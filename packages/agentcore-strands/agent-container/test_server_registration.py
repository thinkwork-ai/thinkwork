"""Tests for ``_register_delegate_to_workspace_tool`` — Plan §008 U6.

Exercises all four registration branches that the helper exposes so the
operator dashboards (which aggregate on the structured ``event_type``
field) cannot regress silently:

1. All env present → INFO log, factory called, tool appended.
2. Missing env → WARNING log with ``event_type="tool_registration_skipped"``
   and a ``missing`` list naming the empty env var(s); factory NOT called.
3. ``ImportError`` while importing ``delegate_to_workspace_tool`` →
   WARNING log with ``event_type="tool_registration_failed"``; factory NOT
   reached. Patched via ``sys.modules``.
4. Each individual env var missing — covered as parametric subcases of (2)
   to lock the per-var ``missing`` field shape into the dashboard contract.

Run with::

    uv run --no-project --with pytest --with pytest-asyncio --with pyyaml \\
        --with mistune --with anyio --with boto3 --with strands-agents \\
        pytest packages/agentcore-strands/agent-container/test_server_registration.py
"""

# ruff: noqa: I001
from __future__ import annotations

import logging
import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from user_storage import PackResult

# server.py runs `_boot_assert.check` at import time; the test environment
# has only container-sources/ on sys.path (not the flattened /app layout the
# real container builds). Stub the check to a no-op for the duration of the
# server import only — restoring the original after so other tests in the
# same pytest session (notably test_boot_assert.py) see the genuine
# implementation.
import _boot_assert

_original_boto3 = sys.modules.get("boto3")
sys.modules["boto3"] = SimpleNamespace(client=lambda *_a, **_kw: None)

_original_check = _boot_assert.check
_boot_assert.check = lambda *a, **kw: None
try:
    import server
finally:
    _boot_assert.check = _original_check
    if _original_boto3 is None:
        sys.modules.pop("boto3", None)
    else:
        sys.modules["boto3"] = _original_boto3


_BASE_ENV = {
    "THINKWORK_API_URL": "https://api.example.test",
    "API_AUTH_SECRET": "test-secret",
    "TENANT_ID": "tenant-a",
    "AGENT_ID": "agent-marco",
}

_DW_ENV_KEYS = (
    "THINKWORK_API_URL",
    "API_URL",
    "API_AUTH_SECRET",
    "INTERNAL_API_SECRET",
    "TENANT_ID",
    "AGENT_ID",
    "_ASSISTANT_ID",
    "USER_ID",
    "CURRENT_USER_ID",
    "_MCP_USER_ID",
    "HINDSIGHT_ENDPOINT",
    "STAGE",
)


@pytest.fixture
def clean_env(monkeypatch):
    """Clear every env var the registration helper consults.

    The runtime env-fallback chain (`THINKWORK_API_URL` → `API_URL`,
    `API_AUTH_SECRET` → `INTERNAL_API_SECRET`, `AGENT_ID` → `_ASSISTANT_ID`)
    means tests must scrub every name to make per-var missing-cases
    deterministic.
    """
    for key in _DW_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    return monkeypatch


@pytest.fixture
def all_env_present(clean_env):
    """Set the four happy-path env vars."""
    for key, value in _BASE_ENV.items():
        clean_env.setenv(key, value)
    return clean_env


def _capture_factory(monkeypatch):
    """Replace ``make_delegate_to_workspace_fn`` with a capturing spy.

    Returns the spy so callers can assert call args. The real factory
    deep-copies the platform manifest and snapshots tenant/agent/api args;
    we don't need that work here — the spy just records the call.
    """
    spy = MagicMock(name="make_delegate_to_workspace_fn", return_value=lambda **kw: None)
    import delegate_to_workspace_tool

    monkeypatch.setattr(
        delegate_to_workspace_tool, "make_delegate_to_workspace_fn", spy
    )
    return spy


