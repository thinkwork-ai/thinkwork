from __future__ import annotations

import asyncio
import os
import tempfile

import _boot_assert as ba
import applet_tool

RUNTIME = {
    "tenant_id": "tenant-A",
    "agent_id": "agent-1",
    "computer_id": "computer-1",
    "api_url": "https://api.example.test/",
    "api_secret": "secret",
}


def run(coro):
    return asyncio.run(coro)


def test_save_app_happy_path_delegates_to_seam():
    async def seam(**kwargs):
        return {
            "ok": True,
            "appId": "app-1",
            "version": 1,
            "validated": True,
            "persisted": True,
            "tenantId": kwargs["runtime"].tenant_id,
            "appIdInput": kwargs["app_id"],
        }

    save_app = applet_tool.make_save_app_fn(**RUNTIME, seam_fn=seam)

    result = run(
        save_app(
            name="Pipeline Risk",
            files={"App.tsx": "export default function App() { return null; }"},
            metadata={"prompt": "pipeline"},
            app_id="app-existing",
        )
    )

    assert result["ok"] is True
    assert result["tenantId"] == "tenant-A"
    assert result["appIdInput"] == "app-existing"


def test_make_save_app_from_env_returns_inert_tool(monkeypatch):
    set_runtime_env(monkeypatch)

    save_app = applet_tool.make_save_app_from_env()
    result = run(save_app("Name", {"App.tsx": "export default null"}, {}))

    assert result == {
        "ok": False,
        "reason": "INERT_NOT_WIRED",
        "validated": False,
        "persisted": False,
        "errors": [],
    }


def test_load_and_list_from_env_return_inert_payloads(monkeypatch):
    set_runtime_env(monkeypatch)

    load_app = applet_tool.make_load_app_from_env()
    list_apps = applet_tool.make_list_apps_from_env()

    assert run(load_app("app-1"))["reason"] == "INERT_NOT_WIRED"
    assert run(list_apps()) == {
        "ok": False,
        "reason": "INERT_NOT_WIRED",
        "applets": [],
        "errors": [],
    }


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


def test_inert_save_app_returns_not_wired_regardless_of_input(monkeypatch):
    set_runtime_env(monkeypatch)
    save_app = applet_tool.make_save_app_from_env()

    result = run(save_app("", {}, {}, app_id=None))

    assert result["ok"] is False
    assert result["reason"] == "INERT_NOT_WIRED"
    assert result["validated"] is False
    assert result["persisted"] is False


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


def test_body_swap_forcing_functions_point_at_inert_seams():
    assert applet_tool.get_save_app_for_test() is applet_tool._inert_save_app
    assert applet_tool.get_load_app_for_test() is applet_tool._inert_load_app
    assert applet_tool.get_list_apps_for_test() is applet_tool._inert_list_apps


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
