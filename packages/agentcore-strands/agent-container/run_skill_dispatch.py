"""kind='run_skill' dispatch — composition runner entry point.

The TS /api/skills/start handler fires `kind=run_skill` envelopes at the
agentcore Lambda via agentcore-invoke. This module owns:

  * Loading the target composition YAML from S3 via install_skills
  * Building a SkillDispatch closure that raises for any un-registered
    sub-skill (per the composable-skills plan, failing at a specific
    missing connector is a PASS condition — it proves the full
    dispatch → runtime → DB loop works end-to-end)
  * Calling run_composition and translating the CompositionResult to a
    terminal status
  * POSTing that terminal status back to /api/skills/complete so
    skill_runs.status transitions out of `running`

Extracted from server.py so unit tests can exercise it without pulling
in the full chat-agent + permissions + strands runtime import graph.
server.py imports and calls `dispatch_run_skill(payload)` from its
do_POST handler under the kind=='run_skill' branch.
"""

from __future__ import annotations

import json
import logging
import os
import random
import re
import socket
import time
from typing import Any

logger = logging.getLogger(__name__)

# Bounded retry for the /api/skills/complete POST. Transient Aurora /
# API-gateway blips shouldn't strand the row — the reconciler is a 15-min
# backstop, not a substitute for getting the writeback through. Delays are
# seconds and include ±0.5s jitter to avoid thundering-herd on cold starts.
_COMPLETE_RETRY_DELAYS = (1.0, 3.0, 9.0)
_COMPLETE_RETRY_JITTER = 0.5

# context-mode sub-skill defaults. Model matches DEFAULT_MODEL in server.py —
# context-mode prompts are short, deterministic-enough Sonnet workloads.
_DEFAULT_CONTEXT_MODEL = "us.anthropic.claude-sonnet-4-6"

# Single-brace template-token regex, matching the format used by the
# composition-invoked context skills' prompt files (packages/skill-catalog/
# frame/prompts/frame.md, synthesize/prompts/synthesize.md). The plan's
# handoff doc suggested lifting the package skill's double-brace {{ var }}
# regex, but the real prompt files use {var} — using Mustache here would
# leave every placeholder unresolved in the rendered prompt. Missing keys
# render as empty string to mirror render.py's _lookup behavior.
_CONTEXT_TEMPLATE_TOKEN = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")


class SkillNotRegisteredError(RuntimeError):
    """Raised by the SkillDispatch closure when a composition step
    references a skill that isn't loaded in this runtime.
    composition_runner catches per-step exceptions and surfaces them as
    failed StepResults, which bubble up to a failed CompositionResult
    with a clear failure_reason.
    """


