"""Tests for the in-process composer cache (Plan §004 U3).

Targets ``fetch_composed_workspace_cached`` in
``workspace_composer_client.py``. The un-cached call shape is covered
by ``test_workspace_composer_fetch.py``; this file pins TTL semantics,
key separation, and the disable path.

Run with::

    uv run --no-project --with pytest \\
        pytest packages/agentcore-strands/agent-container/test_workspace_composer_client.py
"""

from __future__ import annotations

import io
import json
import unittest
from unittest.mock import MagicMock, patch

import workspace_composer_client as wcc
from workspace_composer_client import (
    _reset_composed_cache,
    fetch_composed_workspace_cached,
)


def _fake_urlopen_factory(response_payload: dict, captured: list):
    """Patch target for ``urllib.request.urlopen`` — captures each call."""

    def opener(req, timeout=None):
        captured.append(
            {
                "url": req.full_url if hasattr(req, "full_url") else req.get_full_url(),
                "timeout": timeout,
            }
        )
        data = json.dumps(response_payload).encode("utf-8")
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=io.BytesIO(data))
        ctx.__exit__ = MagicMock(return_value=False)
        return ctx

    return opener


class TestFetchComposedWorkspaceCached(unittest.TestCase):
    def setUp(self):
        _reset_composed_cache()

    def tearDown(self):
        _reset_composed_cache()

    def test_two_sequential_calls_within_ttl_hit_cache(self):
        """Cache happy: composer mock called once across two same-key calls."""
        captured: list = []
        response = {"ok": True, "files": [{"path": "SOUL.md", "content": "Hi"}]}
        with patch("urllib.request.urlopen", _fake_urlopen_factory(response, captured)):
            a = fetch_composed_workspace_cached(
                tenant_id="t1",
                agent_id="a1",
                api_url="https://api.example.test",
                api_secret="secret",
                ttl_seconds=30,
            )
            b = fetch_composed_workspace_cached(
                tenant_id="t1",
                agent_id="a1",
                api_url="https://api.example.test",
                api_secret="secret",
                ttl_seconds=30,
            )
        self.assertEqual(len(captured), 1)
        self.assertEqual(a, b)

    def test_third_call_after_ttl_expiry_refetches(self):
        """Cache TTL expiry: time advances past TTL → composer called again."""
        captured: list = []
        response = {"ok": True, "files": []}
        # Fake monotonic clock so we don't sleep during tests.
        clock = {"t": 1000.0}

        def fake_monotonic():
            return clock["t"]

        with patch("urllib.request.urlopen", _fake_urlopen_factory(response, captured)):
            with patch.object(wcc.time, "monotonic", side_effect=fake_monotonic):
                fetch_composed_workspace_cached(
                    tenant_id="t1",
                    agent_id="a1",
                    api_url="https://api.example.test",
                    api_secret="secret",
                    ttl_seconds=30,
                )
                clock["t"] += 10  # within TTL
                fetch_composed_workspace_cached(
                    tenant_id="t1",
                    agent_id="a1",
                    api_url="https://api.example.test",
                    api_secret="secret",
                    ttl_seconds=30,
                )
                self.assertEqual(len(captured), 1)
                clock["t"] += 31  # advance past TTL
                fetch_composed_workspace_cached(
                    tenant_id="t1",
                    agent_id="a1",
                    api_url="https://api.example.test",
                    api_secret="secret",
                    ttl_seconds=30,
                )
        self.assertEqual(len(captured), 2)

    def test_different_tenant_or_agent_keys_do_not_share_entries(self):
        """Cache key separation: distinct (tenant, agent) → distinct entries."""
        captured: list = []
        response = {"ok": True, "files": []}
        with patch("urllib.request.urlopen", _fake_urlopen_factory(response, captured)):
            fetch_composed_workspace_cached(
                tenant_id="t1",
                agent_id="a1",
                api_url="https://api.example.test",
                api_secret="secret",
                ttl_seconds=30,
            )
            fetch_composed_workspace_cached(
                tenant_id="t1",
                agent_id="a2",  # different agent
                api_url="https://api.example.test",
                api_secret="secret",
                ttl_seconds=30,
            )
            fetch_composed_workspace_cached(
                tenant_id="t2",  # different tenant
                agent_id="a1",
                api_url="https://api.example.test",
                api_secret="secret",
                ttl_seconds=30,
            )
        self.assertEqual(len(captured), 3)

    def test_ttl_zero_disables_cache(self):
        """Cache disabled (TTL=0): every call passes through."""
        captured: list = []
        response = {"ok": True, "files": []}
        with patch("urllib.request.urlopen", _fake_urlopen_factory(response, captured)):
            for _ in range(3):
                fetch_composed_workspace_cached(
                    tenant_id="t1",
                    agent_id="a1",
                    api_url="https://api.example.test",
                    api_secret="secret",
                    ttl_seconds=0,
                )
        self.assertEqual(len(captured), 3)

    def test_default_ttl_is_30s(self):
        """Default TTL kwarg is 30s — pin so silent regression is caught."""
        import inspect

        sig = inspect.signature(fetch_composed_workspace_cached)
        self.assertEqual(sig.parameters["ttl_seconds"].default, 30.0)


if __name__ == "__main__":
    unittest.main()
