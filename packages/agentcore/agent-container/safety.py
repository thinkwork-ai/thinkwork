"""
Input safety validation — defends against prompt injection and memory poisoning.

Based on Microsoft Security Blog guidance on running ServerlessClaw safely:
https://www.microsoft.com/en-us/security/blog/2026/02/19/running-openclaw-safely-identity-isolation-runtime-risk

Two attack surfaces are defended:
1. Memory poisoning: attacker injects instructions into session summaries that
   persist across sessions and influence future agent behaviour.
2. Prompt injection via message input: oversized or instruction-laden messages
   that attempt to override the agent's system prompt.
"""

import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Memory poisoning patterns
# Phrases that indicate an attempt to inject persistent instructions into memory.
# These are checked against session summaries BEFORE writing to AgentCore Memory.
# ---------------------------------------------------------------------------
_MEMORY_INJECTION_PATTERNS = [
    r"ignore\s+(all\s+)?(previous|prior|above)\s+instructions",
    r"you\s+are\s+now\s+",
    r"new\s+system\s+prompt",
    r"forget\s+(everything|all|your\s+instructions)",
    r"disregard\s+(your|all|previous)",
    r"override\s+(your|the)\s+(instructions|rules|guidelines)",
    r"act\s+as\s+(if\s+you\s+are|a\s+)",
    r"pretend\s+(you\s+are|to\s+be)",
    r"your\s+new\s+(role|persona|identity|instructions)",
    r"from\s+now\s+on\s+you\s+(will|must|should)",
    r"<\s*system\s*>",           # XML-style system tag injection
    r"\[INST\]",                  # Llama instruction injection
    r"###\s*instruction",         # Markdown instruction header injection
]

_COMPILED_MEMORY_PATTERNS = [
    re.compile(p, re.IGNORECASE | re.DOTALL)
    for p in _MEMORY_INJECTION_PATTERNS
]

# ---------------------------------------------------------------------------
# Input validation limits
# ---------------------------------------------------------------------------
MAX_MESSAGE_LENGTH = 32_000   # ~8k tokens, generous for legitimate use
MAX_TOOL_NAME_LENGTH = 64
MAX_RESOURCE_PATH_LENGTH = 512


class SafetyViolation(Exception):
    """Raised when input fails a safety check."""

    def __init__(self, reason: str, field: str):
        self.reason = reason
        self.field = field
        super().__init__(f"Safety violation in {field}: {reason}")


def check_memory_safety(summary: str, tenant_id: str) -> bool:
    """
    Check a session summary for prompt injection patterns before writing to memory.

    Returns True if safe.
    Raises SafetyViolation if a poisoning pattern is detected.

    The check is intentionally conservative — false positives (blocking a
    legitimate summary) are preferable to false negatives (persisting an
    attacker-controlled instruction).
    """
    for pattern in _COMPILED_MEMORY_PATTERNS:
        match = pattern.search(summary)
        if match:
            logger.warning(
                "Memory poisoning attempt blocked tenant_id=%s pattern=%r matched=%r",
                tenant_id,
                pattern.pattern,
                match.group(0)[:80],
            )
            raise SafetyViolation(
                reason=f"Injection pattern detected: {match.group(0)[:40]!r}",
                field="session_summary",
            )
    return True


def validate_message(message: str) -> str:
    """
    Validate and sanitise an incoming message.

    - Truncates messages exceeding MAX_MESSAGE_LENGTH (logs a warning).
    - Returns the (possibly truncated) message.
    """
    if len(message) > MAX_MESSAGE_LENGTH:
        logger.warning(
            "Message truncated: length=%d exceeds limit=%d",
            len(message),
            MAX_MESSAGE_LENGTH,
        )
        return message[:MAX_MESSAGE_LENGTH]
    return message


def validate_tool_name(tool_name: str) -> str:
    """
    Validate a tool name — must be alphanumeric + underscores, max 64 chars.
    Raises SafetyViolation on invalid input.
    """
    if len(tool_name) > MAX_TOOL_NAME_LENGTH:
        raise SafetyViolation(
            reason=f"Tool name too long: {len(tool_name)} > {MAX_TOOL_NAME_LENGTH}",
            field="tool_name",
        )
    if not re.match(r"^[a-zA-Z0-9_]+$", tool_name):
        raise SafetyViolation(
            reason=f"Tool name contains invalid characters: {tool_name!r}",
            field="tool_name",
        )
    return tool_name


def validate_resource_path(resource: Optional[str]) -> Optional[str]:
    """
    Validate a resource path — max 512 chars, no null bytes or path traversal.
    Returns None if resource is None.
    Raises SafetyViolation on invalid input.
    """
    if resource is None:
        return None
    if len(resource) > MAX_RESOURCE_PATH_LENGTH:
        raise SafetyViolation(
            reason=f"Resource path too long: {len(resource)} > {MAX_RESOURCE_PATH_LENGTH}",
            field="resource",
        )
    if "\x00" in resource:
        raise SafetyViolation(reason="Null byte in resource path", field="resource")
    if ".." in resource.split("/"):
        raise SafetyViolation(reason="Path traversal attempt in resource", field="resource")
    return resource
