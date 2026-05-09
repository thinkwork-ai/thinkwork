"""Strands tools for Computer-generated applets.

The v1 substrate lands these tools inert first. The factories snapshot runtime
configuration at construction time, then close over a seam function that U7
will swap from inert to live GraphQL calls.
"""

from __future__ import annotations

import asyncio
import inspect
import os
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx

try:
    from strands import tool
except ModuleNotFoundError:  # unit tests run without the full Strands runtime

    def tool(fn):
        return fn


@dataclass(frozen=True)
class AppletToolRuntime:
    tenant_id: str
    agent_id: str
    computer_id: str
    api_url: str
    api_secret: str
    thread_id: str = ""
    prompt: str = ""


SAVE_APP_MUTATION = """
mutation SaveApplet($input: SaveAppletInput!) {
  saveApplet(input: $input) {
    ok
    appId
    version
    validated
    persisted
    errors
  }
}
"""

REGENERATE_APPLET_MUTATION = """
mutation RegenerateApplet($input: SaveAppletInput!) {
  regenerateApplet(input: $input) {
    ok
    appId
    version
    validated
    persisted
    errors
  }
}
"""

LOAD_APPLET_QUERY = """
query LoadApplet($appId: ID!) {
  applet(appId: $appId) {
    source
    files
    metadata
    applet {
      appId
      name
      version
      tenantId
      threadId
      prompt
      agentVersion
      modelId
      generatedAt
      stdlibVersionAtGeneration
    }
  }
}
"""

LIST_APPLETS_QUERY = """
query ListApplets {
  applets {
    nodes {
      appId
      name
      version
      tenantId
      threadId
      prompt
      agentVersion
      modelId
      generatedAt
      stdlibVersionAtGeneration
    }
    nextCursor
  }
}
"""


async def _live_save_app(
    *,
    runtime: AppletToolRuntime,
    name: str,
    files: dict[str, str],
    metadata: dict[str, Any],
    app_id: str | None = None,
) -> dict[str, Any]:
    mutation_name = "regenerateApplet" if app_id else "saveApplet"
    query = REGENERATE_APPLET_MUTATION if app_id else SAVE_APP_MUTATION
    metadata_payload = dict(metadata) if isinstance(metadata, dict) else {}
    if runtime.thread_id and not metadata_payload.get("threadId"):
        metadata_payload["threadId"] = runtime.thread_id
    if runtime.prompt and not metadata_payload.get("prompt"):
        metadata_payload["prompt"] = runtime.prompt
    input_payload: dict[str, Any] = {
        "name": name,
        "files": files,
        "metadata": metadata_payload,
    }
    if app_id:
        input_payload["appId"] = app_id

    data = await _graphql(runtime, query, {"input": input_payload})
    if not data.get("ok"):
        return data
    payload = data.get("data", {}).get(mutation_name)
    if isinstance(payload, dict):
        return payload
    return {
        "ok": False,
        "reason": "INVALID_APPLET_API_RESPONSE",
        "validated": False,
        "persisted": False,
        "errors": [{"message": f"GraphQL response omitted {mutation_name}"}],
    }


async def _live_load_app(
    *,
    runtime: AppletToolRuntime,
    app_id: str,
) -> dict[str, Any]:
    data = await _graphql(runtime, LOAD_APPLET_QUERY, {"appId": app_id})
    if not data.get("ok"):
        return data
    payload = data.get("data", {}).get("applet")
    if isinstance(payload, dict):
        return {"ok": True, **payload}
    return {
        "ok": False,
        "reason": "NOT_FOUND",
        "errors": [{"message": f"Applet {app_id} was not found"}],
    }


async def _live_list_apps(*, runtime: AppletToolRuntime) -> dict[str, Any]:
    data = await _graphql(runtime, LIST_APPLETS_QUERY, {})
    if not data.get("ok"):
        return data
    payload = data.get("data", {}).get("applets")
    if isinstance(payload, dict):
        return {
            "ok": True,
            "applets": payload.get("nodes") or [],
            "nextCursor": payload.get("nextCursor"),
        }
    return {
        "ok": False,
        "reason": "INVALID_APPLET_API_RESPONSE",
        "applets": [],
        "errors": [{"message": "GraphQL response omitted applets"}],
    }


