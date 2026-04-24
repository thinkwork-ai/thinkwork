"""Unit tests for sandbox_tool — pure helpers + the execute_code closure.

AWS wiring (bedrock-agentcore boto3) is not mocked; the tool takes
start_session / stop_session / run_code as injected callables so tests
exercise the full decision tree against fakes.
"""

from __future__ import annotations

import asyncio
import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
# Direct import — dataclasses in Python 3.13 look up cls.__module__ in
# sys.modules, which the spec_from_file_location path doesn't populate.
import sandbox_tool as st  # type: ignore  # noqa: E402

# ---------------------------------------------------------------------------
# _shape_payload — output shape + truncation
# ---------------------------------------------------------------------------


def test_shape_payload_happy_path():
    r = st._shape_payload({"stdout": "hello\n", "stderr": "", "exit_code": 0})
    assert r.ok is True
    assert r.stdout == "hello\n"
    assert r.exit_status == "ok"
    assert r.stdout_truncated is False
    assert r.error is None


def test_shape_payload_non_zero_exit_marks_error():
    r = st._shape_payload({"stdout": "", "stderr": "fail", "exit_code": 1})
    assert r.ok is False
    assert r.exit_status == "error"
    assert r.error == "SandboxError"


def test_shape_payload_large_stdout_truncates_at_256kb():
    payload = {"stdout": "x" * (300 * 1024), "stderr": "", "exit_code": 0}
    r = st._shape_payload(payload)
    assert r.stdout_bytes == 300 * 1024
    assert r.stdout_truncated is True
    assert "[truncated" in r.stdout


def test_shape_payload_large_stderr_truncates_at_32kb():
    payload = {"stdout": "", "stderr": "e" * (64 * 1024), "exit_code": 0}
    r = st._shape_payload(payload)
    assert r.stderr_bytes == 64 * 1024
    assert r.stderr_truncated is True


def test_shape_payload_accepts_legacy_output_layout():
    r = st._shape_payload(
        {
            "output": ["line 1", "line 2"],
            "error": "warning",
        },
    )
    assert "line 1" in r.stdout
    assert "line 2" in r.stdout
    assert r.stderr == "warning"


def test_truncate_does_not_split_utf8():
    s = "é" * 100_000  # 200,000 bytes
    out = st._truncate(s, 256 * 1024)
    assert out == s  # under cap
    huge = "é" * 200_000  # 400,000 bytes
    out = st._truncate(huge, 256 * 1024)
    assert out.encode("utf-8", errors="strict")  # does not raise


# ---------------------------------------------------------------------------
# execute_code closure — the full decision tree with injected fakes
# ---------------------------------------------------------------------------


def _passthrough_tool_decorator(fn):
    """Stand-in for the Strands @tool decorator: just returns the fn."""
    return fn


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture
def interpreter_env(monkeypatch):
    monkeypatch.setenv("SANDBOX_INTERPRETER_ID", "ci-abc")
    monkeypatch.setenv("SANDBOX_ENVIRONMENT", "default-public")


def test_execute_code_returns_provisioning_when_no_interpreter_id(monkeypatch):
    monkeypatch.delenv("SANDBOX_INTERPRETER_ID", raising=False)

    async def never(*args, **kwargs):
        raise AssertionError("should not be called")

    tool = st.build_execute_code_tool(
        strands_tool_decorator=_passthrough_tool_decorator,
        session_state={},
        start_session=never,
        stop_session=never,
        run_code=never,
    )
    result = _run(tool("print('hi')"))
    assert result["ok"] is False
    assert result["error"] == "SandboxProvisioning"
    assert result["exit_status"] == "provisioning"


def test_execute_code_starts_and_reuses_session(interpreter_env):
    calls = {"start": 0, "run": 0}

    async def start(ipi, timeout):
        calls["start"] += 1
        return "sess-1"

    async def run(ipi, sess, code):
        calls["run"] += 1
        assert sess == "sess-1"
        return {"stdout": f"ran: {code}", "stderr": "", "exit_code": 0}

    async def noop_stop(ipi, sess):
        pass

    state: dict = {}
    tool = st.build_execute_code_tool(
        strands_tool_decorator=_passthrough_tool_decorator,
        session_state=state,
        start_session=start,
        stop_session=noop_stop,
        run_code=run,
    )
    a = _run(tool("print(1)"))
    b = _run(tool("print(2)"))
    assert a["ok"] is True and b["ok"] is True
    assert calls["start"] == 1  # session reused
    assert calls["run"] == 2
    assert state["session_id"] == "sess-1"


