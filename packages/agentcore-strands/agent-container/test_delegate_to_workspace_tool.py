"""Tests for delegate_to_workspace_tool — Plan §008 U9 (inert spawn).

The tool exposes a path-validation pure function plus a factory closure
that wires the composer / parser / resolver into a Strands ``@tool``-style
callable. The Bedrock sub-agent spawn is **inert** in this PR — the tool
returns ``{"ok": False, "reason": "spawn not yet wired", ...}``. The
follow-up PR replaces only the spawn body.

Tests are organised by surface:

    * ``validate_path``        — pure, traversal / reserved-name / depth
    * ``make_delegate_to_workspace_fn`` — factory closure: snapshot semantics,
                                          dispatch order, error propagation
    * ``_boot_assert``         — smoke that the new module is registered

Honors the Key Decision §008: depth cap = 5 hard, soft-warn at 4. The
unit-body number (``3``) is superseded.

Run with::

    uv run --no-project --with pytest \\
        pytest packages/agentcore-strands/agent-container/test_delegate_to_workspace_tool.py
"""

from __future__ import annotations

import logging
from typing import Any
from unittest.mock import MagicMock

import pytest

# ────────────────────────────────────────────────────────────────────────────
# Fixture data
# ────────────────────────────────────────────────────────────────────────────

LOCAL_SKILL_MD = """---
name: approve-receipt
description: Approve an expense receipt
execution: script
---
Local body.
"""

EXPENSES_AGENTS_MD = """\
# Expenses sub-agent

## Routing

| Task | Go to | Read | Skills |
|------|-------|------|--------|
| Approve receipt | escalation/ | CONTEXT.md | approve-receipt |
"""

EXPENSES_AGENTS_MD_BOGUS_SLUG = """\
## Routing

| Task | Go to | Skills |
|------|-------|--------|
| Approve | escalation/ | bogus-slug |
"""


def _entry(path: str, content: str) -> dict[str, Any]:
    """Composer record shape: {path, source, sha256, content}."""
    return {"path": path, "source": "agent-override", "sha256": "x", "content": content}


def _expenses_tree() -> list[dict[str, Any]]:
    """Composed-tree fixture for an `expenses/` sub-agent with one local skill."""
    return [
        _entry("AGENTS.md", "# root\n"),
        _entry("CONTEXT.md", "Root context.\n"),
        _entry("expenses/AGENTS.md", EXPENSES_AGENTS_MD),
        _entry("expenses/CONTEXT.md", "Expenses sub-agent.\n"),
        _entry(
            "expenses/skills/approve-receipt/SKILL.md",
            LOCAL_SKILL_MD,
        ),
    ]


def _expenses_tree_bogus_slug() -> list[dict[str, Any]]:
    """Composed-tree fixture where AGENTS.md references a non-resolvable slug."""
    return [
        _entry("expenses/AGENTS.md", EXPENSES_AGENTS_MD_BOGUS_SLUG),
        _entry("expenses/CONTEXT.md", "Sub.\n"),
    ]


# ────────────────────────────────────────────────────────────────────────────
# validate_path — pure
# ────────────────────────────────────────────────────────────────────────────


class TestValidatePath:
    def test_single_segment_normalizes_unchanged(self):
        from delegate_to_workspace_tool import validate_path

        assert validate_path("expenses") == "expenses"

    def test_trailing_slash_is_stripped(self):
        from delegate_to_workspace_tool import validate_path

        assert validate_path("expenses/") == "expenses"

    def test_depth_5_succeeds(self):
        from delegate_to_workspace_tool import validate_path

        # five segments → depth 5, hard cap.
        assert validate_path("a/b/c/d/e") == "a/b/c/d/e"

    def test_depth_4_succeeds_and_warns(self, caplog):
        from delegate_to_workspace_tool import validate_path

        with caplog.at_level(logging.WARNING):
            assert validate_path("a/b/c/d") == "a/b/c/d"
        assert any(
            "delegate_to_workspace approaching cap" in rec.message
            for rec in caplog.records
        ), caplog.records

    def test_depth_3_does_not_warn(self, caplog):
        from delegate_to_workspace_tool import validate_path

        with caplog.at_level(logging.WARNING):
            validate_path("a/b/c")
        warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
        assert warnings == [], warnings

    def test_depth_6_rejects(self):
        from delegate_to_workspace_tool import validate_path

        with pytest.raises(ValueError, match="exceeds cap of 5"):
            validate_path("a/b/c/d/e/f")

    def test_empty_string_rejects(self):
        from delegate_to_workspace_tool import validate_path

        with pytest.raises(ValueError, match="empty"):
            validate_path("")

    def test_whitespace_only_rejects(self):
        from delegate_to_workspace_tool import validate_path

        with pytest.raises(ValueError, match="empty"):
            validate_path("   ")

    def test_traversal_rejects(self):
        from delegate_to_workspace_tool import validate_path

        with pytest.raises(ValueError, match="traversal"):
            validate_path("expenses/../etc")

    def test_dot_segment_rejects(self):
        from delegate_to_workspace_tool import validate_path

        with pytest.raises(ValueError, match="traversal"):
            validate_path("./expenses")

    def test_absolute_rejects(self):
        from delegate_to_workspace_tool import validate_path

        with pytest.raises(ValueError, match="absolute"):
            validate_path("/expenses")

    @pytest.mark.parametrize(
        "path",
        ["memory", "skills", "expenses/memory", "expenses/skills", "team/memory/notes"],
    )
    def test_reserved_segment_rejects(self, path):
        from delegate_to_workspace_tool import validate_path

        with pytest.raises(ValueError, match="reserved"):
            validate_path(path)

    def test_reserved_substring_does_not_reject(self):
        """`memory-team` and `skills-2026` are NOT reserved (exact match only)."""
        from delegate_to_workspace_tool import validate_path

        assert validate_path("memory-team") == "memory-team"
        assert validate_path("skills-2026/escalation") == "skills-2026/escalation"

    def test_internal_double_slash_rejects(self):
        """A double slash creates an empty segment — treat as malformed input."""
        from delegate_to_workspace_tool import validate_path

        with pytest.raises(ValueError, match="empty"):
            validate_path("expenses//escalation")


