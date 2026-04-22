"""Wrapper module for the thinkwork-admin skill.

Provides the shared GraphQL client, env probe, `@_safe` decorator, and
role / allowlist pre-checks used by every tool function in this skill.
Units 7 (reads) and 8 (mutations) import from here; until they land,
the skill exposes no tool functions.

Auth model (three layers):
  1. Service secret (`x-api-key: $THINKWORK_API_SECRET`) proves the
     caller is the agent runtime.
  2. `x-principal-id` / `x-tenant-id` / `x-agent-id` assert the invoker
     + target tenant + calling agent. `cognito-auth.ts` already parses
     these headers for apikey callers.
  3. Per-agent allowlist enforced at the resolver
     (`requireAgentAllowsOperation`, Unit 3). The wrapper's
     `_check_admin_role()` here is an early-fail UX pre-check — the
     server-side gate is the authoritative one.

R15 (no invoker → refuse): `_env()` raises when `CURRENT_USER_ID` is
missing. Webhook-triggered invocations leave it unset on purpose.
"""

from __future__ import annotations

import functools
import json
import os
import urllib.error
import urllib.request
from typing import Any, Callable

# Env resolution. Fall back to the underscored MCP aliases — matches the
# pattern in `agent-thread-management/scripts/threads.py` so tests that
# only set the MCP aliases still work.
API_URL = os.environ.get("THINKWORK_API_URL", "")
API_SECRET = os.environ.get("THINKWORK_API_SECRET", "") or os.environ.get(
    "API_AUTH_SECRET", ""
)
TENANT_ID = os.environ.get("TENANT_ID", "") or os.environ.get("_MCP_TENANT_ID", "")
AGENT_ID = os.environ.get("AGENT_ID", "") or os.environ.get("_MCP_AGENT_ID", "")
CURRENT_USER_ID = os.environ.get("CURRENT_USER_ID", "")