def get_save_app_for_test() -> Callable[..., Any]:
    return _live_save_app


def get_load_app_for_test() -> Callable[..., Any]:
    return _live_load_app


def get_list_apps_for_test() -> Callable[..., Any]:
    return _live_list_apps


def make_save_app_fn(
    *,
    tenant_id: str,
    agent_id: str,
    computer_id: str,
    api_url: str,
    api_secret: str,
    thread_id: str = "",
    prompt: str = "",
    seam_fn: Callable[..., Any] | None = None,
):
    runtime = _runtime_from_values(
        tenant_id=tenant_id,
        agent_id=agent_id,
        computer_id=computer_id,
        api_url=api_url,
        api_secret=api_secret,
        thread_id=thread_id,
        prompt=prompt,
    )
    seam = seam_fn or get_save_app_for_test()

    @tool
    async def save_app(
        name: str,
        files: dict[str, str],
        metadata: dict[str, Any],
        app_id: str | None = None,
    ) -> dict[str, Any]:
        """Save or regenerate a Computer applet.

        Use this after generating TSX applet source. For Computer requests to
        build or create an app, applet, dashboard, briefing, report, or other
        interactive work surface, do not stop at a prose answer: generate a
        runnable applet and call save_app before responding. Pass one or more
        source files, structured metadata, and an optional app_id. Omitting
        app_id creates a new applet; providing app_id regenerates that stable
        applet. Include a deterministic refresh() export in the TSX source
        whenever the result should be refreshable.
        """

        return await _call_seam(
            seam,
            runtime=runtime,
            name=name,
            files=files,
            metadata=metadata,
            app_id=app_id,
        )

    return save_app


def make_load_app_fn(
    *,
    tenant_id: str,
    agent_id: str,
    computer_id: str,
    api_url: str,
    api_secret: str,
    thread_id: str = "",
    prompt: str = "",
    seam_fn: Callable[..., Any] | None = None,
):
    runtime = _runtime_from_values(
        tenant_id=tenant_id,
        agent_id=agent_id,
        computer_id=computer_id,
        api_url=api_url,
        api_secret=api_secret,
        thread_id=thread_id,
        prompt=prompt,
    )
    seam = seam_fn or get_load_app_for_test()

    @tool
    async def load_app(app_id: str) -> dict[str, Any]:
        """Load a previously saved applet by app_id."""

        return await _call_seam(seam, runtime=runtime, app_id=app_id)

    return load_app


def make_list_apps_fn(
    *,
    tenant_id: str,
    agent_id: str,
    computer_id: str,
    api_url: str,
    api_secret: str,
    thread_id: str = "",
    prompt: str = "",
    seam_fn: Callable[..., Any] | None = None,
):
    runtime = _runtime_from_values(
        tenant_id=tenant_id,
        agent_id=agent_id,
        computer_id=computer_id,
        api_url=api_url,
        api_secret=api_secret,
        thread_id=thread_id,
        prompt=prompt,
    )
    seam = seam_fn or get_list_apps_for_test()

    @tool
    async def list_apps() -> dict[str, Any]:
        """List applets generated for the current Computer context."""

        return await _call_seam(seam, runtime=runtime)

    return list_apps


def make_save_app_from_env():
    values = _runtime_env()
    return make_save_app_fn(**values)


def make_load_app_from_env():
    values = _runtime_env()
    return make_load_app_fn(**values)


def make_list_apps_from_env():
    values = _runtime_env()
    return make_list_apps_fn(**values)


async def _call_seam(seam: Callable[..., Any], **kwargs: Any) -> dict[str, Any]:
    result = seam(**kwargs)
    if inspect.isawaitable(result):
        result = await result
    if not isinstance(result, dict):
        return {
            "ok": False,
            "reason": "INVALID_APPLET_TOOL_RESULT",
            "errors": [{"message": "Applet tool seam returned a non-object result"}],
        }
    return result


