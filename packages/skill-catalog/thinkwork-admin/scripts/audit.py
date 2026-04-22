"""Audit logging + secret redaction for the thinkwork-admin skill.

Unit 12 of the thinkwork-admin plan (R20, R21, R22). Every tool call
in the skill — successful or refused — emits one structured log line
with a stable field set the operator can query via CloudWatch Insights.

The emission shape matches `packages/agentcore/agent-container/
observability.py`'s `STRUCTURED_LOG {json}` prefix so one CloudWatch
Insights query can join agent_invocation / permission_denied /
admin_mutation events without a cross-image dependency.

R21 (no secrets in logs) is defense-in-depth. Three independent
passes before serialization:

  1. Key-name — deep-walk the payload; any key matching
     (secret|token|password|authorization|api[_-]?key|credential|
     bearer|assertion|signing[_-]?key|private[_-]?key|access[_-]?
     [a-z]*token) → value replaced with <REDACTED>.
  2. Value-shape — regex-match known secret prefixes / shapes even
     when they hide in neutrally-named keys: JWTs (eyJ...), GitHub
     tokens (ghp_...), Stripe (sk_...), Slack (xoxb-/xoxp-),
     explicit `Bearer ` prefix, AWS access-key-id pattern.
  3. Exact-value — replace anything equal to the
     `THINKWORK_API_SECRET` env literal. Catches secrets that leak
     through a custom-named key AND don't match a known shape.
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from typing import Any

REDACTED = "<REDACTED>"

# Key-name regex. `re.IGNORECASE` is set at match time rather than
# inline so tests can eyeball the regex directly.
_KEY_REGEX = re.compile(
    r"(secret|token|password|authorization|api[_-]?key|credential|"
    r"bearer|assertion|signing[_-]?key|private[_-]?key|"
    r"access[_-]?[a-z]*token)",
    re.IGNORECASE,
)

# Value-shape patterns. Order matters: Bearer must win over a bare JWT
# because `Bearer eyJ...` would otherwise be half-redacted.
_VALUE_SHAPE_PATTERNS: list[re.Pattern[str]] = [
    # OAuth / service-auth header prefix. `Bearer <anything>`.
    re.compile(r"^Bearer\s+\S+"),
    # JWT (three dot-separated base64url segments, `eyJ` start).
    re.compile(r"eyJ[A-Za-z0-9+/=._-]{20,}"),
    # GitHub personal access token / fine-grained.
    re.compile(r"(ghp|ghu|ghs|ghr|gho)_[A-Za-z0-9]{20,}"),
    # Stripe secret keys.
    re.compile(r"sk_(live|test)_[A-Za-z0-9]{16,}"),
    # Slack bot / user tokens.
    re.compile(r"xox[bpasr]-[A-Za-z0-9-]{10,}"),
    # OpenAI API keys (defensive — keys stored in Secrets Manager today).
    re.compile(r"sk-[A-Za-z0-9]{20,}"),
    # AWS access key id.
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
]


def _scalar_matches_shape(value: str) -> bool:
    return any(p.search(value) for p in _VALUE_SHAPE_PATTERNS)


def _redact(value: Any, _service_secret: str | None = None) -> Any:
    """Recursively apply all three redaction passes.

    `_service_secret` is read once at entry (from `THINKWORK_API_SECRET`
    / `API_AUTH_SECRET` if unset) and threaded through so the recursion
    avoids re-reading the env for every node.
    """
    secret = _service_secret
    if secret is None:
        secret = os.environ.get("THINKWORK_API_SECRET") or os.environ.get(
            "API_AUTH_SECRET", ""
        )

    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            if isinstance(k, str) and _KEY_REGEX.search(k):
                # Key-name pass — redact the whole subtree regardless of
                # its shape, including nested dicts that might contain
                # unrelated fields. That's deliberate: if the parent key
                # looks like `credentials`, nothing under it should leak.
                out[k] = REDACTED
            else:
                out[k] = _redact(v, secret)
        return out

    if isinstance(value, list):
        return [_redact(v, secret) for v in value]

    if isinstance(value, str):
        # Exact-value pass first — cheapest. Then value-shape.
        if secret and value == secret:
            return REDACTED
        if _scalar_matches_shape(value):
            return REDACTED
        return value

    return value


def emit(
    *,
    invoker_user_id: str,
    invoker_role: str,
    agent_id: str,
    agent_tenant_id: str,
    operation_name: str,
    arguments: Any,
    status: str,
    refusal_reason: str | None = None,
    latency_ms: int = 0,
    turn_count: int | None = None,
    stream: Any = None,
) -> None:
    """Emit one STRUCTURED_LOG line for an admin-skill tool call.

    R20 fields are fixed: invoker_user_id / invoker_role / agent_id /
    agent_tenant_id / operation_name / arguments_redacted / status /
    refusal_reason / latency_ms. `turn_count` is added opportunistically
    from Unit 9's per-turn counter when the caller passes it.

    `stream` is an injection point for tests — defaults to sys.stdout
    so CloudWatch picks the line up via the Lambda runtime's stdout
    capture. Matches the pattern used by the existing observability
    module (logger.info) but routes through a dedicated stream so the
    redaction-negative test can point an io.StringIO at it.
    """
    entry: dict[str, Any] = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "log_stream": f"tenant_{agent_tenant_id}",
        "event_type": "admin_mutation",
        "invoker_user_id": invoker_user_id,
        "invoker_role": invoker_role,
        "agent_id": agent_id,
        "agent_tenant_id": agent_tenant_id,
        "operation_name": operation_name,
        "arguments_redacted": _redact(arguments),
        "status": status,
        "refusal_reason": refusal_reason,
        "latency_ms": latency_ms,
    }
    if turn_count is not None:
        entry["turn_count"] = turn_count

    out = stream if stream is not None else sys.stdout
    print(f"STRUCTURED_LOG {json.dumps(entry)}", file=out)


__all__ = ["REDACTED", "emit"]
