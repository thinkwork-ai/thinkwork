"""Unit tests for skill_dispatcher.dispatch_skill_script.

Run with:
    uv run --no-project --with pytest --with pytest-asyncio \
        pytest packages/agentcore-strands/agent-container/test_skill_dispatcher.py
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

import pytest
import pytest_asyncio  # noqa: F401
from skill_dispatcher import (
    MAX_CALLS_PER_TURN,
    MAX_NESTED_DEPTH,
    SkillDepthExceeded,
    SkillExecutionError,
    SkillNotFound,
    SkillOutputParseError,
    SkillTimeout,
    SkillTurnBudgetExceeded,
    TurnCounters,
    dispatch_skill_script,
)
from skill_session_pool import SkillSessionPool

# ---------------------------------------------------------------------------
# Fixtures — in-memory catalog + runner
# ---------------------------------------------------------------------------


@dataclass
class FakeBundle:
    slug: str
    files: list[dict[str, str]] = field(default_factory=list)
    timeout_s: int = 30

    def files_for_interpreter(self) -> list[dict[str, str]]:
        return list(self.files)


@dataclass
class FakeCatalog:
    bundles: dict[str, FakeBundle] = field(default_factory=dict)

    def load_bundle(self, slug: str) -> FakeBundle:
        if slug not in self.bundles:
            raise KeyError(slug)
        return self.bundles[slug]


class FakeRunner:
    """Records what the dispatcher sends to the sandbox; replays canned output."""

    def __init__(self) -> None:
        self.write_files_calls: list[list[dict[str, str]]] = []
        self.execute_code_calls: list[str] = []
        # Response queue — test pushes results in order.
        self._responses: list[dict[str, Any]] = []

    def queue(self, **response) -> None:
        self._responses.append(
            {
                "stdout": response.get("stdout", ""),
                "stderr": response.get("stderr", ""),
                "exit_code": response.get("exit_code", 0),
                "timed_out": response.get("timed_out", False),
            }
        )

    async def write_files(self, handle, files):
        self.write_files_calls.append(files)

    async def execute_code(self, handle, code, *, timeout_s):
        self.execute_code_calls.append(code)
        if not self._responses:
            return {"stdout": "{}\n", "stderr": "", "exit_code": 0}
        return self._responses.pop(0)


async def _fake_start(_ipi: str, _timeout_s: int) -> str:
    await asyncio.sleep(0)
    return "sess-1"


async def _fake_stop(_ipi: str, _sess: str) -> None:
    await asyncio.sleep(0)


def _pool() -> SkillSessionPool:
    return SkillSessionPool(
        interpreter_id="ipi-test",
        start_session=_fake_start,
        stop_session=_fake_stop,
    )


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_happy_path_routes_args_through_writeFiles_and_returns_parsed_result():
    catalog = FakeCatalog(
        bundles={
            "demo": FakeBundle(
                slug="demo",
                files=[{"path": "scripts/demo/entrypoint.py", "text": "ok"}],
            )
        }
    )
    runner = FakeRunner()
    runner.queue(stdout='{"greeting": "hi"}\n', exit_code=0)
    pool = _pool()

    result = await dispatch_skill_script(
        tenant_id="tenant-a",
        user_id="user-a",
        skill_slug="demo",
        args={"name": "world"},
        environment="dev",
        pool=pool,
        catalog=catalog,
        runner=runner,
        counters=TurnCounters(),
    )

    assert result.status == "ok"
    assert result.result == {"greeting": "hi"}
    # Files staged include the skill payload *and* the args file.
    staged = runner.write_files_calls[0]
    args_file = next(f for f in staged if f["path"] == "_args.json")
    assert args_file["text"] == '{"name": "world"}'
    # executeCode string is the fixed template — args are NOT embedded in it.
    exec_code = runner.execute_code_calls[0]
    assert "scripts.demo.entrypoint" in exec_code
    assert "_args.json" in exec_code
    assert "world" not in exec_code


# ---------------------------------------------------------------------------
# Error paths
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unknown_slug_raises_skill_not_found():
    catalog = FakeCatalog()
    runner = FakeRunner()
    pool = _pool()

    with pytest.raises(SkillNotFound):
        await dispatch_skill_script(
            tenant_id="t",
            user_id="u",
            skill_slug="missing",
            args={},
            environment="dev",
            pool=pool,
            catalog=catalog,
            runner=runner,
            counters=TurnCounters(),
        )


@pytest.mark.asyncio
async def test_non_json_stdout_raises_skill_output_parse_error():
    catalog = FakeCatalog(bundles={"demo": FakeBundle(slug="demo")})
    runner = FakeRunner()
    runner.queue(stdout="this is not json\n", exit_code=0)
    pool = _pool()

    with pytest.raises(SkillOutputParseError) as excinfo:
        await dispatch_skill_script(
            tenant_id="t",
            user_id="u",
            skill_slug="demo",
            args={},
            environment="dev",
            pool=pool,
            catalog=catalog,
            runner=runner,
            counters=TurnCounters(),
        )
    # The captured stdout rides along so the operator can diagnose.
    assert "this is not json" in excinfo.value.stdout


@pytest.mark.asyncio
async def test_timeout_signal_raises_skill_timeout():
    catalog = FakeCatalog(bundles={"demo": FakeBundle(slug="demo", timeout_s=5)})
    runner = FakeRunner()
    runner.queue(timed_out=True, exit_code=124)
    pool = _pool()

    with pytest.raises(SkillTimeout):
        await dispatch_skill_script(
            tenant_id="t",
            user_id="u",
            skill_slug="demo",
            args={},
            environment="dev",
            pool=pool,
            catalog=catalog,
            runner=runner,
            counters=TurnCounters(),
        )


@pytest.mark.asyncio
async def test_non_zero_exit_raises_skill_execution_error_with_stderr():
    catalog = FakeCatalog(bundles={"demo": FakeBundle(slug="demo")})
    runner = FakeRunner()
    runner.queue(exit_code=1, stderr="Traceback: KeyError\n")
    pool = _pool()

    with pytest.raises(SkillExecutionError) as excinfo:
        await dispatch_skill_script(
            tenant_id="t",
            user_id="u",
            skill_slug="demo",
            args={},
            environment="dev",
            pool=pool,
            catalog=catalog,
            runner=runner,
            counters=TurnCounters(),
        )
    assert "KeyError" in excinfo.value.stderr


# ---------------------------------------------------------------------------
# Budget gates
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_depth_cap_rejects_nested_beyond_max():
    catalog = FakeCatalog(bundles={"demo": FakeBundle(slug="demo")})
    runner = FakeRunner()
    runner.queue(stdout="{}\n", exit_code=0)
    pool = _pool()

    counters = TurnCounters(depth=MAX_NESTED_DEPTH + 1)
    with pytest.raises(SkillDepthExceeded):
        await dispatch_skill_script(
            tenant_id="t",
            user_id="u",
            skill_slug="demo",
            args={},
            environment="dev",
            pool=pool,
            catalog=catalog,
            runner=runner,
            counters=counters,
        )


@pytest.mark.asyncio
async def test_depth_cap_admits_exactly_max_nested_calls():
    # Boundary — depth == MAX is allowed; depth > MAX is not.
    catalog = FakeCatalog(bundles={"demo": FakeBundle(slug="demo")})
    runner = FakeRunner()
    runner.queue(stdout="{}\n", exit_code=0)
    pool = _pool()

    result = await dispatch_skill_script(
        tenant_id="t",
        user_id="u",
        skill_slug="demo",
        args={},
        environment="dev",
        pool=pool,
        catalog=catalog,
        runner=runner,
        counters=TurnCounters(depth=MAX_NESTED_DEPTH),
    )
    assert result.status == "ok"


@pytest.mark.asyncio
async def test_turn_budget_rejects_call_51_on_a_turn():
    catalog = FakeCatalog(bundles={"demo": FakeBundle(slug="demo")})
    runner = FakeRunner()
    pool = _pool()

    counters = TurnCounters(total=MAX_CALLS_PER_TURN)
    with pytest.raises(SkillTurnBudgetExceeded):
        await dispatch_skill_script(
            tenant_id="t",
            user_id="u",
            skill_slug="demo",
            args={},
            environment="dev",
            pool=pool,
            catalog=catalog,
            runner=runner,
            counters=counters,
        )


# ---------------------------------------------------------------------------
# Audit hook
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_audit_hook_fires_on_ok_and_on_failure():
    catalog = FakeCatalog(bundles={"demo": FakeBundle(slug="demo")})
    runner = FakeRunner()
    runner.queue(stdout='{"ok": true}\n', exit_code=0)
    pool = _pool()

    events: list[dict[str, Any]] = []

    async def capture(event):
        events.append(event)

    await dispatch_skill_script(
        tenant_id="t",
        user_id="u",
        skill_slug="demo",
        args={},
        environment="dev",
        pool=pool,
        catalog=catalog,
        runner=runner,
        counters=TurnCounters(),
        on_audit=capture,
    )
    assert events and events[0]["status"] == "ok"

    runner.queue(stdout="nope\n", exit_code=0)
    with pytest.raises(SkillOutputParseError):
        await dispatch_skill_script(
            tenant_id="t",
            user_id="u",
            skill_slug="demo",
            args={},
            environment="dev",
            pool=pool,
            catalog=catalog,
            runner=runner,
            counters=TurnCounters(),
            on_audit=capture,
        )
    assert events[-1]["status"] == "failed"
    assert events[-1]["error_kind"] == "SkillOutputParseError"
