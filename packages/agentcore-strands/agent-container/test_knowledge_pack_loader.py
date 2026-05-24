from __future__ import annotations

import logging
import sys
from datetime import UTC, datetime
from types import SimpleNamespace

import _boot_assert

_original_boto3 = sys.modules.get("boto3")
_original_botocore = sys.modules.get("botocore")
_original_botocore_exceptions = sys.modules.get("botocore.exceptions")
sys.modules["boto3"] = SimpleNamespace(client=lambda *_a, **_kw: None)
sys.modules["botocore"] = SimpleNamespace()
sys.modules["botocore.exceptions"] = SimpleNamespace(ClientError=Exception)

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
    if _original_botocore is None:
        sys.modules.pop("botocore", None)
    else:
        sys.modules["botocore"] = _original_botocore
    if _original_botocore_exceptions is None:
        sys.modules.pop("botocore.exceptions", None)
    else:
        sys.modules["botocore.exceptions"] = _original_botocore_exceptions

from user_storage import PackResult


def _reset_server_pack_state():
    server._PACK_CACHE = None
    server._USER_CONTEXT_CACHE = None


def test_ensure_workspace_ready_fetches_user_pack_during_bootstrap(monkeypatch, tmp_path):
    _reset_server_pack_state()
    calls = []
    workspace_calls = []
    pack = PackResult(
        body="<user_distilled_knowledge_test>Le Jules Verne</user_distilled_knowledge_test>",
        etag="etag-1",
        last_modified=datetime(2026, 4, 26, tzinfo=UTC),
    )
    user_context = PackResult(
        body="# USER\n\nEric likes direct status updates.",
        etag="user-etag-1",
        last_modified=datetime(2026, 5, 21, tzinfo=UTC),
    )

    monkeypatch.setenv("THINKWORK_API_URL", "https://api.example.test")
    monkeypatch.setenv("API_AUTH_SECRET", "secret")
    monkeypatch.setenv("USER_ID", "user-1")
    monkeypatch.setenv("CURRENT_USER_ID", "user-should-not-win")
    monkeypatch.setenv("WORKSPACE_BUCKET", "workspace-bucket")
    monkeypatch.setattr(server, "WORKSPACE_DIR", str(tmp_path))
    monkeypatch.setattr(
        server,
        "bootstrap_workspace",
        lambda **kwargs: (
            workspace_calls.append(kwargs) or SimpleNamespace(synced=1, deleted=0, total=1)
        ),
    )

    def fake_get_pack(tenant_id, user_id, *, bucket):
        calls.append((tenant_id, user_id, bucket))
        return pack

    def fake_get_user_context(tenant_id, user_id, *, bucket):
        calls.append(("context", tenant_id, user_id, bucket))
        return user_context

    monkeypatch.setattr(server, "get_user_knowledge_pack", fake_get_pack)
    monkeypatch.setattr(server, "get_user_context_md", fake_get_user_context)

    server._ensure_workspace_ready("tenant-1", "agent-1")

    assert workspace_calls[0]["tenant_slug"] == "tenant-1"
    assert workspace_calls[0]["agent_slug"] == "agent-1"
    assert workspace_calls[0]["bucket"] == "workspace-bucket"
    assert calls == [
        ("context", "tenant-1", "user-1", "workspace-bucket"),
        ("tenant-1", "user-1", "workspace-bucket"),
    ]
    assert server._USER_CONTEXT_CACHE == user_context
    assert server._PACK_CACHE == pack


def test_ensure_workspace_ready_logs_no_user_skip(monkeypatch, tmp_path, caplog):
    caplog.set_level(logging.INFO, logger="server")
    server._PACK_CACHE = PackResult(
        body="<user_distilled_knowledge_test>stale</user_distilled_knowledge_test>",
        etag="stale-pack",
        last_modified=datetime(2026, 4, 26, tzinfo=UTC),
    )
    server._USER_CONTEXT_CACHE = PackResult(
        body="# USER\n\nStale requester context",
        etag="stale-user",
        last_modified=datetime(2026, 5, 21, tzinfo=UTC),
    )

    monkeypatch.setenv("THINKWORK_API_URL", "https://api.example.test")
    monkeypatch.setenv("API_AUTH_SECRET", "secret")
    monkeypatch.delenv("USER_ID", raising=False)
    monkeypatch.delenv("CURRENT_USER_ID", raising=False)
    monkeypatch.setenv("WORKSPACE_BUCKET", "workspace-bucket")
    monkeypatch.setattr(server, "WORKSPACE_DIR", str(tmp_path))
    monkeypatch.setattr(
        server,
        "bootstrap_workspace",
        lambda **_kwargs: SimpleNamespace(synced=1, deleted=0, total=1),
    )
    monkeypatch.setattr(
        server,
        "get_user_knowledge_pack",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("pack should not be fetched without a user id")
        ),
    )
    monkeypatch.setattr(
        server,
        "get_user_context_md",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("user context should not be fetched without a user id")
        ),
    )

    server._ensure_workspace_ready("tenant-1", "agent-1")

    assert server._PACK_CACHE is None
    assert server._USER_CONTEXT_CACHE is None
    assert "Stale requester context" not in server._build_system_prompt()
    assert any(
        getattr(record, "event_type", None) == "pack_skipped"
        and getattr(record, "reason", None) == "no_user_id"
        for record in caplog.records
    )


