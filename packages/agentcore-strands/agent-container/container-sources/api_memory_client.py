"""Bridge from the Strands runtime container into the API's normalized
memory layer.

The runtime pushes user-scoped conversation and daily-memory retain
requests into the ``memory-retain`` Lambda. The Lambda owns engine-specific
dispatch, so the runtime stays engine-agnostic.

All retain calls are fire-and-forget (``InvocationType="Event"``) so the
agent response path is never blocked on Hindsight extraction. Failures
are logged at WARN level and never raise — memory retention must not
break the chat path.
"""

from __future__ import annotations

import json
import logging
import os
from typing import List, Optional, Sequence

logger = logging.getLogger(__name__)

_lambda_client = None


def _get_client():
	global _lambda_client
	if _lambda_client is None:
		import boto3  # boto3 is already pulled in by the runtime container
		_lambda_client = boto3.client("lambda", region_name=os.environ.get("AWS_REGION", "us-east-1"))
	return _lambda_client


def retain_full_thread(
	thread_id: str,
	transcript: Sequence[dict],
	tenant_id: Optional[str] = None,
	user_id: Optional[str] = None,
) -> bool:
	"""Fire-and-forget invoke ``memory-retain`` with a full thread transcript.

	The Lambda will fetch the canonical transcript from the messages table
	and merge with the supplied tail (longest-suffix-prefix overlap) before
	calling ``retainConversation`` on the adapter. The resulting Hindsight
	document is keyed by ``threadId`` with ``update_mode="replace"``.

	Returns False on any precondition or invoke failure; never raises.
	The chat handler must not block on this — it is a side effect, not
	the response path.
	"""
	# Snapshot env at entry per feedback_completion_callback_snapshot_pattern.
	# botocore / Strands can transiently shadow these vars mid-turn; the
	# snapshot is the source of truth from this point forward.
	fn_name = os.environ.get("MEMORY_RETAIN_FN_NAME", "")
	tenant = tenant_id or os.environ.get("TENANT_ID") or os.environ.get("_MCP_TENANT_ID") or ""
	user = user_id or os.environ.get("USER_ID") or os.environ.get("CURRENT_USER_ID") or ""

	if not fn_name:
		logger.debug("retain_full_thread skipped: MEMORY_RETAIN_FN_NAME unset")
		return False
	if not thread_id:
		return False
	if not tenant or not user:
		logger.debug("retain_full_thread skipped: tenant/user unset")
		return False

	transcript_list = list(transcript)
	if not transcript_list:
		return False

	payload = {
		"tenantId": tenant,
		"userId": user,
		"threadId": thread_id,
		"transcript": transcript_list,
	}

	try:
		client = _get_client()
		client.invoke(
			FunctionName=fn_name,
			InvocationType="Event",
			Payload=json.dumps(payload).encode("utf-8"),
		)
		logger.info(
			"api_memory_client.retain_full_thread thread=%s user=%s entries=%d",
			thread_id,
			user[:8] if user else "",
			len(transcript_list),
		)
		return True
	except Exception as e:
		logger.warning("api_memory_client.retain_full_thread failed thread=%s: %s", thread_id, e)
		return False


def retain_daily(
	date: str,
	content: str,
	tenant_id: Optional[str] = None,
	user_id: Optional[str] = None,
) -> bool:
	"""Fire-and-forget invoke ``memory-retain`` with a daily-memory document.

	Uses ``InvocationType="Event"`` so the rollover hook never blocks the
	turn. The Lambda routes to ``retainDailyMemory`` on the adapter, which
	writes a Hindsight document keyed by ``workspace_daily:<userId>:<date>``.
	"""
	fn_name = os.environ.get("MEMORY_RETAIN_FN_NAME", "")
	tenant = tenant_id or os.environ.get("TENANT_ID") or os.environ.get("_MCP_TENANT_ID") or ""
	user = user_id or os.environ.get("USER_ID") or os.environ.get("CURRENT_USER_ID") or ""

	if not fn_name or not date or not content.strip():
		return False
	if not tenant or not user:
		logger.warning("retain_daily skipped: tenant/user unset")
		return False

	payload = {
		"tenantId": tenant,
		"userId": user,
		"kind": "daily",
		"date": date,
		"content": content,
	}

	try:
		client = _get_client()
		client.invoke(
			FunctionName=fn_name,
			InvocationType="Event",
			Payload=json.dumps(payload).encode("utf-8"),
		)
		logger.info("api_memory_client.retain_daily ok date=%s user=%s", date, user[:8] if user else "")
		return True
	except Exception as e:
		logger.warning("api_memory_client.retain_daily failed date=%s: %s", date, e)
		return False
