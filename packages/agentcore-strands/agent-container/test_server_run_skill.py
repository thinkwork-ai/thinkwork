"""Tests for run_skill_dispatch — kind='run_skill' dispatcher.

Post-U6 the dispatcher fails every envelope fast with the unsupported-
runtime reason. Tests pin that behavior so the expected `failed` row +
writeback contract can't drift quietly:

  * Happy envelope → status='failed', reason names the U6 cutover,
    /api/skills/complete POSTed with HMAC signature.
  * Missing runId/tenantId/skillId → return failed without posting.
  * /api/skills/complete 5xx → logged, dispatch still returns status
    (smoke timeout + reconciler are the backstops for dropped writeback).

Run with:
    uv run --with pytest --no-project pytest packages/agentcore-strands/agent-container/test_server_run_skill.py
"""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

import run_skill_dispatch


class DispatchRunSkillTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        os.environ["THINKWORK_API_URL"] = "https://example.test"
        os.environ["API_AUTH_SECRET"] = "smoke-secret"
        os.environ.pop("THINKWORK_API_SECRET", None)

    async def test_envelope_posts_failed_with_u6_reason(self):
        posts: list = []
        with patch.object(run_skill_dispatch, "post_skill_run_complete",
                          side_effect=lambda *a, **kw: posts.append((a, kw))):
            result = await run_skill_dispatch.dispatch_run_skill({
                "kind": "run_skill",
                "runId": "run-1",
                "tenantId": "tenant-1",
                "invokerUserId": "user-1",
                "skillId": "sales-prep",
                "resolvedInputs": {"k": "v"},
                "scope": {"tenant_id": "tenant-1"},
                "completionHmacSecret": "sig-secret",
            })

        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["runId"], "run-1")
        self.assertIn("U6", result["failureReason"])
        self.assertIn("Skill", result["failureReason"])

        self.assertEqual(len(posts), 1)
        post_args, post_kwargs = posts[0]
        self.assertEqual(post_args[0], "run-1")
        self.assertEqual(post_args[1], "tenant-1")
        self.assertEqual(post_args[2], "failed")
        self.assertIn("U6", post_kwargs["failure_reason"])
        self.assertEqual(post_kwargs["completion_hmac_secret"], "sig-secret")

    async def test_missing_run_id_returns_failed_without_posting(self):
        posts: list = []
        with patch.object(run_skill_dispatch, "post_skill_run_complete",
                          side_effect=lambda *a, **kw: posts.append((a, kw))):
            result = await run_skill_dispatch.dispatch_run_skill({
                "kind": "run_skill",
                "tenantId": "tenant-1",
                "skillId": "sales-prep",
            })
        self.assertEqual(result["status"], "failed")
        self.assertIn("missing", result["error"])
        self.assertEqual(posts, [])

    async def test_missing_tenant_id_returns_failed_without_posting(self):
        posts: list = []
        with patch.object(run_skill_dispatch, "post_skill_run_complete",
                          side_effect=lambda *a, **kw: posts.append((a, kw))):
            result = await run_skill_dispatch.dispatch_run_skill({
                "kind": "run_skill",
                "runId": "run-2",
                "skillId": "sales-prep",
            })
        self.assertEqual(result["status"], "failed")
        self.assertEqual(posts, [])


class PostCompletionTests(unittest.TestCase):
    def setUp(self):
        os.environ["THINKWORK_API_URL"] = "https://example.test"
        os.environ["API_AUTH_SECRET"] = "smoke-secret"

    def test_missing_env_logs_and_returns(self):
        os.environ.pop("THINKWORK_API_URL", None)
        os.environ.pop("API_AUTH_SECRET", None)
        os.environ.pop("THINKWORK_API_SECRET", None)
        # Does not raise
        run_skill_dispatch.post_skill_run_complete(
            "run-x", "tenant-x", "failed", failure_reason="x",
        )

    def test_5xx_response_logged_no_raise(self):
        import urllib.error
        def fake_urlopen(req, timeout=None):
            raise urllib.error.HTTPError(
                url="https://example.test/api/skills/complete",
                code=500, msg="boom", hdrs=None, fp=None,
            )
        # time.sleep is patched so the 3 backoff waits don't drag tests.
        with patch("urllib.request.urlopen", side_effect=fake_urlopen), \
             patch("run_skill_dispatch.time.sleep"):
            # Does not raise — _urlopen_with_retry raises after exhausting
            # attempts, post_skill_run_complete catches + logs.
            run_skill_dispatch.post_skill_run_complete(
                "run-x", "tenant-x", "failed", failure_reason="x",
            )


