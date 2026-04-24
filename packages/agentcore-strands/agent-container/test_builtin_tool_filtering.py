"""Tenant kill-switch + template-block built-in tool filter tests (plan §U12).

Run with:
    uv run --no-project --with pytest \
        pytest packages/agentcore-strands/agent-container/test_builtin_tool_filtering.py

The filter is a pure function, so tests stub simple callables with a
``tool_name`` attribute to mimic Strands ``@tool``-decorated callables.
"""

from __future__ import annotations

import logging

import pytest
from builtin_tool_filter import (
    MEMORY_ENGINE_SLUGS,
    FilteredBuiltins,
    filter_builtin_tools,
    log_filter_result,
)


def _tool(name: str):
    """Build a minimal stub that exposes ``tool_name``.

    Strands tool callables set ``tool_name`` via the ``@tool`` decorator;
    we duck-type it here so the filter runs against realistic inputs without
    importing strands.
    """

    def impl(*args, **kwargs):  # pragma: no cover — callable isn't invoked
        raise AssertionError("filter should not call the tool")

    impl.tool_name = name  # type: ignore[attr-defined]
    return impl


def _slugs(result: FilteredBuiltins) -> list[str]:
    return [t.tool_name for t in result.tools]  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Happy paths + precedence
# ---------------------------------------------------------------------------


def test_happy_empty_blocks_keeps_everything():
    tools = [_tool("execute_code"), _tool("recall"), _tool("web_search")]
    result = filter_builtin_tools(tools)
    assert _slugs(result) == ["execute_code", "recall", "web_search"]
    assert result.removed == ()
    assert result.warnings == ()


def test_covers_ae5_tenant_disables_execute_code():
    tools = [_tool("execute_code"), _tool("recall"), _tool("web_search")]
    result = filter_builtin_tools(
        tools, disabled_builtin_tools=["execute_code"]
    )
    assert "execute_code" not in _slugs(result)
    assert ("execute_code", "tenant-disabled") in result.removed


def test_tenant_wins_over_template_intersection():
    """Same slug in both lists — still removed, and accounted to tenant."""
    tools = [_tool("execute_code"), _tool("recall")]
    result = filter_builtin_tools(
        tools,
        disabled_builtin_tools=["execute_code"],
        template_blocked_tools=["execute_code"],
    )
    assert _slugs(result) == ["recall"]
    # Tenant precedence: record it as tenant-disabled (stronger signal).
    assert ("execute_code", "tenant-disabled") in result.removed
    assert ("execute_code", "template-blocked") not in result.removed


def test_tenant_disable_template_silent_still_disabled():
    """Tenant disable applies even when template allows."""
    tools = [_tool("execute_code"), _tool("recall")]
    result = filter_builtin_tools(
        tools,
        disabled_builtin_tools=["execute_code"],
        template_blocked_tools=[],
    )
    assert "execute_code" not in _slugs(result)


def test_tenant_allow_template_block_still_blocks():
    """Template can narrow even when tenant stays neutral."""
    tools = [_tool("execute_code"), _tool("recall")]
    result = filter_builtin_tools(
        tools,
        disabled_builtin_tools=[],
        template_blocked_tools=["recall"],
    )
    assert _slugs(result) == ["execute_code"]
    assert ("recall", "template-blocked") in result.removed


# ---------------------------------------------------------------------------
# Memory engine WARN
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("slug", sorted(MEMORY_ENGINE_SLUGS))
def test_memory_engine_disable_emits_warning(slug: str):
    tools = [_tool(slug), _tool("execute_code")]
    result = filter_builtin_tools(tools, disabled_builtin_tools=[slug])
    assert slug not in _slugs(result)
    assert any("memory engine tool disabled" in w and slug in w for w in result.warnings)


def test_non_memory_engine_disable_no_warning():
    tools = [_tool("execute_code"), _tool("web_search")]
    result = filter_builtin_tools(
        tools, disabled_builtin_tools=["execute_code"]
    )
    # Only the unknown-slug warning channel is triggered on real unknowns;
    # a known-slug disable has no warning by itself.
    assert not any("memory engine" in w for w in result.warnings)