async def _graphql(
    runtime: AppletToolRuntime,
    query: str,
    variables: dict[str, Any],
    *,
    timeout_s: float = 30.0,
) -> dict[str, Any]:
    endpoint = _graphql_endpoint(runtime.api_url)
    last_err: Exception | None = None

    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=timeout_s) as client:
                response = await client.post(
                    endpoint,
                    json={"query": query, "variables": variables},
                    headers={
                        "content-type": "application/json",
                        "authorization": f"Bearer {runtime.api_secret}",
                        "x-tenant-id": runtime.tenant_id,
                        "x-agent-id": runtime.agent_id,
                        "x-computer-id": runtime.computer_id,
                    },
                )
            if response.status_code >= 500:
                last_err = RuntimeError(
                    f"GraphQL HTTP {response.status_code}: {response.text[:200]}"
                )
            elif response.status_code >= 400:
                return _api_failure(
                    "API_ERROR",
                    f"GraphQL HTTP {response.status_code}: {response.text[:200]}",
                )
            else:
                payload = response.json()
                errors = payload.get("errors")
                if errors:
                    return {
                        "ok": False,
                        "reason": "GRAPHQL_ERROR",
                        "validated": False,
                        "persisted": False,
                        "errors": errors,
                    }
                data = payload.get("data")
                if isinstance(data, dict):
                    return {"ok": True, "data": data}
                return _api_failure(
                    "INVALID_APPLET_API_RESPONSE",
                    "GraphQL response did not include a data object",
                )
        except httpx.TimeoutException as err:
            last_err = err
            if attempt == 2:
                return _api_failure("API_UNAVAILABLE", "Applet API request timed out")
        except Exception as err:
            last_err = err
            if attempt == 2:
                return _api_failure("API_UNAVAILABLE", str(err))

        if attempt < 2:
            await asyncio.sleep(1.0 * (2**attempt))

    return _api_failure("API_ERROR", str(last_err))


def _graphql_endpoint(api_url: str) -> str:
    normalized = api_url.rstrip("/")
    if normalized.endswith("/graphql"):
        return normalized
    return normalized + "/graphql"


def _api_failure(reason: str, message: str) -> dict[str, Any]:
    return {
        "ok": False,
        "reason": reason,
        "validated": False,
        "persisted": False,
        "errors": [{"message": message}],
    }


def _runtime_env() -> dict[str, str]:
    return {
        "tenant_id": os.environ.get("TENANT_ID") or os.environ.get("_MCP_TENANT_ID") or "",
        "agent_id": os.environ.get("AGENT_ID") or os.environ.get("_MCP_AGENT_ID") or "",
        "computer_id": os.environ.get("COMPUTER_ID") or "",
        "api_url": os.environ.get("THINKWORK_API_URL") or "",
        "api_secret": os.environ.get("API_AUTH_SECRET")
        or os.environ.get("THINKWORK_API_SECRET")
        or "",
        "thread_id": os.environ.get("COMPUTER_THREAD_ID") or "",
        "prompt": os.environ.get("COMPUTER_TURN_PROMPT") or "",
    }


def _runtime_from_values(
    *,
    tenant_id: str,
    agent_id: str,
    computer_id: str,
    api_url: str,
    api_secret: str,
    thread_id: str = "",
    prompt: str = "",
) -> AppletToolRuntime:
    values = {
        "tenant_id": tenant_id,
        "agent_id": agent_id,
        "computer_id": computer_id,
        "api_url": api_url,
        "api_secret": api_secret,
    }
    missing = sorted(name for name, value in values.items() if not value)
    if missing:
        raise ValueError("applet tool runtime is missing required config: " + ", ".join(missing))
    return AppletToolRuntime(
        tenant_id=tenant_id,
        agent_id=agent_id,
        computer_id=computer_id,
        api_url=api_url.rstrip("/"),
        api_secret=api_secret,
        thread_id=thread_id,
        prompt=prompt,
    )