def test_build_system_prompt_injects_pack_after_system_files(monkeypatch, tmp_path, caplog):
    _reset_server_pack_state()
    caplog.set_level(logging.INFO, logger="server")
    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()
    (workspace_dir / "AGENTS.md").write_text("Workspace map", encoding="utf-8")
    (workspace_dir / "CONTEXT.md").write_text("Workspace context", encoding="utf-8")
    (workspace_dir / "GUARDRAILS.md").write_text("Workspace guardrails", encoding="utf-8")
    (workspace_dir / "SPACE.md").write_text("Space context", encoding="utf-8")
    (workspace_dir / "USER.md").write_text("Workspace user profile", encoding="utf-8")
    (workspace_dir / "SOUL.md").write_text("Retired soul", encoding="utf-8")
    (workspace_dir / "IDENTITY.md").write_text("Retired identity", encoding="utf-8")
    (workspace_dir / "PLATFORM.md").write_text("Retired platform", encoding="utf-8")
    (workspace_dir / "CAPABILITIES.md").write_text("Retired capabilities", encoding="utf-8")
    (workspace_dir / "MEMORY_GUIDE.md").write_text("Retired memory guide", encoding="utf-8")
    (workspace_dir / "TOOLS.md").write_text("Retired tools", encoding="utf-8")

    monkeypatch.setattr(server, "WORKSPACE_DIR", str(workspace_dir))
    monkeypatch.setenv("TENANT_ID", "tenant-1")
    monkeypatch.setenv("USER_ID", "user-1")
    server._PACK_CACHE = PackResult(
        body=(
            "<user_distilled_knowledge_test>"
            "Favorite restaurant: Le Jules Verne"
            "</user_distilled_knowledge_test>"
        ),
        etag="etag-1",
        last_modified=datetime(2026, 4, 26, tzinfo=UTC),
    )
    server._USER_CONTEXT_CACHE = PackResult(
        body="# USER\n\nCall the requester Eric.",
        etag="user-etag-1",
        last_modified=datetime(2026, 5, 21, tzinfo=UTC),
    )

    prompt = server._build_system_prompt()

    assert prompt.index("# USER") < prompt.index("Workspace map")
    assert prompt.index("Workspace map") < prompt.index("Workspace context")
    assert prompt.index("Workspace context") < prompt.index("Workspace guardrails")
    assert prompt.index("Workspace guardrails") < prompt.index("Space context")
    assert prompt.index("Space context") < prompt.index("<user_distilled_knowledge_test")
    assert prompt.index("<user_distilled_knowledge_test") < prompt.index("Workspace user profile")
    assert "Retired soul" not in prompt
    assert "Retired identity" not in prompt
    assert "Retired platform" not in prompt
    assert "Retired capabilities" not in prompt
    assert "Retired memory guide" not in prompt
    assert "Retired tools" not in prompt
    user_context_injected = [
        record
        for record in caplog.records
        if getattr(record, "event_type", None) == "user_context_injected"
    ]
    assert len(user_context_injected) == 1
    assert getattr(user_context_injected[0], "tenant_id", None) == "tenant-1"
    assert getattr(user_context_injected[0], "user_id", None) == "user-1"
    injected = [
        record
        for record in caplog.records
        if getattr(record, "event_type", None) == "pack_injected"
    ]
    assert len(injected) == 1
    assert getattr(injected[0], "tenant_id", None) == "tenant-1"
    assert getattr(injected[0], "user_id", None) == "user-1"


def test_build_system_prompt_can_suppress_workspace_user_md(monkeypatch, tmp_path):
    _reset_server_pack_state()
    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()
    (workspace_dir / "USER.md").write_text("Workspace user profile", encoding="utf-8")
    (workspace_dir / "AGENTS.md").write_text("Workspace map", encoding="utf-8")

    monkeypatch.setattr(server, "WORKSPACE_DIR", str(workspace_dir))

    prompt = server._build_system_prompt(suppress_user_md=True)

    assert "Workspace map" in prompt
    assert "Workspace user profile" not in prompt


def test_build_system_prompt_profile_skips_retired_prompt_files(monkeypatch, tmp_path):
    _reset_server_pack_state()
    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()
    (workspace_dir / "AGENTS.md").write_text("Workspace map", encoding="utf-8")
    (workspace_dir / "CONTEXT.md").write_text("Workspace context", encoding="utf-8")
    (workspace_dir / "GUARDRAILS.md").write_text("Workspace guardrails", encoding="utf-8")
    (workspace_dir / "SPACE.md").write_text("Space context", encoding="utf-8")
    (workspace_dir / "SOUL.md").write_text("Retired soul", encoding="utf-8")
    (workspace_dir / "IDENTITY.md").write_text("Retired identity", encoding="utf-8")
    (workspace_dir / "USER.md").write_text("Workspace user profile", encoding="utf-8")

    monkeypatch.setattr(server, "WORKSPACE_DIR", str(workspace_dir))

    from router_parser import ContextProfile

    prompt = server._build_system_prompt(
        profile=ContextProfile(load=["SOUL.md", "IDENTITY.md", "USER.md"]),
        suppress_user_md=False,
    )

    assert "Workspace map" in prompt
    assert "Workspace context" in prompt
    assert "Workspace guardrails" in prompt
    assert "Space context" in prompt
    assert "Workspace user profile" in prompt
    assert "Retired soul" not in prompt
    assert "Retired identity" not in prompt
    assert prompt.index("Workspace map") < prompt.index("Workspace context")
    assert prompt.index("Workspace context") < prompt.index("Workspace guardrails")
    assert prompt.index("Workspace guardrails") < prompt.index("Space context")
    assert prompt.index("Space context") < prompt.index("Workspace user profile")


def test_format_requester_context_overlay_wraps_text():
    overlay = server._format_requester_context_overlay("Requester prefers concise notes.")

    assert overlay == (
        "<requester_context_overlay>\n"
        "Requester prefers concise notes.\n"
        "</requester_context_overlay>"
    )