def test_execute_code_timeout_returns_structured_error(interpreter_env):
    async def start(ipi, timeout):
        return "sess-1"

    async def run(ipi, sess, code):
        raise TimeoutError()

    async def stop(ipi, sess):
        pass

    tool = st.build_execute_code_tool(
        strands_tool_decorator=_passthrough_tool_decorator,
        session_state={},
        start_session=start,
        stop_session=stop,
        run_code=run,
    )
    result = _run(tool("while True: pass"))
    assert result["ok"] is False
    assert result["error"] == "SandboxTimeout"
    assert result["exit_status"] == "timeout"


def test_execute_code_oom_returns_structured_error(interpreter_env):
    async def start(ipi, timeout):
        return "sess-1"

    async def run(ipi, sess, code):
        raise MemoryError("OOM")

    async def stop(ipi, sess):
        pass

    tool = st.build_execute_code_tool(
        strands_tool_decorator=_passthrough_tool_decorator,
        session_state={},
        start_session=start,
        stop_session=stop,
        run_code=run,
    )
    result = _run(tool("pandas.DataFrame"))
    assert result["error"] == "SandboxOOM"


def test_execute_code_generic_error_is_sandbox_error(interpreter_env):
    async def start(ipi, timeout):
        return "sess-1"

    async def run(ipi, sess, code):
        raise RuntimeError("transport failure")

    async def stop(ipi, sess):
        pass

    tool = st.build_execute_code_tool(
        strands_tool_decorator=_passthrough_tool_decorator,
        session_state={},
        start_session=start,
        stop_session=stop,
        run_code=run,
    )
    result = _run(tool("print(1)"))
    assert result["error"] == "SandboxError"
    assert "transport failure" in result["error_message"]


def test_execute_code_propagates_truncation_flags(interpreter_env):
    async def start(ipi, timeout):
        return "sess-1"

    async def run(ipi, sess, code):
        return {
            "stdout": "x" * (300 * 1024),
            "stderr": "",
            "exit_code": 0,
        }

    async def stop(ipi, sess):
        pass

    tool = st.build_execute_code_tool(
        strands_tool_decorator=_passthrough_tool_decorator,
        session_state={},
        start_session=start,
        stop_session=stop,
        run_code=run,
    )
    r = _run(tool("print('big')"))
    assert r["ok"] is True
    assert r["stdout_truncated"] is True
    assert r["stdout_bytes"] == 300 * 1024


def test_cleanup_stops_session_and_clears_state(interpreter_env):
    stopped = {"count": 0}

    async def start(ipi, timeout):
        return "sess-1"

    async def run(ipi, sess, code):
        return {"stdout": "ok", "stderr": "", "exit_code": 0}

    async def stop(ipi, sess):
        stopped["count"] += 1

    state: dict = {}
    tool = st.build_execute_code_tool(
        strands_tool_decorator=_passthrough_tool_decorator,
        session_state=state,
        start_session=start,
        stop_session=stop,
        run_code=run,
    )
    _run(tool("print('a')"))
    assert state.get("session_id") == "sess-1"
    _run(tool._sandbox_cleanup())
    assert stopped["count"] == 1
    assert "session_id" not in state


def test_cleanup_is_noop_when_no_session_started(interpreter_env):
    async def unreachable(*args, **kwargs):
        raise AssertionError("no session — stop_session must not be called")

    tool = st.build_execute_code_tool(
        strands_tool_decorator=_passthrough_tool_decorator,
        session_state={},
        start_session=unreachable,
        stop_session=unreachable,
        run_code=unreachable,
    )
    _run(tool._sandbox_cleanup())  # must not raise


def test_cleanup_logs_and_continues_on_stop_failure(interpreter_env):
    async def start(ipi, timeout):
        return "sess-1"

    async def run(ipi, sess, code):
        return {"stdout": "", "stderr": "", "exit_code": 0}

    async def stop(ipi, sess):
        raise RuntimeError("AgentCore transient failure")

    state: dict = {}
    tool = st.build_execute_code_tool(
        strands_tool_decorator=_passthrough_tool_decorator,
        session_state=state,
        start_session=start,
        stop_session=stop,
        run_code=run,
    )
    _run(tool("x = 1"))
    # Must not raise; cleanup swallows the exception.
    _run(tool._sandbox_cleanup())
    # State cleared even on stop failure (finally block).
    assert "session_id" not in state


