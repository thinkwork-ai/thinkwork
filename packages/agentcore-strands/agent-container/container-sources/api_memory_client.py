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


def retain_turn_pair(
	thread_id: str,
	user_message: str,
	assistant_response: str,
	tenant_id: Optional[str] = None,
	agent_id: Optional[str] = None,
) -> bool:
	"""DEPRECATED: per-message retain — replaced by ``retain_full_thread``.

	Kept until U3's call-site swap lands so the chat handler can fall back
	if the new path is rolled back. Will be deleted once U3 ships and the
	dev smoke confirms the new shape.

	Returns False on any failure; never raises.
	"""
	fn_name = os.environ.get("MEMORY_RETAIN_FN_NAME", "")
	if not fn_name:
		logger.debug("retain_turn_pair skipped: MEMORY_RETAIN_FN_NAME unset")
		return False
	if not thread_id:
		return False

	tenant = tenant_id or os.environ.get("TENANT_ID") or os.environ.get("_MCP_TENANT_ID") or ""
	agent = agent_id or os.environ.get("_ASSISTANT_ID", "")
	if not tenant or not agent:
		logger.debug("retain_turn_pair skipped: tenant/agent unset")
		return False

	messages: List[dict] = []
	if user_message and user_message.strip():
		messages.append({"role": "user", "content": user_message})
	if assistant_response and assistant_response.strip():
		messages.append({"role": "assistant", "content": assistant_response})
	if not messages:
		return False

	payload = {
		"tenantId": tenant,
		"agentId": agent,
		"threadId": thread_id,
		"messages": messages,
	}

	try:
		client = _get_client()
		client.invoke(
			FunctionName=fn_name,
			InvocationType="Event",
			Payload=json.dumps(payload).encode("utf-8"),
		)
		logger.info(
			"api_memory_client.retain_turn_pair thread=%s agent=%s user_len=%d asst_len=%d",
			thread_id,
			agent,
			len(user_message or ""),
			len(assistant_response or ""),
		)
		return True
	except Exception as e:
		logger.warning("api_memory_client.retain_turn_pair failed thread=%s: %s", thread_id, e)
		return False


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
