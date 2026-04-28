"""GET client for ``/api/agents/runtime-config`` (the service-auth REST
endpoint introduced in plan §U1).

Used by ``run_skill_dispatch.dispatch_run_skill`` to pull the agent's
runtime config (template, skills, MCP, KBs, guardrail) so the dispatcher
can build a headless Strands agent turn with the same shape the chat
loop uses.

Read env at call time, not import — per ``project_agentcore_deploy_race_env``
warm containers can boot pre-env-injection during terraform-apply, and
we need to pick up the refreshed values on the first post-race call
rather than keep serving with blanks.

Retry semantics mirror ``run_skill_dispatch._urlopen_with_retry``:
  * 5xx + transient transport errors → retry with bounded backoff.
  * 4xx → terminal (404 becomes ``AgentConfigNotFoundError``; 401 +
    other 4xx raise ``RuntimeConfigFetchError`` with the code).
  * Retry budget exhausted → raise ``RuntimeConfigFetchError``.
"""

from __future__ import annotations

import json
import logging
import os
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

# Mirrors run_skill_dispatch._COMPLETE_RETRY_DELAYS — same 3-attempt
# retry budget + jitter so transient Aurora / API-gateway blips don't
# strand the dispatcher before the 15-min reconciler backstop kicks in.
_FETCH_RETRY_DELAYS = (1.0, 3.0, 9.0)
_FETCH_RETRY_JITTER = 0.5


class RuntimeConfigFetchError(RuntimeError):
    """Raised when the runtime-config fetch fails in a way the dispatcher
    must surface as a terminal ``skill_runs.failed`` row.

    ``reason`` is short enough to fit in skill_runs.failure_reason (500
    chars). ``code`` is the HTTP status if known, else None.
    """

    def __init__(self, reason: str, *, code: int | None = None) -> None:
        super().__init__(reason)
        self.code = code
        self.reason = reason


class AgentConfigNotFoundError(RuntimeConfigFetchError):
    """Specific 404 subclass — the agent was deleted between enqueue and
    dispatch, or the tenantId/agentId pair does not resolve. Dispatcher
    should write ``reason=`agent not found: <agentId>``` and bail."""

    def __init__(self, agent_id: str) -> None:
        super().__init__(f"agent not found: {agent_id}", code=404)
        self.agent_id = agent_id


def fetch(
    agent_id: str,
    tenant_id: str,
    *,
    current_user_id: str | None = None,
    current_user_email: str | None = None,
    api_url: str | None = None,
    api_secret: str | None = None,
    timeout: int = 15,
) -> dict[str, Any]:
    """GET ``/api/agents/runtime-config`` for ``tenantId=tenant_id`` +
    ``agentId=agent_id``. Returns the parsed JSON body on success.

    Args:
        agent_id, tenant_id: required query params (the endpoint enforces
            UUID shape and returns 400 on invalid input).
        current_user_id, current_user_email: optional invoker hints the
            helper forwards to the REST endpoint so it overlays
            ``CURRENT_USER_EMAIL`` on default-skill envOverrides.
        timeout: per-attempt urllib timeout. Total wall-clock budget is
            ~14s (timeout + 3 retries × mean-5s backoff) which fits well
            inside the 900s AgentCore Lambda ceiling.
    """
    api_url = api_url or os.environ.get("THINKWORK_API_URL") or ""
    api_secret = api_secret or (
        os.environ.get("API_AUTH_SECRET")
        or os.environ.get("THINKWORK_API_SECRET")
        or ""
    )
    if not api_url or not api_secret:
        raise RuntimeConfigFetchError(
            "missing THINKWORK_API_URL / API_AUTH_SECRET",
            code=None,
        )

    params: dict[str, str] = {"tenantId": tenant_id, "agentId": agent_id}
    if current_user_id:
        params["currentUserId"] = current_user_id
    if current_user_email:
        params["currentUserEmail"] = current_user_email
    url = (
        f"{api_url.rstrip('/')}/api/agents/runtime-config?"
        + urllib.parse.urlencode(params)
    )
    req = urllib.request.Request(
        url,
        method="GET",
        headers={"Authorization": f"Bearer {api_secret}"},
    )

    last_exc: Exception | None = None
    for attempt_idx, delay in enumerate((0.0, *_FETCH_RETRY_DELAYS), start=1):
        if delay:
            sleep_for = delay + random.uniform(
                -_FETCH_RETRY_JITTER, _FETCH_RETRY_JITTER
            )
            time.sleep(max(0.0, sleep_for))
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if resp.status != 200:
                    raise RuntimeConfigFetchError(
                        f"runtime-config returned HTTP {resp.status}",
                        code=resp.status,
                    )
                body_raw = resp.read().decode("utf-8", errors="replace")
                try:
                    return json.loads(body_raw)
                except json.JSONDecodeError as e:
                    raise RuntimeConfigFetchError(
                        f"runtime-config returned non-JSON body: {e.msg}",
                        code=None,
                    ) from e
        except urllib.error.HTTPError as e:
            if 400 <= e.code < 500:
                # Terminal. 404 = agent deleted; 401 = bad bearer; 400 =
                # invalid UUID (shouldn't happen — we control the caller).
                if e.code == 404:
                    raise AgentConfigNotFoundError(agent_id) from e
                try:
                    detail = e.read().decode("utf-8", errors="replace")
                except Exception:
                    detail = str(e)
                raise RuntimeConfigFetchError(
                    f"runtime-config fetch failed: HTTP {e.code}: {detail[:300]}",
                    code=e.code,
                ) from e
            # 5xx → retryable.
            logger.warning(
                "runtime-config attempt=%d HTTP %d retryable",
                attempt_idx, e.code,
            )
            last_exc = e
        except (TimeoutError, urllib.error.URLError) as e:
            logger.warning(
                "runtime-config attempt=%d transport error: %s",
                attempt_idx, e,
            )
            last_exc = e
    assert last_exc is not None
    logger.error(
        "runtime-config fetch exhausted %d attempts for agentId=%s",
        len(_FETCH_RETRY_DELAYS) + 1, agent_id,
    )
    raise RuntimeConfigFetchError(
        f"runtime-config fetch exhausted retries: {last_exc}",
        code=None,
    ) from last_exc
