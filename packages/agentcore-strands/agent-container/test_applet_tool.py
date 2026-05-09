from __future__ import annotations

import asyncio
import os
import tempfile
from typing import Any

import _boot_assert as ba
import applet_tool
import httpx

RUNTIME = {
    "tenant_id": "tenant-A",
    "agent_id": "agent-1",
    "computer_id": "computer-1",
    "api_url": "https://api.example.test/",
    "api_secret": "secret",
}


def run(coro):
    return asyncio.run(coro)


def test_save_app_happy_path_calls_save_applet(monkeypatch):
    calls: list[dict[str, Any]] = []

    async def graphql(runtime, query, variables):
        calls.append({"runtime": runtime, "query": query, "variables": variables})
        return {
            "ok": True,
            "data": {
                "saveApplet": {
                    "ok": True,
                    "appId": "33333333-3333-4333-8333-333333333333",
                    "version": 1,
                    "validated": True,
                    "persisted": True,
                    "errors": [],
                }
            },
        }

    monkeypatch.setattr(applet_tool, "_graphql", graphql)
    save_app = applet_tool.make_save_app_fn(**RUNTIME)

    result = run(
        save_app(
            name="Pipeline Risk",
            files={"App.tsx": "export default function App() { return null; }"},
            metadata={"prompt": "pipeline"},
        )
    )

    assert result == {
        "ok": True,
        "appId": "33333333-3333-4333-8333-333333333333",
        "version": 1,
        "validated": True,
        "persisted": True,
        "errors": [],
    }
    assert "saveApplet" in calls[0]["query"]
    assert calls[0]["variables"] == {
        "input": {
            "name": "Pipeline Risk",
            "files": {"App.tsx": "export default function App() { return null; }"},
            "metadata": {"prompt": "pipeline"},
        }
    }
    assert calls[0]["runtime"].tenant_id == "tenant-A"


def test_save_app_adds_current_thread_metadata(monkeypatch):
    calls: list[dict[str, Any]] = []

    async def graphql(_runtime, _query, variables):
        calls.append({"variables": variables})
        return {
            "ok": True,
            "data": {
                "saveApplet": {
                    "ok": True,
                    "appId": "33333333-3333-4333-8333-333333333333",
                    "version": 1,
                    "validated": True,
                    "persisted": True,
                    "errors": [],
                }
            },
        }

    monkeypatch.setattr(applet_tool, "_graphql", graphql)
    save_app = applet_tool.make_save_app_fn(
        **RUNTIME,
        thread_id="thread-1",
        prompt="Build a CRM pipeline risk dashboard.",
    )

    result = run(
        save_app(
            name="Pipeline Risk",
            files={"App.tsx": "export default function App() { return null; }"},
            metadata={},
        )
    )

    assert result["ok"] is True
    assert calls[0]["variables"]["input"]["metadata"] == {
        "threadId": "thread-1",
        "prompt": "Build a CRM pipeline risk dashboard.",
    }


def test_save_app_with_app_id_calls_regenerate_applet(monkeypatch):
    calls: list[dict[str, Any]] = []

    async def graphql(_runtime, query, variables):
        calls.append({"query": query, "variables": variables})
        return {
            "ok": True,
            "data": {
                "regenerateApplet": {
                    "ok": True,
                    "appId": "33333333-3333-4333-8333-333333333333",
                    "version": 2,
                    "validated": True,
                    "persisted": True,
                    "errors": [],
                }
            },
        }

    monkeypatch.setattr(applet_tool, "_graphql", graphql)
    save_app = applet_tool.make_save_app_fn(**RUNTIME)

    result = run(
        save_app(
            name="Pipeline Risk",
            files={"App.tsx": "export default function App() { return null; }"},
            metadata={"prompt": "pipeline"},
            app_id="33333333-3333-4333-8333-333333333333",
        )
    )

    assert result["ok"] is True
    assert result["version"] == 2
    assert "regenerateApplet" in calls[0]["query"]
    assert calls[0]["variables"]["input"]["appId"] == ("33333333-3333-4333-8333-333333333333")


