"""Tests for the `outbound` mode_variant added to agent-email-send in Unit 2.

Two concerns:

  1. The SKILL.md frontmatter declares the mode_variant correctly and the
     reply-mode back-compat contract is unchanged.
  2. The Python send_email function rejects threading fields in outbound
     mode and tolerates the absence of INBOUND_* env vars.

Plan 2026-04-24-009 §U3 — frontmatter is the canonical metadata source;
the parallel `skill.yaml` was retired.

No network calls — the tests inject fake env + monkeypatch urlopen.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
from pathlib import Path
from unittest import mock

import pytest
import yaml

SKILL_DIR = Path(__file__).resolve().parent.parent
SKILL_MD = SKILL_DIR / "SKILL.md"
SEND_SCRIPT = SKILL_DIR / "scripts" / "send.py"


def _load_yaml() -> dict:
    """Parse the SKILL.md frontmatter block (between the two ``---`` markers)."""
    text = SKILL_MD.read_text(encoding="utf-8")
    if not text.startswith("---"):
        raise AssertionError("SKILL.md is missing leading frontmatter marker")
    rest = text.split("\n", 1)[1]
    end = rest.find("\n---")
    if end < 0:
        raise AssertionError("SKILL.md is missing closing frontmatter marker")
    parsed = yaml.safe_load(rest[:end])
    if not isinstance(parsed, dict):
        raise AssertionError("SKILL.md frontmatter is not a mapping")
    return parsed


def _load_send_module():
    # Re-load so each test can bake a fresh env into the module-level constants.
    spec = importlib.util.spec_from_file_location("agent_email_send", SEND_SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["agent_email_send"] = module
    spec.loader.exec_module(module)
    return module


# --- YAML contract ----------------------------------------------------------


def test_default_mode_stays_reply_for_backcompat() -> None:
    data = _load_yaml()
    assert data.get("mode") == "reply", (
        "default must remain 'reply' so existing inbound-reply callers are unaffected"
    )


def test_requires_env_top_level_unchanged_for_reply_mode() -> None:
    data = _load_yaml()
    required = data["requires_env"]
    for key in ("INBOUND_MESSAGE_ID", "INBOUND_SUBJECT", "INBOUND_FROM", "INBOUND_BODY"):
        assert key in required, f"reply-mode requires_env missing {key}"


def test_outbound_variant_declared_and_drops_inbound_vars() -> None:
    data = _load_yaml()
    variants = data.get("mode_variants")
    assert isinstance(variants, dict) and "outbound" in variants
    outbound = variants["outbound"]
    for key in ("THINKWORK_API_URL", "THINKWORK_API_SECRET", "AGENT_ID", "AGENT_EMAIL_ADDRESS"):
        assert key in outbound["requires_env"]
    for forbidden in ("INBOUND_MESSAGE_ID", "INBOUND_SUBJECT", "INBOUND_FROM", "INBOUND_BODY"):
        assert forbidden not in outbound["requires_env"], (
            f"outbound must relax {forbidden}"
        )


def test_outbound_variant_forbids_threading_fields() -> None:
    data = _load_yaml()
    forbidden = data["mode_variants"]["outbound"].get("forbidden_fields", [])
    for field in ("in_reply_to", "quoted_from", "quoted_body"):
        assert field in forbidden, (
            f"outbound must forbid {field} so stale inbound tokens can't leak into new emails"
        )


def test_outbound_variant_has_no_chat_triggers() -> None:
    """Outbound is invoked programmatically — no chat intent should route
    to it. Keeping triggers empty prevents accidental dispatcher hits."""
    data = _load_yaml()
    assert data["mode_variants"]["outbound"].get("triggers") == []


# --- send.py behavior --------------------------------------------------------


@pytest.fixture
def send_env(monkeypatch):
    """Minimum env for outbound. Intentionally omits all INBOUND_* vars to
    prove the script doesn't need them."""
    for key in ("INBOUND_MESSAGE_ID", "INBOUND_SUBJECT", "INBOUND_FROM", "INBOUND_BODY"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("THINKWORK_API_URL", "https://api.test.example")
    monkeypatch.setenv("THINKWORK_API_SECRET", "test-secret")
    monkeypatch.setenv("AGENT_ID", "00000000-0000-4000-8000-000000000001")
    monkeypatch.setenv("AGENT_EMAIL_ADDRESS", "agent@agents.test.example")
    monkeypatch.setenv("TENANT_ID", "tenant-1")
    yield


def _fake_response(body: str):
    class R:
        def read(self):
            return body.encode()

    return R()


def test_outbound_mode_sends_without_threading_fields(send_env) -> None:
    mod = _load_send_module()
    captured: dict = {}

    def fake_urlopen(req, timeout=None):
        captured["url"] = req.full_url
        captured["body"] = json.loads(req.data.decode())
        return _fake_response('{"messageId":"m-1","status":"sent"}')

    with mock.patch("urllib.request.urlopen", fake_urlopen):
        result = mod.send_email(
            to=["recipient@example.com"],
            subject="Sales brief — ABC Fuels",
            body="Please find attached...",
            mode="outbound",
        )
    assert json.loads(result) == {"messageId": "m-1", "status": "sent"}
    assert "inReplyTo" not in captured["body"]
    assert "quotedFrom" not in captured["body"]
    assert "quotedBody" not in captured["body"]


def test_outbound_mode_rejects_threading_fields(send_env) -> None:
    mod = _load_send_module()
    result = json.loads(mod.send_email(
        to=["recipient@example.com"],
        subject="Re: something",
        body="hi",
        in_reply_to="<abc@msg>",
        mode="outbound",
    ))
    assert "error" in result
    assert "outbound" in result["error"]


def test_reply_mode_still_supports_threading_fields(send_env) -> None:
    mod = _load_send_module()
    captured: dict = {}

    def fake_urlopen(req, timeout=None):
        captured["body"] = json.loads(req.data.decode())
        return _fake_response('{"messageId":"m-2","status":"sent"}')

    with mock.patch("urllib.request.urlopen", fake_urlopen):
        result = mod.send_email(
            to=["recipient@example.com"],
            subject="Re: hello",
            body="thanks!",
            in_reply_to="<abc@msg>",
            quoted_from="someone@example.com",
            quoted_body="original body here",
            # mode defaults to "reply" — must be back-compat
        )
    assert json.loads(result) == {"messageId": "m-2", "status": "sent"}
    assert captured["body"]["inReplyTo"] == "<abc@msg>"
    assert captured["body"]["quotedFrom"] == "someone@example.com"
    assert captured["body"]["quotedBody"] == "original body here"


def test_unknown_mode_rejected(send_env) -> None:
    mod = _load_send_module()
    result = json.loads(mod.send_email(
        to=["a@b.com"], subject="s", body="b", mode="weird"
    ))
    assert "error" in result
    assert "Unknown mode" in result["error"]


def test_outbound_survives_missing_inbound_env(monkeypatch) -> None:
    """The whole point of the variant: outbound must not depend on any
    INBOUND_* env var being set. Clear them, keep only the outbound-core
    vars, and verify send_email still ships a valid payload."""
    for key in list(os.environ):
        if key.startswith("INBOUND_"):
            monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("THINKWORK_API_URL", "https://api.test.example")
    monkeypatch.setenv("THINKWORK_API_SECRET", "test-secret")
    monkeypatch.setenv("AGENT_ID", "00000000-0000-4000-8000-000000000001")
    monkeypatch.setenv("AGENT_EMAIL_ADDRESS", "agent@agents.test.example")

    mod = _load_send_module()

    def fake_urlopen(req, timeout=None):
        return _fake_response('{"messageId":"m-3","status":"sent"}')

    with mock.patch("urllib.request.urlopen", fake_urlopen):
        result = json.loads(mod.send_email(
            to=["r@example.com"],
            subject="Scheduled brief",
            body="...",
            mode="outbound",
        ))
    assert result["status"] == "sent"
