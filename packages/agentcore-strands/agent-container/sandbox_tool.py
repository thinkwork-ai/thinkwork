"""sandbox_tool — Strands execute_code tool for the AgentCore Code
Interpreter sandbox (plan Unit 7).

Registered by server.py._call_strands_agent when the dispatcher has
populated SANDBOX_INTERPRETER_ID on the invocation env. One tool,
one session per agent turn, structured errors on the return value so
the agent can recover rather than unwind the whole turn.

Session lifecycle:
  * StartCodeInterpreterSession on the first call in the turn.
  * Reused across every subsequent execute_code in the same turn.
  * StopCodeInterpreterSession in the finally-equivalent at turn end
    (see _cleanup_session below, which server.py awaits after the
    agent loop returns).

The session_id is held in a **call-frame-local** dict keyed by the
factory-invocation id rather than a module global. When the factory is
re-constructed next turn, the dict is fresh. That structurally enforces
"one session per turn" regardless of how the AgentCore runtime
schedules requests across processes or warm starts.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

# Output caps match plan Unit 7 — full streams still flow to CloudWatch.
STDOUT_CAP_BYTES = 256 * 1024
STDERR_CAP_BYTES = 32 * 1024

# 5-minute session ceiling per plan R5.
SESSION_TIMEOUT_SECONDS = 300


@dataclass
class SandboxResult:
    """What execute_code returns to the agent. JSON-serialized by Strands."""

    ok: bool
    stdout: str = ""
    stderr: str = ""
    stdout_bytes: int = 0
    stderr_bytes: int = 0
    stdout_truncated: bool = False
    stderr_truncated: bool = False
    exit_status: str = "ok"
    duration_ms: int | None = None
    peak_memory_mb: int | None = None
    # Structured error name when ok=False. One of:
    #   SandboxProvisioning | SandboxCapExceeded | SandboxTimeout
    #   | SandboxOOM | SandboxError | ConnectionRevoked
    error: str | None = None
    # Short human-readable guidance for the agent when ok=False.
    error_message: str | None = None


def build_execute_code_tool(
    *,
    strands_tool_decorator: Callable[..., Any],
    session_state: dict,
    start_session: Callable[[str, int], Awaitable[str]],
    stop_session: Callable[[str, str], Awaitable[None]],
    run_code: Callable[[str, str, str], Awaitable[dict]],
) -> Any:
    """Return the `execute_code` Strands tool closure.

    The dependencies are injected rather than imported at module top-level
    so tests exercise the full decision tree without mocking boto3.

    Args:
        strands_tool_decorator: the ``@tool`` decorator from ``strands``.
            server.py imports it once and passes it in.
        session_state: a caller-scoped dict. The factory reads/writes the
            keys ``"session_id"`` and ``"interpreter_id"`` here; holding
            the dict outside this module means it lives in the call frame
            of ``_call_strands_agent`` rather than in module globals.
        start_session: ``async (interpreter_id, timeout_s) -> session_id``.
            Production wires this to ``BedrockAgentCoreControlClient.start_code_interpreter_session``.
        stop_session: ``async (interpreter_id, session_id) -> None``.
        run_code: ``async (interpreter_id, session_id, code) -> dict`` —
            returns the AgentCore response_payload structure.
    """

    interpreter_id = os.environ.get("SANDBOX_INTERPRETER_ID", "")

    async def _ensure_session() -> str | None:
        if not interpreter_id:
            return None
        existing = session_state.get("session_id")
        if existing:
            return existing
        started = await start_session(interpreter_id, SESSION_TIMEOUT_SECONDS)
        session_state["session_id"] = started
        session_state["interpreter_id"] = interpreter_id
        logger.info(
            "sandbox: started session %s on interpreter %s",
            started,
            interpreter_id,
        )
        return started

    @strands_tool_decorator
    async def execute_code(code: str) -> dict:
        """Run Python code in the tenant's AgentCore Code Interpreter sandbox.

        Use this tool when you need to:
          * manipulate data with pandas/numpy beyond what typed skills cover
          * stitch together CLI output or REST responses mid-turn
          * call a community Python library without waiting for a typed wrapper
          * run quick analytical scripts that produce text, files, or uploads

        The sandbox has the OAuth tokens the template's required_connections
        declares (GITHUB_ACCESS_TOKEN, SLACK_ACCESS_TOKEN, GCAL_ACCESS_TOKEN,
        etc.) available via os.environ for the lifetime of this turn only.

        The tool returns a structured dict; check `ok` before relying on
        stdout. Common `error` values to handle gracefully:
          * SandboxProvisioning — tenant sandbox is still being set up; retry later
          * SandboxCapExceeded — daily or hourly cap was hit; surface the message
          * SandboxTimeout — the 5-minute ceiling tripped; break the work up
          * SandboxOOM — out of memory; reduce data size
          * ConnectionRevoked — a required OAuth connection expired mid-turn
        """
        # Import-lazy so loading the module without a live interpreter_id
        # doesn't trip the stub path.
        start = asyncio.get_event_loop().time()

        if not interpreter_id:
            return SandboxResult(
                ok=False,
                error="SandboxProvisioning",
                error_message=(
                    "The tenant sandbox is not ready yet. The interpreter is "
                    "still being provisioned — retry this action shortly."
                ),
                exit_status="provisioning",
            ).__dict__

        try:
            session_id = await _ensure_session()
            assert session_id is not None
            payload = await run_code(interpreter_id, session_id, code)
        except TimeoutError:
            return SandboxResult(
                ok=False,
                error="SandboxTimeout",
                error_message="Execution exceeded the 5-minute session ceiling.",
                exit_status="timeout",
            ).__dict__
        except MemoryError:
            return SandboxResult(
                ok=False,
                error="SandboxOOM",
                error_message="The sandbox ran out of memory. Reduce the data size and retry.",
                exit_status="oom",
            ).__dict__
        except Exception as err:
            logger.exception("sandbox execute_code failed")
            return SandboxResult(
                ok=False,
                error="SandboxError",
                error_message=f"Sandbox execution failed: {err}",
                exit_status="error",
            ).__dict__

        result = _shape_payload(payload)
        duration_ms = int((asyncio.get_event_loop().time() - start) * 1000)
        result.duration_ms = duration_ms
        return result.__dict__

    async def _cleanup_session() -> None:
        """Stop the per-turn session, log-and-continue on failure."""
        session_id = session_state.get("session_id")
        ipi = session_state.get("interpreter_id") or interpreter_id
        if not session_id or not ipi:
            return
        try:
            await stop_session(ipi, session_id)
            logger.info("sandbox: stopped session %s", session_id)
        except Exception as err:
            # Log-and-continue: AgentCore timeout-reap is the backstop.
            logger.warning("sandbox: stop_session failed: %s", err)
        finally:
            session_state.pop("session_id", None)
            session_state.pop("interpreter_id", None)

    # Attach cleanup so server.py can await it in its try/finally.
    execute_code._sandbox_cleanup = _cleanup_session  # type: ignore[attr-defined]
    return execute_code


# Exported for unit tests — pure shape logic over the AgentCore payload.
def _shape_payload(payload: dict) -> SandboxResult:
    """Normalize the AgentCore APPLICATION_LOGS response into SandboxResult.

    The shape varies across strands-agents-tools versions — this function
    accepts both ``{"stdout": "...", "stderr": "..."}`` and the older
    ``{"output": [...], "error": "..."}`` layouts.
    """
    stdout_raw = _extract_stdout(payload)
    stderr_raw = _extract_stderr(payload)

    stdout_bytes = len(stdout_raw.encode("utf-8"))
    stderr_bytes = len(stderr_raw.encode("utf-8"))

    stdout = _truncate(stdout_raw, STDOUT_CAP_BYTES)
    stderr = _truncate(stderr_raw, STDERR_CAP_BYTES)

    peak_memory = payload.get("peak_memory_mb") or payload.get("peakMemoryMb")
    exit_code = payload.get("exit_code", payload.get("exitCode"))

    ok = True
    exit_status = "ok"
    error = None
    error_message = None
    if exit_code not in (None, 0, "0"):
        ok = False
        exit_status = "error"
        error = "SandboxError"
        error_message = f"Process exited with status {exit_code}"

    return SandboxResult(
        ok=ok,
        stdout=stdout,
        stderr=stderr,
        stdout_bytes=stdout_bytes,
        stderr_bytes=stderr_bytes,
        stdout_truncated=stdout_bytes > STDOUT_CAP_BYTES,
        stderr_truncated=stderr_bytes > STDERR_CAP_BYTES,
        exit_status=exit_status,
        peak_memory_mb=peak_memory,
        error=error,
        error_message=error_message,
    )


def _extract_stdout(payload: dict) -> str:
    if "stdout" in payload:
        v = payload["stdout"]
        return v if isinstance(v, str) else "\n".join(str(x) for x in v)
    if "output" in payload:
        out = payload["output"]
        if isinstance(out, list):
            return "\n".join(str(x) for x in out)
        return str(out)
    return ""


def _extract_stderr(payload: dict) -> str:
    if "stderr" in payload:
        v = payload["stderr"]
        return v if isinstance(v, str) else "\n".join(str(x) for x in v)
    if "error" in payload and isinstance(payload["error"], str):
        return payload["error"]
    return ""


def _truncate(text: str, cap_bytes: int) -> str:
    encoded = text.encode("utf-8")
    if len(encoded) <= cap_bytes:
        return text
    # Slice on a utf-8 boundary; drop the partial tail character.
    truncated = encoded[:cap_bytes].decode("utf-8", errors="ignore")
    return (
        truncated
        + f"\n\n...[truncated — {len(encoded) - cap_bytes} bytes dropped]"
    )


# Convenience: callers that don't want the closure can build a fresh
# session_state dict each turn.
def new_session_state() -> dict:
    """Build a per-turn session_state dict. Call once per agent turn."""
    return {"turn_id": str(uuid.uuid4())}