def test_save_app_returns_api_validation_errors_verbatim(monkeypatch):
    async def graphql(_runtime, _query, _variables):
        return {
            "ok": True,
            "data": {
                "saveApplet": {
                    "ok": False,
                    "appId": None,
                    "version": None,
                    "validated": False,
                    "persisted": False,
                    "errors": [
                        {
                            "code": "IMPORT_NOT_ALLOWED",
                            "message": "found lodash",
                        }
                    ],
                }
            },
        }

    monkeypatch.setattr(applet_tool, "_graphql", graphql)
    save_app = applet_tool.make_save_app_fn(**RUNTIME)

    result = run(save_app("Name", {"App.tsx": "import lodash from 'lodash';"}, {}))

    assert result["ok"] is False
    assert result["errors"][0]["code"] == "IMPORT_NOT_ALLOWED"
    assert result["persisted"] is False


def test_load_and_list_apps_call_graphql(monkeypatch):
    calls: list[dict[str, Any]] = []

    async def graphql(_runtime, query, variables):
        calls.append({"query": query, "variables": variables})
        if "query LoadApplet" in query:
            return {
                "ok": True,
                "data": {
                    "applet": {
                        "source": "export default null",
                        "files": {"App.tsx": "export default null"},
                        "metadata": {"prompt": "pipeline"},
                        "applet": {
                            "appId": "app-1",
                            "name": "Pipeline Risk",
                            "version": 1,
                        },
                    }
                },
            }
        return {
            "ok": True,
            "data": {
                "applets": {
                    "nodes": [{"appId": "app-1", "name": "Pipeline Risk"}],
                    "nextCursor": None,
                }
            },
        }

    monkeypatch.setattr(applet_tool, "_graphql", graphql)
    load_app = applet_tool.make_load_app_fn(**RUNTIME)
    list_apps = applet_tool.make_list_apps_fn(**RUNTIME)

    loaded = run(load_app("app-1"))
    listed = run(list_apps())

    assert loaded["ok"] is True
    assert loaded["applet"]["appId"] == "app-1"
    assert listed == {
        "ok": True,
        "applets": [{"appId": "app-1", "name": "Pipeline Risk"}],
        "nextCursor": None,
    }
    assert calls[0]["variables"] == {"appId": "app-1"}
    assert "query ListApplets" in calls[1]["query"]


def test_graphql_posts_service_headers(monkeypatch):
    captured: dict[str, Any] = {}

    class FakeResponse:
        status_code = 200
        text = '{"data": {"saveApplet": {"ok": true}}}'

        def json(self):
            return {"data": {"saveApplet": {"ok": True}}}

    class FakeAsyncClient:
        def __init__(self, *, timeout):
            captured["timeout"] = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, url, *, json, headers):
            captured["url"] = url
            captured["json"] = json
            captured["headers"] = headers
            return FakeResponse()

    monkeypatch.setattr(applet_tool.httpx, "AsyncClient", FakeAsyncClient)

    result = run(
        applet_tool._graphql(
            applet_tool.AppletToolRuntime(**RUNTIME),
            "query Test { _empty }",
            {"x": 1},
        )
    )

    assert result["ok"] is True
    assert captured["url"] == "https://api.example.test/graphql"
    assert captured["json"] == {
        "query": "query Test { _empty }",
        "variables": {"x": 1},
    }
    assert captured["headers"] == {
        "content-type": "application/json",
        "authorization": "Bearer secret",
        "x-tenant-id": "tenant-A",
        "x-agent-id": "agent-1",
        "x-computer-id": "computer-1",
    }


def test_graphql_maps_timeout_to_api_unavailable(monkeypatch):
    class TimeoutAsyncClient:
        def __init__(self, *, timeout):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, *_args, **_kwargs):
            raise httpx.TimeoutException("too slow")

    async def no_sleep(_seconds):
        return None

    monkeypatch.setattr(applet_tool.httpx, "AsyncClient", TimeoutAsyncClient)
    monkeypatch.setattr(applet_tool.asyncio, "sleep", no_sleep)

    result = run(
        applet_tool._graphql(
            applet_tool.AppletToolRuntime(**RUNTIME),
            "query Test { _empty }",
            {},
        )
    )

    assert result["ok"] is False
    assert result["reason"] == "API_UNAVAILABLE"
    assert result["persisted"] is False


