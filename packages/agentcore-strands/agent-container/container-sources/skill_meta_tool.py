"""The single `Skill(name, args)` meta-tool.

This is the invocation surface every skill-with-scripts goes through once
U6 flips the cutover. The model calls ``Skill("sales-prep", {...})``; this
module validates the name against the per-session allowlist, then either:

  * hands off to ``skill_dispatcher.dispatch_skill_script`` when the bundle
    ships a ``scripts/`` directory, or
  * returns the SKILL.md body as a string when the bundle is pure-context
    (no scripts — the model consumes the SKILL.md inline).

Why a meta-tool instead of per-skill named tools:
    4 enterprises × 100+ agents × ~5 templates ⇒ hundreds of skills per
    session if each were a registered tool. Strands' tool registry would
    swell beyond the model's token budget for tool-use schemas. The
    meta-tool has a fixed schema (``name`` + ``args``); the AgentSkills
    plugin does Level-1 progressive disclosure into the system prompt so
    the model knows what's available without paying the per-schema cost.

Why not AgentSkills' own ``skills`` invocation tool:
    AgentSkills from the Strands SDK registers a built-in tool named
    ``skills`` that reads ``SKILL.md`` on demand. It overlaps with our
    meta-tool in a confusing way — two mechanisms to invoke a skill, with
    different semantics for scripts. V1 keeps AgentSkills' disclosure
    side and suppresses its invocation side; our ``Skill`` meta-tool is
    the sole invocation path (plan #007 §Key Technical Decisions).

Session allowlist invariant (plan R6/R7):
    ``tenant_skills ∩ template_skills ∩ ¬template_blocks ∩ ¬tenant_kill_switches``
    A template cannot widen past what the tenant enabled. ``allowed-tools``
    frontmatter on the skill intersects with the session's tool allowlist
    at registration time — narrow-only, never widens.
"""

from __future__ import annotations

import contextvars
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from skill_dispatcher import (
    SkillDispatchError,
    SkillNotFound,
    TurnCounters,
    dispatch_skill_script,
)
from skill_session_pool import SkillSessionPool

logger = logging.getLogger(__name__)


# U4 of finance pilot (2026-05-14-002) — per-turn dedup for the
# `skill.activated` compliance event.
#
# Stored in a `ContextVar` rather than a module-level global so concurrent
# agent turns (different tenants on the same warm Lambda container) don't
# bleed activations across each other. ``contextvars`` is the right
# primitive: it propagates with asyncio Tasks but isolates per
# top-level call (each ``_execute_agent_turn`` entry runs in its own
# context).
#
# The set holds skill slugs already audited this turn. The first time a
# slug fires we emit `skill.activated`; subsequent invocations of the
# same slug in the same turn skip the emit but the skill still runs.
_activated_skills_this_turn: contextvars.ContextVar[set[str] | None] = (
    contextvars.ContextVar("activated_skills_this_turn", default=None)
)


def reset_skill_activation_dedup_for_turn() -> contextvars.Token[set[str] | None]:
    """Reset the per-turn dedup set. Call once at the start of each agent
    turn (server.py's _execute_agent_turn is the call site). Returns a
    token the caller passes to ``release_skill_activation_dedup_for_turn``
    in a finally block to restore the prior context.
    """
    return _activated_skills_this_turn.set(set())


def release_skill_activation_dedup_for_turn(
    token: contextvars.Token[set[str] | None],
) -> None:
    """Restore the previous dedup-set value. Must be paired with
    ``reset_skill_activation_dedup_for_turn`` in a try/finally.
    """
    _activated_skills_this_turn.reset(token)


def _mark_skill_activated_this_turn(slug: str) -> bool:
    """Returns True the first time this slug is seen this turn, False
    on every subsequent call. The caller emits the audit event only on
    a True return.
    """
    seen = _activated_skills_this_turn.get()
    if seen is None:
        # No turn context — caller forgot to reset, or test scaffolding
        # ran outside an agent turn. Fail open: emit every time so the
        # signal still gets through, but log so the gap is visible.
        logger.warning(
            "skill-meta: activation seen with no turn-dedup context — "
            "emitting every invocation. Did the caller call "
            "reset_skill_activation_dedup_for_turn?"
        )
        return True
    if slug in seen:
        return False
    seen.add(slug)
    return True


class SkillUnauthorized(SkillDispatchError):
    """Slug is in the catalog but not in this session's allowlist.

    Distinct from ``SkillNotFound`` — the model should not learn that a
    catalog slug exists if the current session can't invoke it. The
    error message stays generic at the tool surface; the full context
    goes to the audit log.
    """


@dataclass(frozen=True)
class AllowlistInput:
    """Raw inputs the session allowlist intersects at Agent(tools=...) time."""

    tenant_skills: frozenset[str]
    template_skills: frozenset[str]
    template_blocked_tools: frozenset[str]
    tenant_disabled_builtin_tools: frozenset[str]