class TestWorkspaceBucketEnvAlias:
    def test_payload_workspace_bucket_sets_both_runtime_env_names(self, monkeypatch):
        monkeypatch.delenv("AGENTCORE_FILES_BUCKET", raising=False)
        monkeypatch.delenv("WORKSPACE_BUCKET", raising=False)

        server._apply_workspace_bucket_env("workspace-bucket-a")

        assert os.environ["AGENTCORE_FILES_BUCKET"] == "workspace-bucket-a"
        assert os.environ["WORKSPACE_BUCKET"] == "workspace-bucket-a"

        server._apply_workspace_bucket_env("workspace-bucket-b")

        assert os.environ["AGENTCORE_FILES_BUCKET"] == "workspace-bucket-b"
        assert os.environ["WORKSPACE_BUCKET"] == "workspace-bucket-b"


# ────────────────────────────────────────────────────────────────────────────
# Branch 1 — all env present → INFO log + factory called
# ────────────────────────────────────────────────────────────────────────────


class TestRegistrationHappyPath:
    def test_all_env_present_registers_tool(self, all_env_present, caplog):
        spy = _capture_factory(all_env_present)
        tools: list = []
        decorator = MagicMock(side_effect=lambda fn: ("wrapped", fn))

        caplog.set_level(logging.INFO, logger="server")
        server._register_delegate_to_workspace_tool(
            tools=tools,
            tool_decorator=decorator,
            skill_meta={},  # empty manifest is fine — branch is reachable
            effective_model="us.anthropic.claude-sonnet-4-6",
            sub_agent_usage=[],
        )

        # Factory was called exactly once with the expected kwargs.
        assert spy.call_count == 1
        kwargs = spy.call_args.kwargs
        assert kwargs["parent_tenant_id"] == "tenant-a"
        assert kwargs["parent_agent_id"] == "agent-marco"
        assert kwargs["api_url"] == "https://api.example.test"
        assert kwargs["api_secret"] == "test-secret"
        assert kwargs["cfg_model"] == "us.anthropic.claude-sonnet-4-6"
        # platform_catalog_manifest is empty-but-non-None for empty skill_meta.
        assert kwargs["platform_catalog_manifest"] == {}

        # Tool was wrapped + appended.
        assert len(tools) == 1
        assert tools[0][0] == "wrapped"

        # INFO log line is the "registered" event_type.
        records = [r for r in caplog.records if r.name == "server"]
        registered = [r for r in records if "registered" in r.getMessage()]
        assert len(registered) == 1
        assert registered[0].levelno == logging.INFO
        assert getattr(registered[0], "event_type", None) == "tool_registered"
        assert getattr(registered[0], "tool", None) == "delegate_to_workspace"

    def test_assistant_id_fallback_for_agent(self, clean_env, caplog):
        """``_ASSISTANT_ID`` is the legacy fallback for ``AGENT_ID``."""
        clean_env.setenv("THINKWORK_API_URL", _BASE_ENV["THINKWORK_API_URL"])
        clean_env.setenv("API_AUTH_SECRET", _BASE_ENV["API_AUTH_SECRET"])
        clean_env.setenv("TENANT_ID", _BASE_ENV["TENANT_ID"])
        clean_env.setenv("_ASSISTANT_ID", "assistant-fallback")

        spy = _capture_factory(clean_env)
        tools: list = []

        caplog.set_level(logging.INFO, logger="server")
        server._register_delegate_to_workspace_tool(
            tools=tools,
            tool_decorator=lambda fn: fn,
            skill_meta={},
            effective_model="m",
            sub_agent_usage=[],
        )

        assert spy.call_count == 1
        assert spy.call_args.kwargs["parent_agent_id"] == "assistant-fallback"

    def test_memory_tool_context_is_user_scoped_not_agent_scoped(self, all_env_present):
        all_env_present.setenv("USER_ID", "user-eric")
        all_env_present.setenv("CURRENT_USER_ID", "user-current")
        all_env_present.setenv("HINDSIGHT_ENDPOINT", "https://hindsight.example.test")
        all_env_present.setenv("STAGE", "dev")
        server._PACK_CACHE = PackResult(
            body=(
                "<user_distilled_knowledge_test>"
                "User pack"
                "</user_distilled_knowledge_test>"
            ),
            etag="pack-etag",
        )

        try:
            spy = _capture_factory(all_env_present)
            server._register_delegate_to_workspace_tool(
                tools=[],
                tool_decorator=lambda fn: fn,
                skill_meta={},
                effective_model="m",
                sub_agent_usage=[],
            )
        finally:
            server._PACK_CACHE = None

        tool_context = spy.call_args.kwargs["tool_context"]
        assert tool_context["hs_endpoint"] == "https://hindsight.example.test"
        assert tool_context["hs_bank"] == "user_user-eric"
        assert tool_context["hs_owner_id"] == "user-eric"
        assert tool_context["wiki_owner_id"] == "user-eric"
        assert tool_context["wiki_tenant_id"] == "tenant-a"
        assert "user_id:user-eric" in tool_context["hs_tags"]
        assert "agent_id:agent-marco" in tool_context["hs_tags"]
        assert tool_context["hs_bank"] != "agent-marco"
        assert tool_context["wiki_owner_id"] != "agent-marco"
        assert tool_context["knowledge_pack_body"].startswith(
            "<user_distilled_knowledge_test>"
        )
        assert tool_context["knowledge_pack_etag"] == "pack-etag"

    def test_memory_tool_context_falls_back_to_current_user_id(self, all_env_present):
        all_env_present.delenv("USER_ID", raising=False)
        all_env_present.setenv("CURRENT_USER_ID", "user-current")

        spy = _capture_factory(all_env_present)
        server._register_delegate_to_workspace_tool(
            tools=[],
            tool_decorator=lambda fn: fn,
            skill_meta={},
            effective_model="m",
            sub_agent_usage=[],
        )

        tool_context = spy.call_args.kwargs["tool_context"]
        assert tool_context["hs_bank"] == "user_user-current"
        assert tool_context["wiki_owner_id"] == "user-current"


