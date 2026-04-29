"""Unit tests for api_memory_client.

Covers retain_full_thread (U2) and retain_daily (U7 — Event invocation
type). retain_turn_pair was deleted in U3's cutover.
"""

from __future__ import annotations

import json
import os
from unittest.mock import MagicMock, patch

import pytest

import api_memory_client


@pytest.fixture(autouse=True)
def reset_module_state(monkeypatch):
	# Reset memoized boto3 client and ensure each test sees a clean env.
	api_memory_client._lambda_client = None
	for var in (
		"MEMORY_RETAIN_FN_NAME",
		"TENANT_ID",
		"_MCP_TENANT_ID",
		"USER_ID",
		"CURRENT_USER_ID",
		"_ASSISTANT_ID",
	):
		monkeypatch.delenv(var, raising=False)
	yield


# ---------------------------------------------------------------------------
# retain_full_thread (U2)
# ---------------------------------------------------------------------------


def _populated_env(monkeypatch, fn_name="memory-retain-dev"):
	monkeypatch.setenv("MEMORY_RETAIN_FN_NAME", fn_name)
	monkeypatch.setenv("TENANT_ID", "tenant-A")
	monkeypatch.setenv("USER_ID", "user-1")


def _stub_client(monkeypatch):
	stub = MagicMock()
	monkeypatch.setattr(api_memory_client, "_get_client", lambda: stub)
	return stub


def test_retain_full_thread_happy_path(monkeypatch):
	"""AE1: env populated + valid 5-msg transcript invokes Lambda once."""
	_populated_env(monkeypatch)
	stub = _stub_client(monkeypatch)

	transcript = [
		{"role": "user", "content": f"msg-{i}"} for i in range(5)
	]
	ok = api_memory_client.retain_full_thread(
		thread_id="t-123",
		transcript=transcript,
	)

	assert ok is True
	assert stub.invoke.call_count == 1
	kwargs = stub.invoke.call_args.kwargs
	assert kwargs["FunctionName"] == "memory-retain-dev"
	assert kwargs["InvocationType"] == "Event"
	payload = json.loads(kwargs["Payload"].decode("utf-8"))
	assert payload == {
		"tenantId": "tenant-A",
		"userId": "user-1",
		"threadId": "t-123",
		"transcript": transcript,
	}


def test_retain_full_thread_explicit_args_override_env(monkeypatch):
	_populated_env(monkeypatch)
	stub = _stub_client(monkeypatch)

	api_memory_client.retain_full_thread(
		thread_id="t-1",
		transcript=[{"role": "user", "content": "x"}],
		tenant_id="explicit-tenant",
		user_id="explicit-user",
	)
	payload = json.loads(stub.invoke.call_args.kwargs["Payload"].decode("utf-8"))
	assert payload["tenantId"] == "explicit-tenant"
	assert payload["userId"] == "explicit-user"


def test_retain_full_thread_large_transcript_no_truncation(monkeypatch):
	_populated_env(monkeypatch)
	stub = _stub_client(monkeypatch)

	transcript = [{"role": "user", "content": f"msg-{i}"} for i in range(50)]
	api_memory_client.retain_full_thread(thread_id="t-1", transcript=transcript)
	payload = json.loads(stub.invoke.call_args.kwargs["Payload"].decode("utf-8"))
	assert len(payload["transcript"]) == 50


def test_retain_full_thread_empty_thread_id_returns_false(monkeypatch):
	_populated_env(monkeypatch)
	stub = _stub_client(monkeypatch)

	ok = api_memory_client.retain_full_thread(
		thread_id="",
		transcript=[{"role": "user", "content": "x"}],
	)
	assert ok is False
	stub.invoke.assert_not_called()


def test_retain_full_thread_empty_transcript_returns_false(monkeypatch):
	_populated_env(monkeypatch)
	stub = _stub_client(monkeypatch)

	ok = api_memory_client.retain_full_thread(thread_id="t-1", transcript=[])
	assert ok is False
	stub.invoke.assert_not_called()


def test_retain_full_thread_env_unset_returns_false(monkeypatch):
	# MEMORY_RETAIN_FN_NAME deliberately not set
	stub = _stub_client(monkeypatch)
	ok = api_memory_client.retain_full_thread(
		thread_id="t-1",
		transcript=[{"role": "user", "content": "x"}],
	)
	assert ok is False
	stub.invoke.assert_not_called()


def test_retain_full_thread_missing_tenant_returns_false(monkeypatch):
	monkeypatch.setenv("MEMORY_RETAIN_FN_NAME", "memory-retain-dev")
	monkeypatch.setenv("USER_ID", "user-1")
	# tenant deliberately unset
	stub = _stub_client(monkeypatch)
	ok = api_memory_client.retain_full_thread(
		thread_id="t-1",
		transcript=[{"role": "user", "content": "x"}],
	)
	assert ok is False
	stub.invoke.assert_not_called()


def test_retain_full_thread_invoke_raises_returns_false(monkeypatch):
	"""AE5: never propagates Lambda invoke errors."""
	_populated_env(monkeypatch)
	stub = _stub_client(monkeypatch)
	stub.invoke.side_effect = RuntimeError("network down")

	ok = api_memory_client.retain_full_thread(
		thread_id="t-1",
		transcript=[{"role": "user", "content": "x"}],
	)
	assert ok is False


def test_retain_full_thread_env_snapshot_at_entry(monkeypatch):
	"""Snapshot regression: env mutated mid-call still uses entry-time value."""
	_populated_env(monkeypatch)
	stub = _stub_client(monkeypatch)

	# Mutate env between snapshot and invoke. The snapshot is read at entry,
	# so the Lambda should receive the entry-time tenant.
	def mutate_then_invoke(*args, **kwargs):
		os.environ["TENANT_ID"] = "mutated-tenant"
		return MagicMock()

	stub.invoke.side_effect = mutate_then_invoke

	api_memory_client.retain_full_thread(
		thread_id="t-1",
		transcript=[{"role": "user", "content": "x"}],
	)
	payload = json.loads(stub.invoke.call_args.kwargs["Payload"].decode("utf-8"))
	assert payload["tenantId"] == "tenant-A"


# ---------------------------------------------------------------------------
# retain_daily (Event invocation, U7-aligned)
# ---------------------------------------------------------------------------


def test_retain_daily_uses_event_invocation_type(monkeypatch):
	_populated_env(monkeypatch)
	stub = _stub_client(monkeypatch)

	ok = api_memory_client.retain_daily(date="2026-04-27", content="- bullet")
	assert ok is True
	assert stub.invoke.call_args.kwargs["InvocationType"] == "Event"
	payload = json.loads(stub.invoke.call_args.kwargs["Payload"].decode("utf-8"))
	assert payload == {
		"tenantId": "tenant-A",
		"userId": "user-1",
		"kind": "daily",
		"date": "2026-04-27",
		"content": "- bullet",
	}


def test_retain_daily_empty_content_returns_false(monkeypatch):
	_populated_env(monkeypatch)
	stub = _stub_client(monkeypatch)

	ok = api_memory_client.retain_daily(date="2026-04-27", content="   ")
	assert ok is False
	stub.invoke.assert_not_called()


def test_retain_daily_invoke_raises_returns_false(monkeypatch):
	_populated_env(monkeypatch)
	stub = _stub_client(monkeypatch)
	stub.invoke.side_effect = RuntimeError("boom")

	ok = api_memory_client.retain_daily(date="2026-04-27", content="bullet")
	assert ok is False


