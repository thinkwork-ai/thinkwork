"""Bridge from the Strands runtime container into the API's normalized
memory layer.

After every chat turn the runtime calls :func:`retain_turn_pair` to push
the user + assistant messages into long-term memory via the
``memory-retain`` Lambda. That Lambda runs ``adapter.retainTurn()`` on
whichever engine is active (Hindsight or AgentCore), so the runtime stays
engine-agnostic.

The invoke is fire-and-forget (``InvocationType=Event``) — chat turns
must never block on memory retention, and any failure is logged and
swallowed.
"""

from __future__ import annotations

import json
import logging
import os
from typing import List, Optional

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