# ────────────────────────────────────────────────────────────────────────────
# Branch 2 — missing env → WARNING with event_type="tool_registration_skipped"
# ────────────────────────────────────────────────────────────────────────────


class TestRegistrationMissingEnv:
    @pytest.mark.parametrize(
        "drop_keys, expected_missing",
        [
            (("THINKWORK_API_URL", "API_URL"), ["THINKWORK_API_URL"]),
            (("API_AUTH_SECRET", "INTERNAL_API_SECRET"), ["API_AUTH_SECRET"]),
            (("TENANT_ID",), ["TENANT_ID"]),
            (("AGENT_ID", "_ASSISTANT_ID"), ["AGENT_ID"]),
        ],
        ids=["api_url", "api_secret", "tenant_id", "agent_id"],
    )
    def test_missing_env_emits_structured_warning(
        self, all_env_present, caplog, drop_keys, expected_missing
    ):
        for key in drop_keys:
            all_env_present.delenv(key, raising=False)
        spy = _capture_factory(all_env_present)
        tools: list = []

        caplog.set_level(logging.WARNING, logger="server")
        server._register_delegate_to_workspace_tool(
            tools=tools,
            tool_decorator=lambda fn: fn,
            skill_meta={},
            effective_model="m",
            sub_agent_usage=[],
        )

        # Factory NOT called; tools list NOT mutated.
        assert spy.call_count == 0
        assert tools == []

        # Exactly one WARNING for the skip event with the expected `missing`.
        skip_records = [
            r
            for r in caplog.records
            if r.name == "server"
            and getattr(r, "event_type", None) == "tool_registration_skipped"
        ]
        assert len(skip_records) == 1
        record = skip_records[0]
        assert record.levelno == logging.WARNING
        assert getattr(record, "tool", None) == "delegate_to_workspace"
        assert getattr(record, "missing", None) == expected_missing

    def test_all_four_missing_lists_all(self, clean_env, caplog):
        """When every env var is empty the ``missing`` list names all four
        in declaration order — operator dashboards depend on the ordering
        for stable bucket aggregation."""
        spy = _capture_factory(clean_env)
        tools: list = []

        caplog.set_level(logging.WARNING, logger="server")
        server._register_delegate_to_workspace_tool(
            tools=tools,
            tool_decorator=lambda fn: fn,
            skill_meta={},
            effective_model="m",
            sub_agent_usage=[],
        )

        assert spy.call_count == 0
        skip_records = [
            r
            for r in caplog.records
            if getattr(r, "event_type", None) == "tool_registration_skipped"
        ]
        assert len(skip_records) == 1
        assert getattr(skip_records[0], "missing", None) == [
            "THINKWORK_API_URL",
            "API_AUTH_SECRET",
            "TENANT_ID",
            "AGENT_ID",
        ]


