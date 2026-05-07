"""Compliance audit-event emit client (U6).

Cross-runtime emit path from the Strands Python runtime to the
TypeScript api Lambda's ``POST /api/compliance/events`` endpoint. The
runtime authenticates via ``API_AUTH_SECRET`` and posts events that
land in ``compliance.audit_outbox`` alongside U5's in-process
TypeScript emits — same drainer (U4), same per-tenant hash chain.

Idempotency: every emit carries a client-supplied UUIDv7 ``event_id``.
Retries (3 attempts, exponential backoff) reuse the same id, so the
server-side ``audit_outbox.uq_audit_outbox_event_id`` constraint
makes replays no-ops at the DB layer.

Failure semantics: telemetry tier from the runtime's perspective. If
the entire round-trip fails after retries, the client logs and
returns ``None``; the agent action proceeds. Audit row loss in
adverse audit-DB conditions is the documented Type 1 limitation.

Env: snapshots ``THINKWORK_API_URL`` + ``API_AUTH_SECRET`` at
``__init__`` time per feedback_completion_callback_snapshot_pattern.
Re-reads inside the retry loop are forbidden; instance attrs are the
source of truth across the agent turn.

Thread-safe: no shared mutable state; each ``emit()`` call constructs
its own ``Request`` and runs in a fresh executor thread.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import secrets
import time
import urllib.error
import urllib.request
from typing import Any, Optional

logger = logging.getLogger(__name__)


# ── UUIDv7 helper (RFC 9562) ────────────────────────────────────────────
#
# packages/agentcore-strands/pyproject.toml does not include
# uuid_extensions, so we ship a minimal stdlib implementation. The
# format: 48-bit big-endian Unix timestamp in milliseconds, then 4-bit
# version (0x7), 12-bit random, 2-bit variant (0b10), 62-bit random.
# Total 128 bits, formatted as the canonical 8-4-4-4-12 hex string.


def _uuidv7() -> str:
	"""Return a fresh UUIDv7 string per RFC 9562.

	Used for ``event_id`` in compliance emits so retries dedup at the
	server's unique constraint and the chain-head ordering invariant
	(``recorded_at, event_id``) holds across cross-runtime emits.
	"""
	ts_ms = int(time.time() * 1000) & 0xFFFFFFFFFFFF  # 48 bits
	rand_a = secrets.randbits(12)  # 12 random bits, joined with version
	rand_b = secrets.randbits(62)  # 62 random bits, joined with variant
	# Version 7 in the high nibble of byte 6 (bits 48..51 of the 16-byte int)
	ver_and_rand_a = (0x7 << 12) | rand_a
	# Variant 0b10 in the top bits of byte 8 (bits 64..65)
	var_and_rand_b = (0b10 << 62) | rand_b
	value = (ts_ms << 80) | (ver_and_rand_a << 64) | var_and_rand_b
	hex_str = f"{value:032x}"
	return f"{hex_str[0:8]}-{hex_str[8:12]}-{hex_str[12:16]}-{hex_str[16:20]}-{hex_str[20:32]}"


# ── Compliance client ───────────────────────────────────────────────────


class ComplianceClient:
	"""POST audit events to the TS api Lambda's /api/compliance/events.

	Telemetry tier — failures log and return ``None``; agent actions are
	never blocked. Construct once at server startup and reuse across
	agent turns; ``__init__`` snapshots env so botocore / Strands
	can't transiently shadow ``THINKWORK_API_URL`` or ``API_AUTH_SECRET``
	mid-turn.

	When either env var is unset (dev stages without the secret wired),
	the client sets ``disabled = True`` and ``emit()`` returns ``None``
	immediately without making a network call. This mirrors the
	existing ``_log_invocation`` template's dev-stage fallback.
	"""

	# 3 attempts with exponential backoff (0.5s, 1.0s, 2.0s) — total
	# worst-case wait ~3.5s on full transient failure. Per-request
	# timeout is 3 seconds (matches the existing _log_invocation
	# template at server.py:993).
	RETRY_DELAYS_SEC = (0.5, 1.0, 2.0)
	REQUEST_TIMEOUT_SEC = 3.0

	def __init__(self) -> None:
		# Snapshot once at coroutine entry — never re-read inside emit().
		self._api_url: str = (os.environ.get("THINKWORK_API_URL") or "").rstrip("/")
		self._api_secret: str = os.environ.get("API_AUTH_SECRET") or ""
		self.disabled: bool = not (self._api_url and self._api_secret)
		logger.info(
			"compliance.client_initialized disabled=%s api_url_set=%s secret_set=%s",
			self.disabled,
			bool(self._api_url),
			bool(self._api_secret),
		)

	async def emit(
		self,
		*,
		tenant_id: str,
		actor_user_id: str,
		event_type: str,
		payload: dict[str, Any],
		actor_type: str = "user",
		source: str = "strands",
		occurred_at: Optional[str] = None,
		request_id: Optional[str] = None,
		thread_id: Optional[str] = None,
		agent_id: Optional[str] = None,
		resource_type: Optional[str] = None,
		resource_id: Optional[str] = None,
		action: Optional[str] = None,
		outcome: Optional[str] = None,
		control_ids: Optional[list[str]] = None,
		event_id: Optional[str] = None,
	) -> Optional[dict[str, Any]]:
		"""POST one compliance audit event.

		Returns the parsed response dict on success
		(``{dispatched, idempotent, eventId, outboxId, redactedFields}``)
		or ``None`` on any suppressed failure (retries exhausted, env
		unset, network timeout, 5xx). Caller MUST NOT block on the
		return value — emit failures are telemetry-tier.

		``event_id`` is generated as a UUIDv7 if the caller doesn't
		supply one. Caller-supplied event_ids must already be UUIDv7;
		the server validates the shape and rejects 400 on mismatch.
		"""
		if self.disabled:
			return None
		if not tenant_id or not actor_user_id:
			logger.warning(
				"compliance.emit skipped: tenant_id=%r actor_user_id=%r",
				tenant_id,
				actor_user_id,
			)
			return None

		eid = event_id or _uuidv7()
		# snake_case (Python convention) → camelCase (HTTP API
		# convention). Done at this boundary so call sites stay
		# Pythonic. The TS handler validates these names.
		body: dict[str, Any] = {
			"event_id": eid,
			"tenantId": tenant_id,
			"actorUserId": actor_user_id,
			"actorType": actor_type,
			"eventType": event_type,
			"source": source,
			"payload": payload,
		}
		if occurred_at is not None:
			body["occurredAt"] = occurred_at
		if request_id is not None:
			body["requestId"] = request_id
		if thread_id is not None:
			body["threadId"] = thread_id
		if agent_id is not None:
			body["agentId"] = agent_id
		if resource_type is not None:
			body["resourceType"] = resource_type
		if resource_id is not None:
			body["resourceId"] = resource_id
		if action is not None:
			body["action"] = action
		if outcome is not None:
			body["outcome"] = outcome
		if control_ids is not None:
			body["controlIds"] = control_ids

		# Snapshot for closure — never read self.* inside the retry loop.
		api_url = self._api_url
		api_secret = self._api_secret

		def _do_post() -> tuple[bool, Optional[dict[str, Any]], Optional[Exception]]:
			"""Single attempt; returns (should_retry, response_dict, error).

			should_retry is True only on 5xx / 429 / network errors.
			Any 4xx is a permanent client bug and breaks out.
			"""
			data = json.dumps(body).encode("utf-8")
			req = urllib.request.Request(
				f"{api_url}/api/compliance/events",
				data=data,
				headers={
					"Content-Type": "application/json",
					"Authorization": f"Bearer {api_secret}",
					"Idempotency-Key": eid,
				},
				method="POST",
			)
			try:
				with urllib.request.urlopen(
					req, timeout=ComplianceClient.REQUEST_TIMEOUT_SEC
				) as resp:
					return False, json.loads(resp.read().decode("utf-8")), None
			except urllib.error.HTTPError as http_err:
				status = http_err.code
				retryable = status >= 500 or status == 429
				return retryable, None, http_err
			except (urllib.error.URLError, TimeoutError) as net_err:
				# Network-level failures (DNS, TCP, timeout) are
				# always retryable — the caller didn't even reach
				# the server.
				return True, None, net_err
			except Exception as exc:  # noqa: BLE001
				# Unexpected non-network error — don't retry, surface
				# to log via the outer exception path.
				return False, None, exc

		loop = asyncio.get_event_loop()
		last_err: Optional[Exception] = None

		for attempt, delay in enumerate(self.RETRY_DELAYS_SEC):
			try:
				retryable, result, err = await loop.run_in_executor(None, _do_post)
			except Exception as exc:  # noqa: BLE001 — defensive
				last_err = exc
				retryable = False
				result = None
				err = exc

			if result is not None:
				if attempt > 0:
					logger.info(
						"compliance.emit succeeded after %d retries event_id=%s",
						attempt,
						eid,
					)
				return result

			last_err = err
			if not retryable:
				logger.warning(
					"compliance.emit failed (no retry) event_id=%s err=%s",
					eid,
					last_err,
				)
				return None

			# More attempts left — sleep before the next retry. The
			# final iteration's delay is the wait BEFORE giving up,
			# so we still sleep on attempt = len(RETRY_DELAYS_SEC) - 1
			# to honor the documented backoff schedule.
			if attempt < len(self.RETRY_DELAYS_SEC) - 1:
				await asyncio.sleep(delay)

		logger.warning(
			"compliance.emit retries exhausted event_id=%s last_err=%s",
			eid,
			last_err,
		)
		return None
