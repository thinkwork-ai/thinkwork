"""kind='run_skill' dispatch — entry point for scheduled / webhook /
admin-catalog skill runs.

The TS /api/skills/start handler fires `kind=run_skill` envelopes at the
agentcore Lambda via agentcore-invoke. This module owns:

  * Validating the envelope (runId, tenantId, skillId, agentId required;
    webhook-sourced null agentId is rejected fast per plan §U1 and
    deferred to a follow-up).
  * Fetching the agent's runtime config from the TS API
    (``api_runtime_config.fetch``).
  * Building a synthetic user message: "Run the <skillId> skill with
    these inputs: <json>".
  * Running a headless Strands agent turn via the shared
    ``server._execute_agent_turn`` helper — reuses the exact same
    prologue (skill install, workspace ready, system prompt, tool
    registration) the chat loop uses, so sales-prep run via scheduled
    job and sales-prep run via chat both behave identically.
  * POSTing terminal status back to ``/api/skills/complete`` with
    HMAC-signed callback so skill_runs.status transitions out of
    `running`.

Plan: ``docs/plans/2026-04-24-008-feat-skill-run-dispatcher-plan.md``
(§U3). Replaces the post-§U6 unsupported-runtime rejector in PR #542.
"""

from __future__ import annotations

import json
import logging
import os
import random
import time

logger = logging.getLogger(__name__)

# Bounded retry for the /api/skills/complete POST. Transient Aurora /
# API-gateway blips shouldn't strand the row — the reconciler is a 15-min
# backstop, not a substitute for getting the writeback through. Delays are
# seconds and include ±0.5s jitter to avoid thundering-herd on cold starts.
_COMPLETE_RETRY_DELAYS = (1.0, 3.0, 9.0)
_COMPLETE_RETRY_JITTER = 0.5

# Reason string written to skill_runs.failure_reason when the envelope
# carries a null agentId. Webhook-sourced envelopes are the only path
# that emits null; those runs are deferred to a follow-up PR that will
# route to a tenant-admin fallback agent (plan §U3 Deferred to Follow-Up
# Work).
_MISSING_AGENT_REASON = (
    "run_skill requires an agentId — webhook-sourced runs without one "
    "are deferred to a follow-up"
)


def _urlopen_with_retry(req, timeout: int, run_id: str):
    """Invoke urlopen with bounded retry on transient errors.

    Retries on 5xx HTTPError, URLError, and socket.timeout. Does NOT
    retry on 4xx — those are validation or idempotency signals. Returns
    the response on success (200); raises on terminal failure after the
    last attempt. The caller wraps the raise in a log + return so
    dispatch itself never throws.

    A 400 with body containing "invalid transition" is treated as
    idempotency-ok: a prior attempt already terminated the row, so the
    retry should treat the second server-side refusal as success rather
    than a failure. The function returns None in that case; callers
    check for the sentinel before treating the result as a response.
    """
    import urllib.error
    import urllib.request

    last_exc: Exception | None = None
    for attempt_idx, delay in enumerate((0.0, *_COMPLETE_RETRY_DELAYS), start=1):
        if delay:
            sleep_for = delay + random.uniform(-_COMPLETE_RETRY_JITTER, _COMPLETE_RETRY_JITTER)
            time.sleep(max(0.0, sleep_for))
        try:
            resp = urllib.request.urlopen(req, timeout=timeout)
            logger.info(
                "run_skill: completion POST attempt=%d status=%d runId=%s",
                attempt_idx, resp.status, run_id,
            )
            return resp
        except urllib.error.HTTPError as e:
            # 4xx: terminal. 400 "invalid transition" means a prior attempt
            # already completed this row — treat as idempotency success.
            if 400 <= e.code < 500:
                try:
                    detail = e.read().decode("utf-8", errors="replace")
                except Exception:
                    detail = str(e)
                if e.code == 400 and "invalid transition" in detail.lower():
                    logger.info(
                        "run_skill: completion POST attempt=%d runId=%s "
                        "status=400 invalid-transition (idempotency ok)",
                        attempt_idx, run_id,
                    )
                    return None
                logger.error(
                    "run_skill: completion POST attempt=%d runId=%s "
                    "status=%d terminal (no retry) detail=%s",
                    attempt_idx, run_id, e.code, detail[:300],
                )
                raise
            # 5xx: retryable.
            logger.warning(
                "run_skill: completion POST attempt=%d runId=%s "
                "status=%d retryable HTTPError",
                attempt_idx, run_id, e.code,
            )
            last_exc = e
        except (TimeoutError, urllib.error.URLError) as e:
            logger.warning(
                "run_skill: completion POST attempt=%d runId=%s retryable transport error: %s",
                attempt_idx, run_id, e,
            )
            last_exc = e
    # Exhausted retries.
    assert last_exc is not None  # mypy: loop guarantees an exception was seen
    logger.error(
        "run_skill: completion POST runId=%s exhausted %d attempts, raising",
        run_id, len(_COMPLETE_RETRY_DELAYS) + 1,
    )
    raise last_exc


