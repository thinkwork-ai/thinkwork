"""Tests for the Skill meta-tool + session allowlist intersection.

Run with:
    uv run --no-project --with pytest --with pytest-asyncio \
        pytest packages/agentcore-strands/agent-container/test_skill_meta_tool.py
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

import pytest
import pytest_asyncio  # noqa: F401
from skill_dispatcher import SkillNotFound, TurnCounters
from skill_meta_tool import (
    AllowlistInput,
    SessionAllowlist,
    SkillMetaContext,
    SkillUnauthorized,
    build_skill_meta_tool,
    intersect_allowed_tools,
    invoke_skill,
)
from skill_session_pool import SkillSessionPool

# ---------------------------------------------------------------------------
# Fake catalog + runner — extend the U4 test shape with SKILL.md body access.
# ---------------------------------------------------------------------------


@dataclass
class FakeBundle:
    slug: str
    files: list[dict[str, str]] = field(default_factory=list)
    timeout_s: int = 30
    scripts: bool = True
    body: str = ""

    def files_for_interpreter(self) -> list[dict[str, str]]:
        return list(self.files)


@dataclass
class FakeCatalog:
    bundles: dict[str, FakeBundle] = field(default_factory=dict)

    def load_bundle(self, slug: str) -> FakeBundle:
        if slug not in self.bundles:
            raise KeyError(slug)
        return self.bundles[slug]

    def has_scripts(self, slug: str) -> bool:
        return self.bundles[slug].scripts

    def skill_md_body(self, slug: str) -> str:
        return self.bundles[slug].body


class FakeRunner:
    def __init__(self) -> None:
        self.execute_code_calls: list[str] = []
        self.write_files_calls: list[list[dict[str, str]]] = []
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
        self.write_files_calls.append(files)

    async def execute_code(self, handle, code, *, timeout_s):
        self.execute_code_calls.append(code)
        return self.responses.pop(0) if self.responses else {
            "stdout": "{}\n",
            "stderr": "",
            "exit_code": 0,
            "timed_out": False,
        }


async def _fake_start(_ipi: str, _timeout_s: int) -> str:
    await asyncio.sleep(0)
    return "sess-meta"


async def _fake_stop(_ipi: str, _sess: str) -> None:
    await asyncio.sleep(0)


def _pool() -> SkillSessionPool:
    return SkillSessionPool(
        interpreter_id="ipi-meta",
        start_session=_fake_start,
        stop_session=_fake_stop,
    )


def _ctx(
    *,
    allowlist_slugs: set[str],
    catalog: FakeCatalog,
    runner: FakeRunner,
    counters: TurnCounters | None = None,
) -> SkillMetaContext:
    return SkillMetaContext(
        tenant_id="tenant-a",
        user_id="user-a",
        environment="dev",
        allowlist=SessionAllowlist(slugs=frozenset(allowlist_slugs)),
        pool=_pool(),
        catalog=catalog,
        runner=runner,
        counters=counters or TurnCounters(),
    )


# ---------------------------------------------------------------------------
# Happy path — covers plan AE4
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_happy_path_script_skill_routes_to_dispatcher():
    catalog = FakeCatalog(
        bundles={"sales-prep": FakeBundle(slug="sales-prep", scripts=True)}
    )
    runner = FakeRunner()
    runner.queue(stdout='{"brief": "ready"}\n')
    ctx = _ctx(allowlist_slugs={"sales-prep"}, catalog=catalog, runner=runner)

    result = await invoke_skill("sales-prep", {"account": "Acme"}, ctx=ctx)

    assert result["kind"] == "script-result"
    assert result["slug"] == "sales-prep"
    assert result["result"] == {"brief": "ready"}
    # Confirm the dispatcher's exec template was actually sent.
    assert runner.execute_code_calls, "dispatcher must hit the runner"
    assert "scripts.sales-prep.entrypoint" in runner.execute_code_calls[0]


@pytest.mark.asyncio
async def test_nested_skill_invocations_share_the_same_turn_counters():
    catalog = FakeCatalog(
        bundles={
            "sales-prep": FakeBundle(slug="sales-prep"),
            "gather-crm-context": FakeBundle(slug="gather-crm-context"),
        }
    )
    runner = FakeRunner()
    runner.queue()
    runner.queue()
    counters = TurnCounters()
    ctx = _ctx(
        allowlist_slugs={"sales-prep", "gather-crm-context"},
        catalog=catalog,
        runner=runner,
        counters=counters,
    )

    await invoke_skill("sales-prep", {}, ctx=ctx)
    await invoke_skill("gather-crm-context", {}, ctx=ctx)

    # Both calls ran; both counted against the same per-turn budget.
    assert counters.total == 2
    assert counters.history == ["sales-prep", "gather-crm-context"]


# ---------------------------------------------------------------------------
# Pure-SKILL.md path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pure_skill_md_returns_body_without_sandbox():
    catalog = FakeCatalog(
        bundles={
            "synthesize": FakeBundle(
                slug="synthesize",
                scripts=False,
                body="# Synthesize\n\nProse the model reads inline.",
            )
        }
    )
    runner = FakeRunner()
    ctx = _ctx(allowlist_slugs={"synthesize"}, catalog=catalog, runner=runner)

    result = await invoke_skill("synthesize", None, ctx=ctx)

    assert result["kind"] == "skill-md-body"
    assert "Prose the model reads inline." in result["body"]
    # No sandbox roundtrip when the bundle has no scripts.
    assert runner.execute_code_calls == []
    assert runner.write_files_calls == []


# ---------------------------------------------------------------------------
# Authorization errors
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unknown_slug_raises_skill_not_found():
    catalog = FakeCatalog(bundles={})
    runner = FakeRunner()
    ctx = _ctx(allowlist_slugs=set(), catalog=catalog, runner=runner)

    with pytest.raises(SkillNotFound):
        await invoke_skill("missing", {}, ctx=ctx)


@pytest.mark.asyncio
async def test_in_catalog_but_not_in_session_raises_skill_unauthorized():
    """Distinct from SkillNotFound — the model must not learn a slug exists
    in the catalog if the current session can't invoke it."""
    catalog = FakeCatalog(bundles={"admin-op": FakeBundle(slug="admin-op")})
    runner = FakeRunner()
    ctx = _ctx(allowlist_slugs={"some-other-skill"}, catalog=catalog, runner=runner)

    with pytest.raises(SkillUnauthorized):
        await invoke_skill("admin-op", {}, ctx=ctx)
    # Skipped dispatcher entirely — no sandbox contact.
    assert runner.execute_code_calls == []


