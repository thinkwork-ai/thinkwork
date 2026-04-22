"""Contract tests for the thinkwork-admin wrapper helpers.

Three invariants pinned here:

1. `_env()` refuses loudly when CURRENT_USER_ID is unset (R15 — no
   human invoker, no admin action). Webhook-triggered invocations
   deliberately leave the env var blank; a refusal lands in the audit
   log rather than a doomed mutation call.
2. `_graphql()` attaches the existing header shape
   `cognito-auth.ts` already parses — x-api-key / x-tenant-id /
   x-agent-id / x-principal-id. No new headers.
3. `_check_admin_role()` delegates to the scoped `adminRoleCheck`
   query and raises `AdminSkillRefusal(reason="missing_admin_role")`
   for any role outside `owner` / `admin`.
"""

from __future__ import annotations

import json
import os
import sys
import unittest
from unittest.mock import patch

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.normpath(os.path.join(HERE, "..", "scripts"))
sys.path.insert(0, SCRIPTS_DIR)

import thinkwork_admin as ta  # noqa: E402


ENV_KEYS = [
    "THINKWORK_API_URL",
    "THINKWORK_API_SECRET",
    "API_AUTH_SECRET",
    "TENANT_ID",
    "_MCP_TENANT_ID",
    "AGENT_ID",
    "_MCP_AGENT_ID",
    "CURRENT_USER_ID",
]


def _set_env(**overrides):
    """Populate the module's env + return a cleanup callable."""
    originals = {k: os.environ.get(k) for k in ENV_KEYS}
    defaults = {
        "THINKWORK_API_URL": "https://api.test.invalid",
        "THINKWORK_API_SECRET": "test-secret",
        "TENANT_ID": "tenant-A",
        "AGENT_ID": "agent-A",
        "CURRENT_USER_ID": "user-A",
    }
    for k in ENV_KEYS:
        os.environ.pop(k, None)
    for k, v in {**defaults, **overrides}.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v

    def cleanup():
        for k, v in originals.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    return cleanup


class EnvTests(unittest.TestCase):
    def tearDown(self):
        for k in ENV_KEYS:
            os.environ.pop(k, None)

    def test_full_env_returns_resolved_values(self):
        cleanup = _set_env()
        try:
            env = ta._env()
            self.assertEqual(env["current_user_id"], "user-A")
            self.assertEqual(env["tenant_id"], "tenant-A")
            self.assertEqual(env["agent_id"], "agent-A")
            self.assertEqual(env["api_url"], "https://api.test.invalid")
            self.assertEqual(env["api_secret"], "test-secret")
        finally:
            cleanup()

    def test_missing_current_user_id_refuses_loudly(self):
        """R15: webhook-triggered invocations leave CURRENT_USER_ID blank —
        the wrapper refuses with reason=no_invoker rather than using a
        default / empty value."""
        cleanup = _set_env(CURRENT_USER_ID=None)
        try:
            with self.assertRaises(ta.AdminSkillRefusal) as cm:
                ta._env()
            self.assertEqual(cm.exception.reason, "no_invoker")
        finally:
            cleanup()

    def test_empty_current_user_id_treated_as_absent(self):
        """Payload may pass '' rather than omitting the key; still refuse."""
        cleanup = _set_env(CURRENT_USER_ID="")
        try:
            with self.assertRaises(ta.AdminSkillRefusal) as cm:
                ta._env()
            self.assertEqual(cm.exception.reason, "no_invoker")
        finally:
            cleanup()

    def test_missing_secret_refuses_with_env_misconfigured(self):
        cleanup = _set_env(THINKWORK_API_SECRET=None, API_AUTH_SECRET=None)
        try:
            with self.assertRaises(ta.AdminSkillRefusal) as cm:
                ta._env()
            self.assertEqual(cm.exception.reason, "env_misconfigured")
            self.assertIn("THINKWORK_API_SECRET", cm.exception.extra["missing"])
        finally:
            cleanup()

    def test_falls_back_to_api_auth_secret_when_thinkwork_api_secret_is_missing(
        self,
    ):
        cleanup = _set_env(THINKWORK_API_SECRET=None, API_AUTH_SECRET="fallback")
        try:
            env = ta._env()
            self.assertEqual(env["api_secret"], "fallback")
        finally:
            cleanup()


