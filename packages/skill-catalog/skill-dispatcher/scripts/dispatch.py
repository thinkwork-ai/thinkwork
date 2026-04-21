"""Skill dispatcher — start composition runs via service-to-service REST call.

The LLM reads the enabled composition skills, matches user intent, resolves
inputs, and calls `start_composition(skill_id, invocation_source, inputs, ...)`.
This module is the thin HTTP client that forwards the call to the API's
`POST /api/skills/start` endpoint. The endpoint mirrors the GraphQL
`startSkillRun` mutation's contract; we use the REST variant here because
the container authenticates with `THINKWORK_API_SECRET`, not a Cognito JWT.

Two tools:
  * start_composition — kicks off a run, returns {runId, status, deduped}.
  * composition_status — polls a previously-started run by id.
"""

import json
import os
import urllib.error
import urllib.request
from typing import Any

API_URL = os.environ.get("THINKWORK_API_URL", "")
API_SECRET = os.environ.get("THINKWORK_API_SECRET", "")
TENANT_ID = os.environ.get("TENANT_ID", "") or os.environ.get("_MCP_TENANT_ID", "")
CURRENT_USER_ID = os.environ.get("CURRENT_USER_ID", "")


def start_composition(
    skill_id: str,
    invocation_source: str = "chat",
    inputs: dict[str, Any] | None = None,
    agent_id: str = "",
    skill_version: int = 1,
    delivery_channels: list[str] | None = None,
) -> str:
    """Start a composition skill run for the current user.

    Args:
        skill_id: Slug of the composition skill (e.g., "sales-prep").
        invocation_source: One of "chat" | "scheduled" | "catalog" | "webhook".
            Chat intent always uses "chat". The scheduled/webhook sources
            are for non-dispatcher callers.
        inputs: Resolved inputs dict per the composition's schema. Empty
            dict is valid for compositions that declare no inputs.
        agent_id: Optional agent id for delivery targeting (e.g. for the
            agent-owner channel on reconciler compositions). Empty =
            agent unspecified.
        skill_version: Composition version to run. Defaults to 1.
        delivery_channels: Optional list naming where the deliverable
            lands (e.g. ["chat", "email"]). Empty uses the composition's
            declared defaults.

    Returns:
        JSON string with either:
          {"runId": "...", "status": "running", "deduped": false} — new run
          {"runId": "...", "status": "running", "deduped": true}  — dedup hit,
              an identical run is already in progress; surface it to the user.
          {"error": "..."} — the dispatcher could not start the run.
    """
    if not skill_id:
        return json.dumps({"error": "skill_id is required"})
    if not API_URL or not API_SECRET:
        return json.dumps({"error": "THINKWORK_API_URL and THINKWORK_API_SECRET required"})
    if not TENANT_ID or not CURRENT_USER_ID:
        return json.dumps({"error": "TENANT_ID and CURRENT_USER_ID required"})
    if invocation_source not in ("chat", "scheduled", "catalog", "webhook"):
        return json.dumps({
            "error": f"invocation_source must be one of chat|scheduled|catalog|webhook "
                     f"(got {invocation_source})"
        })

    body: dict[str, Any] = {
        "tenantId": TENANT_ID,
        "invokerUserId": CURRENT_USER_ID,
        "skillId": skill_id,
        "skillVersion": skill_version,
        "invocationSource": invocation_source,
        "inputs": inputs or {},
        "deliveryChannels": delivery_channels or [],
    }
    if agent_id:
        body["agentId"] = agent_id

    return _post("/api/skills/start", body)


def composition_status(run_id: str) -> str:
    """Fetch the current status of a composition run.

    Args:
        run_id: The runId returned by start_composition.

    Returns:
        JSON string mirroring the run's shape, or {"error": "..."}.
    """
    if not run_id:
        return json.dumps({"error": "run_id is required"})
    if not API_URL or not API_SECRET:
        return json.dumps({"error": "THINKWORK_API_URL and THINKWORK_API_SECRET required"})
    # GraphQL query over the graphql-http Lambda would be the proper path
    # here, but Unit 5 scopes the dispatcher to start-only. Surface the
    # limitation so the LLM knows not to promise progress polling yet.
    return json.dumps({
        "error": "composition_status not yet implemented — see run-detail page for progress",
        "runId": run_id,
    })


# --- HTTP helper -------------------------------------------------------------


def _post(path: str, body: dict[str, Any]) -> str:
    url = f"{API_URL.rstrip('/')}{path}"
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_SECRET}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        body_text = ""
        try:
            body_text = e.read().decode("utf-8")[:500]
        except Exception:
            pass
        return json.dumps({
            "error": f"{path} failed: HTTP {e.code}: {body_text}",
        })
    except urllib.error.URLError as e:
        return json.dumps({"error": f"{path} network error: {e.reason}"})
