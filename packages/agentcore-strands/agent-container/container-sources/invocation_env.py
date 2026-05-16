"""Per-invocation env-var setup for the Strands container.

The AgentCore runtime reuses a warm container across invocations, so every
request must set the per-invocation env (tenant / agent / user / thread)
at entry and clear it in a `finally` block at exit. Otherwise one
invocation's identity leaks into the next — most importantly, a
webhook-triggered run could inherit the previous chat caller's
`CURRENT_USER_ID` and silently pass the admin-skill R15 "no invoker"
check.

The normal `do_POST` path AND the `kind="run_skill"` composition branch
must both call `apply_invocation_env`; today the `run_skill` branch
returns before reaching the env block, leaving scripts without the
identity aliases they expect.

CURRENT_USER_ID is intentionally NOT set when the payload has no
`user_id`. Downstream skills treat a missing key as "no invoker" and
refuse; writing an empty string would bypass that check.
"""

from __future__ import annotations

import json
import os


def apply_invocation_env(payload: dict) -> list[str]:
    """Set per-invocation env vars from the payload.

    Writes these keys when the corresponding payload field is a non-empty
    string:

    - `TENANT_ID`, `_MCP_TENANT_ID` ← `workspace_tenant_id`
    - `AGENT_ID`, `_MCP_AGENT_ID`   ← `assistant_id`
    - `USER_ID`, `_MCP_USER_ID`, `CURRENT_USER_ID` ← `user_id`
    - `CURRENT_THREAD_ID`           ← `thread_id`

    Returns the list of env keys it actually set, so the caller can pass
    it back to `cleanup_invocation_env` to clear exactly those keys
    without disturbing other env state.
    """
    keys: list[str] = []
    workspace_tenant_id = payload.get("workspace_tenant_id") or ""
    assistant_id = payload.get("assistant_id") or ""
    user_id = payload.get("user_id") or ""
    thread_id = payload.get("thread_id") or payload.get("ticket_id") or ""

    if workspace_tenant_id:
        os.environ["_MCP_TENANT_ID"] = workspace_tenant_id
        keys.append("_MCP_TENANT_ID")
        os.environ["TENANT_ID"] = workspace_tenant_id
        keys.append("TENANT_ID")
    if assistant_id:
        os.environ["_MCP_AGENT_ID"] = assistant_id
        keys.append("_MCP_AGENT_ID")
        os.environ["AGENT_ID"] = assistant_id
        keys.append("AGENT_ID")
    if user_id:
        os.environ["_MCP_USER_ID"] = user_id
        keys.append("_MCP_USER_ID")
        os.environ["USER_ID"] = user_id
        keys.append("USER_ID")
        os.environ["CURRENT_USER_ID"] = user_id
        keys.append("CURRENT_USER_ID")
    if thread_id:
        os.environ["CURRENT_THREAD_ID"] = thread_id
        keys.append("CURRENT_THREAD_ID")

    slack = payload.get("slack")
    if isinstance(slack, dict):
        _set_env(keys, "SLACK_ENVELOPE", json.dumps(slack, separators=(",", ":")))
        _set_env(keys, "SLACK_TEAM_ID", slack.get("slackTeamId"))
        _set_env(keys, "SLACK_USER_ID", slack.get("slackUserId"))
        _set_env(keys, "SLACK_WORKSPACE_ROW_ID", slack.get("slackWorkspaceRowId"))
        _set_env(keys, "SLACK_CHANNEL_ID", slack.get("channelId"))
        _set_env(keys, "SLACK_CHANNEL_TYPE", slack.get("channelType"))
        _set_env(keys, "SLACK_ROOT_THREAD_TS", slack.get("rootThreadTs"))
        _set_env(keys, "SLACK_RESPONSE_URL", slack.get("responseUrl"))
        _set_env(keys, "SLACK_TRIGGER_SURFACE", slack.get("triggerSurface"))
        _set_json_env(keys, "SLACK_SOURCE_MESSAGE", slack.get("sourceMessage"))
        _set_json_env(keys, "SLACK_THREAD_CONTEXT", slack.get("threadContext"))
        _set_json_env(keys, "SLACK_FILE_REFS", slack.get("fileRefs"))
        _set_env(keys, "SLACK_PLACEHOLDER_TS", slack.get("placeholderTs"))
        _set_env(keys, "SLACK_MODAL_VIEW_ID", slack.get("modalViewId"))

    # Sandbox. Dispatcher sets sandbox_* payload fields only when pre-
    # flight returned status=ready; server.py reads SANDBOX_INTERPRETER_ID
    # to gate execute_code registration. Unconditional pop at invocation
    # entry prevents a warm container from leaking a prior tenant's
    # interpreter id into this invocation — even if a prior cleanup was
    # interrupted (SIGTERM during deploy, OOM mid-finally). Also removes
    # the retired OAuth preamble keys (SANDBOX_SECRET_PATHS /
    # SANDBOX_TENANT_ID / SANDBOX_USER_ID / SANDBOX_STAGE) left behind
    # by pre-deploy invocations on a warm container (see docs/plans/
    # 2026-04-23-006).
    for stale in (
        "SANDBOX_INTERPRETER_ID",
        "SANDBOX_ENVIRONMENT",
        "SANDBOX_SECRET_PATHS",
        "SANDBOX_TENANT_ID",
        "SANDBOX_USER_ID",
        "SANDBOX_STAGE",
    ):
        os.environ.pop(stale, None)

    sandbox_interpreter_id = payload.get("sandbox_interpreter_id") or ""
    sandbox_environment = payload.get("sandbox_environment") or ""

    if sandbox_interpreter_id:
        os.environ["SANDBOX_INTERPRETER_ID"] = sandbox_interpreter_id
        keys.append("SANDBOX_INTERPRETER_ID")
    if sandbox_environment:
        os.environ["SANDBOX_ENVIRONMENT"] = sandbox_environment
        keys.append("SANDBOX_ENVIRONMENT")

    return keys


def _set_env(keys: list[str], name: str, value: object) -> None:
    if isinstance(value, str) and value:
        os.environ[name] = value
        keys.append(name)


def _set_json_env(keys: list[str], name: str, value: object) -> None:
    if value is not None:
        os.environ[name] = json.dumps(value, separators=(",", ":"))
        keys.append(name)


def cleanup_invocation_env(keys: list[str]) -> None:
    """Pop the env keys that `apply_invocation_env` set for this invocation."""
    for k in keys:
        os.environ.pop(k, None)
