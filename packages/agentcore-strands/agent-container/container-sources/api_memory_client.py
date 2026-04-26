"""Bridge from the Strands runtime container into the API's normalized
memory layer.

The runtime pushes user-scoped conversation and daily-memory retain
requests into the ``memory-retain`` Lambda. The Lambda owns engine-specific
dispatch, so the runtime stays engine-agnostic.
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
	"""Async-invoke the memory-retain Lambda with one user + assistant pair.

	Returns False on any failure; never raises. Memory retention must
	never break the chat path.
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
			InvocationType="Event",  # async, fire-and-forget
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


def retain_conversation(
	thread_id: str,
	transcript: Sequence[dict],
	tenant_id: Optional[str] = None,
	user_id: Optional[str] = None,
) -> bool:
	"""Invoke memory-retain with one replaceable conversation document."""
	fn_name = os.environ.get("MEMORY_RETAIN_FN_NAME", "")
	if not fn_name or not thread_id:
		return False
	tenant = tenant_id or os.environ.get("TENANT_ID") or os.environ.get("_MCP_TENANT_ID") or ""
	user = user_id or os.environ.get("USER_ID") or os.environ.get("CURRENT_USER_ID") or ""
	if not tenant or not user:
		logger.warning("retain_conversation skipped: tenant/user unset")
		return False

	payload = {
		"tenantId": tenant,
		"userId": user,
		"threadId": thread_id,
		"transcript": list(transcript),
	}
	return _invoke_request_response(fn_name, payload, "retain_conversation", thread_id)


def retain_daily(
	date: str,
	content: str,
	tenant_id: Optional[str] = None,
	user_id: Optional[str] = None,
) -> bool:
	"""Invoke memory-retain with one replaceable daily-memory document."""
	fn_name = os.environ.get("MEMORY_RETAIN_FN_NAME", "")
	if not fn_name or not date or not content.strip():
		return False
	tenant = tenant_id or os.environ.get("TENANT_ID") or os.environ.get("_MCP_TENANT_ID") or ""
	user = user_id or os.environ.get("USER_ID") or os.environ.get("CURRENT_USER_ID") or ""
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
	return _invoke_request_response(fn_name, payload, "retain_daily", date)


def _invoke_request_response(fn_name: str, payload: dict, action: str, ref: str) -> bool:
	try:
		client = _get_client()
		resp = client.invoke(
			FunctionName=fn_name,
			InvocationType="RequestResponse",
			Payload=json.dumps(payload).encode("utf-8"),
		)
		body = resp.get("Payload").read().decode("utf-8") if resp.get("Payload") else "{}"
		parsed = json.loads(body) if body else {}
		ok = bool(parsed.get("ok"))
		if not ok:
			logger.warning("api_memory_client.%s failed ref=%s response=%s", action, ref, parsed)
			return False
		logger.info("api_memory_client.%s ok ref=%s", action, ref)
		return True
	except Exception as e:
		logger.warning("api_memory_client.%s failed ref=%s: %s", action, ref, e)
		return False
