"""Unit tests for dispatch.py.

Mocks urllib.request.urlopen so tests don't hit the network. Covers:
  * happy path — POST body shape, auth header, response parsing
  * dedup hit — surfaces the deduped flag to the LLM
  * API-secret / URL missing — returns a clean error, no network call
  * invalid invocation_source — rejected pre-flight
  * missing skill_id — rejected pre-flight
  * HTTP error + URL error — structured error responses
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "dispatch.py"


_DEFAULT = object()


def _load_module(env=_DEFAULT):
    """Load dispatch.py fresh with the provided env so module-level
    constants (API_URL, API_SECRET, etc.) pick up the test values.

    Pass env={} explicitly to simulate the missing-env path — default-or
    wouldn't work because {} is falsy."""
    if env is _DEFAULT:
        env = {
            "THINKWORK_API_URL": "https://api.test.example",
            "THINKWORK_API_SECRET": "service-secret",
            "TENANT_ID": "T1",
            "CURRENT_USER_ID": "U1",
        }
    with mock.patch.dict("os.environ", env, clear=True):
        spec = importlib.util.spec_from_file_location(f"dispatch_{id(env)}", SCRIPT)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module


def _fake_response(payload: dict):
    class R:
        def read(self):
            return json.dumps(payload).encode("utf-8")

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    return R()


def test_start_skill_run_happy_path() -> None:
    mod = _load_module()
    captured: dict = {}

    def fake_urlopen(req, timeout=None):
        captured["url"] = req.full_url
        captured["headers"] = dict(req.header_items())
        captured["body"] = json.loads(req.data.decode())
        return _fake_response({"runId": "run-1", "status": "running", "deduped": False})

    with mock.patch("urllib.request.urlopen", fake_urlopen):
        out = json.loads(mod.start_skill_run(
            skill_id="sales-prep",
            invocation_source="chat",
            inputs={"customer": "cust-abc", "meeting_date": "2026-05-01"},
            agent_id="agent-1",
        ))

    assert out == {"runId": "run-1", "status": "running", "deduped": False}
    assert captured["url"] == "https://api.test.example/api/skills/start"
    # urllib normalizes header names to title case — assert case-insensitively.
    auth = {k.lower(): v for k, v in captured["headers"].items()}
    assert auth["authorization"] == "Bearer service-secret"
    body = captured["body"]
    assert body["tenantId"] == "T1"
    assert body["invokerUserId"] == "U1"
    assert body["skillId"] == "sales-prep"
    assert body["agentId"] == "agent-1"
    assert body["invocationSource"] == "chat"
    assert body["inputs"] == {"customer": "cust-abc", "meeting_date": "2026-05-01"}


def test_start_skill_run_dedup_hit_surfaces_flag() -> None:
    """The service handler returns deduped=true when an identical run is
    already active. The LLM should see that flag and tell the user
    'already running' rather than starting a duplicate."""
    mod = _load_module()
    with mock.patch(
        "urllib.request.urlopen",
        return_value=_fake_response({"runId": "run-existing", "status": "running", "deduped": True}),
    ):
        out = json.loads(mod.start_skill_run(
            skill_id="sales-prep", invocation_source="chat",
        ))
    assert out["deduped"] is True
    assert out["runId"] == "run-existing"


def test_missing_env_returns_clean_error() -> None:
    mod = _load_module(env={})
    with mock.patch("urllib.request.urlopen") as fake:
        out = json.loads(mod.start_skill_run(skill_id="sales-prep"))
    fake.assert_not_called()
    assert "THINKWORK_API_URL" in out["error"]


def test_missing_tenant_returns_clean_error() -> None:
    mod = _load_module(env={
        "THINKWORK_API_URL": "https://api.test",
        "THINKWORK_API_SECRET": "s",
    })
    with mock.patch("urllib.request.urlopen") as fake:
        out = json.loads(mod.start_skill_run(skill_id="sales-prep"))
    fake.assert_not_called()
    assert "TENANT_ID" in out["error"] or "CURRENT_USER_ID" in out["error"]


def test_missing_skill_id_rejected() -> None:
    mod = _load_module()
    with mock.patch("urllib.request.urlopen") as fake:
        out = json.loads(mod.start_skill_run(skill_id=""))
    fake.assert_not_called()
    assert "skill_id" in out["error"]


def test_invalid_invocation_source_rejected() -> None:
    mod = _load_module()
    with mock.patch("urllib.request.urlopen") as fake:
        out = json.loads(mod.start_skill_run(skill_id="s", invocation_source="chatroom"))
    fake.assert_not_called()
    assert "invocation_source" in out["error"]


def test_api_http_error_surfaces_status() -> None:
    import urllib.error

    mod = _load_module()
    err = urllib.error.HTTPError(
        url="", code=400, msg="Bad Request",
        hdrs=None,  # type: ignore[arg-type]
        fp=None,  # type: ignore[arg-type]
    )
    # Attach a body the error handler can read.
    err.read = lambda: b'{"error":"tenant mismatch"}'  # type: ignore[attr-defined]
    with mock.patch("urllib.request.urlopen", side_effect=err):
        out = json.loads(mod.start_skill_run(skill_id="s"))
    assert "HTTP 400" in out["error"]
    assert "tenant mismatch" in out["error"]


def test_api_network_error_surfaces_reason() -> None:
    import urllib.error

    mod = _load_module()
    with mock.patch("urllib.request.urlopen", side_effect=urllib.error.URLError("timed out")):
        out = json.loads(mod.start_skill_run(skill_id="s"))
    assert "network error" in out["error"]
    assert "timed out" in out["error"]


def test_empty_inputs_valid() -> None:
    """A skill with no required inputs must still be startable."""
    mod = _load_module()
    with mock.patch(
        "urllib.request.urlopen",
        return_value=_fake_response({"runId": "r", "status": "running", "deduped": False}),
    ) as fake:
        out = json.loads(mod.start_skill_run(skill_id="no-input-skill"))
    fake.assert_called_once()
    assert out["status"] == "running"


def test_skill_run_status_is_stubbed_honestly() -> None:
    """Unit 5 doesn't implement status polling — the stub must return a
    clear error so the LLM knows not to promise progress updates yet."""
    mod = _load_module()
    out = json.loads(mod.skill_run_status("run-1"))
    assert "error" in out
    assert "not yet implemented" in out["error"]


def test_skill_run_status_empty_run_id() -> None:
    mod = _load_module()
    out = json.loads(mod.skill_run_status(""))
    assert "run_id" in out["error"]
