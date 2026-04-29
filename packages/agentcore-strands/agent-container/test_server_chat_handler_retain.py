"""Contract tests for the U3 retain seam in server.py.

Exercises ``_build_full_thread_transcript`` and ``_fire_retain_full_thread``
without spinning up the BaseHTTPRequestHandler. The full-handler integration
path is covered by the manual dev smoke listed in U3's Verification.
"""

# ruff: noqa: I001
from __future__ import annotations

import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

# server.py runs `_boot_assert.check` at import time; the test environment
# has only container-sources/ on sys.path. Stub the check (mirror the
# pattern in test_server_registration.py).
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


# ---------------------------------------------------------------------------
# _build_full_thread_transcript
# ---------------------------------------------------------------------------


def test_transcript_brand_new_thread_history_empty():
	"""AE1: brand-new thread → transcript is just [user, assistant]."""
	t = server._build_full_thread_transcript([], "hi", "hello")
	assert t == [
		{"role": "user", "content": "hi"},
		{"role": "assistant", "content": "hello"},
	]


def test_transcript_3_turn_thread_includes_full_history():
	"""AE1: 3-turn thread → transcript length 6 (3 prior + new pair)."""
	history = [
		{"role": "user", "content": "u1"},
		{"role": "assistant", "content": "a1"},
		{"role": "user", "content": "u2"},
		{"role": "assistant", "content": "a2"},
	]
	t = server._build_full_thread_transcript(history, "u3", "a3")
	assert len(t) == 6
	assert t[-2] == {"role": "user", "content": "u3"}
	assert t[-1] == {"role": "assistant", "content": "a3"}


def test_transcript_missing_history_treated_as_empty():
	t = server._build_full_thread_transcript(None, "hi", "hello")
	assert len(t) == 2


def test_transcript_filters_non_user_assistant_roles():
	"""Roles other than user/assistant are dropped (system, tool, etc.)."""
	history = [
		{"role": "system", "content": "system prompt"},
		{"role": "tool", "content": "tool output"},
		{"role": "user", "content": "u1"},
	]
	t = server._build_full_thread_transcript(history, "u2", "a2")
	assert t == [
		{"role": "user", "content": "u1"},
		{"role": "user", "content": "u2"},
		{"role": "assistant", "content": "a2"},
	]


def test_transcript_drops_empty_content_in_history():
	history = [
		{"role": "user", "content": ""},
		{"role": "assistant", "content": "a1"},
	]
	t = server._build_full_thread_transcript(history, "u2", "a2")
	assert len(t) == 3
	assert t[0] == {"role": "assistant", "content": "a1"}


def test_transcript_empty_response_text_still_includes_user_message():
	"""Edge case: the model produced no text but the user message is preserved."""
	t = server._build_full_thread_transcript([], "u1", "")
	assert t == [{"role": "user", "content": "u1"}]


# ---------------------------------------------------------------------------
# _fire_retain_full_thread (contract assertion)
# ---------------------------------------------------------------------------


def test_fire_retain_calls_retain_full_thread_with_correct_args():
	"""AE1: the seam invokes retain_full_thread with the assembled transcript."""
	stub = MagicMock()
	history = [
		{"role": "user", "content": "u1"},
		{"role": "assistant", "content": "a1"},
	]
	server._fire_retain_full_thread(
		stub,
		ticket_id="t-123",
		message="u2",
		response_text="a2",
		history_payload=history,
		tenant_id="tenant-A",
		user_id="user-1",
	)

	stub.retain_full_thread.assert_called_once()
	kwargs = stub.retain_full_thread.call_args.kwargs
	assert kwargs["thread_id"] == "t-123"
	assert kwargs["tenant_id"] == "tenant-A"
	assert kwargs["user_id"] == "user-1"
	assert len(kwargs["transcript"]) == 4
	assert kwargs["transcript"][-1] == {"role": "assistant", "content": "a2"}


def test_fire_retain_resolves_user_id_from_env_when_payload_blank(monkeypatch):
	"""user_id falls back to USER_ID then CURRENT_USER_ID env vars."""
	monkeypatch.setenv("USER_ID", "env-user")
	stub = MagicMock()
	server._fire_retain_full_thread(
		stub,
		ticket_id="t-1",
		message="hi",
		response_text="hello",
		history_payload=[],
		tenant_id="tenant-A",
		user_id="",
	)
	assert stub.retain_full_thread.call_args.kwargs["user_id"] == "env-user"


def test_fire_retain_skips_when_transcript_is_empty():
	"""Defensive: empty message + no history + no response → no Lambda call."""
	stub = MagicMock()
	server._fire_retain_full_thread(
		stub,
		ticket_id="t-1",
		message="",
		response_text="",
		history_payload=[],
		tenant_id="tenant-A",
		user_id="user-1",
	)
	stub.retain_full_thread.assert_not_called()


def test_fire_retain_called_exactly_once_per_turn():
	"""AE3 sub-agent regression: one outer turn → one retain call.

	Pinned at the unit boundary: regardless of how many sub-agent
	delegations happen inside _execute_agent_turn (which is upstream of
	this seam), the seam itself fires exactly once.
	"""
	stub = MagicMock()
	server._fire_retain_full_thread(
		stub,
		ticket_id="t-1",
		message="u1",
		response_text="a1",
		history_payload=[],
		tenant_id="tenant-A",
		user_id="user-1",
	)
	assert stub.retain_full_thread.call_count == 1
