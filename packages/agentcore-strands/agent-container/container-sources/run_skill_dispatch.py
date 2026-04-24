"""kind='run_skill' dispatch — entry point for scheduled / webhook /
admin-catalog skill runs.

The TS /api/skills/start handler fires `kind=run_skill` envelopes at the
agentcore Lambda via agentcore-invoke. This module owns:

  * Validating the envelope has the minimum fields needed to complete
    the row cleanly.
  * Sending a terminal `failed` writeback to /api/skills/complete with a
    clear reason when the runtime cannot execute the target.

U6 removed the parallel orchestrator module (plus its input-parser
sibling) that used to execute ``kind=run_skill`` envelopes. Every V1
skill now declares ``execution: context`` and runs inside the chat
agent loop via the ``Skill`` meta-tool (U5). The sandboxed unified
dispatcher (U4, ``skill_dispatcher.dispatch_skill_script``) is wired
into the chat loop but does not yet have a production wiring for
out-of-band skill_runs envelopes — that wiring is out of scope for U6.

Until a replacement dispatcher lands here, ``kind=run_skill`` envelopes
simply fail fast with a named reason so scheduled / webhook / catalog
callers see a clean `failed` row instead of a stuck `running` row. The
user authorized this cutover: per docs/plans/2026-04-23-007 §U6, the
orchestrator deletion ships before the dispatcher replacement.
"""

from __future__ import annotations

import json
import logging
import os
import random
import socket
import time

logger = logging.getLogger(__name__)

# Bounded retry for the /api/skills/complete POST. Transient Aurora /
# API-gateway blips shouldn't strand the row — the reconciler is a 15-min
# backstop, not a substitute for getting the writeback through. Delays are
# seconds and include ±0.5s jitter to avoid thundering-herd on cold starts.
_COMPLETE_RETRY_DELAYS = (1.0, 3.0, 9.0)
_COMPLETE_RETRY_JITTER = 0.5


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

    Service-auth via API_AUTH_SECRET (or THINKWORK_API_SECRET alias)
    AND a per-run HMAC header computed from completion_hmac_secret
    (arrived in the run_skill envelope). The HMAC gate means a leaked
    API_AUTH_SECRET plus a guessed runId cannot forge a completion for
    someone else's run. Uses a bounded retry (3 attempts, exponential
    backoff with jitter) to ride through transient Aurora / API-gateway
    blips; the 15-minute skill-runs-reconciler is the backstop. Failures
    log loudly but do NOT raise — a dispatch coroutine should never
    throw because of a writeback failure.
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


# Human-readable reason returned to callers and written to skill_runs.failure_reason
# when the envelope lands during the U6 cutover window. Kept as a module constant
# so tests can assert it verbatim.
_U6_UNSUPPORTED_REASON = (
    "kind=run_skill is unsupported in this runtime: U6 removed the composition "
    "runner and a replacement out-of-band dispatcher has not landed yet. "
    "Skills are invoked via the Skill() meta-tool inside chat — scheduled / "
    "webhook / catalog paths that target skill_runs are temporarily offline "
    "per plan #007 §U6."
)


async def dispatch_run_skill(payload: dict) -> dict:
    """Terminate a kind='run_skill' envelope with a structured failure.

    Until a replacement dispatcher is wired, every envelope lands as
    ``failed`` with ``_U6_UNSUPPORTED_REASON``. The run row still
    transitions cleanly (so dedup slots free up and admins see the
    failure in the UI) — the only difference from a "normal" failure
    is that no Python execution ran against the skill.
    """
    run_id = payload.get("runId") or ""
    tenant_id = payload.get("tenantId") or ""
    skill_id = payload.get("skillId") or ""
    completion_hmac_secret = payload.get("completionHmacSecret") or ""

    if not (run_id and tenant_id and skill_id):
        # Pre-HMAC failure — we cannot reach the complete endpoint
        # without a runId/tenantId, so just return the structured error.
        # The TS caller will transition the row itself.
        return {
            "runId": run_id,
            "status": "failed",
            "error": "missing runId/tenantId/skillId",
        }

    logger.warning(
        "run_skill: failing envelope for skillId=%s runId=%s — %s",
        skill_id, run_id, _U6_UNSUPPORTED_REASON,
    )

    post_skill_run_complete(
        run_id, tenant_id, "failed",
        failure_reason=_U6_UNSUPPORTED_REASON,
        completion_hmac_secret=completion_hmac_secret,
    )
    return {
        "runId": run_id,
        "status": "failed",
        "failureReason": _U6_UNSUPPORTED_REASON,
    }
