"""Resolved Capability Manifest capture tests (plan §U15 pt 2/3).

Run with:
    uv run --no-project --with pytest \
        pytest packages/agentcore-strands/agent-container/test_capability_manifest.py

The module is pure-Python + urllib so the tests stub os.environ + patch
urllib.request.urlopen — no strands import needed.
"""

from __future__ import annotations

import io
import json
import logging
import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from capability_manifest import (
    MANIFEST_RUNTIME_VERSION,
    build_and_log,
    build_manifest,
    log_manifest,
    post_manifest,
)


def _tool(name: str):
    def impl(*_args, **_kwargs):  # pragma: no cover
        raise AssertionError("filter should not call the tool")

    impl.tool_name = name  # type: ignore[attr-defined]
    return impl


# ---------------------------------------------------------------------------
# build_manifest — pure shape + normalization
# ---------------------------------------------------------------------------


class TestBuildManifest:
    def test_happy_path_normalizes_every_field(self):
        manifest = build_manifest(
            session_id="sess-1",
            tenant_id="t-1",
            agent_id="a-1",
            template_id="tpl-1",
            user_id="u-1",
            tools=[_tool("execute_code"), _tool("web_search")],
            skills=[{"slug": "greet", "version": "1.0", "source": "builtin"}],
            mcp_servers=[{"id": "m-1", "url_hash": "h", "status": "approved"}],
            workspace_files=[{"path": "README.md", "version": "abc"}],
            tenant_disabled_builtins=["recall"],
            template_blocked_tools=["reflect"],
        )
        assert manifest["session_id"] == "sess-1"
        assert manifest["tenant_id"] == "t-1"
        assert manifest["agent_id"] == "a-1"
        assert manifest["template_id"] == "tpl-1"
        assert manifest["user_id"] == "u-1"
        assert manifest["tools"] == [{"slug": "execute_code"}, {"slug": "web_search"}]
        assert manifest["skills"] == [
            {"slug": "greet", "version": "1.0", "source": "builtin"},
        ]
        assert manifest["mcp_servers"] == [
            {"id": "m-1", "url_hash": "h", "status": "approved"},
        ]
        assert manifest["workspace_files"] == [{"path": "README.md", "version": "abc"}]
        assert manifest["blocks"] == {
            "tenant_disabled_builtins": ["recall"],
            "template_blocked_tools": ["reflect"],
        }
        assert manifest["runtime_version"] == MANIFEST_RUNTIME_VERSION
        assert isinstance(manifest["timestamp"], int)

    def test_empty_defaults_produce_stable_shape(self):
        manifest = build_manifest(session_id="s", tenant_id="t")
        assert manifest["tools"] == []
        assert manifest["skills"] == []
        assert manifest["mcp_servers"] == []
        assert manifest["workspace_files"] == []
        assert manifest["blocks"] == {
            "tenant_disabled_builtins": [],
            "template_blocked_tools": [],
        }
        # Optional ids collapse to empty strings for JSONB compatibility.
        assert manifest["agent_id"] == ""
        assert manifest["template_id"] == ""
        assert manifest["user_id"] == ""

    def test_unnamed_tool_is_dropped_not_crashed(self):
        class Anon:
            pass

        manifest = build_manifest(
            session_id="s",
            tenant_id="t",
            tools=[Anon(), _tool("execute_code")],
        )
        # Anonymous tool silently dropped; the named one lands.
        assert manifest["tools"] == [{"slug": "execute_code"}]

    def test_blocks_deduped_and_sorted(self):
        manifest = build_manifest(
            session_id="s",
            tenant_id="t",
            tenant_disabled_builtins=["b", "a", "a", "c"],
            template_blocked_tools=["x", "x", "y"],
        )
        assert manifest["blocks"]["tenant_disabled_builtins"] == ["a", "b", "c"]
        assert manifest["blocks"]["template_blocked_tools"] == ["x", "y"]

    def test_extra_is_echoed_on_dedicated_key(self):
        manifest = build_manifest(
            session_id="s",
            tenant_id="t",
            extra={"integration_context": "github"},
        )
        assert manifest["extra"] == {"integration_context": "github"}


# ---------------------------------------------------------------------------
# log_manifest — structured CloudWatch output
# ---------------------------------------------------------------------------


class TestLogManifest:
    def test_emits_single_info_line_with_json_payload(self, caplog):
        manifest = build_manifest(session_id="s", tenant_id="t")
        caplog.set_level(logging.INFO, logger="capability_manifest")
        log_manifest(manifest)
        records = [r for r in caplog.records if r.name == "capability_manifest"]
        assert len(records) == 1
        msg = records[0].getMessage()
        assert msg.startswith("capability_manifest ")
        payload = json.loads(msg.removeprefix("capability_manifest "))
        assert payload["session_id"] == "s"
        assert payload["runtime_version"] == MANIFEST_RUNTIME_VERSION

    def test_non_serializable_value_logs_warning_not_crash(self, caplog):
        caplog.set_level(logging.WARNING, logger="capability_manifest")
        # A circular reference is unambiguously unserializable — str()
        # can't flatten it, so json.dumps(default=str) still raises.
        circular: dict = {"session_id": "s"}
        circular["self"] = circular
        log_manifest(circular)
        records = [r for r in caplog.records if "serialize_failed" in r.getMessage()]
        assert records  # Warning emitted, no exception bubbled.