# ---------------------------------------------------------------------------
# Session allowlist intersection (plan R6 / R7)
# ---------------------------------------------------------------------------


def test_allowlist_intersects_tenant_and_template_then_subtracts_blocks():
    inputs = AllowlistInput(
        tenant_skills=frozenset({"a", "b", "c", "d"}),
        template_skills=frozenset({"a", "b", "c"}),
        template_blocked_tools=frozenset({"b"}),
        tenant_disabled_builtin_tools=frozenset({"c"}),
    )
    allowlist = SessionAllowlist.from_inputs(inputs)

    # 'a' is tenant ∩ template; 'b' removed by template block; 'c' removed
    # by tenant kill-switch; 'd' not in template so not in session.
    assert allowlist.slugs == frozenset({"a"})


def test_allowlist_warns_when_template_names_skills_tenant_has_not_installed():
    inputs = AllowlistInput(
        tenant_skills=frozenset({"a"}),
        template_skills=frozenset({"a", "b"}),
        template_blocked_tools=frozenset(),
        tenant_disabled_builtin_tools=frozenset(),
    )
    allowlist = SessionAllowlist.from_inputs(inputs)

    assert allowlist.slugs == frozenset({"a"})
    # Warning captures the tenant-missing slug so operators can spot
    # misconfigured templates without the dispatcher raising per-call.
    assert any("b" in w for w in allowlist.warnings)


def test_allowlist_template_cannot_unblock_a_tenant_kill_switch():
    inputs = AllowlistInput(
        tenant_skills=frozenset({"critical-skill"}),
        template_skills=frozenset({"critical-skill"}),
        template_blocked_tools=frozenset(),
        tenant_disabled_builtin_tools=frozenset({"critical-skill"}),
    )
    allowlist = SessionAllowlist.from_inputs(inputs)

    # Tenant disable trumps template enablement — the session sees no
    # skill, period.
    assert allowlist.slugs == frozenset()
    assert any("critical-skill" in w for w in allowlist.warnings)


# ---------------------------------------------------------------------------
# allowed-tools intersection (narrow-only)
# ---------------------------------------------------------------------------


def test_allowed_tools_narrows_to_session_intersection():
    effective, warnings = intersect_allowed_tools(
        declared=["Read", "Grep", "Bash"],
        session_tools=frozenset({"Read", "Grep"}),
    )
    assert effective == frozenset({"Read", "Grep"})
    # Bash was declared but not granted — surfaced as a warning.
    assert any("Bash" in w for w in warnings)


def test_allowed_tools_never_widens_past_session():
    """Even if a skill declares a tool outside the session, it's filtered out."""
    effective, _ = intersect_allowed_tools(
        declared=["Shell"],
        session_tools=frozenset({"Read"}),
    )
    assert effective == frozenset()


def test_allowed_tools_returns_full_session_when_declared_is_absent():
    """Per spec, absent allowed-tools means the skill doesn't opt into
    narrowing — the session's own allowlist applies unchanged."""
    effective, warnings = intersect_allowed_tools(
        declared=None,
        session_tools=frozenset({"Read", "Grep"}),
    )
    assert effective == frozenset({"Read", "Grep"})
    assert warnings == []


# ---------------------------------------------------------------------------
# build_skill_meta_tool wiring
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_build_skill_meta_tool_returns_callable_that_invokes_correctly():
    """The factory closure must capture ctx and route through invoke_skill."""
    catalog = FakeCatalog(bundles={"demo": FakeBundle(slug="demo")})
    runner = FakeRunner()
    runner.queue(stdout='{"ok": 1}\n')
    ctx = _ctx(allowlist_slugs={"demo"}, catalog=catalog, runner=runner)

    Skill = build_skill_meta_tool(ctx)
    result = await Skill("demo", {"x": 1})

    assert result["kind"] == "script-result"
    assert result["slug"] == "demo"
    assert result["result"] == {"ok": 1}