@dataclass(frozen=True)
class SessionAllowlist:
    """Resolved set of skill slugs the current session may invoke.

    The intersection is pre-computed once at Agent construction — runtime
    lookups are O(1). ``warnings`` captures slugs the template *named* that
    got filtered out, so operators can spot misconfiguration without the
    dispatcher raising on every call.
    """

    slugs: frozenset[str]
    warnings: tuple[str, ...] = ()

    def contains(self, slug: str) -> bool:
        return slug in self.slugs

    @classmethod
    def from_inputs(cls, inputs: AllowlistInput) -> "SessionAllowlist":
        # Start with template slugs — the template author decides what the
        # agent *can* see. Narrow by tenant-library (tenant hasn't installed
        # it? not available), template-blocks (explicit opt-out), and
        # tenant-kill-switches (tenant-wide disable; strongest precedence).
        resolved: set[str] = set(inputs.template_skills) & set(inputs.tenant_skills)
        blocked = inputs.template_blocked_tools | inputs.tenant_disabled_builtin_tools
        resolved -= blocked

        warnings: list[str] = []
        missing_from_tenant = inputs.template_skills - inputs.tenant_skills
        if missing_from_tenant:
            warnings.append(
                f"template names {len(missing_from_tenant)} skill(s) the tenant has "
                f"not installed: {sorted(missing_from_tenant)}"
            )
        unblocked_by_tenant = (
            inputs.template_skills & inputs.tenant_disabled_builtin_tools
        )
        if unblocked_by_tenant:
            warnings.append(
                f"tenant kill-switch filters {len(unblocked_by_tenant)} template-named "
                f"skill(s): {sorted(unblocked_by_tenant)}"
            )

        return cls(slugs=frozenset(resolved), warnings=tuple(warnings))


@dataclass
class SkillMetaResponse:
    """Shape the meta-tool returns to the Strands runtime."""

    kind: str  # 'script-result' | 'skill-md-body'
    slug: str
    result: Any = None
    body: str | None = None
    duration_ms: int | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"kind": self.kind, "slug": self.slug}
        if self.result is not None:
            out["result"] = self.result
        if self.body is not None:
            out["body"] = self.body
        if self.duration_ms is not None:
            out["duration_ms"] = self.duration_ms
        return out


class BundleLoader(Protocol):
    """Extends skill_dispatcher.SkillBundleLoader with SKILL.md body access."""

    def load_bundle(self, slug: str) -> Any: ...

    def has_scripts(self, slug: str) -> bool:
        """True if the bundle ships ``scripts/<slug>/entrypoint.py``."""
        ...

    def skill_md_body(self, slug: str) -> str:
        """Return the SKILL.md body for pure-context skills."""
        ...


@dataclass
class SkillMetaContext:
    """Per-turn wiring passed to every Skill() call.

    Constructed once at Agent(tools=...) construction and captured by the
    tool closure. Split into its own type so test harnesses can swap
    individual parts without rebuilding the whole tool.
    """

    tenant_id: str
    user_id: str
    environment: str
    allowlist: SessionAllowlist
    pool: SkillSessionPool
    catalog: BundleLoader
    runner: Any  # duck-typed as skill_dispatcher.SandboxRunner
    counters: TurnCounters = field(default_factory=TurnCounters)
    on_audit: Callable[[dict[str, Any]], Awaitable[None]] | None = None
    # U4 of finance pilot — `skill.activated` audit emit hook. Fires
    # exactly once per distinct skill slug per turn (the dedup state
    # lives in the module-level ContextVar above). server.py wires this
    # to compliance_client.emit. Called with the slug + outcome
    # ("allowed" / "denied") + an optional denied_reason. Telemetry tier:
    # exceptions are caught and logged; the agent turn never fails on
    # an audit error.
    on_skill_activated: Callable[[str, str, str | None], Awaitable[None]] | None = None


# ---------------------------------------------------------------------------
# Tool factory
# ---------------------------------------------------------------------------