# ---------------------------------------------------------------------------
# post_manifest — best-effort POST with env-gated auth
# ---------------------------------------------------------------------------


class _FakeResponse:
    """Stand-in for urlopen's context manager response."""

    def __init__(self, status: int = 201):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return b"{}"


class TestPostManifest:
    @pytest.fixture(autouse=True)
    def _clean_env(self):
        keys = ("THINKWORK_API_URL", "API_AUTH_SECRET", "THINKWORK_API_SECRET")
        prev = {k: os.environ.get(k) for k in keys}
        for k in keys:
            os.environ.pop(k, None)
        yield
        for k, v in prev.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_skipped_when_env_missing_logs_and_returns_false(self, caplog):
        caplog.set_level(logging.WARNING, logger="capability_manifest")
        result = post_manifest({"session_id": "s", "tenant_id": "t"})
        assert result is False
        assert any("post_skipped" in r.getMessage() for r in caplog.records)

    def test_happy_path_posts_and_returns_true(self):
        os.environ["THINKWORK_API_URL"] = "https://api.example"
        os.environ["API_AUTH_SECRET"] = "secret"
        captured: dict = {}

        def fake_urlopen(req, timeout=None):
            captured["url"] = req.full_url
            captured["method"] = req.get_method()
            captured["headers"] = dict(req.headers)
            captured["body"] = req.data
            return _FakeResponse(status=201)

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            ok = post_manifest({
                "session_id": "s",
                "tenant_id": "11111111-1111-1111-1111-111111111111",
                "agent_id": "a",
                "template_id": "",
                "user_id": "u",
                "runtime_version": "v1",
            })
        assert ok is True
        assert captured["url"] == "https://api.example/api/runtime/manifests"
        assert captured["method"] == "POST"
        # urllib.request.Request normalizes header keys to Capitalized.
        assert captured["headers"]["Authorization"] == "Bearer secret"
        body = json.loads(captured["body"])
        assert body["tenant_id"] == "11111111-1111-1111-1111-111111111111"
        assert body["manifest_json"]["session_id"] == "s"
        # Empty template_id passes as None so the server can nil it.
        assert body["template_id"] is None

    def test_returns_false_on_http_error(self, caplog):
        os.environ["THINKWORK_API_URL"] = "https://api.example"
        os.environ["API_AUTH_SECRET"] = "secret"
        import urllib.error

        caplog.set_level(logging.WARNING, logger="capability_manifest")
        err = urllib.error.HTTPError(
            "https://api.example/api/runtime/manifests",
            500,
            "Internal Server Error",
            hdrs=None,
            fp=io.BytesIO(b""),
        )
        with patch("urllib.request.urlopen", side_effect=err):
            ok = post_manifest({"session_id": "s", "tenant_id": "t"})
        assert ok is False
        assert any("post_failed" in r.getMessage() for r in caplog.records)

    def test_returns_false_on_network_error(self, caplog):
        os.environ["THINKWORK_API_URL"] = "https://api.example"
        os.environ["API_AUTH_SECRET"] = "secret"
        caplog.set_level(logging.WARNING, logger="capability_manifest")
        import urllib.error

        with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("no route")):
            ok = post_manifest({"session_id": "s", "tenant_id": "t"})
        assert ok is False
        assert any("post_failed" in r.getMessage() for r in caplog.records)

    def test_falls_back_to_thinkwork_api_secret(self):
        os.environ["THINKWORK_API_URL"] = "https://api.example"
        os.environ["THINKWORK_API_SECRET"] = "alt-secret"
        captured: dict = {}

        def fake_urlopen(req, timeout=None):
            captured["auth"] = dict(req.headers).get("Authorization")
            return _FakeResponse(status=201)

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            post_manifest({"session_id": "s", "tenant_id": "t"})
        assert captured["auth"] == "Bearer alt-secret"


# ---------------------------------------------------------------------------
# build_and_log convenience wrapper
# ---------------------------------------------------------------------------


class TestBuildAndLog:
    def test_builds_logs_and_attempts_post(self, caplog):
        caplog.set_level(logging.INFO, logger="capability_manifest")
        with patch("capability_manifest.post_manifest") as mock_post:
            mock_post.return_value = True
            manifest = build_and_log(
                session_id="s",
                tenant_id="t",
                tools=[_tool("execute_code")],
            )
        assert manifest["session_id"] == "s"
        assert manifest["tools"] == [{"slug": "execute_code"}]
        mock_post.assert_called_once()
        assert any(
            "capability_manifest" in r.getMessage() and r.levelno == logging.INFO
            for r in caplog.records
        )

    def test_post_failure_does_not_propagate(self):
        with patch("capability_manifest.post_manifest", return_value=False):
            manifest = build_and_log(session_id="s", tenant_id="t")
        # Returned manifest is still the built value — caller doesn't need
        # to check a success flag, the CloudWatch log is the ground truth.
        assert manifest["session_id"] == "s"

    def test_session_continues_when_post_returns_false(self, caplog):
        """build_and_log must swallow the POST outcome — server.py's
        caller never branches on it. A False return from post_manifest
        should still hand the caller a usable manifest dict."""
        caplog.set_level(logging.WARNING, logger="capability_manifest")
        with patch("capability_manifest.post_manifest", return_value=False):
            manifest = build_and_log(session_id="s", tenant_id="t")
        assert manifest["session_id"] == "s"


# Silence the unused-import warning some configurations emit on SimpleNamespace.
_ = SimpleNamespace
