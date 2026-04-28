from __future__ import annotations

import logging
import sys
from datetime import UTC, datetime
from types import SimpleNamespace

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

from user_storage import PackResult


def _reset_server_pack_state():
    server._PACK_CACHE = None


def test_ensure_workspace_ready_fetches_user_pack_during_bootstrap(monkeypatch, tmp_path):
    _reset_server_pack_state()
    calls = []
    workspace_calls = []
    pack = PackResult(
        body="<user_distilled_knowledge_test>Le Jules Verne</user_distilled_knowledge_test>",
        etag="etag-1",
        last_modified=datetime(2026, 4, 26, tzinfo=UTC),
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
        lambda **kwargs: workspace_calls.append(kwargs)
        or SimpleNamespace(synced=1, deleted=0, total=1),
    )

    def fake_get_pack(tenant_id, user_id, *, bucket):
        calls.append((tenant_id, user_id, bucket))
        return pack

    monkeypatch.setattr(server, "get_user_knowledge_pack", fake_get_pack)

    server._ensure_workspace_ready("tenant-1", "agent-1")

    assert workspace_calls[0]["tenant_slug"] == "tenant-1"
    assert workspace_calls[0]["agent_slug"] == "agent-1"
    assert workspace_calls[0]["bucket"] == "workspace-bucket"
    assert calls == [("tenant-1", "user-1", "workspace-bucket")]
    assert server._PACK_CACHE == pack


def test_ensure_workspace_ready_logs_no_user_skip(monkeypatch, tmp_path, caplog):
    _reset_server_pack_state()
    caplog.set_level(logging.INFO, logger="server")

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

    server._ensure_workspace_ready("tenant-1", "agent-1")

    assert server._PACK_CACHE is None
    assert any(
        getattr(record, "event_type", None) == "pack_skipped"
        and getattr(record, "reason", None) == "no_user_id"
        for record in caplog.records
    )


def test_build_system_prompt_injects_pack_after_system_files(monkeypatch, tmp_path, caplog):
    _reset_server_pack_state()
    caplog.set_level(logging.INFO, logger="server")
    workspace_dir = tmp_path / "workspace"
    system_dir = tmp_path / "system"
    workspace_dir.mkdir()
    system_dir.mkdir()
    (workspace_dir / "USER.md").write_text("Workspace user profile", encoding="utf-8")
    (system_dir / "PLATFORM.md").write_text("Platform rules", encoding="utf-8")
    (system_dir / "MEMORY_GUIDE.md").write_text("Memory guide", encoding="utf-8")

    import install_skills

    monkeypatch.setattr(server, "WORKSPACE_DIR", str(workspace_dir))
    monkeypatch.setattr(install_skills, "SYSTEM_WORKSPACE_DIR", str(system_dir))
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

    prompt = server._build_system_prompt()

    assert prompt.index("Memory guide") < prompt.index("<user_distilled_knowledge_test")
    assert prompt.index("<user_distilled_knowledge_test") < prompt.index(
        "Workspace user profile"
    )
    injected = [
        record
        for record in caplog.records
        if getattr(record, "event_type", None) == "pack_injected"
    ]
    assert len(injected) == 1
    assert getattr(injected[0], "tenant_id", None) == "tenant-1"
    assert getattr(injected[0], "user_id", None) == "user-1"