def test_graphql_retries_server_errors(monkeypatch):
    attempts = 0

    class ServerErrorResponse:
        status_code = 502
        text = "bad gateway"

    class ServerErrorAsyncClient:
        def __init__(self, *, timeout):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, *_args, **_kwargs):
            nonlocal attempts
            attempts += 1
            return ServerErrorResponse()

    async def no_sleep(_seconds):
        return None

    monkeypatch.setattr(applet_tool.httpx, "AsyncClient", ServerErrorAsyncClient)
    monkeypatch.setattr(applet_tool.asyncio, "sleep", no_sleep)

    result = run(
        applet_tool._graphql(
            applet_tool.AppletToolRuntime(**RUNTIME),
            "query Test { _empty }",
            {},
        )
    )

    assert attempts == 3
    assert result["ok"] is False
    assert result["reason"] == "API_ERROR"
    assert "GraphQL HTTP 502" in result["errors"][0]["message"]


def test_factory_raises_when_required_env_is_missing():
    missing_computer = {**RUNTIME, "computer_id": ""}

    try:
        applet_tool.make_save_app_fn(**missing_computer)
    except ValueError as exc:
        assert "computer_id" in str(exc)
    else:
        raise AssertionError("expected missing config to raise")


def test_factories_snapshot_env_independently(monkeypatch):
    snapshots: list[tuple[str, str]] = []

    async def seam(**kwargs):
        runtime = kwargs["runtime"]
        snapshots.append((runtime.tenant_id, runtime.api_url))
        return {"ok": True}

    set_runtime_env(monkeypatch, tenant_id="tenant-A", api_url="https://a.example.test")
    save_a = applet_tool.make_save_app_fn(
        seam_fn=seam,
        **applet_tool._runtime_env(),
    )
    set_runtime_env(monkeypatch, tenant_id="tenant-B", api_url="https://b.example.test")
    save_b = applet_tool.make_save_app_fn(
        seam_fn=seam,
        **applet_tool._runtime_env(),
    )

    run(save_a("A", {}, {}))
    run(save_b("B", {}, {}))

    assert snapshots == [
        ("tenant-A", "https://a.example.test"),
        ("tenant-B", "https://b.example.test"),
    ]


def test_body_swap_forcing_functions_point_at_live_seams():
    assert applet_tool.get_save_app_for_test() is applet_tool._live_save_app
    assert applet_tool.get_load_app_for_test() is applet_tool._live_load_app
    assert applet_tool.get_list_apps_for_test() is applet_tool._live_list_apps


def test_boot_assert_lists_applet_tool():
    assert "applet_tool" in ba.EXPECTED_CONTAINER_SOURCES


def test_boot_assert_fires_when_applet_tool_is_missing():
    with tempfile.TemporaryDirectory() as app_dir:
        seed_boot_assert_dir(app_dir)
        os.remove(os.path.join(app_dir, "applet_tool.py"))

        try:
            ba.check(app_dir)
        except RuntimeError as exc:
            assert "applet_tool.py" in str(exc)
        else:
            raise AssertionError("expected boot assert to fail")


def set_runtime_env(
    monkeypatch,
    *,
    tenant_id: str = "tenant-A",
    agent_id: str = "agent-1",
    computer_id: str = "computer-1",
    api_url: str = "https://api.example.test",
    api_secret: str = "secret",
):
    monkeypatch.setenv("TENANT_ID", tenant_id)
    monkeypatch.setenv("AGENT_ID", agent_id)
    monkeypatch.setenv("COMPUTER_ID", computer_id)
    monkeypatch.setenv("THINKWORK_API_URL", api_url)
    monkeypatch.setenv("API_AUTH_SECRET", api_secret)


def seed_boot_assert_dir(app_dir: str) -> None:
    for mod in ba.EXPECTED_CONTAINER_SOURCES + ba.EXPECTED_SHARED:
        with open(os.path.join(app_dir, f"{mod}.py"), "w", encoding="utf-8") as handle:
            handle.write("# placeholder\n")
    os.makedirs(os.path.join(app_dir, "auth-agent"), exist_ok=True)
    for rel in ba.EXPECTED_AUTH_AGENT:
        full = os.path.join(app_dir, rel)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as handle:
            handle.write("# placeholder\n")