def post_skill_run_complete(run_id: str, tenant_id: str, status: str,
                             failure_reason: str | None = None,
                             delivered_artifact_ref: dict | None = None,
                             completion_hmac_secret: str | None = None,
                             api_url: str | None = None,
                             api_secret: str | None = None) -> None:
    """POST terminal state to the TS /api/skills/complete endpoint.

    Service-auth via API_AUTH_SECRET (or THINKWORK_API_SECRET alias)
    AND a per-run HMAC header computed from completion_hmac_secret
    (arrived in the run_skill envelope). The HMAC gate means a leaked
    API_AUTH_SECRET plus a guessed runId cannot forge a completion for
    someone else's run. Uses a bounded retry (3 attempts, exponential
    backoff with jitter) to ride through transient Aurora / API-gateway
    blips; the 15-minute skill-runs-reconciler is the backstop. Failures
    log loudly but do NOT raise — a dispatch coroutine should never
    throw because of a writeback failure.

    ``api_url`` + ``api_secret`` may be passed in by the caller as a
    snapshot taken at dispatcher entry. This avoids re-reading
    ``os.environ`` after a long-running agent turn, where (per real
    incidents on dev 2026-04-25) the env can appear empty even though
    runtime-config fetch succeeded earlier in the same coroutine. When
    not provided, falls back to env reads as a backstop for callers
    that don't snapshot.
    """
    import hashlib as _hashlib
    import hmac as _hmac
    import urllib.request

    api_url = api_url or os.environ.get("THINKWORK_API_URL") or ""
    api_secret = api_secret or (
        os.environ.get("API_AUTH_SECRET")
        or os.environ.get("THINKWORK_API_SECRET")
        or ""
    )
    if not api_url or not api_secret:
        logger.error(
            "run_skill: cannot post completion — missing THINKWORK_API_URL / API_AUTH_SECRET "
            "(neither parameter passed nor env var present); runId=%s status=%s — "
            "row will land on the 15-min reconciler",
            run_id, status,
        )
        return

    body_dict: dict = {"runId": run_id, "tenantId": tenant_id, "status": status}
    if failure_reason is not None:
        body_dict["failureReason"] = str(failure_reason)[:500]
    if delivered_artifact_ref is not None:
        body_dict["deliveredArtifactRef"] = delivered_artifact_ref

    body = json.dumps(body_dict).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_secret}",
    }
    if completion_hmac_secret:
        signature = _hmac.new(
            completion_hmac_secret.encode("utf-8"),
            run_id.encode("utf-8"),
            _hashlib.sha256,
        ).hexdigest()
        headers["X-Skill-Run-Signature"] = f"sha256={signature}"
    else:
        # The envelope is supposed to carry this; if it doesn't, the server
        # will 401 and the retry helper will surface the terminal failure.
        logger.warning(
            "run_skill: no completion_hmac_secret in envelope for runId=%s; "
            "server will reject the completion POST",
            run_id,
        )
    req = urllib.request.Request(
        f"{api_url.rstrip('/')}/api/skills/complete",
        data=body,
        method="POST",
        headers=headers,
    )
    try:
        resp = _urlopen_with_retry(req, timeout=15, run_id=run_id)
        if resp is None:
            # Idempotency-ok from a prior attempt's success.
            return
        with resp:
            if resp.status != 200:
                logger.error(
                    "run_skill: completion POST returned HTTP %s for runId=%s",
                    resp.status, run_id,
                )
            else:
                logger.info(
                    "run_skill: completion POSTed — runId=%s status=%s",
                    run_id, status,
                )
    except Exception as e:
        logger.error("run_skill: completion POST failed runId=%s err=%s", run_id, e)