# ────────────────────────────────────────────────────────────────────────────
# Branch 3 — ImportError on tool module → WARNING tool_registration_failed
# ────────────────────────────────────────────────────────────────────────────


class TestRegistrationImportFails:
    def test_import_error_logs_structured_warning(self, all_env_present, caplog):
        """Patch ``sys.modules`` to make the local
        ``from delegate_to_workspace_tool import …`` raise so we exercise the
        outer ``except ImportError`` branch."""
        original = sys.modules.pop("delegate_to_workspace_tool", None)

        # Sentinel that raises ImportError on attribute access — when
        # `from <mod> import <name>` runs, Python reads the attribute, so
        # raising here surfaces as ImportError at the import statement.
        class _Boom:
            def __getattr__(self, _name):
                raise ImportError("synthetic test failure")

        sys.modules["delegate_to_workspace_tool"] = _Boom()
        try:
            tools: list = []
            caplog.set_level(logging.WARNING, logger="server")
            server._register_delegate_to_workspace_tool(
                tools=tools,
                tool_decorator=lambda fn: fn,
                skill_meta={},
                effective_model="m",
                sub_agent_usage=[],
            )

            # No tool appended.
            assert tools == []

            failed_records = [
                r
                for r in caplog.records
                if r.name == "server"
                and getattr(r, "event_type", None) == "tool_registration_failed"
            ]
            assert len(failed_records) == 1
            record = failed_records[0]
            assert record.levelno == logging.WARNING
            assert getattr(record, "tool", None) == "delegate_to_workspace"
        finally:
            # Restore the real module so subsequent tests (and other test
            # files in the same pytest session) see the genuine version.
            if original is not None:
                sys.modules["delegate_to_workspace_tool"] = original
            else:
                sys.modules.pop("delegate_to_workspace_tool", None)


# ────────────────────────────────────────────────────────────────────────────
# Branch 4 — manifest building tolerates missing/empty SKILL.md files
# ────────────────────────────────────────────────────────────────────────────


class TestRegistrationManifestBuilding:
    def test_missing_skill_md_files_logged_and_skipped(
        self, all_env_present, caplog, tmp_path, monkeypatch
    ):
        """Per the helper's contract, an OSError reading SKILL.md WARN-skips
        that entry without aborting registration. The dashboard already
        covers the file-level WARN; this test locks in that the registration
        completes despite per-entry failures (i.e. branch parity)."""
        spy = _capture_factory(all_env_present)
        # Redirect /tmp/skills lookup to an empty tmp dir so every slug
        # raises OSError on open() — simulating the "manifest entries empty"
        # operational scenario.
        empty_skills_root = tmp_path / "no-skills"
        empty_skills_root.mkdir()

        # Only function-level os.path.join is referenced; the helper opens
        # `/tmp/skills/<slug>/SKILL.md` directly. We patch open() to raise
        # OSError unconditionally so the per-slug except path runs.
        real_open = open

        def _raising_open(path, *a, **kw):
            if "/tmp/skills/" in str(path):
                raise OSError("no such file (test stub)")
            return real_open(path, *a, **kw)

        monkeypatch.setattr("builtins.open", _raising_open)

        tools: list = []
        caplog.set_level(logging.WARNING, logger="server")
        server._register_delegate_to_workspace_tool(
            tools=tools,
            tool_decorator=lambda fn: fn,
            skill_meta={"alpha": {"description": "x"}, "beta": {"description": "y"}},
            effective_model="m",
            sub_agent_usage=[],
        )

        # Registration still succeeds with an empty manifest.
        assert spy.call_count == 1
        assert spy.call_args.kwargs["platform_catalog_manifest"] == {}

        # Both per-slug WARN-skips landed.
        per_slug_warns = [
            r
            for r in caplog.records
            if r.name == "server" and "platform_catalog_manifest" in r.getMessage()
        ]
        assert len(per_slug_warns) == 2