class UrlopenWithRetryTests(unittest.TestCase):
    """Inner retry helper — exercised directly so we can count attempts."""

    def setUp(self):
        # Suppress real backoff for fast tests.
        self._sleep_patch = patch("run_skill_dispatch.time.sleep")
        self._sleep_patch.start()

    def tearDown(self):
        self._sleep_patch.stop()

    def test_200_one_call_only(self):
        class FakeResp:
            status = 200
        with patch("urllib.request.urlopen", return_value=FakeResp()) as mock_open:
            resp = run_skill_dispatch._urlopen_with_retry(
                MagicMock(), timeout=15, run_id="r1",
            )
        self.assertEqual(resp.status, 200)
        self.assertEqual(mock_open.call_count, 1)

    def test_5xx_retries_three_times_then_raises(self):
        import urllib.error
        def fake_urlopen(req, timeout=None):
            raise urllib.error.HTTPError(
                url="https://example.test/api/skills/complete",
                code=503, msg="unavail", hdrs=None, fp=None,
            )
        with patch("urllib.request.urlopen", side_effect=fake_urlopen) as mock_open:
            with self.assertRaises(urllib.error.HTTPError):
                run_skill_dispatch._urlopen_with_retry(
                    MagicMock(), timeout=15, run_id="r2",
                )
        # 1 initial + 3 retries = 4 attempts total (matches
        # _COMPLETE_RETRY_DELAYS = (1, 3, 9) per the plan spec).
        self.assertEqual(mock_open.call_count, 4)

    def test_400_invalid_transition_treated_as_success_not_retried(self):
        import io
        import urllib.error

        def fake_urlopen(req, timeout=None):
            err = urllib.error.HTTPError(
                url="https://example.test/api/skills/complete",
                code=400, msg="bad",
                hdrs=None,
                fp=io.BytesIO(b'{"error":"invalid transition: complete -> failed"}'),
            )
            raise err

        with patch("urllib.request.urlopen", side_effect=fake_urlopen) as mock_open:
            resp = run_skill_dispatch._urlopen_with_retry(
                MagicMock(), timeout=15, run_id="r3",
            )
        # Sentinel: invalid-transition returns None (treat as idempotency-ok).
        self.assertIsNone(resp)
        self.assertEqual(mock_open.call_count, 1)

    def test_other_400_is_terminal_not_retried_and_raised(self):
        import io
        import urllib.error

        def fake_urlopen(req, timeout=None):
            raise urllib.error.HTTPError(
                url="https://example.test/api/skills/complete",
                code=400, msg="bad",
                hdrs=None,
                fp=io.BytesIO(b'{"error":"Missing required fields"}'),
            )

        with patch("urllib.request.urlopen", side_effect=fake_urlopen) as mock_open:
            with self.assertRaises(urllib.error.HTTPError):
                run_skill_dispatch._urlopen_with_retry(
                    MagicMock(), timeout=15, run_id="r4",
                )
        self.assertEqual(mock_open.call_count, 1)

    def test_socket_timeout_retried_then_raised(self):
        import socket
        def boom(req, timeout=None):
            raise socket.timeout("slow downstream")
        with patch("urllib.request.urlopen", side_effect=boom) as mock_open:
            with self.assertRaises(socket.timeout):
                run_skill_dispatch._urlopen_with_retry(
                    MagicMock(), timeout=15, run_id="r5",
                )
        self.assertEqual(mock_open.call_count, 4)


if __name__ == "__main__":
    unittest.main()