class GraphqlHeadersTests(unittest.TestCase):
    def tearDown(self):
        for k in ENV_KEYS:
            os.environ.pop(k, None)

    def test_graphql_sends_existing_header_shape_no_new_headers(self):
        """No x-invoker-user-id or other new header — cognito-auth.ts
        already parses principalId from x-principal-id for apikey
        callers."""
        cleanup = _set_env()
        captured = {}

        class FakeResp:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def read(self):
                return json.dumps(
                    {"data": {"adminRoleCheck": {"role": "admin"}}}
                ).encode("utf-8")

        def fake_urlopen(req, timeout=None):
            captured["url"] = req.full_url
            captured["headers"] = dict(req.headers)
            captured["body"] = req.data.decode("utf-8")
            return FakeResp()

        try:
            with patch("urllib.request.urlopen", side_effect=fake_urlopen):
                ta._graphql("query { adminRoleCheck { role } }")
            self.assertTrue(captured["url"].endswith("/graphql"))
            # urllib normalizes header names to Title-Case on the Request
            # object — compare case-insensitively.
            headers_lower = {k.lower(): v for k, v in captured["headers"].items()}
            self.assertEqual(headers_lower["x-api-key"], "test-secret")
            self.assertEqual(headers_lower["x-tenant-id"], "tenant-A")
            self.assertEqual(headers_lower["x-agent-id"], "agent-A")
            self.assertEqual(headers_lower["x-principal-id"], "user-A")
            self.assertNotIn("x-invoker-user-id", headers_lower)
            # Body carries the query
            self.assertIn("adminRoleCheck", captured["body"])
        finally:
            cleanup()


class CheckAdminRoleTests(unittest.TestCase):
    def tearDown(self):
        for k in ENV_KEYS:
            os.environ.pop(k, None)

    def _with_role(self, role: str):
        def fake_graphql(query, variables=None):
            return {"adminRoleCheck": {"role": role}}

        return fake_graphql

    def test_admin_role_passes(self):
        cleanup = _set_env()
        try:
            with patch.object(ta, "_graphql", side_effect=self._with_role("admin")):
                ta._check_admin_role()  # no raise
        finally:
            cleanup()

    def test_owner_role_passes(self):
        cleanup = _set_env()
        try:
            with patch.object(ta, "_graphql", side_effect=self._with_role("owner")):
                ta._check_admin_role()
        finally:
            cleanup()

    def test_member_role_refuses_with_structured_reason(self):
        cleanup = _set_env()
        try:
            with patch.object(ta, "_graphql", side_effect=self._with_role("member")):
                with self.assertRaises(ta.AdminSkillRefusal) as cm:
                    ta._check_admin_role()
            self.assertEqual(cm.exception.reason, "missing_admin_role")
            self.assertEqual(cm.exception.extra["role"], "member")
        finally:
            cleanup()

    def test_other_role_refuses(self):
        cleanup = _set_env()
        try:
            with patch.object(ta, "_graphql", side_effect=self._with_role("other")):
                with self.assertRaises(ta.AdminSkillRefusal):
                    ta._check_admin_role()
        finally:
            cleanup()


class SafeDecoratorTests(unittest.TestCase):
    def tearDown(self):
        for k in ENV_KEYS:
            os.environ.pop(k, None)

    def test_admin_skill_refusal_wraps_to_structured_json(self):
        @ta._safe
        def tool():
            raise ta.AdminSkillRefusal(
                "missing_admin_role", "not an admin", role="member"
            )

        payload = json.loads(tool())
        self.assertEqual(payload["refused"], True)
        self.assertEqual(payload["reason"], "missing_admin_role")
        self.assertEqual(payload["role"], "member")

    def test_generic_exception_maps_to_reason_internal(self):
        @ta._safe
        def tool():
            raise RuntimeError("boom")

        payload = json.loads(tool())
        self.assertEqual(payload["refused"], True)
        self.assertEqual(payload["reason"], "internal")

    def test_success_passthrough(self):
        @ta._safe
        def tool():
            return "ok"

        self.assertEqual(tool(), "ok")


if __name__ == "__main__":
    unittest.main()
