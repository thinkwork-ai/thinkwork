"""Tests for api_runtime_config — the /api/agents/runtime-config GET
client used by dispatch_run_skill (plan §U3).

Run with:
    uv run --with pytest --no-project pytest packages/agentcore-strands/agent-container/test_api_runtime_config.py
"""

from __future__ import annotations

import io
import os
import unittest
from unittest.mock import MagicMock, patch

import api_runtime_config


class FetchHappyPathTests(unittest.TestCase):
    def setUp(self):
        os.environ["THINKWORK_API_URL"] = "https://api.example.test"
        os.environ["API_AUTH_SECRET"] = "service-secret"
        os.environ.pop("THINKWORK_API_SECRET", None)

    def test_fetch_returns_parsed_body_on_200(self):
        class FakeResp:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def read(self):
                return b'{"tenantSlug":"acme","agentName":"Ada"}'

        with patch("urllib.request.urlopen", return_value=FakeResp()) as mock_open:
            out = api_runtime_config.fetch(
                agent_id="agent-1", tenant_id="tenant-1",
            )
        self.assertEqual(out["tenantSlug"], "acme")
        self.assertEqual(out["agentName"], "Ada")
        mock_open.assert_called_once()
        req = mock_open.call_args.args[0]
        self.assertEqual(req.method, "GET")
        # Auth header carried through. urllib normalizes header names to
        # title case; allow both forms.
        headers = {k.lower(): v for k, v in req.header_items()}
        self.assertEqual(headers["authorization"], "Bearer service-secret")
        # Query string built correctly (no currentUserId unless provided).
        self.assertIn("tenantId=tenant-1", req.full_url)
        self.assertIn("agentId=agent-1", req.full_url)
        self.assertNotIn("currentUserId", req.full_url)

    def test_fetch_forwards_currentUserId_when_provided(self):
        class FakeResp:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def read(self):
                return b'{}'

        with patch("urllib.request.urlopen", return_value=FakeResp()) as mock_open:
            api_runtime_config.fetch(
                agent_id="agent-1",
                tenant_id="tenant-1",
                current_user_id="user-42",
                current_user_email="rep@acme.test",
            )
        req = mock_open.call_args.args[0]
        self.assertIn("currentUserId=user-42", req.full_url)
        self.assertIn("currentUserEmail=rep%40acme.test", req.full_url)

    def test_explicit_credentials_override_env(self):
        os.environ["THINKWORK_API_URL"] = "https://stale.example.test"
        os.environ["API_AUTH_SECRET"] = "stale-secret"

        class FakeResp:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def read(self):
                return b"{}"

        with patch("urllib.request.urlopen", return_value=FakeResp()) as mock_open:
            api_runtime_config.fetch(
                agent_id="agent-1",
                tenant_id="tenant-1",
                api_url="https://payload.example.test",
                api_secret="payload-secret",
            )
        req = mock_open.call_args.args[0]
        self.assertTrue(req.full_url.startswith("https://payload.example.test/"))
        headers = {k.lower(): v for k, v in req.header_items()}
        self.assertEqual(headers["authorization"], "Bearer payload-secret")


class FetchFailureTests(unittest.TestCase):
    def setUp(self):
        os.environ["THINKWORK_API_URL"] = "https://api.example.test"
        os.environ["API_AUTH_SECRET"] = "service-secret"
        os.environ.pop("THINKWORK_API_SECRET", None)
        # Drive retry sleeps to zero so tests run fast.
        self._sleep_patch = patch("api_runtime_config.time.sleep")
        self._sleep_patch.start()

    def tearDown(self):
        self._sleep_patch.stop()

    def test_missing_env_raises_before_calling_urlopen(self):
        os.environ.pop("THINKWORK_API_URL", None)
        os.environ.pop("API_AUTH_SECRET", None)
        os.environ.pop("THINKWORK_API_SECRET", None)
        with patch("urllib.request.urlopen") as mock_open:
            with self.assertRaises(api_runtime_config.RuntimeConfigFetchError):
                api_runtime_config.fetch(agent_id="a", tenant_id="t")
        mock_open.assert_not_called()

    def test_404_raises_AgentConfigNotFoundError(self):
        import urllib.error

        def boom(req, timeout=None):
            raise urllib.error.HTTPError(
                url="", code=404, msg="Not Found",
                hdrs=None,
                fp=io.BytesIO(b'{"error":"Agent not found"}'),
            )

        with patch("urllib.request.urlopen", side_effect=boom) as mock_open:
            with self.assertRaises(api_runtime_config.AgentConfigNotFoundError) as cm:
                api_runtime_config.fetch(agent_id="agent-1", tenant_id="tenant-1")
        self.assertEqual(cm.exception.code, 404)
        self.assertEqual(cm.exception.agent_id, "agent-1")
        # 4xx is terminal — no retry.
        self.assertEqual(mock_open.call_count, 1)

    def test_401_raises_RuntimeConfigFetchError_terminal(self):
        import urllib.error

        def boom(req, timeout=None):
            raise urllib.error.HTTPError(
                url="", code=401, msg="Unauthorized",
                hdrs=None,
                fp=io.BytesIO(b'{"error":"bad bearer"}'),
            )

        with patch("urllib.request.urlopen", side_effect=boom) as mock_open:
            with self.assertRaises(api_runtime_config.RuntimeConfigFetchError) as cm:
                api_runtime_config.fetch(agent_id="agent-1", tenant_id="tenant-1")
        self.assertEqual(cm.exception.code, 401)
        self.assertIn("401", cm.exception.reason)
        self.assertEqual(mock_open.call_count, 1)

    def test_5xx_retries_then_raises(self):
        import urllib.error

        def boom(req, timeout=None):
            raise urllib.error.HTTPError(
                url="", code=503, msg="Unavailable",
                hdrs=None, fp=None,
            )

        with patch("urllib.request.urlopen", side_effect=boom) as mock_open:
            with self.assertRaises(api_runtime_config.RuntimeConfigFetchError):
                api_runtime_config.fetch(agent_id="agent-1", tenant_id="tenant-1")
        # 1 initial + 3 retries = 4 attempts, matches _FETCH_RETRY_DELAYS.
        self.assertEqual(mock_open.call_count, 4)

    def test_5xx_then_200_returns_payload(self):
        import urllib.error

        class FakeResp:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def read(self):
                return b'{"tenantSlug":"acme"}'

        flaky = MagicMock(
            side_effect=[
                urllib.error.HTTPError(
                    url="", code=503, msg="", hdrs=None, fp=None,
                ),
                FakeResp(),
            ],
        )
        with patch("urllib.request.urlopen", flaky):
            out = api_runtime_config.fetch(agent_id="a", tenant_id="t")
        self.assertEqual(out["tenantSlug"], "acme")

    def test_socket_timeout_retried_then_raised(self):

        def boom(req, timeout=None):
            raise TimeoutError("slow api")

        with patch("urllib.request.urlopen", side_effect=boom) as mock_open:
            with self.assertRaises(api_runtime_config.RuntimeConfigFetchError):
                api_runtime_config.fetch(agent_id="a", tenant_id="t")
        self.assertEqual(mock_open.call_count, 4)

    def test_non_json_body_raises(self):
        class FakeResp:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def read(self):
                return b"not-json"

        with patch("urllib.request.urlopen", return_value=FakeResp()):
            with self.assertRaises(api_runtime_config.RuntimeConfigFetchError) as cm:
                api_runtime_config.fetch(agent_id="a", tenant_id="t")
        self.assertIn("non-JSON", cm.exception.reason)


if __name__ == "__main__":
    unittest.main()