def _invoke_sub_skill(sub_skill_id: str, sub_inputs: dict):
    """Execute one sub-skill referenced by a composition step.

    Sync from S3 (idempotent — warm invocations reuse /tmp/skills), read
    the sub-skill's skill.yaml, and dispatch on `execution`:

      * `script` — import the declared script file and call its entry
        function with `sub_inputs` kwargs. Deterministic.
      * `context` — render the skill's prompt template against
        `sub_inputs` and invoke Bedrock Converse. Returns the model's
        response text as the sub-skill's output. Composition steps that
        need LLM reasoning (frame / synthesize) take this path.
      * anything else — raise SkillNotRegisteredError so the composition
        runner surfaces a clean per-step failure with a named reason.
    """
    import importlib.util
    import os
    import yaml  # type: ignore[import-untyped]

    try:
        from install_skills import install_skill_from_s3, SKILLS_DIR
    except ImportError as exc:
        raise SkillNotRegisteredError(
            f"install_skills module unavailable: {exc}"
        ) from exc

    # Idempotent sync. Real install_skill_from_s3 is a no-op when the
    # bucket env var is unset (tests), or when objects are already on disk.
    try:
        install_skill_from_s3(f"skills/catalog/{sub_skill_id}", sub_skill_id)
    except Exception as exc:
        raise SkillNotRegisteredError(
            f"skill {sub_skill_id!r} failed to sync from S3: {exc}"
        ) from exc

    yaml_path = os.path.join(SKILLS_DIR, sub_skill_id, "skill.yaml")
    if not os.path.isfile(yaml_path):
        raise SkillNotRegisteredError(
            f"skill {sub_skill_id!r} has no skill.yaml in {SKILLS_DIR}"
        )

    with open(yaml_path) as f:
        meta = yaml.safe_load(f) or {}

    execution = meta.get("execution") or ""
    if execution == "context":
        return _invoke_context_skill(sub_skill_id, sub_inputs, meta)
    if execution != "script":
        raise SkillNotRegisteredError(
            f"skill {sub_skill_id!r} execution={execution!r} is not wired "
            f"in the run_skill dispatch path yet "
            f"(only 'script' and 'context' are supported)"
        )

    scripts = meta.get("scripts") or []
    if not scripts:
        raise SkillNotRegisteredError(
            f"skill {sub_skill_id!r} declares execution=script but has no "
            f"`scripts:` entries"
        )

    # v1: each composition-invocable script skill declares exactly one
    # entry script whose function name matches `scripts[0].name`. If a
    # skill ever needs multi-entry dispatch, the step YAML would have to
    # specify which function to call — not a concern for today's smokes.
    entry = scripts[0]
    script_path = os.path.join(SKILLS_DIR, sub_skill_id, entry.get("path", ""))
    fn_name = entry.get("name") or ""
    if not os.path.isfile(script_path) or not fn_name:
        raise SkillNotRegisteredError(
            f"skill {sub_skill_id!r} script_path={script_path!r} or "
            f"fn_name={fn_name!r} missing"
        )

    # Dynamic import. Module name is namespaced so reloading the same
    # skill across invocations doesn't collide with other modules.
    module_key = f"_skill_{sub_skill_id.replace('-', '_')}_{fn_name}"
    spec = importlib.util.spec_from_file_location(module_key, script_path)
    if spec is None or spec.loader is None:
        raise SkillNotRegisteredError(
            f"skill {sub_skill_id!r} could not build import spec for {script_path}"
        )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    fn = getattr(module, fn_name, None)
    if not callable(fn):
        raise SkillNotRegisteredError(
            f"skill {sub_skill_id!r} script {script_path} has no callable "
            f"named {fn_name!r}"
        )

    try:
        return fn(**(sub_inputs or {}))
    except TypeError as exc:
        # Bad inputs shape — surface cleanly so the step fails with a named
        # reason rather than a mystery stack trace.
        raise SkillNotRegisteredError(
            f"skill {sub_skill_id!r} refused inputs: {exc}"
        ) from exc


def _render_context_template(template: str, sub_inputs: dict[str, Any]) -> str:
    """Substitute {key} tokens in a prompt template against sub_inputs.

    Missing keys render as empty string (mirrors
    packages/skill-catalog/package/scripts/render.py's _lookup). Non-string
    values are JSON-encoded so dicts / lists passed between composition
    steps arrive as readable text instead of Python repr.
    """
    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        if key not in sub_inputs:
            return ""
        value = sub_inputs[key]
        if value is None:
            return ""
        if isinstance(value, str):
            return value
        if isinstance(value, (int, float, bool)):
            return str(value)
        return json.dumps(value)

    return _CONTEXT_TEMPLATE_TOKEN.sub(replace, template)