def _build_synthetic_payload(
    envelope: dict, runtime_config: dict, user_message: str,
) -> dict:
    """Shape a chat-invoke-style payload from a run_skill envelope + the
    runtime config fetched from /api/agents/runtime-config.

    Accepts ``runtime_config`` with either camelCase (TS endpoint shape)
    or snake_case keys. The REST endpoint returns the helper's camelCase
    AgentRuntimeConfig shape today, so we translate here. Tests pass
    snake_case for simplicity.
    """
    scope = envelope.get("scope") or {}

    def _cfg(key_camel: str, key_snake: str | None = None) -> object:
        if key_camel in runtime_config:
            return runtime_config[key_camel]
        if key_snake and key_snake in runtime_config:
            return runtime_config[key_snake]
        return None

    tenant_id = envelope.get("tenantId") or scope.get("tenantId") or ""
    agent_id = envelope.get("agentId") or scope.get("agentId") or ""
    invoker_user_id = (
        envelope.get("invokerUserId") or scope.get("invokerUserId") or ""
    )
    thread_id = envelope.get("threadId") or scope.get("threadId") or ""

    payload: dict = {
        "tenant_id": tenant_id,
        "workspace_tenant_id": tenant_id,
        "assistant_id": agent_id,
        "user_id": invoker_user_id,
        "thread_id": thread_id,
        "tenant_slug": _cfg("tenantSlug", "tenant_slug") or "",
        "instance_id": _cfg("agentSlug", "agent_slug") or "",
        "agent_name": _cfg("agentName", "agent_name") or "",
        "human_name": _cfg("humanName", "human_name") or "",
        "runtime_type": _cfg("runtimeType", "runtime_type") or "strands",
        "model": _cfg("templateModel", "template_model") or "",
        "skills": _cfg("skillsConfig", "skills") or [],
        "knowledge_bases": _cfg("knowledgeBasesConfig", "knowledge_bases"),
        "guardrail_config": _cfg("guardrailConfig", "guardrail_config"),
        "mcp_configs": _cfg("mcpConfigs", "mcp_configs") or [],
        "blocked_tools": _cfg("blockedTools", "blocked_tools") or [],
        "thinkwork_api_url": (
            envelope.get("thinkworkApiUrl")
            or envelope.get("thinkwork_api_url")
            or os.environ.get("THINKWORK_API_URL")
            or ""
        ),
        "thinkwork_api_secret": (
            envelope.get("apiAuthSecret")
            or envelope.get("thinkworkApiSecret")
            or envelope.get("api_auth_secret")
            or os.environ.get("THINKWORK_API_SECRET")
            or os.environ.get("API_AUTH_SECRET")
            or ""
        ),
        "hindsight_endpoint": os.environ.get("HINDSIGHT_ENDPOINT") or "",
        "workspace_bucket": os.environ.get("AGENTCORE_FILES_BUCKET") or "",
        "message": user_message,
        "messages_history": [],
        "trigger_channel": "run_skill",
        "use_memory": False,
    }
    return payload