async def invoke_skill(
    name: str,
    args: dict[str, Any] | None,
    *,
    ctx: SkillMetaContext,
) -> dict[str, Any]:
    """Pure entry point the Strands @tool wrapper calls.

    Kept decoupled from the Strands SDK so unit tests exercise the full
    decision tree without importing strands. ``build_skill_meta_tool``
    below wraps this for the runtime.
    """
    call_args = dict(args or {})

    # SkillNotFound vs SkillUnauthorized:
    # * not in the catalog at all → NotFound (returned to the model so it
    #   learns the slug doesn't exist anywhere).
    # * in the catalog but the current session can't see it → Unauthorized
    #   (returned with a generic message so the model cannot enumerate
    #   tenant-scoped catalog membership by probing slugs).
    try:
        ctx.catalog.load_bundle(name)
    except KeyError as e:
        raise SkillNotFound(f"skill '{name}' is not registered in the catalog") from e

    if not ctx.allowlist.contains(name):
        logger.info(
            "skill-meta: %s blocked — not in session allowlist "
            "(tenant=%s user=%s env=%s)",
            name,
            ctx.tenant_id,
            ctx.user_id,
            ctx.environment,
        )
        # U4 of finance pilot — emit skill.activated with outcome="denied"
        # so the audit log records blocked attempts. Deduped per turn so
        # a model that loops on a denied skill doesn't flood the log.
        await _maybe_emit_skill_activated(
            ctx,
            slug=name,
            outcome="denied",
            denied_reason="not_in_allowlist",
        )
        raise SkillUnauthorized(
            f"skill '{name}' is not available in this session"
        )

    # U4 of finance pilot — emit skill.activated with outcome="allowed"
    # the first time each slug fires this turn.
    await _maybe_emit_skill_activated(
        ctx,
        slug=name,
        outcome="allowed",
        denied_reason=None,
    )

    # Pure-SKILL.md skills never touch the sandbox. Returning the body lets
    # the model consume the instructions inline; no quota, no pool slot.
    if not ctx.catalog.has_scripts(name):
        body = ctx.catalog.skill_md_body(name)
        logger.info("skill-meta: %s served from SKILL.md body (%d chars)", name, len(body))
        return SkillMetaResponse(kind="skill-md-body", slug=name, body=body).to_dict()

    # Script-bundle skills flow through U4's unified dispatcher.
    dispatch_result = await dispatch_skill_script(
        tenant_id=ctx.tenant_id,
        user_id=ctx.user_id,
        skill_slug=name,
        args=call_args,
        environment=ctx.environment,
        pool=ctx.pool,
        catalog=ctx.catalog,
        runner=ctx.runner,
        counters=ctx.counters,
        on_audit=ctx.on_audit,
    )
    return SkillMetaResponse(
        kind="script-result",
        slug=name,
        result=dispatch_result.result,
        duration_ms=dispatch_result.duration_ms,
    ).to_dict()


async def _maybe_emit_skill_activated(
    ctx: SkillMetaContext,
    *,
    slug: str,
    outcome: str,
    denied_reason: str | None,
) -> None:
    """Per-turn deduped skill.activated emit.

    Fires the context's ``on_skill_activated`` hook the first time a
    given slug appears within a turn. Subsequent invocations of the
    same slug in the same turn are silenced.

    Telemetry tier: hook exceptions are caught and logged. The agent
    turn never fails on an audit error.
    """
    if ctx.on_skill_activated is None:
        return
    if not _mark_skill_activated_this_turn(slug):
        return
    try:
        await ctx.on_skill_activated(slug, outcome, denied_reason)
    except Exception:  # noqa: BLE001 — telemetry tier
        logger.exception(
            "skill-meta: skill.activated emit failed for slug=%s outcome=%s",
            slug,
            outcome,
        )


def build_skill_meta_tool(ctx: SkillMetaContext) -> Callable[..., Awaitable[dict[str, Any]]]:
    """Return a coroutine the Strands @tool decorator can wrap.

    Caller is expected to wrap the returned function with ``@strands.tool``
    (or the equivalent ``strands_tool(...)`` decorator). The factory itself
    avoids importing strands so tests can exercise the tool without
    triggering the SDK's side effects.
    """

    async def Skill(name: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
        """Invoke a registered skill by slug.

        Args:
            name: Skill slug, e.g. "sales-prep".
            args: Keyword arguments forwarded to the skill's ``run()`` function.

        Returns:
            Structured result with kind='script-result' or 'skill-md-body'.
        """
        return await invoke_skill(name, args, ctx=ctx)

    return Skill


# ---------------------------------------------------------------------------
# allowed-tools intersection (frontmatter advisory → session allowlist)
# ---------------------------------------------------------------------------


def intersect_allowed_tools(
    declared: list[str] | None,
    session_tools: frozenset[str],
) -> tuple[frozenset[str], list[str]]:
    """Narrow a skill's declared ``allowed-tools`` against the session's
    effective tool allowlist.

    Anthropic's Agent Skills spec treats ``allowed-tools`` as the set of
    tools the skill is allowed to use *within its own execution*. The
    Claude Code CLI honours it by clamping the skill's tool access; we
    honour it as an informational hint that narrows toward the session's
    harness-constructed allowlist (plan #007 §Key Technical Decisions).

    Returns (effective_tools, warnings). Warnings list any tool the skill
    declared but the session doesn't grant — logged at registration time
    so operators can spot tenants that disabled a dependency.
    """
    if not declared:
        return session_tools, []
    declared_set = frozenset(declared)
    missing = declared_set - session_tools
    effective = declared_set & session_tools
    warnings: list[str] = []
    if missing:
        warnings.append(
            "declared tools absent from session allowlist — narrowing. "
            f"missing={sorted(missing)}"
        )
    return effective, warnings


__all__ = [
    "AllowlistInput",
    "BundleLoader",
    "SessionAllowlist",
    "SkillMetaContext",
    "SkillMetaResponse",
    "SkillUnauthorized",
    "build_skill_meta_tool",
    "intersect_allowed_tools",
    "invoke_skill",
]
