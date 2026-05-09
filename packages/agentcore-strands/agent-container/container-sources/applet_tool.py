"""Strands tools for Computer-generated applets.

The v1 substrate lands these tools inert first. The factories snapshot runtime
configuration at construction time, then close over a seam function that U7
will swap from inert to live GraphQL calls.
"""

from __future__ import annotations

import inspect
import os
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

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


def _inert_save_app(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    return {
        "ok": False,
        "reason": "INERT_NOT_WIRED",
        "validated": False,
        "persisted": False,
        "errors": [],
    }


def _inert_load_app(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    return {
        "ok": False,
        "reason": "INERT_NOT_WIRED",
        "validated": False,
        "persisted": False,
        "errors": [],
    }


def _inert_list_apps(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    return {
        "ok": False,
        "reason": "INERT_NOT_WIRED",
        "applets": [],
        "errors": [],
    }


def get_save_app_for_test() -> Callable[..., Any]:
    return _inert_save_app


def get_load_app_for_test() -> Callable[..., Any]:
    return _inert_load_app


def get_list_apps_for_test() -> Callable[..., Any]:
    return _inert_list_apps


def make_save_app_fn(
    *,
    tenant_id: str,
    agent_id: str,
    computer_id: str,
    api_url: str,
    api_secret: str,
    seam_fn: Callable[..., Any] | None = None,
):
    runtime = _runtime_from_values(
        tenant_id=tenant_id,
        agent_id=agent_id,
        computer_id=computer_id,
        api_url=api_url,
        api_secret=api_secret,
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

        Use this after generating TSX applet source. Pass one or more source
        files, structured metadata, and an optional app_id. Omitting app_id
        creates a new applet; providing app_id regenerates that stable applet.
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
    seam_fn: Callable[..., Any] | None = None,
):
    runtime = _runtime_from_values(
        tenant_id=tenant_id,
        agent_id=agent_id,
        computer_id=computer_id,
        api_url=api_url,
        api_secret=api_secret,
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
    seam_fn: Callable[..., Any] | None = None,
):
    runtime = _runtime_from_values(
        tenant_id=tenant_id,
        agent_id=agent_id,
        computer_id=computer_id,
        api_url=api_url,
        api_secret=api_secret,
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


def _runtime_env() -> dict[str, str]:
    return {
        "tenant_id": os.environ.get("TENANT_ID") or os.environ.get("_MCP_TENANT_ID") or "",
        "agent_id": os.environ.get("AGENT_ID") or os.environ.get("_MCP_AGENT_ID") or "",
        "computer_id": os.environ.get("COMPUTER_ID") or "",
        "api_url": os.environ.get("THINKWORK_API_URL") or "",
        "api_secret": os.environ.get("API_AUTH_SECRET")
        or os.environ.get("THINKWORK_API_SECRET")
        or "",
    }


def _runtime_from_values(
    *,
    tenant_id: str,
    agent_id: str,
    computer_id: str,
    api_url: str,
    api_secret: str,
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
        raise ValueError(
            "applet tool runtime is missing required config: " + ", ".join(missing)
        )
    return AppletToolRuntime(
        tenant_id=tenant_id,
        agent_id=agent_id,
        computer_id=computer_id,
        api_url=api_url.rstrip("/"),
        api_secret=api_secret,
    )
