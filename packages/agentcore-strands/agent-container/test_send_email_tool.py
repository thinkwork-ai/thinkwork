from __future__ import annotations

import json

import send_email_tool


def test_send_email_tool_posts_to_platform_api(monkeypatch):
    calls = []

    def fake_post_json(url, *, headers, payload):
        calls.append((url, headers, payload))
        return {"messageId": "ses-1", "status": "sent"}

    monkeypatch.setattr(send_email_tool, "_post_json", fake_post_json)
    costs = []
    tool = send_email_tool.build_send_email_tool(
        strands_tool_decorator=lambda fn: fn,
        send_email_config={
            "apiUrl": "https://api.test",
            "apiSecret": "secret",
            "agentId": "agent-1",
            "tenantId": "tenant-1",
            "threadId": "thread-1",
        },
        cost_sink=costs,
    )

    result = json.loads(tool(["user@example.com"], "Subject", "Body"))

    assert result == {"ok": True, "messageId": "ses-1", "status": "sent"}
    assert calls[0][0] == "https://api.test/api/email/send"
    assert calls[0][1]["Authorization"] == "Bearer secret"
    assert calls[0][1]["x-tenant-id"] == "tenant-1"
    assert calls[0][2]["agentId"] == "agent-1"
    assert calls[0][2]["to"] == "user@example.com"
    assert calls[0][2]["threadId"] == "thread-1"
    assert costs[0]["event_type"] == "send_email"


def test_send_email_tool_reply_mode_uses_inbound_context(monkeypatch):
    captured = {}

    def fake_post_json(_url, *, headers, payload):
        captured["headers"] = headers
        captured["payload"] = payload
        return {"messageId": "ses-2", "status": "sent"}

    monkeypatch.setattr(send_email_tool, "_post_json", fake_post_json)
    tool = send_email_tool.build_send_email_tool(
        strands_tool_decorator=lambda fn: fn,
        send_email_config={
            "apiUrl": "https://api.test",
            "apiSecret": "secret",
            "agentId": "agent-1",
            "tenantId": "tenant-1",
            "inboundMessageId": "<msg-1>",
            "inboundFrom": "sender@example.com",
            "inboundBody": "Original",
        },
        cost_sink=[],
    )

    result = json.loads(tool("sender@example.com", "Re: Subject", "Reply", mode="reply"))

    assert result["ok"] is True
    assert captured["payload"]["inReplyTo"] == "<msg-1>"
    assert captured["payload"]["quotedFrom"] == "sender@example.com"
    assert captured["payload"]["quotedBody"] == "Original"


def test_send_email_tool_reports_missing_config_without_http_call(monkeypatch):
    monkeypatch.setattr(
        send_email_tool,
        "_post_json",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("no http")),
    )
    tool = send_email_tool.build_send_email_tool(
        strands_tool_decorator=lambda fn: fn,
        send_email_config={"agentId": "agent-1"},
        cost_sink=[],
    )

    result = json.loads(tool("user@example.com", "Subject", "Body"))

    assert result["ok"] is False
    assert "credentials" in result["error"]