def _invoke_context_skill(sub_skill_id: str, sub_inputs: dict, meta: dict):
    """Execute an execution=context sub-skill via Bedrock Converse.

    Prompt file location is `<SKILLS_DIR>/<sub_skill_id>/prompts/<slug>.md`
    where slug = meta.get('slug') or sub_skill_id. That matches the
    on-disk layout of the composition-invoked context skills (frame,
    synthesize). The skill.yaml may declare `model:` to override the
    default sonnet-4-6 selection.

    No system prompt beyond the rendered template — context skills self-
    describe their role in the template's opening lines ("You are the
    `frame` step of a composition…"). One user-message converse call;
    return the concatenated text blocks from the assistant response.
    """
    from install_skills import SKILLS_DIR  # local import — already loaded by caller

    slug = meta.get("slug") or sub_skill_id
    prompt_path = os.path.join(SKILLS_DIR, sub_skill_id, "prompts", f"{slug}.md")
    if not os.path.isfile(prompt_path):
        raise SkillNotRegisteredError(
            f"skill {sub_skill_id!r} (execution=context) has no prompt at "
            f"{prompt_path}"
        )

    with open(prompt_path, encoding="utf-8") as f:
        template = f.read()

    try:
        rendered = _render_context_template(template, sub_inputs or {})
    except Exception as exc:
        raise SkillNotRegisteredError(
            f"skill {sub_skill_id!r} prompt render failed: {exc}"
        ) from exc

    model_id = meta.get("model") or _DEFAULT_CONTEXT_MODEL

    try:
        import boto3  # type: ignore[import-untyped]
    except ImportError as exc:
        raise SkillNotRegisteredError(
            f"skill {sub_skill_id!r} (execution=context): boto3 unavailable: {exc}"
        ) from exc

    client = boto3.client("bedrock-runtime")
    try:
        response = client.converse(
            modelId=model_id,
            messages=[{"role": "user", "content": [{"text": rendered}]}],
        )
    except Exception as exc:
        raise SkillNotRegisteredError(
            f"skill {sub_skill_id!r} (execution=context) Bedrock converse "
            f"failed: {exc}"
        ) from exc

    # Converse response shape: output.message.content is a list of blocks;
    # text-only context skills emit one or more {"text": "..."} entries.
    try:
        blocks = response["output"]["message"]["content"]
    except (KeyError, TypeError) as exc:
        raise SkillNotRegisteredError(
            f"skill {sub_skill_id!r} (execution=context) Bedrock response "
            f"missing output.message.content: {exc}"
        ) from exc

    text_parts = [b.get("text", "") for b in blocks if isinstance(b, dict) and "text" in b]
    return "".join(text_parts)


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
        except (urllib.error.URLError, socket.timeout) as e:
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
                             completion_hmac_secret: str | None = None) -> None:
    """POST terminal state to the TS /api/skills/complete endpoint.

    Mirrors the urllib pattern from write_memory_tool.py. Service-auth
    via API_AUTH_SECRET (or THINKWORK_API_SECRET alias) AND a per-run
    HMAC header computed from completion_hmac_secret (arrived in the
    run_skill envelope). The HMAC gate means a leaked API_AUTH_SECRET
    plus a guessed runId cannot forge a completion for someone else's
    run. Uses a bounded retry (3 attempts, exponential backoff with
    jitter) to ride through transient Aurora / API-gateway blips; the
    15-minute skill-runs-reconciler is the backstop for anything that
    makes it past the retries. Failures log loudly but do NOT raise out
    of this function — a dispatch coroutine should never throw because
    of a writeback failure.
    """
    import hmac as _hmac
    import hashlib as _hashlib
    import urllib.request

    api_url = os.environ.get("THINKWORK_API_URL") or ""
    api_secret = (
        os.environ.get("API_AUTH_SECRET")
        or os.environ.get("THINKWORK_API_SECRET")
        or ""
    )
    if not api_url or not api_secret:
        logger.error(
            "run_skill: cannot post completion — missing THINKWORK_API_URL / API_AUTH_SECRET"
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


async def dispatch_run_skill(payload: dict) -> dict:
    """Execute a composition end-to-end for a kind='run_skill' envelope.

    Loads the target composition YAML from S3, builds a SkillDispatch
    closure that raises SkillNotRegisteredError for any sub-skill not
    present, runs the composition, and posts terminal state back to
    the TS API. Returns a small dict the HTTP handler can include in
    its /invocations response — the authoritative state lives in
    Postgres via the completion callback.
    """
    run_id = payload.get("runId") or ""
    tenant_id = payload.get("tenantId") or ""
    skill_id = payload.get("skillId") or ""
    resolved_inputs = payload.get("resolvedInputs") or {}
    scope = payload.get("scope") or {}
    completion_hmac_secret = payload.get("completionHmacSecret") or ""

    if not (run_id and tenant_id and skill_id):
        return {
            "runId": run_id,
            "status": "failed",
            "error": "missing runId/tenantId/skillId",
        }

    # Sync the target skill's YAML from S3. Skills ship under
    # s3://<bucket>/skills/catalog/<id>/. Idempotent; warm invocations
    # reuse /tmp/skills.
    try:
        from install_skills import install_skill_from_s3
        install_skill_from_s3(f"skills/catalog/{skill_id}", skill_id)
    except Exception as e:
        reason = f"failed to sync composition skill {skill_id!r} from S3: {e}"
        logger.error("run_skill: %s", reason)
        post_skill_run_complete(
            run_id, tenant_id, "failed",
            failure_reason=reason,
            completion_hmac_secret=completion_hmac_secret,
        )
        return {"runId": run_id, "status": "failed", "failureReason": reason}

    # Load the composition (pydantic-validated). load_composition_skills
    # returns a dict keyed by composition.id.
    from skill_runner import load_composition_skills
    compositions = load_composition_skills([{"skillId": skill_id}])
    composition = compositions.get(skill_id)
    if composition is None:
        reason = (
            f"composition skillId={skill_id!r} not loaded "
            f"(YAML missing or not execution: composition)"
        )
        logger.error("run_skill: %s", reason)
        post_skill_run_complete(
            run_id, tenant_id, "failed",
            failure_reason=reason,
            completion_hmac_secret=completion_hmac_secret,
        )
        return {"runId": run_id, "status": "failed", "failureReason": reason}

    # Build the SkillDispatch. For each sub-skill requested by a composition
    # step, we sync the skill from S3, inspect its skill.yaml, and:
    #   * execution: script — import the declared script file and call its
    #     entry function with `inputs` kwargs. Deterministic, no LLM.
    #   * everything else (context, composition, agent) — not yet wired in
    #     the run_skill path; raise SkillNotRegisteredError so the step
    #     fails cleanly with a named reason.
    async def dispatch(sub_skill_id: str, sub_inputs: dict):
        try:
            return _invoke_sub_skill(sub_skill_id, sub_inputs)
        except SkillNotRegisteredError as exc:
            # composition_runner only surfaces the exception class name, so
            # log the full message here for CloudWatch debugging.
            logger.warning("run_skill: sub-skill %r dispatch failed: %s",
                           sub_skill_id, exc)
            raise

    from composition_runner import run_composition
    try:
        result = await run_composition(
            composition,
            resolved_inputs if isinstance(resolved_inputs, dict) else {},
            dispatch,
            context={"scope": scope} if scope else None,
        )
        status = result.status
        failure_reason = result.failure_reason
    except Exception as e:
        # run_composition shouldn't raise under normal conditions (it
        # catches dispatch exceptions per-step), but catastrophic failure
        # (YAML corruption, programming error) lands here. Mark failed +
        # post so the DB row transitions.
        logger.exception("run_skill: run_composition raised unexpectedly")
        status = "failed"
        failure_reason = f"composition_runner raised: {e}"

    post_skill_run_complete(
        run_id, tenant_id, status,
        failure_reason=failure_reason,
        completion_hmac_secret=completion_hmac_secret,
    )
    return {
        "runId": run_id,
        "status": status,
        "failureReason": failure_reason,
    }