# ---------------------------------------------------------------------------
# Unknown slugs
# ---------------------------------------------------------------------------


def test_unknown_tenant_slug_is_runtime_noop_with_warn():
    tools = [_tool("execute_code")]
    result = filter_builtin_tools(
        tools, disabled_builtin_tools=["typo_tool"]
    )
    # Tool list unchanged — unknown slugs are a no-op at runtime.
    assert _slugs(result) == ["execute_code"]
    # Warning surfaces the typo so an admin can triage it.
    assert any("unknown tool slug" in w and "typo_tool" in w for w in result.warnings)


def test_unknown_template_slug_is_runtime_noop_with_warn():
    tools = [_tool("execute_code")]
    result = filter_builtin_tools(tools, template_blocked_tools=["typo"])
    assert _slugs(result) == ["execute_code"]
    assert any("unknown slug" in w and "typo" in w for w in result.warnings)


def test_tool_without_resolvable_name_flows_through():
    """Anonymous tools (no tool_name / __name__) are never filtered.

    A missing slug must NOT be treated as a match for ANY block entry —
    silently stripping capability on metadata loss is worse than keeping it.
    """

    class Anon:
        # Intentionally no tool_name / __name__ attributes.
        pass

    anon = Anon()
    result = filter_builtin_tools(
        [anon], disabled_builtin_tools=["anything"]
    )
    assert result.tools == [anon]
    assert not any(r[0] == "" for r in result.removed)


# ---------------------------------------------------------------------------
# Normalization edge cases
# ---------------------------------------------------------------------------


def test_empty_string_slugs_are_ignored():
    tools = [_tool("execute_code")]
    result = filter_builtin_tools(
        tools,
        disabled_builtin_tools=["", "execute_code"],
        template_blocked_tools=["", ""],
    )
    assert "execute_code" not in _slugs(result)
    # Empty strings do not populate the warning channel.
    assert not any("unknown" in w and "''" in w for w in result.warnings)


def test_filter_accepts_generators_not_just_lists():
    tools = (_tool(name) for name in ["a", "b", "c"])
    result = filter_builtin_tools(
        tools, disabled_builtin_tools=(s for s in ["b"])
    )
    assert _slugs(result) == ["a", "c"]


# ---------------------------------------------------------------------------
# Logger integration
# ---------------------------------------------------------------------------


def test_log_filter_result_emits_warnings(caplog):
    tools = [_tool("recall"), _tool("execute_code")]
    result = filter_builtin_tools(
        tools,
        disabled_builtin_tools=["recall", "typo"],
    )
    caplog.set_level(logging.INFO, logger="builtin_tool_filter")
    log_filter_result("[test]", result)
    messages = [r.getMessage() for r in caplog.records]
    # Memory-engine WARN + unknown-slug WARN + filter summary INFO.
    assert any("memory engine tool disabled" in m and "recall" in m for m in messages)
    assert any("unknown tool slug" in m and "typo" in m for m in messages)
    assert any("filtered 1 built-in tool" in m for m in messages)


def test_log_filter_result_noop_when_nothing_removed(caplog):
    tools = [_tool("execute_code")]
    result = filter_builtin_tools(tools)
    caplog.set_level(logging.INFO, logger="builtin_tool_filter")
    log_filter_result("[test]", result)
    messages = [r.getMessage() for r in caplog.records]
    assert messages == []


# ---------------------------------------------------------------------------
# Rebuild invariant — pool flush is what surfaces new config; test that the
# filter is idempotent so rebuilding against fresh config is safe to retry.
# ---------------------------------------------------------------------------


def test_filter_is_pure_re_applying_with_new_config_yields_new_result():
    tools = [_tool("execute_code"), _tool("recall"), _tool("web_search")]
    first = filter_builtin_tools(tools, disabled_builtin_tools=["execute_code"])
    # A fresh session after a pool flush re-runs the filter on the SAME
    # tool list with new config. Regression guard: the prior call does not
    # mutate the input list or leave behind hidden state.
    second = filter_builtin_tools(tools, disabled_builtin_tools=["web_search"])
    assert _slugs(first) == ["recall", "web_search"]
    assert _slugs(second) == ["execute_code", "recall"]