# ────────────────────────────────────────────────────────────────────────────
# Factory + tool — happy paths
# ────────────────────────────────────────────────────────────────────────────


def _build_factory(
    *,
    composer_files: list[dict[str, Any]] | None = None,
    composer_raises: Exception | None = None,
    platform_catalog: dict[str, dict[str, Any]] | None = None,
    spawn_capture: list | None = None,
    cfg_model: str = "anthropic.claude-sonnet-4-v1:0",
):
    """Helper: build a tool factory with the given dependencies wired in.

    Returns ``(tool_fn, mocks)`` where ``mocks`` exposes references for
    assertions (composer mock, spawn capture list, usage_acc list).
    """
    from delegate_to_workspace_tool import make_delegate_to_workspace_fn

    composer_mock = MagicMock()
    if composer_raises is not None:
        composer_mock.side_effect = composer_raises
    else:
        composer_mock.return_value = composer_files or []

    spawn_capture = spawn_capture if spawn_capture is not None else []

    def spawn_fn(resolved_context):
        spawn_capture.append(resolved_context)
        return {
            "ok": False,
            "reason": "spawn not yet wired",
            "resolved_context": resolved_context,
        }

    usage_acc: list = []

    tool_fn = make_delegate_to_workspace_fn(
        parent_tenant_id="tenant-abc",
        parent_agent_id="agent-xyz",
        api_url="https://api.example.test",
        api_secret="secret",
        platform_catalog_manifest=platform_catalog,
        cfg_model=cfg_model,
        usage_acc=usage_acc,
        composer_fetch=composer_mock,
        spawn_fn=spawn_fn,
    )

    return tool_fn, {
        "composer": composer_mock,
        "spawn_capture": spawn_capture,
        "usage_acc": usage_acc,
    }


class TestDelegateHappyPath:
    def test_returns_inert_spawn_result_with_resolved_skills(self):
        """AE2/AE6: thin sub-agent + local skill resolves; spawn is inert."""
        tool_fn, mocks = _build_factory(composer_files=_expenses_tree())

        result = tool_fn(path="expenses", task="approve a receipt")

        assert result["ok"] is False
        assert result["reason"] == "spawn not yet wired"
        ctx = result["resolved_context"]
        assert ctx["normalized_path"] == "expenses"
        assert ctx["depth"] == 1
        assert ctx["task"] == "approve a receipt"
        assert ctx["parent_agent_id"] == "agent-xyz"
        assert ctx["parent_tenant_id"] == "tenant-abc"
        # Routing parsed from expenses/AGENTS.md
        assert len(ctx["routing"]) == 1
        assert ctx["routing"][0]["go_to"] == "escalation/"
        assert ctx["routing"][0]["skills"] == ["approve-receipt"]
        # Local skill resolved
        assert "approve-receipt" in ctx["resolved_skills"]
        rs = ctx["resolved_skills"]["approve-receipt"]
        assert rs["source"] == "local"
        assert rs["composed_tree_path"] == "expenses/skills/approve-receipt/SKILL.md"

    def test_depth_5_succeeds(self):
        """Depth 5 is the hard cap (Key Decision §008)."""
        tree = [
            _entry(
                "a/b/c/d/e/AGENTS.md",
                "## Routing\n\n| Task | Go to |\n|---|---|\n",
            )
        ]
        tool_fn, mocks = _build_factory(composer_files=tree)
        result = tool_fn(path="a/b/c/d/e", task="x")
        assert result["resolved_context"]["depth"] == 5

    def test_trailing_slash_is_normalized(self):
        tool_fn, mocks = _build_factory(composer_files=_expenses_tree())
        a = tool_fn(path="expenses/", task="t")
        b = tool_fn(path="expenses", task="t")
        # Both spawn calls capture identical normalized_path.
        assert a["resolved_context"]["normalized_path"] == "expenses"
        assert b["resolved_context"]["normalized_path"] == "expenses"


