from __future__ import annotations

import builtins

from wake_workspace_tool import make_wake_workspace_fn
import wake_workspace_tool


def test_wake_workspace_posts_valid_request():
    calls = []

    def post_json(api_url, api_secret, tenant_id, agent_id, body):
        calls.append((api_url, api_secret, tenant_id, agent_id, body))
        return {"ok": True, "sourceObjectKey": "tenants/acme/agents/marco/workspace/work/inbox/r.md"}

    wake = make_wake_workspace_fn(
        tenant_id="tenant",
        agent_id="agent",
        api_url="https://api.example.test",
        api_secret="secret",
        agents_md_routes=["expenses"],
        post_json=post_json,
    )

    result = wake("expenses", "# Please audit this")

    assert "queued tenants/acme" in result
    assert calls[0][4]["targetPath"] == "expenses"
    assert calls[0][4]["requestMd"] == "# Please audit this"
    assert calls[0][4]["waitForResult"] is False


def test_wake_workspace_wait_for_result_sends_single_api_request_with_flag():
    calls = []

    def post_json(api_url, api_secret, tenant_id, agent_id, body):
        calls.append(body)
        return {"ok": True, "sourceObjectKey": "key"}

    wake = make_wake_workspace_fn(
        tenant_id="tenant",
        agent_id="agent",
        api_url="https://api.example.test",
        api_secret="secret",
        agents_md_routes=["expenses"],
        post_json=post_json,
    )

    assert "queued" in wake("expenses", "Do work", wait_for_result=True)
    assert len(calls) == 1
    assert calls[0]["waitForResult"] is True


def test_wake_workspace_rejects_invalid_target_before_api_call():
    calls = []
    wake = make_wake_workspace_fn(
        tenant_id="tenant",
        agent_id="agent",
        api_url="https://api.example.test",
        api_secret="secret",
        agents_md_routes=["expenses"],
        post_json=lambda *args: calls.append(args),
    )

    result = wake("memory", "Do work")

    assert result == "wake_workspace: invalid target (reserved_name)."
    assert calls == []


def test_wake_workspace_requires_runtime_config():
    wake = make_wake_workspace_fn(
        tenant_id="",
        agent_id="agent",
        api_url="https://api.example.test",
        api_secret="secret",
        agents_md_routes=["expenses"],
    )

    assert "missing tenant" in wake("expenses", "Do work")


def test_make_wake_workspace_from_env_reads_agents_md_routes(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "AGENTS.md").write_text(
        """## Routing

| Task | Go to | Read | Skills |
|------|-------|------|--------|
| Expenses | expenses/ | expenses/CONTEXT.md | |
"""
    )
    monkeypatch.setenv("TENANT_ID", "tenant")
    monkeypatch.setenv("AGENT_ID", "agent")
    monkeypatch.setenv("THINKWORK_API_URL", "https://api.example.test")
    monkeypatch.setenv("API_AUTH_SECRET", "secret")
    monkeypatch.chdir(tmp_path)

    real_open = builtins.open

    def fake_open(path, *args, **kwargs):
        if path == "/tmp/workspace/AGENTS.md":
            return (workspace / "AGENTS.md").open(*args, **kwargs)
        return real_open(path, *args, **kwargs)

    monkeypatch.setattr(
        wake_workspace_tool,
        "_post_json",
        lambda *args: {"ok": True, "key": "key"},
    )
    monkeypatch.setattr("builtins.open", fake_open)
    wake = wake_workspace_tool.make_wake_workspace_from_env()

    assert "queued" in wake("expenses", "Do work")