def _format_user_message(skill_id: str, resolved_inputs: dict) -> str:
    """Synthetic user prompt handed to the Strands agent.

    The agent sees the skill's SKILL.md via the AgentSkills plugin's
    progressive disclosure; this prompt just tells it which skill to
    run and with what args. Kept deliberately simple — the model reads
    the SKILL.md body on demand via the plugin's built-in ``skills``
    tool, and the body carries the method.
    """
    try:
        args_json = json.dumps(resolved_inputs or {}, indent=2, sort_keys=True)
    except (TypeError, ValueError):
        args_json = repr(resolved_inputs)
    return (
        f"Run the `{skill_id}` skill with these inputs:\n\n"
        f"```json\n{args_json}\n```\n\n"
        f"Follow the skill's SKILL.md body. Produce the final "
        f"deliverable as your response — don't wrap it in a status "
        f"summary."
    )


async def dispatch_run_skill(payload: dict) -> dict:
    """Execute a ``kind=run_skill`` envelope end-to-end.

    Plan §U3. Envelope → runtime config fetch → synthetic chat turn via
    ``server._execute_agent_turn`` → /api/skills/complete callback.

    Invocation env (TENANT_ID / AGENT_ID / USER_ID / CURRENT_USER_ID /
    CURRENT_THREAD_ID + underscored MCP aliases) is already applied by
    the caller in ``server.py``'s run_skill branch; this function does
    NOT touch ``invocation_env.apply/cleanup``.

    Returns a small status dict the HTTP handler forwards verbatim. The
    authoritative state lives in Postgres via the completion callback.
    """
    run_id = payload.get("runId") or ""
    tenant_id = payload.get("tenantId") or ""
    skill_id = payload.get("skillId") or ""
    agent_id = payload.get("agentId") or ""
    resolved_inputs = payload.get("resolvedInputs") or {}
    scope = payload.get("scope") or {}
    completion_hmac_secret = payload.get("completionHmacSecret") or ""
    invoker_user_id = (
        payload.get("invokerUserId") or scope.get("invokerUserId") or ""
    )

    # Snapshot the completion-callback env at dispatcher entry. Real
    # incidents on dev (2026-04-25, run c886c82e + 6d143ead) showed that
    # ``os.environ.get("THINKWORK_API_URL")`` could come back empty after
    # ``_execute_agent_turn`` finished, even though the same env was
    # populated 30 seconds earlier when ``_fetch_runtime_config`` and
    # ``workspace_sync action=composer_fetch`` both succeeded. Cause is
    # not fully diagnosed (something inside the long agent turn appears
    # to clear or shadow these vars), but the fix is structural: capture
    # them now and pass them through. ``post_skill_run_complete`` falls
    # back to ``os.environ`` when these are not provided, preserving
    # backward compatibility for the few internal callers that don't
    # snapshot.
    api_url_snapshot = (
        payload.get("thinkworkApiUrl")
        or payload.get("thinkwork_api_url")
        or os.environ.get("THINKWORK_API_URL")
        or ""
    )
    api_secret_snapshot = (
        payload.get("apiAuthSecret")
        or payload.get("thinkworkApiSecret")
        or payload.get("api_auth_secret")
        or os.environ.get("API_AUTH_SECRET")
        or os.environ.get("THINKWORK_API_SECRET")
        or ""
    )
    if not api_url_snapshot or not api_secret_snapshot:
        # Container env is genuinely empty at dispatcher entry — most
        # likely the boot-pre-env-injection race documented in
        # ``project_agentcore_deploy_race_env``. We can't post the
        # completion at all from here; let the row hit the 15-min
        # reconciler. Loud log so operators see the cause in CloudWatch
        # Insights.
        logger.error(
            "run_skill: container env unset at dispatcher entry "
            "(THINKWORK_API_URL / API_AUTH_SECRET both empty); "
            "cannot post completion callback. runId=%s skillId=%s — "
            "row will hit the 15-min reconciler",
            run_id, skill_id,
        )

    if not (run_id and tenant_id and skill_id):
        return {
            "runId": run_id,
            "status": "failed",
            "error": "missing runId/tenantId/skillId",
        }

    if not agent_id:
        logger.warning(
            "run_skill: rejecting envelope with null agentId runId=%s skillId=%s",
            run_id, skill_id,
        )
        post_skill_run_complete(
            run_id, tenant_id, "failed",
            failure_reason=_MISSING_AGENT_REASON,
            completion_hmac_secret=completion_hmac_secret,
            api_url=api_url_snapshot,
            api_secret=api_secret_snapshot,
        )
        return {
            "runId": run_id,
            "status": "failed",
            "failureReason": _MISSING_AGENT_REASON,
        }

    from api_runtime_config import (
        AgentConfigNotFoundError,
        RuntimeConfigFetchError,
    )
    from api_runtime_config import (
        fetch as _fetch_runtime_config,
    )

    try:
        runtime_config = _fetch_runtime_config(
            agent_id=agent_id,
            tenant_id=tenant_id,
            current_user_id=invoker_user_id or None,
            api_url=api_url_snapshot,
            api_secret=api_secret_snapshot,
        )
    except AgentConfigNotFoundError as exc:
        logger.error("run_skill: %s", exc.reason)
        post_skill_run_complete(
            run_id, tenant_id, "failed",
            failure_reason=exc.reason,
            completion_hmac_secret=completion_hmac_secret,
            api_url=api_url_snapshot,
            api_secret=api_secret_snapshot,
        )
        return {
            "runId": run_id,
            "status": "failed",
            "failureReason": exc.reason,
        }
    except RuntimeConfigFetchError as exc:
        reason = f"runtime-config fetch failed: {exc.reason}"
        logger.error("run_skill: %s", reason)
        post_skill_run_complete(
            run_id, tenant_id, "failed",
            failure_reason=reason,
            completion_hmac_secret=completion_hmac_secret,
            api_url=api_url_snapshot,
            api_secret=api_secret_snapshot,
        )
        return {
            "runId": run_id,
            "status": "failed",
            "failureReason": reason,
        }

    user_message = _format_user_message(skill_id, resolved_inputs)
    synthetic_payload = _build_synthetic_payload(
        payload, runtime_config, user_message,
    )

    try:
        from server import _execute_agent_turn
    except ImportError as exc:
        reason = f"_execute_agent_turn unavailable: {exc}"
        logger.error("run_skill: %s", reason)
        post_skill_run_complete(
            run_id, tenant_id, "failed",
            failure_reason=reason,
            completion_hmac_secret=completion_hmac_secret,
            api_url=api_url_snapshot,
            api_secret=api_secret_snapshot,
        )
        return {
            "runId": run_id,
            "status": "failed",
            "failureReason": reason,
        }

    try:
        turn_result = _execute_agent_turn(synthetic_payload)
        response_text = str(turn_result.get("response_text") or "")
    except Exception as exc:
        logger.exception("run_skill: _execute_agent_turn raised")
        reason = f"agent loop crashed: {exc}"
        post_skill_run_complete(
            run_id, tenant_id, "failed",
            failure_reason=reason,
            completion_hmac_secret=completion_hmac_secret,
            api_url=api_url_snapshot,
            api_secret=api_secret_snapshot,
        )
        return {
            "runId": run_id,
            "status": "failed",
            "failureReason": reason,
        }

    if not response_text.strip():
        reason = "agent produced no final text"
        logger.warning("run_skill: %s runId=%s skillId=%s", reason, run_id, skill_id)
        post_skill_run_complete(
            run_id, tenant_id, "failed",
            failure_reason=reason,
            completion_hmac_secret=completion_hmac_secret,
            api_url=api_url_snapshot,
            api_secret=api_secret_snapshot,
        )
        return {
            "runId": run_id,
            "status": "failed",
            "failureReason": reason,
        }

    delivered_artifact_ref = {"type": "inline", "payload": response_text}
    post_skill_run_complete(
        run_id, tenant_id, "complete",
        delivered_artifact_ref=delivered_artifact_ref,
        completion_hmac_secret=completion_hmac_secret,
        api_url=api_url_snapshot,
        api_secret=api_secret_snapshot,
    )
    return {
        "runId": run_id,
        "status": "complete",
        "deliveredArtifactRef": delivered_artifact_ref,
    }