class AdminSkillRefusal(Exception):
    """Structured refusal surfaced by wrapper-side pre-checks.

    Carries a stable `reason` code the agent can reason about and an
    audit hook in `extra` for Unit 12's structured log.
    """

    def __init__(self, reason: str, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.reason = reason
        self.extra = extra


def _env() -> dict[str, str]:
    """Resolve + validate the env this skill depends on.

    Reads fresh on every call so tests can toggle env between assertions
    without having to reimport the module. Refuses loudly rather than
    returning partial state.

    - Missing `CURRENT_USER_ID` → `AdminSkillRefusal(reason="no_invoker")`.
      The admin skill must not act under an impersonated or system identity.
    - Missing secret / tenant / agent → `AdminSkillRefusal(reason="env_misconfigured")`.
    """
    api_url = os.environ.get("THINKWORK_API_URL", "")
    api_secret = os.environ.get("THINKWORK_API_SECRET", "") or os.environ.get(
        "API_AUTH_SECRET", ""
    )
    tenant_id = os.environ.get("TENANT_ID", "") or os.environ.get("_MCP_TENANT_ID", "")
    agent_id = os.environ.get("AGENT_ID", "") or os.environ.get("_MCP_AGENT_ID", "")
    current_user_id = os.environ.get("CURRENT_USER_ID", "")

    if not current_user_id:
        raise AdminSkillRefusal(
            "no_invoker",
            "thinkwork-admin requires a human invoker (CURRENT_USER_ID unset)",
        )
    missing = [
        name
        for name, val in (
            ("THINKWORK_API_URL", api_url),
            ("THINKWORK_API_SECRET", api_secret),
            ("TENANT_ID", tenant_id),
            ("AGENT_ID", agent_id),
        )
        if not val
    ]
    if missing:
        raise AdminSkillRefusal(
            "env_misconfigured",
            f"thinkwork-admin env missing: {', '.join(missing)}",
            missing=missing,
        )

    return {
        "api_url": api_url,
        "api_secret": api_secret,
        "tenant_id": tenant_id,
        "agent_id": agent_id,
        "current_user_id": current_user_id,
    }


def _graphql(query: str, variables: dict | None = None) -> dict:
    """Execute a GraphQL query/mutation against the thinkwork API.

    Uses the existing header shape that `cognito-auth.ts` already
    parses (x-api-key / x-tenant-id / x-agent-id / x-principal-id) —
    no new headers are introduced.
    """
    env = _env()
    payload: dict[str, Any] = {"query": query}
    if variables:
        payload["variables"] = variables
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{env['api_url']}/graphql",
        data=data,
        headers={
            "Content-Type": "application/json",
            "x-api-key": env["api_secret"],
            "x-tenant-id": env["tenant_id"],
            "x-agent-id": env["agent_id"],
            "x-principal-id": env["current_user_id"],
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        result = json.loads(resp.read().decode("utf-8"))
    if "errors" in result:
        return {"error": result["errors"][0].get("message", str(result["errors"]))}
    return result.get("data", result)


def _safe(fn: Callable[..., Any]) -> Callable[..., Any]:
    """Decorator — preserve the Strands tool schema while catching errors.

    Wraps exceptions into JSON refusal shapes instead of propagating, so
    the agent sees a structured error it can reason about rather than a
    runtime crash. `AdminSkillRefusal` carries a stable `reason` code;
    other exceptions land as `reason="internal"`.
    """

    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        try:
            return fn(*args, **kwargs)
        except AdminSkillRefusal as exc:
            return json.dumps(
                {
                    "refused": True,
                    "reason": exc.reason,
                    "message": str(exc),
                    **exc.extra,
                }
            )
        except urllib.error.HTTPError as exc:
            detail = (
                exc.read().decode("utf-8", errors="replace")[:500]
                if exc.fp
                else str(exc)
            )
            return json.dumps({"refused": True, "reason": "http_error", "message": f"HTTP {exc.code}: {detail}"})
        except Exception as exc:
            return json.dumps(
                {"refused": True, "reason": "internal", "message": str(exc)}
            )

    return wrapper


def _check_admin_role() -> None:
    """Pre-flight the server-side role gate via the scoped adminRoleCheck query.

    Refuses wrapper-side with `AdminSkillRefusal(reason="missing_admin_role")`
    when the caller isn't `owner` / `admin` on the resolved tenant. Server
    enforces the gate again on each mutation — this is early-fail UX, not
    authoritative.
    """
    result = _graphql("query { adminRoleCheck { role } }")
    role = (result or {}).get("adminRoleCheck", {}).get("role")
    if role not in ("owner", "admin"):
        raise AdminSkillRefusal(
            "missing_admin_role",
            f"thinkwork-admin requires owner/admin role (resolved role: {role!r})",
            role=role,
        )


def _begin_mutation(operation_name: str) -> dict[str, object]:
    """Pre-mutation pipeline shared by every wrapper in operations/*.py.

    Runs in this order:
      1. `_env()` — refuse on R15 no-invoker / env-misconfigured.
      2. `_check_admin_role()` — wrapper-side role gate (early-fail UX).
      3. `turn_cap.check_and_increment()` — per-turn mutation cap (Unit 9).

    Returns a context dict carrying the resolved env + the start time,
    consumed by `_end_mutation()` to emit the audit log (Unit 12).

    Raises `AdminSkillRefusal` on any gate failure — @_safe turns that
    into a structured refused shape for the caller. The counter is
    incremented BEFORE the GraphQL call, so if the server refuses the
    mutation the turn still counts (otherwise an agent could burn its
    budget on refused calls and never trip the cap).
    """
    import time as _time

    import turn_cap as _turn_cap

    env = _env()
    _check_admin_role()
    turn_count = _turn_cap.check_and_increment()
    return {
        "env": env,
        "operation_name": operation_name,
        "turn_count": turn_count,
        "started_at_ms": int(_time.time() * 1000),
    }


def _end_mutation(
    ctx: dict[str, object],
    *,
    status: str,
    arguments: object,
    refusal_reason: str | None = None,
) -> None:
    """Post-mutation pipeline — emit one structured audit line.

    Never raises. Called on both success and refusal paths. Redaction
    lives in `audit.emit` (Unit 12) so secrets never reach stdout.
    """
    import time as _time

    import audit as _audit

    env = ctx["env"]
    try:
        _audit.emit(
            invoker_user_id=env["current_user_id"],  # type: ignore[index]
            invoker_role="admin",
            agent_id=env["agent_id"],  # type: ignore[index]
            agent_tenant_id=env["tenant_id"],  # type: ignore[index]
            operation_name=ctx["operation_name"],  # type: ignore[arg-type]
            arguments=arguments,
            status=status,
            refusal_reason=refusal_reason,
            latency_ms=int(_time.time() * 1000) - int(ctx["started_at_ms"]),  # type: ignore[arg-type]
            turn_count=ctx["turn_count"] if isinstance(ctx.get("turn_count"), int) else None,  # type: ignore[arg-type]
        )
    except Exception:
        # Audit emission must never block the caller. Failures swallow;
        # the underlying stdout write is synchronous and won't retry.
        pass


__all__ = [
    "AdminSkillRefusal",
    "_env",
    "_graphql",
    "_safe",
    "_check_admin_role",
    "_begin_mutation",
    "_end_mutation",
]
