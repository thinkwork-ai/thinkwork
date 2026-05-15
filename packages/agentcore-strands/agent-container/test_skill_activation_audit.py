"""Tests for the U4 `skill.activated` audit emit + per-turn dedup.

Uses ``asyncio.run`` inside synchronous tests (project convention — see
test_compliance_client.py) so we don't need pytest-asyncio.

Plan: docs/plans/2026-05-14-002-feat-finance-analysis-pilot-plan.md (U4)
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
CONTAINER_SOURCES = (
    REPO_ROOT / "packages/agentcore-strands/agent-container/container-sources"
)
if str(CONTAINER_SOURCES) not in sys.path:
    sys.path.insert(0, str(CONTAINER_SOURCES))

from skill_meta_tool import (  # noqa: E402
    AllowlistInput,
    SessionAllowlist,
    SkillMetaContext,
    SkillUnauthorized,
    invoke_skill,
    release_skill_activation_dedup_for_turn,
    reset_skill_activation_dedup_for_turn,
)


class _FakeBundle:
    def __init__(self, slug: str, has_scripts: bool = False, body: str = ""):
        self.slug = slug
        self._has_scripts = has_scripts
        self._body = body


class _FakeCatalog:
    def __init__(self, slugs: list[str], with_scripts: set[str] | None = None):
        self._with_scripts = with_scripts or set()
        self._bundles = {
            s: _FakeBundle(s, s in self._with_scripts, f"body of {s}")
            for s in slugs
        }

    def load_bundle(self, slug: str):
        if slug not in self._bundles:
            raise KeyError(slug)
        return self._bundles[slug]

    def has_scripts(self, slug: str) -> bool:
        return slug in self._with_scripts

    def skill_md_body(self, slug: str) -> str:
        return self._bundles[slug]._body


def _build_ctx(
    *,
    allowed: list[str],
    catalog_slugs: list[str] | None = None,
    on_skill_activated=None,
) -> SkillMetaContext:
    inputs = AllowlistInput(
        tenant_skills=frozenset(allowed),
        template_skills=frozenset(allowed),
        template_blocked_tools=frozenset(),
        tenant_disabled_builtin_tools=frozenset(),
    )
    allowlist = SessionAllowlist.from_inputs(inputs)
    catalog = _FakeCatalog(catalog_slugs or allowed)
    return SkillMetaContext(
        tenant_id="t1",
        user_id="u1",
        environment="dev",
        allowlist=allowlist,
        pool=None,  # type: ignore[arg-type]
        catalog=catalog,
        runner=None,
        on_skill_activated=on_skill_activated,
    )


def _run_in_turn(coro_factory):
    """Run a coroutine under a fresh per-turn dedup context. Mirrors
    server.py's `_execute_agent_turn` wrapping pattern.
    """

    async def _wrap():
        token = reset_skill_activation_dedup_for_turn()
        try:
            return await coro_factory()
        finally:
            release_skill_activation_dedup_for_turn(token)

    return asyncio.run(_wrap())


class TestPerTurnDedup:
    def test_single_skill_three_calls_emits_once(self):
        events: list[tuple[str, str, str | None]] = []

        async def hook(slug, outcome, reason):
            events.append((slug, outcome, reason))

        ctx = _build_ctx(allowed=["sales-prep"], on_skill_activated=hook)

        async def run():
            await invoke_skill("sales-prep", None, ctx=ctx)
            await invoke_skill("sales-prep", None, ctx=ctx)
            await invoke_skill("sales-prep", None, ctx=ctx)

        _run_in_turn(run)
        assert events == [("sales-prep", "allowed", None)]

    def test_two_distinct_skills_emit_in_order(self):
        events: list[tuple[str, str, str | None]] = []

        async def hook(slug, outcome, reason):
            events.append((slug, outcome, reason))

        ctx = _build_ctx(allowed=["a", "b"], on_skill_activated=hook)

        async def run():
            await invoke_skill("a", None, ctx=ctx)
            await invoke_skill("b", None, ctx=ctx)
            await invoke_skill("a", None, ctx=ctx)
            await invoke_skill("b", None, ctx=ctx)

        _run_in_turn(run)
        assert events == [("a", "allowed", None), ("b", "allowed", None)]

    def test_denied_activation_emits_with_outcome_and_reason(self):
        events: list[tuple[str, str, str | None]] = []

        async def hook(slug, outcome, reason):
            events.append((slug, outcome, reason))

        ctx = _build_ctx(
            allowed=["allowed-only"],
            catalog_slugs=["allowed-only", "blocked-skill"],
            on_skill_activated=hook,
        )

        async def run():
            for _ in range(2):
                with pytest.raises(SkillUnauthorized):
                    await invoke_skill("blocked-skill", None, ctx=ctx)

        _run_in_turn(run)
        # Two denied attempts, one emit — dedup applies to denials too.
        assert events == [("blocked-skill", "denied", "not_in_allowlist")]

    def test_hook_failure_does_not_break_invocation(self):
        async def flaky_hook(slug, outcome, reason):
            raise RuntimeError("audit endpoint down")

        ctx = _build_ctx(allowed=["sales-prep"], on_skill_activated=flaky_hook)

        async def run():
            return await invoke_skill("sales-prep", None, ctx=ctx)

        result = _run_in_turn(run)
        assert result["kind"] == "skill-md-body"

    def test_two_concurrent_turns_have_independent_dedup(self):
        """ContextVar isolation: two coroutines each running their own
        turn must each emit once per slug, not share state.
        """
        events_a: list[str] = []
        events_b: list[str] = []

        async def hook_a(slug, outcome, reason):
            events_a.append(slug)

        async def hook_b(slug, outcome, reason):
            events_b.append(slug)

        ctx_a = _build_ctx(allowed=["sales-prep"], on_skill_activated=hook_a)
        ctx_b = _build_ctx(allowed=["sales-prep"], on_skill_activated=hook_b)

        async def run_turn(ctx):
            token = reset_skill_activation_dedup_for_turn()
            try:
                await invoke_skill("sales-prep", None, ctx=ctx)
                await invoke_skill("sales-prep", None, ctx=ctx)
            finally:
                release_skill_activation_dedup_for_turn(token)

        async def both():
            await asyncio.gather(run_turn(ctx_a), run_turn(ctx_b))

        asyncio.run(both())

        # Each turn emits exactly once despite each invoking the same
        # skill twice. The ContextVar prevents A's set from suppressing
        # B's emit.
        assert events_a == ["sales-prep"]
        assert events_b == ["sales-prep"]

    def test_no_dedup_context_emits_every_invocation_fail_open(self):
        events: list[str] = []

        async def hook(slug, outcome, reason):
            events.append(slug)

        ctx = _build_ctx(allowed=["sales-prep"], on_skill_activated=hook)

        async def run_without_turn():
            # Deliberately do NOT reset the dedup ContextVar — emulate
            # a code path that forgot to wrap.
            await invoke_skill("sales-prep", None, ctx=ctx)
            await invoke_skill("sales-prep", None, ctx=ctx)

        asyncio.run(run_without_turn())
        # Fail-open: every invocation emits so the signal still gets
        # through. _mark_skill_activated_this_turn logs a warning.
        assert events == ["sales-prep", "sales-prep"]

    def test_no_hook_configured_is_a_no_op(self):
        """When `on_skill_activated` is None, invocation works without
        any audit side effect (zero-config path).
        """
        ctx = _build_ctx(allowed=["sales-prep"], on_skill_activated=None)

        async def run():
            return await invoke_skill("sales-prep", None, ctx=ctx)

        result = _run_in_turn(run)
        assert result["kind"] == "skill-md-body"
