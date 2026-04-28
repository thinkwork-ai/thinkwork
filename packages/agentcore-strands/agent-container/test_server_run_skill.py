"""Tests for run_skill_dispatch — kind='run_skill' dispatcher.

Plan docs/plans/2026-04-24-008-feat-skill-run-dispatcher-plan.md §U3.
Covers the fully wired dispatcher path: runtime-config fetch → synthetic
chat turn via _execute_agent_turn → /api/skills/complete POST.

Run with:
    uv run --with pytest --no-project pytest packages/agentcore-strands/agent-container/test_server_run_skill.py
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import MagicMock, patch

import run_skill_dispatch


def _base_envelope(**overrides):
    """Scheduled/catalog-style envelope with a non-null agentId."""
    env = {
        "kind": "run_skill",
        "runId": "run-1",
        "tenantId": "tenant-1",
        "agentId": "agent-1",
        "invokerUserId": "user-1",
        "skillId": "sales-prep",
        "resolvedInputs": {"customer": "ABC"},
        "scope": {"tenant_id": "tenant-1"},
        "completionHmacSecret": "hmac-xyz",
    }
    env.update(overrides)
    return env


class DispatchRunSkillHappyPathTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        os.environ["THINKWORK_API_URL"] = "https://example.test"
        os.environ["API_AUTH_SECRET"] = "smoke-secret"
        os.environ.pop("THINKWORK_API_SECRET", None)

    async def test_complete_happy_path_posts_inline_deliverable(self):
        posts: list = []
        fake_config = {
            "tenantSlug": "acme",
            "agentSlug": "ada",
            "agentName": "Ada",
            "templateModel": "us.anthropic.claude-sonnet-4-6",
            "skillsConfig": [{"skillId": "sales-prep", "s3Key": "skills/catalog/sales-prep"}],
            "mcpConfigs": [],
            "guardrailConfig": None,
            "knowledgeBasesConfig": None,
            "blockedTools": [],
        }
        captured_payload: dict = {}

        def _fake_execute_agent_turn(payload):
            captured_payload.update(payload)
            return {
                "response_text": "## Risks\n- AR is 30 days overdue\n",
                "strands_usage": {},
                "duration_ms": 1200,
                "invocation_tool_costs": [],
            }

        fake_fetch = MagicMock(return_value=fake_config)
        fake_server = MagicMock()
        fake_server._execute_agent_turn = _fake_execute_agent_turn

        with patch.object(run_skill_dispatch, "post_skill_run_complete",
                          side_effect=lambda *a, **kw: posts.append((a, kw))), \
             patch.dict(sys.modules, {
                 "api_runtime_config": MagicMock(
                     AgentConfigNotFoundError=type("AgentConfigNotFoundError", (RuntimeError,), {}),
                     RuntimeConfigFetchError=type("RuntimeConfigFetchError", (RuntimeError,), {}),
                     fetch=fake_fetch,
                 ),
                 "server": fake_server,
             }):
            result = await run_skill_dispatch.dispatch_run_skill(_base_envelope())

        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["deliveredArtifactRef"]["type"], "inline")
        self.assertIn("AR is 30 days overdue", result["deliveredArtifactRef"]["payload"])
        self.assertEqual(len(posts), 1)
        args, kwargs = posts[0]
        self.assertEqual(args[0], "run-1")
        self.assertEqual(args[1], "tenant-1")
        self.assertEqual(args[2], "complete")
        self.assertEqual(kwargs["delivered_artifact_ref"]["type"], "inline")
        self.assertEqual(kwargs["completion_hmac_secret"], "hmac-xyz")

        # runtime-config fetch went through with the envelope's ids.
        fake_fetch.assert_called_once()
        call_kwargs = fake_fetch.call_args.kwargs
        self.assertEqual(call_kwargs["agent_id"], "agent-1")
        self.assertEqual(call_kwargs["tenant_id"], "tenant-1")
        self.assertEqual(call_kwargs["current_user_id"], "user-1")
        self.assertEqual(call_kwargs["api_url"], "https://example.test")
        self.assertEqual(call_kwargs["api_secret"], "smoke-secret")

        # synthetic payload wired the runtime config + envelope per-turn.
        self.assertEqual(captured_payload["assistant_id"], "agent-1")
        self.assertEqual(captured_payload["tenant_id"], "tenant-1")
        self.assertEqual(captured_payload["tenant_slug"], "acme")
        self.assertEqual(captured_payload["agent_name"], "Ada")
        self.assertEqual(captured_payload["model"], "us.anthropic.claude-sonnet-4-6")
        self.assertEqual(captured_payload["trigger_channel"], "run_skill")
        self.assertIn("sales-prep", captured_payload["message"])
        self.assertIn("ABC", captured_payload["message"])

    async def test_envelope_credentials_are_used_when_env_is_empty(self):
        os.environ.pop("THINKWORK_API_URL", None)
        os.environ.pop("API_AUTH_SECRET", None)
        os.environ.pop("THINKWORK_API_SECRET", None)
        posts: list = []
        fake_config = {
            "tenantSlug": "acme",
            "agentSlug": "ada",
            "agentName": "Ada",
            "templateModel": "us.anthropic.claude-sonnet-4-6",
            "skillsConfig": [],
            "mcpConfigs": [],
            "guardrailConfig": None,
            "knowledgeBasesConfig": None,
            "blockedTools": [],
        }
        fake_fetch = MagicMock(return_value=fake_config)
        fake_server = MagicMock()
        fake_server._execute_agent_turn = MagicMock(return_value={
            "response_text": "done",
            "strands_usage": {},
            "duration_ms": 1,
            "invocation_tool_costs": [],
        })

        with patch.object(run_skill_dispatch, "post_skill_run_complete",
                          side_effect=lambda *a, **kw: posts.append((a, kw))), \
             patch.dict(sys.modules, {
                 "api_runtime_config": MagicMock(
                     AgentConfigNotFoundError=type("AgentConfigNotFoundError", (RuntimeError,), {}),
                     RuntimeConfigFetchError=type("RuntimeConfigFetchError", (RuntimeError,), {}),
                     fetch=fake_fetch,
                 ),
                 "server": fake_server,
             }):
            result = await run_skill_dispatch.dispatch_run_skill(
                _base_envelope(
                    thinkworkApiUrl="https://payload.example",
                    apiAuthSecret="payload-secret",
                ),
            )

        self.assertEqual(result["status"], "complete")
        call_kwargs = fake_fetch.call_args.kwargs
        self.assertEqual(call_kwargs["api_url"], "https://payload.example")
        self.assertEqual(call_kwargs["api_secret"], "payload-secret")
        self.assertEqual(posts[0][1]["api_url"], "https://payload.example")
        self.assertEqual(posts[0][1]["api_secret"], "payload-secret")


class DispatchRunSkillFailurePathTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        os.environ["THINKWORK_API_URL"] = "https://example.test"
        os.environ["API_AUTH_SECRET"] = "smoke-secret"
        os.environ.pop("THINKWORK_API_SECRET", None)

    async def test_null_agent_id_fails_fast_without_fetching(self):
        posts: list = []
        fake_fetch = MagicMock(return_value={})
        with patch.object(run_skill_dispatch, "post_skill_run_complete",
                          side_effect=lambda *a, **kw: posts.append((a, kw))), \
             patch.dict(sys.modules, {
                 "api_runtime_config": MagicMock(fetch=fake_fetch),
             }):
            result = await run_skill_dispatch.dispatch_run_skill(
                _base_envelope(agentId=""),
            )
        self.assertEqual(result["status"], "failed")
        self.assertIn("agentId", result["failureReason"])
        self.assertIn("deferred", result["failureReason"])
        fake_fetch.assert_not_called()
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0][0][2], "failed")

    async def test_missing_run_id_returns_without_posting(self):
        posts: list = []
        with patch.object(run_skill_dispatch, "post_skill_run_complete",
                          side_effect=lambda *a, **kw: posts.append((a, kw))):
            result = await run_skill_dispatch.dispatch_run_skill({
                "kind": "run_skill",
                "tenantId": "tenant-1",
                "skillId": "sales-prep",
                "agentId": "agent-1",
            })
        self.assertEqual(result["status"], "failed")
        self.assertIn("missing", result["error"])
        self.assertEqual(posts, [])

    async def test_runtime_config_404_posts_agent_not_found(self):
        posts: list = []

        class FakeAgentConfigNotFoundError(RuntimeError):
            def __init__(self, agent_id):
                super().__init__(f"agent not found: {agent_id}")
                self.reason = f"agent not found: {agent_id}"
                self.agent_id = agent_id

        class FakeRuntimeConfigFetchError(RuntimeError):
            def __init__(self, reason):
                super().__init__(reason)
                self.reason = reason

        def boom(*_a, **_kw):
            raise FakeAgentConfigNotFoundError("agent-1")

        with patch.object(run_skill_dispatch, "post_skill_run_complete",
                          side_effect=lambda *a, **kw: posts.append((a, kw))), \
             patch.dict(sys.modules, {
                 "api_runtime_config": MagicMock(
                     AgentConfigNotFoundError=FakeAgentConfigNotFoundError,
                     RuntimeConfigFetchError=FakeRuntimeConfigFetchError,
                     fetch=MagicMock(side_effect=boom),
                 ),
             }):
            result = await run_skill_dispatch.dispatch_run_skill(_base_envelope())
        self.assertEqual(result["status"], "failed")
        self.assertIn("agent not found", result["failureReason"])
        self.assertEqual(posts[0][0][2], "failed")

    async def test_runtime_config_fetch_error_posts_reason(self):
        posts: list = []

        class FakeAgentConfigNotFoundError(RuntimeError):
            pass

        class FakeRuntimeConfigFetchError(RuntimeError):
            def __init__(self, reason):
                super().__init__(reason)
                self.reason = reason

        def boom(*_a, **_kw):
            raise FakeRuntimeConfigFetchError("runtime-config returned HTTP 503")

        with patch.object(run_skill_dispatch, "post_skill_run_complete",
                          side_effect=lambda *a, **kw: posts.append((a, kw))), \
             patch.dict(sys.modules, {
                 "api_runtime_config": MagicMock(
                     AgentConfigNotFoundError=FakeAgentConfigNotFoundError,
                     RuntimeConfigFetchError=FakeRuntimeConfigFetchError,
                     fetch=MagicMock(side_effect=boom),
                 ),
             }):
            result = await run_skill_dispatch.dispatch_run_skill(_base_envelope())
        self.assertEqual(result["status"], "failed")
        self.assertIn("HTTP 503", result["failureReason"])
        self.assertEqual(posts[0][0][2], "failed")

    async def test_execute_agent_turn_raises_posts_crashed_reason(self):
        posts: list = []
        fake_server = MagicMock()
        fake_server._execute_agent_turn = MagicMock(
            side_effect=RuntimeError("bedrock throttled"),
        )
        with patch.object(run_skill_dispatch, "post_skill_run_complete",
                          side_effect=lambda *a, **kw: posts.append((a, kw))), \
             patch.dict(sys.modules, {
                 "api_runtime_config": MagicMock(
                     AgentConfigNotFoundError=type("X", (RuntimeError,), {}),
                     RuntimeConfigFetchError=type("Y", (RuntimeError,), {}),
                     fetch=MagicMock(return_value={}),
                 ),
                 "server": fake_server,
             }):
            result = await run_skill_dispatch.dispatch_run_skill(_base_envelope())
        self.assertEqual(result["status"], "failed")
        self.assertIn("bedrock throttled", result["failureReason"])
        self.assertIn("agent loop crashed", result["failureReason"])
        self.assertEqual(posts[0][0][2], "failed")

    async def test_empty_response_text_posts_no_final_text(self):
        posts: list = []
        fake_server = MagicMock()
        fake_server._execute_agent_turn = MagicMock(return_value={
            "response_text": "   ",
            "strands_usage": {},
            "duration_ms": 0,
            "invocation_tool_costs": [],
        })
        with patch.object(run_skill_dispatch, "post_skill_run_complete",
                          side_effect=lambda *a, **kw: posts.append((a, kw))), \
             patch.dict(sys.modules, {
                 "api_runtime_config": MagicMock(
                     AgentConfigNotFoundError=type("X", (RuntimeError,), {}),
                     RuntimeConfigFetchError=type("Y", (RuntimeError,), {}),
                     fetch=MagicMock(return_value={}),
                 ),
                 "server": fake_server,
             }):
            result = await run_skill_dispatch.dispatch_run_skill(_base_envelope())
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["failureReason"], "agent produced no final text")
        self.assertEqual(posts[0][0][2], "failed")


class SyntheticMessageShapeTests(unittest.TestCase):
    def test_skill_id_and_args_appear_in_synthetic_message(self):
        msg = run_skill_dispatch._format_user_message(
            "sales-prep",
            {"customer": "ABC", "meeting_date": "2026-05-10"},
        )
        self.assertIn("sales-prep", msg)
        self.assertIn("ABC", msg)
        self.assertIn("meeting_date", msg)
        self.assertIn("SKILL.md", msg)

    def test_format_tolerates_non_serializable_inputs(self):
        # Sets aren't JSON-serializable; helper falls back to repr rather
        # than blowing up.
        msg = run_skill_dispatch._format_user_message("x", {"s": {1, 2}})
        self.assertIn("x", msg)

    def test_synthetic_payload_honors_both_camel_and_snake_case(self):
        envelope = _base_envelope()
        cfg_camel = {
            "tenantSlug": "acme",
            "agentSlug": "ada",
            "templateModel": "claude",
            "skillsConfig": [{"skillId": "sales-prep", "s3Key": "x"}],
        }
        payload = run_skill_dispatch._build_synthetic_payload(
            envelope, cfg_camel, "hello",
        )
        self.assertEqual(payload["tenant_slug"], "acme")
        self.assertEqual(payload["instance_id"], "ada")
        self.assertEqual(payload["model"], "claude")
        self.assertEqual(payload["trigger_channel"], "run_skill")

        cfg_snake = {
            "tenant_slug": "acme2",
            "agent_slug": "ada2",
            "template_model": "claude2",
            "skills": [{"skillId": "x", "s3Key": "y"}],
        }
        payload2 = run_skill_dispatch._build_synthetic_payload(
            envelope, cfg_snake, "hello",
        )
        self.assertEqual(payload2["tenant_slug"], "acme2")
        self.assertEqual(payload2["instance_id"], "ada2")
        self.assertEqual(payload2["model"], "claude2")


class PostCompletionTests(unittest.TestCase):
    def setUp(self):
        os.environ["THINKWORK_API_URL"] = "https://example.test"
        os.environ["API_AUTH_SECRET"] = "smoke-secret"

    def test_missing_env_logs_and_returns(self):
        # When env is empty AND no snapshot params are passed, the
        # callback logs ERROR and returns without raising. The row
        # then lands on the 15-min reconciler.
        os.environ.pop("THINKWORK_API_URL", None)
        os.environ.pop("API_AUTH_SECRET", None)
        os.environ.pop("THINKWORK_API_SECRET", None)
        with patch("urllib.request.urlopen") as mock_open:
            run_skill_dispatch.post_skill_run_complete(
                "run-x", "tenant-x", "failed", failure_reason="x",
            )
        # No HTTP request fired because we bailed early.
        mock_open.assert_not_called()

    def test_snapshot_params_override_empty_env(self):
        """Regression for the dev-2026-04-25 incident: env can be
        empty at callback time even though it was populated at
        dispatcher entry. The dispatcher snapshots api_url + api_secret
        and passes them as parameters, which must take precedence over
        os.environ — including when os.environ is empty.
        """
        os.environ.pop("THINKWORK_API_URL", None)
        os.environ.pop("API_AUTH_SECRET", None)
        os.environ.pop("THINKWORK_API_SECRET", None)

        class FakeResp:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        captured: dict = {}

        def _fake_urlopen(req, timeout=None):
            captured["url"] = req.full_url
            captured["auth"] = req.headers.get("Authorization")
            return FakeResp()

        with patch("urllib.request.urlopen", side_effect=_fake_urlopen):
            run_skill_dispatch.post_skill_run_complete(
                "run-y",
                "tenant-y",
                "complete",
                completion_hmac_secret="hmac-secret",
                api_url="https://snapshot.example",
                api_secret="snapshot-secret",
            )

        self.assertIn("snapshot.example", captured["url"])
        self.assertEqual(captured["auth"], "Bearer snapshot-secret")

    def test_snapshot_params_take_precedence_over_env(self):
        """When BOTH env and snapshot are present, snapshot wins.
        Env can drift mid-invocation (per the dev-2026-04-25 incident),
        and the dispatcher's at-entry snapshot is the source of truth.
        """
        os.environ["THINKWORK_API_URL"] = "https://stale-env.example"
        os.environ["API_AUTH_SECRET"] = "stale-env-secret"

        class FakeResp:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        captured: dict = {}

        def _fake_urlopen(req, timeout=None):
            captured["url"] = req.full_url
            captured["auth"] = req.headers.get("Authorization")
            return FakeResp()

        with patch("urllib.request.urlopen", side_effect=_fake_urlopen):
            run_skill_dispatch.post_skill_run_complete(
                "run-z",
                "tenant-z",
                "complete",
                completion_hmac_secret="hmac-secret",
                api_url="https://snapshot.example",
                api_secret="snapshot-secret",
            )

        self.assertIn("snapshot.example", captured["url"])
        self.assertNotIn("stale-env", captured["url"])
        self.assertEqual(captured["auth"], "Bearer snapshot-secret")


class UrlopenWithRetryTests(unittest.TestCase):
    def setUp(self):
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
        self.assertEqual(mock_open.call_count, 4)

    def test_400_invalid_transition_treated_as_success_not_retried(self):
        import io
        import urllib.error

        def fake_urlopen(req, timeout=None):
            raise urllib.error.HTTPError(
                url="https://example.test/api/skills/complete",
                code=400, msg="bad",
                hdrs=None,
                fp=io.BytesIO(b'{"error":"invalid transition: complete -> failed"}'),
            )

        with patch("urllib.request.urlopen", side_effect=fake_urlopen) as mock_open:
            resp = run_skill_dispatch._urlopen_with_retry(
                MagicMock(), timeout=15, run_id="r3",
            )
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
            raise TimeoutError("slow downstream")
        with patch("urllib.request.urlopen", side_effect=boom) as mock_open:
            with self.assertRaises(socket.timeout):
                run_skill_dispatch._urlopen_with_retry(
                    MagicMock(), timeout=15, run_id="r5",
                )
        self.assertEqual(mock_open.call_count, 4)


if __name__ == "__main__":
    unittest.main()
