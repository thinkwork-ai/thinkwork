"""SI-7 capability_catalog client tests (plan §U15 pt 3/3).

Run with:
    uv run --no-project --with pytest \
        pytest packages/agentcore-strands/agent-container/test_capability_catalog.py
"""

from __future__ import annotations

import io
import json
import logging
import os
from unittest.mock import patch

import pytest
from capability_catalog import (
    CatalogSnapshot,
    fetch_allowed_slugs,
    filter_by_catalog,
    is_enforcement_enabled,
    log_shadow_compare,
)


def _tool(name: str):
    def impl(*_args, **_kwargs):  # pragma: no cover
        raise AssertionError("filter should not call the tool")

    impl.tool_name = name  # type: ignore[attr-defined]
    return impl


# ---------------------------------------------------------------------------
# fetch_allowed_slugs
# ---------------------------------------------------------------------------


class _Resp:
    def __init__(self, *, status: int = 200, body: bytes = b"{}"):
        self.status = status
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return self._body


class TestFetchAllowedSlugs:
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

    def test_missing_env_returns_not_ok(self):
        snap = fetch_allowed_slugs()
        assert snap.ok is False
        assert snap.error == "missing-env"
        assert snap.slugs == frozenset()

    def test_happy_path_returns_slug_set(self):
        os.environ["THINKWORK_API_URL"] = "https://api.example"
        os.environ["API_AUTH_SECRET"] = "secret"
        captured: dict = {}

        def fake_urlopen(req, timeout=None):
            captured["url"] = req.full_url
            captured["auth"] = dict(req.headers).get("Authorization")
            return _Resp(
                status=200,
                body=json.dumps({
                    "slugs": ["execute_code", "web_search"],
                    "count": 2,
                    "version": "2026-04-24T00:00:00Z",
                }).encode("utf-8"),
            )

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            snap = fetch_allowed_slugs()
        assert snap.ok is True
        assert snap.slugs == frozenset({"execute_code", "web_search"})
        assert snap.version == "2026-04-24T00:00:00Z"
        assert "type=tool" in captured["url"]
        assert "source=builtin" in captured["url"]
        assert captured["auth"] == "Bearer secret"

    def test_drops_non_string_slug_entries(self):
        os.environ["THINKWORK_API_URL"] = "https://api.example"
        os.environ["API_AUTH_SECRET"] = "secret"
        body = json.dumps({"slugs": ["ok", 42, None, "", "also_ok"]}).encode()
        with patch(
            "urllib.request.urlopen",
            return_value=_Resp(status=200, body=body),
        ):
            snap = fetch_allowed_slugs()
        assert snap.slugs == frozenset({"ok", "also_ok"})

    def test_http_error_returns_not_ok(self):
        os.environ["THINKWORK_API_URL"] = "https://api.example"
        os.environ["API_AUTH_SECRET"] = "secret"
        import urllib.error

        err = urllib.error.HTTPError(
            "https://api.example", 500, "bad", hdrs=None, fp=io.BytesIO(b""),
        )
        with patch("urllib.request.urlopen", side_effect=err):
            snap = fetch_allowed_slugs()
        assert snap.ok is False
        assert snap.error == "http_500"

    def test_network_error_returns_not_ok(self):
        os.environ["THINKWORK_API_URL"] = "https://api.example"
        os.environ["API_AUTH_SECRET"] = "secret"
        import urllib.error

        with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("no route")):
            snap = fetch_allowed_slugs()
        assert snap.ok is False
        assert snap.error == "network"

    def test_malformed_json_returns_not_ok(self):
        os.environ["THINKWORK_API_URL"] = "https://api.example"
        os.environ["API_AUTH_SECRET"] = "secret"
        with patch(
            "urllib.request.urlopen",
            return_value=_Resp(status=200, body=b"{not json"),
        ):
            snap = fetch_allowed_slugs()
        assert snap.ok is False
        assert snap.error == "parse"

    def test_missing_slugs_field_returns_not_ok(self):
        os.environ["THINKWORK_API_URL"] = "https://api.example"
        os.environ["API_AUTH_SECRET"] = "secret"
        with patch(
            "urllib.request.urlopen",
            return_value=_Resp(status=200, body=b'{"count": 0}'),
        ):
            snap = fetch_allowed_slugs()
        assert snap.ok is False
        assert snap.error == "shape"

    def test_falls_back_to_thinkwork_api_secret(self):
        os.environ["THINKWORK_API_URL"] = "https://api.example"
        os.environ["THINKWORK_API_SECRET"] = "alt-secret"
        captured: dict = {}

        def fake_urlopen(req, timeout=None):
            captured["auth"] = dict(req.headers).get("Authorization")
            return _Resp(
                status=200, body=json.dumps({"slugs": ["x"]}).encode(),
            )

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            fetch_allowed_slugs()
        assert captured["auth"] == "Bearer alt-secret"