# ---------------------------------------------------------------------------
# new_session_state — each call returns a fresh dict with a unique turn_id
# ---------------------------------------------------------------------------


def test_new_session_state_returns_independent_dicts():
    a = st.new_session_state()
    b = st.new_session_state()
    assert a["turn_id"] != b["turn_id"]
    a["session_id"] = "x"
    assert "session_id" not in b


# ---------------------------------------------------------------------------
# Quota circuit breaker (plan Unit 10)
# ---------------------------------------------------------------------------


def test_quota_ok_runs_the_tool_normally(interpreter_env):
    quota_calls = {"n": 0}

    async def quota():
        quota_calls["n"] += 1
        return {"ok": True, "tenant_daily_count": 1, "agent_hourly_count": 1}

    async def start(ipi, timeout):
        return "sess-1"

    async def run(ipi, sess, code):
        return {"stdout": "hello", "stderr": "", "exit_code": 0}

    async def stop(ipi, sess):
        pass

    tool = st.build_execute_code_tool(
        strands_tool_decorator=_passthrough_tool_decorator,
        session_state={},
        start_session=start,
        stop_session=stop,
        run_code=run,
        check_quota=quota,
    )
    result = _run(tool("print('hi')"))
    assert result["ok"] is True
    assert quota_calls["n"] == 1


def test_quota_denial_returns_cap_exceeded_without_starting_session(
    interpreter_env,
):
    async def quota():
        return {
            "ok": False,
            "dimension": "tenant_daily",
            "resets_at": "2026-04-23T00:00:00Z",
        }

    async def start(ipi, timeout):
        raise AssertionError("start_session must not run after quota denial")

    async def run(ipi, sess, code):
        raise AssertionError("run_code must not run after quota denial")

    async def stop(ipi, sess):
        pass

    tool = st.build_execute_code_tool(
        strands_tool_decorator=_passthrough_tool_decorator,
        session_state={},
        start_session=start,
        stop_session=stop,
        run_code=run,
        check_quota=quota,
    )
    result = _run(tool("print('hi')"))
    assert result["ok"] is False
    assert result["error"] == "SandboxCapExceeded"
    assert result["exit_status"] == "cap_exceeded"
    assert "tenant_daily" in result["error_message"]
    assert "2026-04-23" in result["error_message"]


def test_quota_transport_failure_fails_closed(interpreter_env):
    async def quota():
        raise RuntimeError("network down")

    async def start(ipi, timeout):
        raise AssertionError("start_session must not run after quota failure")

    async def run(ipi, sess, code):
        raise AssertionError("run_code must not run after quota failure")

    async def stop(ipi, sess):
        pass

    tool = st.build_execute_code_tool(
        strands_tool_decorator=_passthrough_tool_decorator,
        session_state={},
        start_session=start,
        stop_session=stop,
        run_code=run,
        check_quota=quota,
    )
    result = _run(tool("print('hi')"))
    # Fails closed — a transport failure must not let calls through.
    assert result["ok"] is False
    assert result["error"] == "SandboxCapExceeded"


def test_quota_none_behaves_like_pre_unit_10(interpreter_env):
    """Back-compat: tests that predate Unit 10 pass check_quota=None."""

    async def start(ipi, timeout):
        return "sess-1"

    async def run(ipi, sess, code):
        return {"stdout": "ok", "stderr": "", "exit_code": 0}

    async def stop(ipi, sess):
        pass

    tool = st.build_execute_code_tool(
        strands_tool_decorator=_passthrough_tool_decorator,
        session_state={},
        start_session=start,
        stop_session=stop,
        run_code=run,
    )
    result = _run(tool("print('hi')"))
    assert result["ok"] is True


# ---------------------------------------------------------------------------
# Audit writer (plan Unit 11)
# ---------------------------------------------------------------------------


