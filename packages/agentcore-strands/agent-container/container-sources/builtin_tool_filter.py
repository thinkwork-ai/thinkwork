"""Tenant kill-switch + template-block filter for built-in tools (plan §U12, R6/R7).

Runs inside the Strands container just before ``Agent(tools=...)`` construction.
Tenant-wide disables (``tenants.disabled_builtin_tools``) and template-level
blocks (``agent_templates.blocked_tools``) both narrow the per-session
built-in set. Tenant wins when the two lists disagree: the tenant's
kill-switch is the strongest signal an operator has to revoke a capability
without re-deploying.

Contract:
    - Pass in the fully registered list of tool callables plus two allow/block
      sets (typically from the invocation payload).
    - Get back the filtered list + a list of structured warnings the caller
      can log. Unknown tool slugs are **runtime no-ops** — logging a WARN is
      enough; the pre-flight admin UI / API is the right place to surface
      typos.
    - Disabling the memory engine tools (``recall`` / ``reflect`` in
      managed-memory or ``hindsight_recall`` / ``hindsight_reflect`` in
      Hindsight) produces a structured WARN so operators see they removed a
      load-bearing capability. The filter still honors the disable.

The filter is deliberately name-based. Strands ``@tool``-decorated callables
expose their slug via ``tool_name`` (or ``__name__`` as fallback); we read
that to match against the block sets. Tools without a resolvable name flow
through untouched so a typo in the decorator never accidentally reveals a
filtered capability.

Pool integration: when a tenant toggles ``disabled_builtin_tools``, the
admin / ops path that persists the change also calls
``SkillSessionPool.flush_for_tenant(tenant_id)`` so warm sessions rebuild
against the new filter. That hook already lives in ``skill_session_pool``
(plan §U4); U12 only adds the filter itself.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

# Slugs that strictly narrow the model's capability surface when removed.
# Disabling any of these is operationally unusual (memory is load-bearing
# for most deployments), so we emit a structured WARN even though the
# filter itself still respects the admin decision.
MEMORY_ENGINE_SLUGS: frozenset[str] = frozenset(
    {
        "recall",
        "reflect",
        "remember",
        "forget",
        "hindsight_recall",
        "hindsight_reflect",
    }
)


@dataclass(frozen=True)
class FilteredBuiltins:
    """Return shape of :func:`filter_builtin_tools`.

    Attributes:
        tools: The tool callables the caller should pass to ``Agent(tools=...)``.
        removed: Slugs that were stripped out, with the reason each was removed.
        warnings: Human-readable notes the caller should log at WARN.
    """

    tools: list[Any]
    removed: tuple[tuple[str, str], ...]
    warnings: tuple[str, ...]


def _resolve_tool_name(tool: Any) -> str | None:
    """Best-effort slug extraction for a Strands tool callable.

    Strands ``@tool`` decorates a function and copies its name onto
    ``tool_name``; plain callables expose ``__name__``. Anything we can't
    classify returns ``None`` — the filter treats unknowns as untouchable.
    """
    for attr in ("tool_name", "__name__"):
        value = getattr(tool, attr, None)
        if isinstance(value, str) and value:
            return value
    return None


def filter_builtin_tools(
    tools: Iterable[Any],
    *,
    disabled_builtin_tools: Iterable[str] = (),
    template_blocked_tools: Iterable[str] = (),
) -> FilteredBuiltins:
    """Drop any tool whose slug appears in either block set.

    Ordering rules:
        1. Tenant kill-switches take precedence when the same slug appears
           in both sets (tenant is the stronger signal — see docstring).
        2. Template blocks further narrow, but cannot widen the tenant's
           disable decision.
        3. Slugs that name no registered tool flow through — they're a
           runtime no-op + WARN; the admin UI surfaces the typo elsewhere.
        4. Tools whose name can't be resolved are never filtered; missing
           metadata is never a reason to silently strip capability.

    Args:
        tools: Iterable of Strands tool callables / tool objects.
        disabled_builtin_tools: Tenant-wide kill-switch slugs.
        template_blocked_tools: Template-level block slugs.

    Returns:
        A :class:`FilteredBuiltins` with the kept tools, the removed slugs
        + their source, and structured warnings.
    """
    tenant_blocks = frozenset(s for s in disabled_builtin_tools if s)
    template_blocks = frozenset(s for s in template_blocked_tools if s)

    warnings: list[str] = []
    kept: list[Any] = []
    removed: list[tuple[str, str]] = []
    present_slugs: set[str] = set()

    for tool in tools:
        slug = _resolve_tool_name(tool)
        if slug is None:
            kept.append(tool)
            continue
        present_slugs.add(slug)
        if slug in tenant_blocks:
            removed.append((slug, "tenant-disabled"))
            if slug in MEMORY_ENGINE_SLUGS:
                warnings.append(
                    f"memory engine tool disabled by tenant kill-switch: {slug} "
                    "(recall/reflect are load-bearing for most deployments)"
                )
            continue
        if slug in template_blocks:
            removed.append((slug, "template-blocked"))
            continue
        kept.append(tool)

    unknown_tenant_slugs = sorted(tenant_blocks - present_slugs)
    if unknown_tenant_slugs:
        warnings.append(
            "tenant kill-switch names unknown tool slug(s), no-op at runtime: "
            f"{unknown_tenant_slugs}"
        )
    unknown_template_slugs = sorted(template_blocks - present_slugs)
    if unknown_template_slugs:
        warnings.append(
            "template blocked_tools names unknown slug(s), no-op at runtime: "
            f"{unknown_template_slugs}"
        )

    return FilteredBuiltins(
        tools=kept,
        removed=tuple(removed),
        warnings=tuple(warnings),
    )


def log_filter_result(prefix: str, result: FilteredBuiltins) -> None:
    """Emit the filter's structured warnings + summary at INFO/WARN.

    Separated from :func:`filter_builtin_tools` so the pure function stays
    trivially testable without a logger handle, while the caller in
    ``server.py`` gets a one-line integration.
    """
    for msg in result.warnings:
        logger.warning("%s %s", prefix, msg)
    if result.removed:
        removed_desc = ", ".join(f"{slug}({reason})" for slug, reason in result.removed)
        logger.info("%s filtered %d built-in tool(s): %s", prefix, len(result.removed), removed_desc)