# ---------------------------------------------------------------------------
# filter_by_catalog
# ---------------------------------------------------------------------------


class TestFilterByCatalog:
    def test_happy_path_keeps_only_allowed_slugs(self):
        allowed = frozenset({"execute_code", "recall"})
        result = filter_by_catalog(
            [_tool("execute_code"), _tool("web_search"), _tool("recall")],
            allowed_slugs=allowed,
        )
        assert [t.tool_name for t in result.tools] == ["execute_code", "recall"]
        assert result.kept_slugs == ("execute_code", "recall")
        assert result.dropped_slugs == ("web_search",)

    def test_unknown_in_catalog_surfaces_missing_implementations(self):
        allowed = frozenset({"execute_code", "web_search", "dream_mode"})
        result = filter_by_catalog(
            [_tool("execute_code"), _tool("web_search")],
            allowed_slugs=allowed,
        )
        # `dream_mode` is in the catalog but no Python impl registered.
        assert result.unknown_in_catalog == ("dream_mode",)

    def test_tool_without_name_flows_through(self):
        class Anon:
            pass

        anon = Anon()
        result = filter_by_catalog(
            [anon, _tool("execute_code")],
            allowed_slugs=frozenset({"execute_code"}),
        )
        # Anonymous tool never gets filtered — metadata loss must not
        # silently strip capability.
        assert anon in result.tools

    def test_empty_allowed_set_drops_every_named_tool(self):
        result = filter_by_catalog(
            [_tool("execute_code"), _tool("web_search")],
            allowed_slugs=frozenset(),
        )
        assert [t.tool_name for t in result.tools] == []
        assert set(result.dropped_slugs) == {"execute_code", "web_search"}


# ---------------------------------------------------------------------------
# is_enforcement_enabled + log_shadow_compare
# ---------------------------------------------------------------------------


class TestEnforcementFlag:
    @pytest.fixture(autouse=True)
    def _clean_env(self):
        prev = os.environ.get("RCM_ENFORCE")
        os.environ.pop("RCM_ENFORCE", None)
        yield
        if prev is None:
            os.environ.pop("RCM_ENFORCE", None)
        else:
            os.environ["RCM_ENFORCE"] = prev

    @pytest.mark.parametrize("value", ["true", "TRUE", "1", "yes", "YES"])
    def test_enabled_values(self, value: str):
        os.environ["RCM_ENFORCE"] = value
        assert is_enforcement_enabled() is True

    @pytest.mark.parametrize("value", ["", "0", "false", "no", "off"])
    def test_disabled_values(self, value: str):
        os.environ["RCM_ENFORCE"] = value
        assert is_enforcement_enabled() is False

    def test_default_disabled(self):
        assert is_enforcement_enabled() is False


class TestLogShadowCompare:
    def test_emits_structured_payload(self, caplog):
        caplog.set_level(logging.INFO, logger="capability_catalog")
        log_shadow_compare(
            registered_slugs=["execute_code", "web_search"],
            catalog_slugs=frozenset({"execute_code", "recall"}),
            enforcement_enabled=False,
            catalog_ok=True,
        )
        msgs = [r.getMessage() for r in caplog.records]
        assert any("capability_catalog_shadow" in m for m in msgs)
        # Extract the JSON payload from the shadow log line.
        payload = json.loads(
            msgs[0].removeprefix("capability_catalog_shadow ")
        )
        assert payload["registered"] == ["execute_code", "web_search"]
        assert payload["catalog"] == ["execute_code", "recall"]
        assert payload["would_drop"] == ["web_search"]
        assert payload["catalog_missing_tool"] == ["recall"]
        assert payload["enforcement_enabled"] is False
        assert payload["catalog_ok"] is True


# ---------------------------------------------------------------------------
# CatalogSnapshot sanity
# ---------------------------------------------------------------------------


class TestCatalogSnapshot:
    def test_frozen_dataclass_equality(self):
        a = CatalogSnapshot(ok=True, slugs=frozenset({"a"}), version="v1")
        b = CatalogSnapshot(ok=True, slugs=frozenset({"a"}), version="v1")
        assert a == b