def test_audit_emits_row_on_successful_call(interpreter_env, monkeypatch):
    """Happy path — audit row carries tenant/user/env, hash, duration."""
    monkeypatch.setenv("TENANT_ID", "11111111-2222-3333-4444-555555555555")
    monkeypatch.setenv("USER_ID", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    monkeypatch.setenv("AGENT_ID", "ffffffff-1111-2222-3333-444444444444")

    logged: list[dict] = []

    async def audit(row):
        logged.append(row)

    async def start(ipi, timeout):
        return "sess-42"

    async def run(ipi, sess, code):
        return {"stdout": "hi", "stderr": "", "exit_code": 0}

    async def stop(ipi, sess):
        pass

    tool = st.build_execute_code_tool(
        strands_tool_decorator=_passthrough_tool_decorator,
        session_state={},
        start_session=start,
        stop_session=stop,
        run_code=run,
        log_invocation=audit,
    )
    result = _run(tool("print('hi')"))
    assert result["ok"] is True
    assert len(logged) == 1
    row = logged[0]
    assert row["tenant_id"] == "11111111-2222-3333-4444-555555555555"
    assert row["user_id"] == "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    assert row["agent_id"] == "ffffffff-1111-2222-3333-444444444444"
    assert row["environment_id"] == "default-public"
    assert row["exit_status"] == "ok"
    assert row["session_id"] == "sess-42"
    assert isinstance(row["executed_code_hash"], str)
    assert len(row["executed_code_hash"]) == 64
    assert row["duration_ms"] is not None


def test_audit_fires_on_provisioning_path(monkeypatch):
    """Audit still runs when SANDBOX_INTERPRETER_ID is unset."""
    monkeypatch.delenv("SANDBOX_INTERPRETER_ID", raising=False)

    logged: list[dict] = []

    async def audit(row):
        logged.append(row)

    async def never(*args, **kwargs):
        raise AssertionError("should not be called")

    tool = st.build_execute_code_tool(
        strands_tool_decorator=_passthrough_tool_decorator,
        session_state={},
        start_session=never,
        stop_session=never,
        run_code=never,
        log_invocation=audit,
    )
    _run(tool("print('hi')"))
    assert len(logged) == 1
    assert logged[0]["exit_status"] == "provisioning"


def test_audit_fires_on_cap_exceeded(interpreter_env):
    """Audit runs even when the quota check rejects."""
    logged: list[dict] = []

    async def audit(row):
        logged.append(row)

    async def quota():
        return {
            "ok": False,
            "dimension": "tenant_daily",
            "resets_at": "2026-04-23T00:00:00Z",
        }

    async def never(*args, **kwargs):
        raise AssertionError("should not be called")

    tool = st.build_execute_code_tool(
        strands_tool_decorator=_passthrough_tool_decorator,
        session_state={},
        start_session=never,
        stop_session=never,
        run_code=never,
        check_quota=quota,
        log_invocation=audit,
    )
    _run(tool("print('hi')"))
    assert len(logged) == 1
    assert logged[0]["exit_status"] == "cap_exceeded"


def test_audit_write_failure_is_swallowed(interpreter_env):
    """An audit write failure must not unwind the agent turn."""

    async def audit(row):
        raise RuntimeError("audit endpoint 500")

    async def start(ipi, timeout):
        return "sess-1"

    async def run(ipi, sess, code):
        return {"stdout": "ok", "stderr": "", "exit_code": 0}

    async def stop(ipi, sess):
        pass

    tool = st.build_execute_code_tool(
        strands_tool_decorator=_passthrough_tool_decorator,
        session_state={},
        start_session=start,
        stop_session=stop,
        run_code=run,
        log_invocation=audit,
    )
    # Must not raise despite the audit writer throwing.
    result = _run(tool("print('hi')"))
    assert result["ok"] is True


def test_audit_code_hash_is_content_addressable(interpreter_env):
    """Same code → same hash. Different code → different hash."""

    logged: list[dict] = []

    async def audit(row):
        logged.append(row)

    async def start(ipi, timeout):
        return "sess"

    async def run(ipi, sess, code):
        return {"stdout": "", "stderr": "", "exit_code": 0}

    async def stop(ipi, sess):
        pass

    tool = st.build_execute_code_tool(
        strands_tool_decorator=_passthrough_tool_decorator,
        session_state={},
        start_session=start,
        stop_session=stop,
        run_code=run,
        log_invocation=audit,
    )
    _run(tool("print(1)"))
    _run(tool("print(1)"))
    _run(tool("print(2)"))
    assert logged[0]["executed_code_hash"] == logged[1]["executed_code_hash"]
    assert logged[1]["executed_code_hash"] != logged[2]["executed_code_hash"]
