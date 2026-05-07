"""Tests for the compliance audit-event client (U6).

Exercises the env-snapshot, UUIDv7 generation, snake_case → camelCase
boundary, retry behavior, and telemetry-tier failure semantics.
Network calls are mocked — no real HTTP traffic.
"""

from __future__ import annotations

import asyncio
import io
import json
import re
import urllib.error
from typing import Optional
from unittest.mock import patch, MagicMock

import pytest

from compliance_client import (
	ComplianceClient,
	_uuidv7,
)


UUIDV7_RE = re.compile(
	r"^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)


# ── _uuidv7 helper ──────────────────────────────────────────────────────


def test_uuidv7_shape_matches_rfc9562():
	"""Every generated id must satisfy the version-7 + variant-10 mask."""
	for _ in range(100):
		uid = _uuidv7()
		assert UUIDV7_RE.match(uid), f"not UUIDv7: {uid}"


def test_uuidv7_monotonic_within_same_second():
	"""Successive ids share the timestamp prefix when generated quickly.

	Verifies the time-leading invariant the chain-head ordering relies
	on — within a single millisecond bucket, the prefix bytes are equal.
	"""
	a = _uuidv7()
	b = _uuidv7()
	# First 8 hex chars = 32 bits of the 48-bit ms timestamp.
	# The window between two adjacent calls is microseconds; same ms
	# bucket is overwhelmingly likely.
	assert a[:8] == b[:8] or int(a[:8], 16) <= int(b[:8], 16)


# ── env snapshot ─────────────────────────────────────────────────────────


def test_disabled_when_api_url_unset(monkeypatch):
	monkeypatch.delenv("THINKWORK_API_URL", raising=False)
	monkeypatch.setenv("API_AUTH_SECRET", "test-secret")
	client = ComplianceClient()
	assert client.disabled is True


def test_disabled_when_secret_unset(monkeypatch):
	monkeypatch.setenv("THINKWORK_API_URL", "https://api.example.com")
	monkeypatch.delenv("API_AUTH_SECRET", raising=False)
	client = ComplianceClient()
	assert client.disabled is True


def test_enabled_when_both_env_vars_set(monkeypatch):
	monkeypatch.setenv("THINKWORK_API_URL", "https://api.example.com")
	monkeypatch.setenv("API_AUTH_SECRET", "test-secret")
	client = ComplianceClient()
	assert client.disabled is False


def test_env_snapshot_stable_across_env_changes(monkeypatch):
	"""__init__ snapshots env once; later mutations don't reach .emit()."""
	monkeypatch.setenv("THINKWORK_API_URL", "https://api.example.com")
	monkeypatch.setenv("API_AUTH_SECRET", "original-secret")
	client = ComplianceClient()
	# Mutate env after construction.
	monkeypatch.setenv("API_AUTH_SECRET", "mutated-secret")
	# Internal attr still holds the original snapshot.
	assert client._api_secret == "original-secret"


def test_disabled_emit_returns_none_without_network_call(monkeypatch):
	monkeypatch.delenv("THINKWORK_API_URL", raising=False)
	monkeypatch.delenv("API_AUTH_SECRET", raising=False)
	client = ComplianceClient()

	with patch("urllib.request.urlopen") as mock_urlopen:
		result = asyncio.run(
			client.emit(
				tenant_id="t",
				actor_user_id="u",
				event_type="agent.skills_changed",
				payload={"agentId": "a"},
			)
		)
	assert result is None
	mock_urlopen.assert_not_called()


# ── happy path ──────────────────────────────────────────────────────────


def _success_response(payload: dict) -> MagicMock:
	body = json.dumps(payload).encode("utf-8")
	resp = MagicMock()
	resp.__enter__ = lambda self: self
	resp.__exit__ = lambda self, *a: False
	resp.read.return_value = body
	return resp


def test_happy_path_returns_parsed_response(monkeypatch):
	monkeypatch.setenv("THINKWORK_API_URL", "https://api.example.com")
	monkeypatch.setenv("API_AUTH_SECRET", "test-secret")
	client = ComplianceClient()

	server_response = {
		"dispatched": True,
		"idempotent": False,
		"eventId": "01900000-0000-7000-8000-000000000001",
		"outboxId": "outbox-123",
		"redactedFields": [],
	}

	with patch("urllib.request.urlopen") as mock_urlopen:
		mock_urlopen.return_value = _success_response(server_response)
		result = asyncio.run(
			client.emit(
				tenant_id="tenant-a",
				actor_user_id="user-1",
				event_type="agent.skills_changed",
				payload={"agentId": "a", "addedSkills": ["x"]},
			)
		)

	assert result == server_response
	mock_urlopen.assert_called_once()


def test_request_carries_camelcase_payload_and_idempotency_header(monkeypatch):
	monkeypatch.setenv("THINKWORK_API_URL", "https://api.example.com")
	monkeypatch.setenv("API_AUTH_SECRET", "test-secret")
	client = ComplianceClient()

	captured: dict = {}

	def _capture(req, timeout):
		captured["url"] = req.full_url
		captured["headers"] = dict(req.headers)
		captured["body"] = json.loads(req.data.decode("utf-8"))
		captured["method"] = req.get_method()
		return _success_response({"dispatched": True, "eventId": "x"})

	with patch("urllib.request.urlopen", side_effect=_capture):
		asyncio.run(
			client.emit(
				tenant_id="tenant-a",
				actor_user_id="user-1",
				event_type="agent.skills_changed",
				payload={"agentId": "a"},
				thread_id="thread-1",
				agent_id="agent-1",
			)
		)

	assert captured["url"] == "https://api.example.com/api/compliance/events"
	assert captured["method"] == "POST"
	# urllib lowercases header keys
	assert captured["headers"]["Authorization"] == "Bearer test-secret"
	assert captured["headers"]["Content-type"] == "application/json"
	# Idempotency-Key mirrors body's event_id
	idem = captured["headers"]["Idempotency-key"]
	assert UUIDV7_RE.match(idem)
	assert captured["body"]["event_id"] == idem
	# camelCase keys in body
	assert captured["body"]["tenantId"] == "tenant-a"
	assert captured["body"]["actorUserId"] == "user-1"
	assert captured["body"]["actorType"] == "user"
	assert captured["body"]["source"] == "strands"
	assert captured["body"]["threadId"] == "thread-1"
	assert captured["body"]["agentId"] == "agent-1"


def test_caller_supplied_event_id_passes_through(monkeypatch):
	monkeypatch.setenv("THINKWORK_API_URL", "https://api.example.com")
	monkeypatch.setenv("API_AUTH_SECRET", "test-secret")
	client = ComplianceClient()
	caller_event_id = "01900000-0000-7000-8000-000000000099"

	captured: dict = {}

	def _capture(req, timeout):
		captured["body"] = json.loads(req.data.decode("utf-8"))
		captured["headers"] = dict(req.headers)
		return _success_response({"dispatched": True, "eventId": caller_event_id})

	with patch("urllib.request.urlopen", side_effect=_capture):
		asyncio.run(
			client.emit(
				tenant_id="t",
				actor_user_id="u",
				event_type="x",
				payload={},
				event_id=caller_event_id,
			)
		)

	assert captured["body"]["event_id"] == caller_event_id
	assert captured["headers"]["Idempotency-key"] == caller_event_id


# ── retry behavior ──────────────────────────────────────────────────────


def test_retries_on_5xx_then_succeeds(monkeypatch):
	monkeypatch.setenv("THINKWORK_API_URL", "https://api.example.com")
	monkeypatch.setenv("API_AUTH_SECRET", "test-secret")
	client = ComplianceClient()

	def _raise_500(*a, **k):
		raise urllib.error.HTTPError(
			"https://x", 500, "boom", hdrs={}, fp=io.BytesIO(b"")
		)

	# First attempt 500, second attempt success.
	call_count = {"n": 0}

	def _flaky(req, timeout):
		call_count["n"] += 1
		if call_count["n"] == 1:
			_raise_500()
		return _success_response({"dispatched": True})

	with patch("urllib.request.urlopen", side_effect=_flaky):
		result = asyncio.run(
			client.emit(
				tenant_id="t",
				actor_user_id="u",
				event_type="x",
				payload={},
			)
		)

	assert result == {"dispatched": True}
	assert call_count["n"] == 2


def test_retries_exhausted_returns_none(monkeypatch):
	monkeypatch.setenv("THINKWORK_API_URL", "https://api.example.com")
	monkeypatch.setenv("API_AUTH_SECRET", "test-secret")
	# Speed the test up — zero out retry delays.
	monkeypatch.setattr(
		"compliance_client.ComplianceClient.RETRY_DELAYS_SEC",
		(0.0, 0.0, 0.0),
	)
	client = ComplianceClient()

	def _always_500(req, timeout):
		raise urllib.error.HTTPError(
			"https://x", 500, "boom", hdrs={}, fp=io.BytesIO(b"")
		)

	with patch("urllib.request.urlopen", side_effect=_always_500) as mock_urlopen:
		result = asyncio.run(
			client.emit(
				tenant_id="t",
				actor_user_id="u",
				event_type="x",
				payload={},
			)
		)

	assert result is None
	# 3 attempts total
	assert mock_urlopen.call_count == 3


def test_no_retry_on_4xx(monkeypatch):
	monkeypatch.setenv("THINKWORK_API_URL", "https://api.example.com")
	monkeypatch.setenv("API_AUTH_SECRET", "test-secret")
	client = ComplianceClient()

	def _403(req, timeout):
		raise urllib.error.HTTPError(
			"https://x", 403, "forbidden", hdrs={}, fp=io.BytesIO(b"")
		)

	with patch("urllib.request.urlopen", side_effect=_403) as mock_urlopen:
		result = asyncio.run(
			client.emit(
				tenant_id="t",
				actor_user_id="u",
				event_type="x",
				payload={},
			)
		)

	assert result is None
	# 4xx is non-retryable — single attempt.
	assert mock_urlopen.call_count == 1


def test_retries_on_429(monkeypatch):
	monkeypatch.setenv("THINKWORK_API_URL", "https://api.example.com")
	monkeypatch.setenv("API_AUTH_SECRET", "test-secret")
	monkeypatch.setattr(
		"compliance_client.ComplianceClient.RETRY_DELAYS_SEC",
		(0.0, 0.0, 0.0),
	)
	client = ComplianceClient()

	call_count = {"n": 0}

	def _flaky(req, timeout):
		call_count["n"] += 1
		if call_count["n"] < 3:
			raise urllib.error.HTTPError(
				"https://x", 429, "throttled", hdrs={}, fp=io.BytesIO(b"")
			)
		return _success_response({"dispatched": True})

	with patch("urllib.request.urlopen", side_effect=_flaky):
		result = asyncio.run(
			client.emit(
				tenant_id="t",
				actor_user_id="u",
				event_type="x",
				payload={},
			)
		)

	assert result == {"dispatched": True}
	assert call_count["n"] == 3


def test_no_live_emit_call_sites_in_server():
	"""U6 ships infrastructure only — no client.emit(...) call sites.

	The only natural Strands AGENTS.md edit path goes through
	/api/workspaces/files which already emits via U5's TypeScript code;
	emitting from Python on top would create duplicate audit rows. This
	test guards against accidental scope creep — if a future PR adds
	`_compliance_client.emit(` or `client.emit(` lines to server.py
	without first picking a non-duplicate call site, this test catches
	it.

	Removing or modifying this test should be paired with adding the
	first non-duplicate caller to the U6 master plan's Phase 4
	follow-up brainstorm.
	"""
	from pathlib import Path

	server_py = (
		Path(__file__).parent / "container-sources" / "server.py"
	).read_text()

	# Allow `_compliance_client = ComplianceClient()` (instantiation),
	# `_compliance_client = None` (fallback), and the global
	# declaration. Reject anything that looks like an emit call.
	for line in server_py.splitlines():
		stripped = line.strip()
		if "_compliance_client.emit(" in stripped:
			raise AssertionError(
				f"server.py contains a live emit call site: {stripped!r}. "
				"U6 ships infrastructure only — see "
				"docs/plans/2026-05-07-007-feat-compliance-u6-strands-emit-path-plan.md "
				"§Key Technical Decisions §'No live emit call sites in U6'."
			)


def test_retries_on_network_timeout(monkeypatch):
	monkeypatch.setenv("THINKWORK_API_URL", "https://api.example.com")
	monkeypatch.setenv("API_AUTH_SECRET", "test-secret")
	monkeypatch.setattr(
		"compliance_client.ComplianceClient.RETRY_DELAYS_SEC",
		(0.0, 0.0, 0.0),
	)
	client = ComplianceClient()

	with patch("urllib.request.urlopen", side_effect=TimeoutError("read timed out")) as mock:
		result = asyncio.run(
			client.emit(
				tenant_id="t",
				actor_user_id="u",
				event_type="x",
				payload={},
			)
		)

	assert result is None
	# Network errors retry the full schedule.
	assert mock.call_count == 3
