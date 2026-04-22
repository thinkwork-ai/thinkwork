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

logger = logging.getLogger(__name__)


class SkillNotRegisteredError(RuntimeError):
    """Raised by the SkillDispatch closure when a composition step
    references a skill that isn't loaded in this runtime.
    composition_runner catches per-step exceptions and surfaces them as
    failed StepResults, which bubble up to a failed CompositionResult
    with a clear failure_reason.
    """


def post_skill_run_complete(run_id: str, tenant_id: str, status: str,
                             failure_reason: str | None = None,
                             delivered_artifact_ref: dict | None = None) -> None:
    """POST terminal state to the TS /api/skills/complete endpoint.

    Mirrors the urllib pattern from write_memory_tool.py. Service-auth
    via API_AUTH_SECRET (or THINKWORK_API_SECRET alias). Failures log
    loudly but do NOT raise — the smoke timeout is the correct backstop
    diagnostic if the writeback drops.
    """
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

    import urllib.error
    import urllib.request

    body = json.dumps(body_dict).encode("utf-8")
    req = urllib.request.Request(
        f"{api_url.rstrip('/')}/api/skills/complete",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_secret}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
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
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode("utf-8", errors="replace")
        except Exception:
            detail = str(e)
        logger.error(
            "run_skill: completion POST HTTPError runId=%s status=%s detail=%s",
            run_id, e.code, detail[:300],
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
        post_skill_run_complete(run_id, tenant_id, "failed", failure_reason=reason)
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
        post_skill_run_complete(run_id, tenant_id, "failed", failure_reason=reason)
        return {"runId": run_id, "status": "failed", "failureReason": reason}

    # Build the SkillDispatch. This runtime has NO script skills registered
    # for the composition path today (connectors are not wired yet — see
    # docs/plans/2026-04-22-001-fix-composable-skills-prod-incident-e2e-plan.md).
    # Every dispatch raises with a clean, named error; composition_runner
    # catches and surfaces it as a step failure, which propagates to a failed
    # CompositionResult. That's the designed "PASS = clean failure at the
    # connector layer" condition.
    async def dispatch(sub_skill_id: str, sub_inputs: dict):
        raise SkillNotRegisteredError(
            f"skill {sub_skill_id!r} not registered in this runtime"
        )

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

    post_skill_run_complete(run_id, tenant_id, status, failure_reason=failure_reason)
    return {
        "runId": run_id,
        "status": status,
        "failureReason": failure_reason,
    }