class TestDelegatePathRejection:
    """Validation rejects before any composer call."""

    def test_depth_6_does_not_call_composer(self):
        tool_fn, mocks = _build_factory()
        with pytest.raises(ValueError, match="exceeds cap of 5"):
            tool_fn(path="a/b/c/d/e/f", task="t")
        mocks["composer"].assert_not_called()

    def test_traversal_does_not_call_composer(self):
        tool_fn, mocks = _build_factory()
        with pytest.raises(ValueError, match="traversal"):
            tool_fn(path="expenses/../etc", task="t")
        mocks["composer"].assert_not_called()

    def test_absolute_does_not_call_composer(self):
        tool_fn, mocks = _build_factory()
        with pytest.raises(ValueError, match="absolute"):
            tool_fn(path="/expenses", task="t")
        mocks["composer"].assert_not_called()

    @pytest.mark.parametrize("path", ["memory", "skills", "expenses/memory"])
    def test_reserved_does_not_call_composer(self, path):
        tool_fn, mocks = _build_factory()
        with pytest.raises(ValueError, match="reserved"):
            tool_fn(path=path, task="t")
        mocks["composer"].assert_not_called()


class TestDelegateComposerErrors:
    def test_composer_raises_is_wrapped_with_prefix(self):
        from delegate_to_workspace_tool import DelegateToWorkspaceError

        class _ComposerBoom(RuntimeError):
            pass

        tool_fn, mocks = _build_factory(composer_raises=_ComposerBoom("boom"))

        with pytest.raises(DelegateToWorkspaceError) as exc:
            tool_fn(path="expenses", task="t")
        assert "delegate_to_workspace failed" in str(exc.value)
        # Original cause is preserved.
        assert isinstance(exc.value.__cause__, _ComposerBoom)
        # Spawn was never called.
        assert mocks["spawn_capture"] == []

    def test_missing_agents_md_aborts(self):
        from delegate_to_workspace_tool import DelegateToWorkspaceError

        # Composer returns a tree without an AGENTS.md at the target folder.
        tree = [_entry("expenses/CONTEXT.md", "no agents map")]
        tool_fn, mocks = _build_factory(composer_files=tree)
        with pytest.raises(DelegateToWorkspaceError, match="no AGENTS.md"):
            tool_fn(path="expenses", task="t")
        assert mocks["spawn_capture"] == []


class TestDelegateResolverAbort:
    def test_skill_not_resolvable_aborts_with_slug(self):
        from delegate_to_workspace_tool import DelegateToWorkspaceError

        tool_fn, mocks = _build_factory(composer_files=_expenses_tree_bogus_slug())
        with pytest.raises(DelegateToWorkspaceError) as exc:
            tool_fn(path="expenses", task="t")
        assert "bogus-slug" in str(exc.value)
        assert "not resolvable" in str(exc.value).lower()
        assert mocks["spawn_capture"] == []


class TestDelegateFactorySnapshots:
    """Factory snapshots config at construction time."""

    def test_platform_manifest_is_snapshotted(self):
        """Mutating the source dict after factory call must not affect resolution."""
        catalog = {"approve-receipt": {"skill_md_content": LOCAL_SKILL_MD}}
        tool_fn, mocks = _build_factory(
            composer_files=[
                _entry("expenses/AGENTS.md", EXPENSES_AGENTS_MD),
                _entry("expenses/CONTEXT.md", "Sub.\n"),
                # No local skill — must fall through to platform.
            ],
            platform_catalog=catalog,
        )
        # Mutate after factory built — should NOT affect resolution.
        catalog.pop("approve-receipt")

        result = tool_fn(path="expenses", task="t")
        rs = result["resolved_context"]["resolved_skills"]["approve-receipt"]
        assert rs["source"] == "platform"


class TestDelegateUsageAcc:
    """The inert spawn does NOT touch usage_acc; the spawn-PR follow-up will."""

    def test_inert_spawn_leaves_usage_acc_empty(self):
        tool_fn, mocks = _build_factory(composer_files=_expenses_tree())
        tool_fn(path="expenses", task="t")
        assert mocks["usage_acc"] == []


# ────────────────────────────────────────────────────────────────────────────
# Boot-assert integration
# ────────────────────────────────────────────────────────────────────────────


def test_boot_assert_lists_delegate_to_workspace_tool():
    """Module is named in EXPECTED_CONTAINER_SOURCES so a missing file fails build."""
    import _boot_assert as ba

    assert "delegate_to_workspace_tool" in ba.EXPECTED_CONTAINER_SOURCES
