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

import asyncio
import logging
import sys
from types import SimpleNamespace
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

EXPENSES_AGENTS_MD_WITH_SKIPS = """\
# Expenses sub-agent

## Routing

| Task | Go to | Read | Skills |
|------|-------|------|--------|
| Hidden mem | memory/ | memory/CONTEXT.md | leak-private |
| Bad path | Not A Path | bad/CONTEXT.md | bogus |
| Real | escalation/ | CONTEXT.md | approve-receipt |
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
        workspace_reader=composer_mock,
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


class TestDelegateParserWarningPropagation:
    """Plan 2026-04-25-004 U4. Parser-skipped routing rows (reserved-name
    go_to, invalid path) must surface in ``resolved_context`` so the U5
    spawn body can include them in the sub-agent's tool-result envelope.
    Tests use explicit ``spawn_fn=`` injection to capture the dict.
    """

    def test_reserved_and_invalid_skips_propagate_to_resolved_context(self):
        tree = [
            _entry("expenses/AGENTS.md", EXPENSES_AGENTS_MD_WITH_SKIPS),
            _entry("expenses/CONTEXT.md", "Sub.\n"),
            _entry(
                "expenses/skills/approve-receipt/SKILL.md",
                LOCAL_SKILL_MD,
            ),
        ]
        tool_fn, mocks = _build_factory(composer_files=tree)
        result = tool_fn(path="expenses", task="t")

        ctx = result["resolved_context"]
        # Only the valid row survives in routing.
        assert [r["go_to"] for r in ctx["routing"]] == ["escalation/"]
        # Both the human-readable warnings list and the structured
        # skipped_rows record are propagated.
        assert ctx["skipped_rows"] == [
            {"row_index": 0, "go_to": "memory/", "reason": "reserved"},
            {"row_index": 1, "go_to": "Not A Path", "reason": "invalid_path"},
        ]
        assert len(ctx["warnings"]) == 2
        assert "memory/" in ctx["warnings"][0]
        assert "reserved" in ctx["warnings"][0]
        assert "Not A Path" in ctx["warnings"][1]

    def test_clean_routing_yields_empty_warnings_and_skipped_rows(self):
        tool_fn, mocks = _build_factory(composer_files=_expenses_tree())
        result = tool_fn(path="expenses", task="t")
        ctx = result["resolved_context"]
        assert ctx["warnings"] == []
        assert ctx["skipped_rows"] == []


class TestDelegateUsageAcc:
    """The inert spawn does NOT touch usage_acc; the spawn-PR follow-up will."""

    def test_inert_spawn_leaves_usage_acc_empty(self):
        tool_fn, mocks = _build_factory(composer_files=_expenses_tree())
        tool_fn(path="expenses", task="t")
        assert mocks["usage_acc"] == []


PLATFORM_SKILL_MD = """---
name: approve-receipt
description: Platform-catalog approve-receipt skill
execution: script
---
Platform body.
"""


# ────────────────────────────────────────────────────────────────────────────
# Platform-catalog manifest plumbing (Plan §004 U3)
# ────────────────────────────────────────────────────────────────────────────


class TestDelegatePlatformManifestPlumbing:
    """Manifest plumbing pinned at the delegate factory layer.

    The server.py registration site adapts ``skill_meta`` into the
    resolver-shaped ``Mapping[str, Mapping[str, Any]]``; here we verify
    the factory honors that mapping when no local skill exists.
    """

    def test_platform_slug_resolves_when_no_local_shadow(self):
        """Routing row references a platform slug → resolves via platform branch."""
        platform_manifest = {
            "approve-receipt": {"skill_md_content": PLATFORM_SKILL_MD},
        }
        # Composed tree has AGENTS.md but no local skills/approve-receipt/.
        tree = [
            _entry("expenses/AGENTS.md", EXPENSES_AGENTS_MD),
            _entry("expenses/CONTEXT.md", "Expenses sub-agent.\n"),
        ]
        tool_fn, mocks = _build_factory(
            composer_files=tree,
            platform_catalog=platform_manifest,
        )
        result = tool_fn(path="expenses", task="t")
        rs = result["resolved_context"]["resolved_skills"]["approve-receipt"]
        assert rs["source"] == "platform"
        assert rs["skill_md_content"] == PLATFORM_SKILL_MD

    def test_empty_but_non_none_manifest_is_reachable_but_resolves_nothing(self):
        """An empty manifest is the registration default when no skills are
        installed. The platform-fallback branch is reachable but no slug
        lands → resolver raises SkillNotResolvable, which the factory
        wraps in DelegateToWorkspaceError. This is the contract the
        registration site relies on: passing ``{}`` rather than ``None``
        does NOT smuggle silent resolutions, but it DOES preserve the
        platform-fallback code path so future catalog reloads work
        without a registration restart.
        """
        from delegate_to_workspace_tool import DelegateToWorkspaceError

        tree = [
            _entry("expenses/AGENTS.md", EXPENSES_AGENTS_MD),
            _entry("expenses/CONTEXT.md", "Expenses sub-agent.\n"),
        ]
        tool_fn, mocks = _build_factory(
            composer_files=tree,
            platform_catalog={},  # empty but non-None
        )
        with pytest.raises(DelegateToWorkspaceError, match="approve-receipt"):
            tool_fn(path="expenses", task="t")


# ────────────────────────────────────────────────────────────────────────────
# Composer cache integration (Plan §004 U3)
# ────────────────────────────────────────────────────────────────────────────


class TestDelegateReadsFromLocalWorkspace:
    """Default ``workspace_reader`` reads from local disk (the bootstrap-
    populated /tmp/workspace), not HTTP — this is the materialize-at-
    write-time contract from docs/plans/2026-04-27-003.
    """

    def test_default_reader_walks_local_dir(self, tmp_path):
        from delegate_to_workspace_tool import make_delegate_to_workspace_fn

        # Pre-populate a local workspace mirror with what the parent's
        # bootstrap would have left there.
        (tmp_path / "expenses").mkdir()
        (tmp_path / "expenses" / "AGENTS.md").write_text(EXPENSES_AGENTS_MD)
        (tmp_path / "expenses" / "CONTEXT.md").write_text("ctx")
        (tmp_path / "expenses" / "skills").mkdir()
        (tmp_path / "expenses" / "skills" / "approve-receipt").mkdir()
        (tmp_path / "expenses" / "skills" / "approve-receipt" / "SKILL.md").write_text(
            LOCAL_SKILL_MD,
        )

        spawn_capture: list = []

        def spawn_fn(resolved_context):
            spawn_capture.append(resolved_context)
            return {
                "ok": True,
                "sub_agent_response": "ok",
                "sub_agent_usage": {},
                "warnings": [],
                "skipped_rows": [],
                "resolved_context": resolved_context,
            }

        tool_fn = make_delegate_to_workspace_fn(
            parent_tenant_id="tenant-abc",
            parent_agent_id="agent-xyz",
            api_url="https://api.example.test",
            api_secret="secret",
            platform_catalog_manifest=None,
            cfg_model="anthropic.claude-sonnet-4-v1:0",
            usage_acc=[],
            workspace_dir=str(tmp_path),
            spawn_fn=spawn_fn,
        )

        result = tool_fn(path="expenses", task="t1")

        assert result["ok"] is True
        assert len(spawn_capture) == 1
        # The local tree was passed through as composed_tree, with
        # AGENTS.md included so the parser can route.
        composed = spawn_capture[0]["composed_tree"]
        paths = {entry["path"] for entry in composed}
        assert "expenses/AGENTS.md" in paths


# ────────────────────────────────────────────────────────────────────────────
# Boot-assert integration
# ────────────────────────────────────────────────────────────────────────────


def test_boot_assert_lists_delegate_to_workspace_tool():
    """Module is named in EXPECTED_CONTAINER_SOURCES so a missing file fails build."""
    import _boot_assert as ba

    assert "delegate_to_workspace_tool" in ba.EXPECTED_CONTAINER_SOURCES


# ────────────────────────────────────────────────────────────────────────────
# Live Bedrock spawn (Plan 2026-04-25-004 U5)
# ────────────────────────────────────────────────────────────────────────────


class _StubResult:
    """Mimics the shape Strands' ``Agent`` call returns: stringifies +
    exposes ``result.metrics.accumulated_usage`` as the spawn body reads.
    """

    def __init__(self, *, text: str, accumulated_usage: dict[str, int] | None):
        self._text = text

        class _Metrics:
            pass

        self.metrics = _Metrics()
        self.metrics.accumulated_usage = accumulated_usage

    def __str__(self) -> str:  # noqa: D401
        return self._text


def _make_strands_stubs(
    *,
    captured: dict | None = None,
    text: str = "sub-agent reply",
    accumulated_usage: dict[str, int] | None = None,
    raise_on_call: Exception | None = None,
):
    """Build (model_factory, agent_factory, tool_decorator) stubs that
    mimic Strands' surface enough for the spawn body, and capture each
    constructor's args into ``captured`` so tests can assert them.

    ``raise_on_call`` makes ``Agent(...)(task)`` raise — used by the
    error-path test.
    """
    captured = captured if captured is not None else {}

    captured.setdefault("model_calls", 0)
    captured.setdefault("agent_calls", 0)

    class _ModelStub:
        def __init__(self, **kwargs):
            captured["model_kwargs"] = kwargs
            captured["model_calls"] += 1

    class _AgentStub:
        def __init__(self, *, model, system_prompt, tools, callback_handler):
            captured["agent_kwargs"] = {
                "model": model,
                "system_prompt": system_prompt,
                "tools": list(tools),
                "callback_handler": callback_handler,
            }
            captured["agent_calls"] += 1

        def __call__(self, task):
            captured["task"] = task
            if raise_on_call is not None:
                raise raise_on_call
            return _StubResult(
                text=text,
                accumulated_usage=accumulated_usage,
            )

    # No-op tool decorator (returns the function unchanged) so we can
    # introspect tool identity without Strands' real wrapping.
    def _tool_dec(fn):
        return fn

    return _ModelStub, _AgentStub, _tool_dec, captured


def _build_live_factory(
    *,
    composer_files: list[dict[str, Any]] | None = None,
    platform_catalog: dict[str, dict[str, Any]] | None = None,
    cfg_model: str = "anthropic.claude-sonnet-4-v1:0",
    aws_region: str = "us-east-1",
    text: str = "sub-agent reply",
    accumulated_usage: dict[str, int] | None = None,
    raise_on_call: Exception | None = None,
    usage_acc: list | None = None,
    tool_context: dict[str, Any] | None = None,
):
    """Helper: build a factory with Strands stubs in place of the real
    BedrockModel + Agent so the *live* default spawn path runs end-to-end
    without booting Bedrock.

    Returns ``(tool_fn, captured)``. ``captured`` exposes the model
    kwargs, agent kwargs, task, and ``usage_acc`` for assertions.
    """
    from delegate_to_workspace_tool import make_delegate_to_workspace_fn

    model_factory, agent_factory, tool_decorator, captured = _make_strands_stubs(
        text=text,
        accumulated_usage=accumulated_usage,
        raise_on_call=raise_on_call,
    )

    composer_mock = MagicMock()
    composer_mock.return_value = composer_files or []

    usage_acc = usage_acc if usage_acc is not None else []
    captured["usage_acc"] = usage_acc

    tool_fn = make_delegate_to_workspace_fn(
        parent_tenant_id="tenant-abc",
        parent_agent_id="agent-xyz",
        api_url="https://api.example.test",
        api_secret="secret",
        platform_catalog_manifest=platform_catalog,
        cfg_model=cfg_model,
        usage_acc=usage_acc,
        workspace_reader=composer_mock,
        aws_region=aws_region,
        model_factory=model_factory,
        agent_factory=agent_factory,
        tool_decorator=tool_decorator,
        tool_context=tool_context,
        # spawn_fn deliberately omitted → live default engages.
    )
    captured["composer_mock"] = composer_mock
    return tool_fn, captured


class TestLiveSpawnHappyPath:
    """AE2: thin sub-agent (`expenses/` with only CONTEXT.md + AGENTS.md +
    one platform skill in routing) → ``ok: True`` + sub-agent reply +
    usage tokens.
    """

    def test_thin_sub_agent_with_platform_skill_returns_ok_true(self):
        """AE2 happy path: live default engages (no spawn_fn injected)
        and Bedrock is stubbed so the test runs offline.
        """
        tree = [
            _entry("expenses/AGENTS.md", EXPENSES_AGENTS_MD),
            _entry("expenses/CONTEXT.md", "Expenses sub-agent context.\n"),
            # No local skill — must fall through to platform.
        ]
        platform_manifest = {
            "approve-receipt": {"skill_md_content": PLATFORM_SKILL_MD},
        }
        tool_fn, captured = _build_live_factory(
            composer_files=tree,
            platform_catalog=platform_manifest,
            text="approved",
            accumulated_usage={"inputTokens": 42, "outputTokens": 17},
        )

        result = tool_fn(path="expenses", task="approve a receipt")

        assert result["ok"] is True
        assert result["sub_agent_response"] == "approved"
        assert result["sub_agent_usage"] == {
            "input_tokens": 42,
            "output_tokens": 17,
        }
        # The factory's `usage_acc` accumulator captured the same shape.
        assert captured["usage_acc"][-1] == {
            "input_tokens": 42,
            "output_tokens": 17,
        }
        # Task forwarded verbatim to Strands' Agent(...)(task) call.
        assert captured["task"] == "approve a receipt"


class TestLiveSpawnLocalSkill:
    """AE6: sub-agent with a local skill in
    ``expenses/skills/approve-receipt/SKILL.md`` → sub-agent's tool
    list includes a callable for the skill.
    """

    def test_local_skill_appears_in_sub_agent_tool_list(self):
        tool_fn, captured = _build_live_factory(
            composer_files=_expenses_tree(),
        )
        result = tool_fn(path="expenses", task="approve")

        assert result["ok"] is True
        # The Agent's tool list contains the local skill, exposed as a
        # callable that returns the SKILL.md body. Shared memory tools may
        # also be present when the Strands package is installed.
        tools = captured["agent_kwargs"]["tools"]
        skill_tool = next(tool for tool in tools if tool.__name__ == "approve_receipt")
        # The tool returns the SKILL.md body so the LLM can read it.
        assert skill_tool() == LOCAL_SKILL_MD


def _fake_hindsight_factory(tool_decorator, *, hs_endpoint, hs_bank, hs_tags):
    @tool_decorator
    async def hindsight_recall(query: str) -> str:
        return f"{hs_bank}:{query}"

    @tool_decorator
    async def hindsight_reflect(query: str) -> str:
        return f"reflect:{hs_bank}:{query}"

    @tool_decorator
    async def retain(content: str) -> str:
        return f"retain:{hs_bank}:{content}"

    return (retain, hindsight_recall, hindsight_reflect)


def _fake_wiki_factory(tool_decorator, *, tenant_id, owner_id):
    @tool_decorator
    async def search_wiki(query: str, limit: int = 10) -> str:
        return f"{tenant_id}:{owner_id}:{query}:{limit}"

    @tool_decorator
    async def read_wiki_page(slug: str, type: str = "entity") -> str:
        return f"{tenant_id}:{owner_id}:{type}:{slug}"

    return search_wiki, read_wiki_page


class TestLiveSpawnMemoryReachability:
    def test_sub_agent_tool_list_includes_hindsight_and_wiki_tools(self):
        tool_fn, captured = _build_live_factory(
            composer_files=_expenses_tree(),
            tool_context={
                "hs_endpoint": "https://hindsight.example.test",
                "hs_bank": "user-user-123",
                "hs_tags": ["tenant_id:tenant-abc", "user_id:user-123"],
                "wiki_tenant_id": "tenant-abc",
                "wiki_owner_id": "user-123",
                "hindsight_tool_factory": _fake_hindsight_factory,
                "wiki_tool_factory": _fake_wiki_factory,
            },
        )

        tool_fn(path="expenses", task="approve")

        names = {tool.__name__ for tool in captured["agent_kwargs"]["tools"]}
        assert "approve_receipt" in names
        assert "retain" in names
        assert "hindsight_recall" in names
        assert "hindsight_reflect" in names
        assert "search_wiki" in names
        assert "read_wiki_page" in names

    def test_sub_agent_tools_use_snapshotted_scope(self):
        tool_context = {
            "hs_endpoint": "https://hindsight.example.test",
            "hs_bank": "user-before",
            "hs_tags": ["tenant_id:tenant-before"],
            "wiki_tenant_id": "tenant-before",
            "wiki_owner_id": "user-before",
            "hindsight_tool_factory": _fake_hindsight_factory,
            "wiki_tool_factory": _fake_wiki_factory,
        }
        tool_fn, captured = _build_live_factory(
            composer_files=_expenses_tree(),
            tool_context=tool_context,
        )
        tool_context["hs_bank"] = "user-after"
        tool_context["wiki_owner_id"] = "user-after"

        tool_fn(path="expenses", task="approve")

        tools = {tool.__name__: tool for tool in captured["agent_kwargs"]["tools"]}
        assert asyncio.run(tools["hindsight_recall"]("where")) == "user-before:where"
        assert (
            asyncio.run(tools["search_wiki"]("topic"))
            == "tenant-before:user-before:topic:10"
        )

    def test_sub_agent_tool_list_gracefully_skips_optional_context(self):
        tool_fn, captured = _build_live_factory(
            composer_files=_expenses_tree(),
            tool_context={},
        )

        tool_fn(path="expenses", task="approve")

        names = {tool.__name__ for tool in captured["agent_kwargs"]["tools"]}
        assert "approve_receipt" in names
        assert "hindsight_recall" not in names
        assert "search_wiki" not in names

    def test_sub_agent_tool_list_includes_managed_memory_tools(self, monkeypatch):
        from delegate_to_workspace_tool import _build_sub_agent_tools

        def remember(fact: str) -> str:
            return fact

        def recall(query: str) -> str:
            return query

        def forget(query: str) -> str:
            return query

        def write_memory(path: str, content: str) -> str:
            return f"{path}:{content}"

        monkeypatch.setitem(
            sys.modules,
            "memory_tools",
            SimpleNamespace(remember=remember, recall=recall, forget=forget),
        )
        monkeypatch.setitem(
            sys.modules,
            "write_memory_tool",
            SimpleNamespace(write_memory=write_memory),
        )

        tools = _build_sub_agent_tools({}, tool_decorator=lambda fn: fn)

        names = {tool.__name__ for tool in tools}
        assert {"remember", "recall", "forget", "write_memory"} <= names


class TestLiveSpawnBodySwapSafety:
    """**Body-swap safety integration test.**

    Production registers the tool with ``spawn_fn=None`` (zero-arg —
    factory falls back to the live default). A future change that
    re-introduces an inert default fails this test loudly.
    """

    def test_zero_arg_spawn_fn_uses_live_default_and_returns_ok_true(self):
        """Mirrors the production registration call shape: build the
        factory WITHOUT ``spawn_fn=`` and assert the live default path
        produces ``ok: True``. If a future change reverts the production
        default to inert, this test fails.
        """
        from delegate_to_workspace_tool import make_delegate_to_workspace_fn

        # Stubs replace BedrockModel + Agent so the live spawn body
        # runs end-to-end without booting Bedrock.
        model_factory, agent_factory, tool_dec, captured = _make_strands_stubs(
            text="ok",
            accumulated_usage={"inputTokens": 1, "outputTokens": 2},
        )
        composer_mock = MagicMock(return_value=_expenses_tree())

        tool_fn = make_delegate_to_workspace_fn(
            parent_tenant_id="tenant-abc",
            parent_agent_id="agent-xyz",
            api_url="https://api.example.test",
            api_secret="secret",
            platform_catalog_manifest=None,
            cfg_model="anthropic.claude-sonnet-4-v1:0",
            usage_acc=[],
            workspace_reader=composer_mock,
            aws_region="us-east-1",
            model_factory=model_factory,
            agent_factory=agent_factory,
            tool_decorator=tool_dec,
            # NO spawn_fn → must hit the live default. This is the
            # production-mirror code path.
        )

        result = tool_fn(path="expenses", task="t")

        # The contract: production registration produces a live spawn
        # whose result has `ok: True`. If `spawn_fn=None` ever falls
        # back to inert again, this fails.
        assert result["ok"] is True, (
            "spawn_fn=None must hit the live spawn default; if this fails, "
            "the production code path has reverted to inert"
        )
        assert result["sub_agent_response"] == "ok"

        # Per ce-code-review adversarial finding: assert the model + agent
        # constructors actually fired so a future hardcoded `{ok: True}`
        # replacement of `_make_live_spawn_fn` (that bypasses BedrockModel
        # entirely) still fails this test. The strand stubs capture call
        # counts in `captured`.
        assert captured["model_calls"] >= 1, (
            "live spawn must invoke the (stubbed) BedrockModel constructor; "
            "if this fails, the live default isn't actually exercising the spawn body"
        )
        assert captured["agent_calls"] >= 1, (
            "live spawn must invoke the (stubbed) Agent constructor; "
            "if this fails, the live default isn't actually exercising the spawn body"
        )


class TestLiveSpawnWarningsPropagation:
    """Edge case: parser-skipped routing rows surface in the
    tool-result envelope so the parent LLM can recover.
    """

    def test_warnings_appear_in_top_level_result(self):
        tree = [
            _entry("expenses/AGENTS.md", EXPENSES_AGENTS_MD_WITH_SKIPS),
            _entry("expenses/CONTEXT.md", "Sub.\n"),
            _entry(
                "expenses/skills/approve-receipt/SKILL.md",
                LOCAL_SKILL_MD,
            ),
        ]
        tool_fn, captured = _build_live_factory(
            composer_files=tree,
            text="ok",
            accumulated_usage={"inputTokens": 0, "outputTokens": 0},
        )
        result = tool_fn(path="expenses", task="t")

        assert result["ok"] is True
        # Top-level `warnings` field carries the parser's human-readable
        # warnings so the parent LLM sees them in the tool-result envelope.
        assert len(result["warnings"]) == 2
        assert "memory/" in result["warnings"][0]
        # Top-level `skipped_rows` carries the structured shape too.
        assert result["skipped_rows"] == [
            {"row_index": 0, "go_to": "memory/", "reason": "reserved"},
            {"row_index": 1, "go_to": "Not A Path", "reason": "invalid_path"},
        ]
        # The skipped row's slug does NOT appear in the sub-agent's
        # **tool list** because the parser dropped the row before
        # resolution. (It's still in the raw AGENTS.md text embedded in
        # the system prompt, but the LLM has no callable for it.)
        tools = captured["agent_kwargs"]["tools"]
        tool_names = {t.__name__ for t in tools}
        assert "leak_private" not in tool_names
        assert "bogus" not in tool_names
        # Only the surviving row's skill (approve-receipt) is callable.
        assert "approve_receipt" in tool_names


class TestLiveSpawnUsageAccumulator:
    """The factory-snapshotted ``usage_acc`` captures sub-agent token
    counts on every successful spawn.
    """

    def test_usage_acc_captures_input_output_tokens(self):
        usage_acc: list = []
        tool_fn, captured = _build_live_factory(
            composer_files=_expenses_tree(),
            accumulated_usage={"inputTokens": 100, "outputTokens": 50},
            usage_acc=usage_acc,
        )
        tool_fn(path="expenses", task="t")
        assert usage_acc[-1] == {"input_tokens": 100, "output_tokens": 50}

    def test_usage_acc_default_when_metrics_missing(self):
        """If Strands returns a result with no metrics, usage defaults
        to zeros so downstream cost dashboards never see a None.
        """
        usage_acc: list = []
        tool_fn, captured = _build_live_factory(
            composer_files=_expenses_tree(),
            accumulated_usage=None,
            usage_acc=usage_acc,
        )
        result = tool_fn(path="expenses", task="t")
        assert result["sub_agent_usage"] == {
            "input_tokens": 0,
            "output_tokens": 0,
        }
        assert usage_acc[-1] == {"input_tokens": 0, "output_tokens": 0}


class TestLiveSpawnErrorPath:
    """Sub-agent spawn raising → wrapped in ``DelegateToWorkspaceError``;
    ``usage_acc`` is unchanged for the failed call.
    """

    def test_agent_raises_is_wrapped_and_usage_unchanged(self):
        from delegate_to_workspace_tool import DelegateToWorkspaceError

        usage_acc: list = []
        tool_fn, captured = _build_live_factory(
            composer_files=_expenses_tree(),
            raise_on_call=RuntimeError("bedrock 500"),
            usage_acc=usage_acc,
        )

        with pytest.raises(DelegateToWorkspaceError) as exc:
            tool_fn(path="expenses", task="t")
        assert "sub-agent spawn raised" in str(exc.value)
        assert isinstance(exc.value.__cause__, RuntimeError)
        # `usage_acc` is not appended to on the failed call.
        assert usage_acc == []


class TestLiveSpawnSystemPromptComposition:
    """The sub-agent system prompt is sourced from
    ``resolved_context["composed_tree"]`` — not a hardcoded string.
    """

    def test_system_prompt_contains_sub_agent_agents_md(self):
        """Snapshot-style assertion: the sub-agent's AGENTS.md content
        appears in the system prompt the Agent constructor sees.
        """
        tool_fn, captured = _build_live_factory(
            composer_files=_expenses_tree(),
        )
        tool_fn(path="expenses", task="t")
        sys_prompt = captured["agent_kwargs"]["system_prompt"]
        # The sub-agent's AGENTS.md content is present.
        assert "# Expenses sub-agent" in sys_prompt
        # The sub-agent's CONTEXT.md content is present.
        assert "Expenses sub-agent." in sys_prompt
        # Token-efficiency rules are appended verbatim.
        assert "Token Efficiency Rules" in sys_prompt
        # The ROOT AGENTS.md content (`# root`) is NOT in the prompt —
        # the sub-agent reads its OWN AGENTS.md, not the parent's.
        assert "# root" not in sys_prompt

    def test_system_prompt_includes_inherited_guardrails_when_present(self):
        """If the composed tree includes root-level PLATFORM.md /
        GUARDRAILS.md, both surface in the sub-agent's system prompt.
        """
        tree = [
            _entry("PLATFORM.md", "PLATFORM rules: never leak secrets.\n"),
            _entry("GUARDRAILS.md", "GUARDRAILS: refuse harmful requests.\n"),
            _entry("expenses/AGENTS.md", EXPENSES_AGENTS_MD),
            _entry("expenses/CONTEXT.md", "Expenses ctx.\n"),
            _entry(
                "expenses/skills/approve-receipt/SKILL.md",
                LOCAL_SKILL_MD,
            ),
        ]
        tool_fn, captured = _build_live_factory(composer_files=tree)
        tool_fn(path="expenses", task="t")
        sys_prompt = captured["agent_kwargs"]["system_prompt"]
        assert "PLATFORM rules" in sys_prompt
        assert "GUARDRAILS" in sys_prompt

    def test_system_prompt_includes_user_knowledge_pack_when_present(self):
        """Sub-agents inherit the same user-scoped distilled knowledge pack
        as the parent runtime through the factory-snapshotted tool context.
        """
        tool_fn, captured = _build_live_factory(
            composer_files=_expenses_tree(),
            tool_context={
                "knowledge_pack_body": (
                    '<user_distilled_knowledge_test scope="user">'
                    "User likes concise plans."
                    "</user_distilled_knowledge_test>"
                )
            },
        )
        tool_fn(path="expenses", task="t")
        sys_prompt = captured["agent_kwargs"]["system_prompt"]
        assert "<user_distilled_knowledge_test" in sys_prompt
        assert "User likes concise plans." in sys_prompt


class TestLiveSpawnSnapshotPattern:
    """``feedback_completion_callback_snapshot_pattern``: the spawn body
    must NOT re-read ``os.environ`` on dispatch. Patch the env mid-call
    and assert the factory-snapshotted ``cfg_model`` and ``aws_region``
    are what BedrockModel sees.
    """

    def test_cfg_model_and_region_snapshotted_at_factory_time(self):
        from unittest.mock import patch

        tool_fn, captured = _build_live_factory(
            composer_files=_expenses_tree(),
            cfg_model="snapshotted-model-id",
            aws_region="snapshotted-region",
        )

        # Mutating env after factory built must NOT change what
        # BedrockModel sees — the values are factory-snapshotted.
        with patch.dict(
            "os.environ",
            {
                "AWS_REGION": "DRIFTED-REGION",
                "AWS_DEFAULT_REGION": "DRIFTED-DEFAULT",
            },
        ):
            tool_fn(path="expenses", task="t")

        kwargs = captured["model_kwargs"]
        assert kwargs["model_id"] == "snapshotted-model-id"
        assert kwargs["region_name"] == "snapshotted-region"
        # Streaming is on (matches make_skill_agent_fn).
        assert kwargs["streaming"] is True

    def test_aws_region_falls_back_to_env_when_unset(self):
        """When the factory caller passes ``aws_region=None`` the
        snapshot reads from env at factory time (one read, no per-call
        re-read).
        """
        import os as _os
        from unittest.mock import patch

        from delegate_to_workspace_tool import make_delegate_to_workspace_fn

        model_factory, agent_factory, tool_dec, captured = _make_strands_stubs(
            text="ok", accumulated_usage={"inputTokens": 0, "outputTokens": 0},
        )
        composer_mock = MagicMock(return_value=_expenses_tree())

        with patch.dict(_os.environ, {"AWS_REGION": "env-region-at-factory"}):
            tool_fn = make_delegate_to_workspace_fn(
                parent_tenant_id="tenant-abc",
                parent_agent_id="agent-xyz",
                api_url="https://api.example.test",
                api_secret="secret",
                platform_catalog_manifest=None,
                cfg_model="m",
                usage_acc=[],
                workspace_reader=composer_mock,
                aws_region=None,  # → factory reads env once.
                model_factory=model_factory,
                agent_factory=agent_factory,
                tool_decorator=tool_dec,
            )

        # Factory built; mutate env; the per-call BedrockModel must
        # still see the factory-time region.
        with patch.dict(_os.environ, {"AWS_REGION": "DRIFTED"}):
            tool_fn(path="expenses", task="t")
        assert captured["model_kwargs"]["region_name"] == "env-region-at-factory"


class TestAwsRegionFallbackChain:
    """Per ce-code-review reliability finding TG-005: pin the documented
    fallback chain (`aws_region` kwarg → `AWS_REGION` → `AWS_DEFAULT_REGION`
    → `"us-east-1"`) so a future regression that re-orders or drops a step
    fails loudly.
    """

    def test_explicit_kwarg_wins_over_env(self):
        import os as _os
        from unittest.mock import patch

        from delegate_to_workspace_tool import make_delegate_to_workspace_fn
        model_factory, agent_factory, tool_dec, captured = _make_strands_stubs(text="ok")
        composer_mock = MagicMock(return_value=_expenses_tree())
        with patch.dict(
            _os.environ,
            {"AWS_REGION": "should-be-ignored", "AWS_DEFAULT_REGION": "should-be-ignored"},
        ):
            tool_fn = make_delegate_to_workspace_fn(
                parent_tenant_id="t", parent_agent_id="a",
                api_url="https://x", api_secret="s",
                platform_catalog_manifest=None,
                cfg_model="m", usage_acc=[],
                workspace_reader=composer_mock,
                aws_region="explicit-region",
                model_factory=model_factory, agent_factory=agent_factory,
                tool_decorator=tool_dec,
            )
        tool_fn(path="expenses", task="t")
        assert captured["model_kwargs"]["region_name"] == "explicit-region"

    def test_aws_region_env_wins_over_aws_default_region(self):
        import os as _os
        from unittest.mock import patch

        from delegate_to_workspace_tool import make_delegate_to_workspace_fn
        model_factory, agent_factory, tool_dec, captured = _make_strands_stubs(text="ok")
        composer_mock = MagicMock(return_value=_expenses_tree())
        with patch.dict(
            _os.environ,
            {"AWS_REGION": "from-aws-region", "AWS_DEFAULT_REGION": "from-default"},
            clear=False,
        ):
            tool_fn = make_delegate_to_workspace_fn(
                parent_tenant_id="t", parent_agent_id="a",
                api_url="https://x", api_secret="s",
                platform_catalog_manifest=None,
                cfg_model="m", usage_acc=[],
                workspace_reader=composer_mock,
                aws_region=None,
                model_factory=model_factory, agent_factory=agent_factory,
                tool_decorator=tool_dec,
            )
        tool_fn(path="expenses", task="t")
        assert captured["model_kwargs"]["region_name"] == "from-aws-region"

    def test_aws_default_region_used_when_aws_region_unset(self):
        import os as _os
        from unittest.mock import patch

        from delegate_to_workspace_tool import make_delegate_to_workspace_fn
        model_factory, agent_factory, tool_dec, captured = _make_strands_stubs(text="ok")
        composer_mock = MagicMock(return_value=_expenses_tree())
        env = {k: v for k, v in _os.environ.items() if k != "AWS_REGION"}
        env["AWS_DEFAULT_REGION"] = "from-default"
        with patch.dict(_os.environ, env, clear=True):
            tool_fn = make_delegate_to_workspace_fn(
                parent_tenant_id="t", parent_agent_id="a",
                api_url="https://x", api_secret="s",
                platform_catalog_manifest=None,
                cfg_model="m", usage_acc=[],
                workspace_reader=composer_mock,
                aws_region=None,
                model_factory=model_factory, agent_factory=agent_factory,
                tool_decorator=tool_dec,
            )
        tool_fn(path="expenses", task="t")
        assert captured["model_kwargs"]["region_name"] == "from-default"

    def test_us_east_1_used_when_no_env_at_all(self):
        import os as _os
        from unittest.mock import patch

        from delegate_to_workspace_tool import make_delegate_to_workspace_fn
        model_factory, agent_factory, tool_dec, captured = _make_strands_stubs(text="ok")
        composer_mock = MagicMock(return_value=_expenses_tree())
        env = {
            k: v for k, v in _os.environ.items()
            if k not in ("AWS_REGION", "AWS_DEFAULT_REGION")
        }
        with patch.dict(_os.environ, env, clear=True):
            tool_fn = make_delegate_to_workspace_fn(
                parent_tenant_id="t", parent_agent_id="a",
                api_url="https://x", api_secret="s",
                platform_catalog_manifest=None,
                cfg_model="m", usage_acc=[],
                workspace_reader=composer_mock,
                aws_region=None,
                model_factory=model_factory, agent_factory=agent_factory,
                tool_decorator=tool_dec,
            )
        tool_fn(path="expenses", task="t")
        assert captured["model_kwargs"]["region_name"] == "us-east-1"


class TestMultiSkillClosureBinding:
    """Per ce-code-review testing/adversarial finding: `_make_skill_tool`
    was extracted to dodge the Python loop-variable closure bug, but no
    existing test exercises the multi-skill iteration path. Two skills →
    each callable returns its own SKILL.md body, not the last one captured.
    """

    def test_two_skills_each_return_own_body(self):
        from delegate_to_workspace_tool import _build_sub_agent_tools
        from skill_resolver import ResolvedSkill

        skill_a_body = "---\nname: skill-a\n---\nbody-A"
        skill_b_body = "---\nname: skill-b\n---\nbody-B"
        resolved_skills = {
            "skill-a": ResolvedSkill(
                slug="skill-a",
                source="platform",
                skill_md_content=skill_a_body,
            ),
            "skill-b": ResolvedSkill(
                slug="skill-b",
                source="local",
                skill_md_content=skill_b_body,
                composed_tree_path="expenses/skills/skill-b/SKILL.md",
                folder_segment="expenses",
            ),
        }

        def _no_decorator(fn):
            return fn

        tools = _build_sub_agent_tools(
            resolved_skills=resolved_skills, tool_decorator=_no_decorator
        )

        # Two skill callables, each bound to its own slug's body — not
        # whichever slug was iterated last (that's the closure bug
        # `_make_skill_tool` was extracted to prevent). Shared memory tools
        # may also be appended when the Strands package is installed.
        skill_tools = [
            fn
            for fn in tools
            if getattr(fn, "__name__", "") in {"skill_a", "skill_b"}
        ]
        assert len(skill_tools) == 2
        results = [fn() for fn in skill_tools]
        assert skill_a_body in results
        assert skill_b_body in results
        assert len({results[0], results[1]}) == 2, (
            "two distinct skill bodies — if both equal, the closure captured "
            "the loop variable by reference (the bug `_make_skill_tool` prevents)"
        )
