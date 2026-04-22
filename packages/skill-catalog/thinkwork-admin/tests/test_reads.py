"""Contract tests for Unit 7's read tool functions.

Three invariant classes pinned:

1. Every read runs `_check_admin_role` before issuing its query.
   A member-role caller is refused at the wrapper (early-fail UX)
   before the HTTP call — even though the server-side resolver
   would refuse too.
2. Every read wraps a GraphQL query with the right field set and
   returns the result as JSON. A refusal raised by the wrapper
   flows through `@_safe` into a structured `{refused: true, ...}`
   shape.
3. The skill.yaml manifest declares every function this module
   exports, with `default_enabled: true` for all of them — so the
   skill-catalog sync and the resolver-side allowlist agree on the
   op name set.
"""

from __future__ import annotations

import json
import os
import re
import sys
import unittest
from unittest.mock import patch

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.normpath(os.path.join(HERE, "..", "scripts"))
OPERATIONS_DIR = os.path.join(SCRIPTS_DIR, "operations")
sys.path.insert(0, SCRIPTS_DIR)
sys.path.insert(0, OPERATIONS_DIR)

import reads  # noqa: E402
import thinkwork_admin as ta  # noqa: E402


ENV = {
    "THINKWORK_API_URL": "https://api.test.invalid",
    "THINKWORK_API_SECRET": "test-secret",
    "TENANT_ID": "tenant-A",
    "AGENT_ID": "agent-A",
    "CURRENT_USER_ID": "user-A",
}


def _set_env():
    originals = {k: os.environ.get(k) for k in ENV}
    for k, v in ENV.items():
        os.environ[k] = v

    def cleanup():
        for k, v in originals.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    return cleanup


def _admin_ok_role_check():
    """Stub for _check_admin_role that resolves as admin."""
    # No-op — admin passes, no raise.
    return None


def _member_role_check():
    """Stub that raises AdminSkillRefusal(missing_admin_role)."""
    raise ta.AdminSkillRefusal(
        "missing_admin_role", "not admin", role="member"
    )


class ReadGatingTests(unittest.TestCase):
    """Every read must consult `_check_admin_role` before calling _graphql."""

    def tearDown(self):
        for k in ENV:
            os.environ.pop(k, None)

    def test_list_agents_calls_role_check_before_graphql(self):
        cleanup = _set_env()
        calls = []

        def fake_role():
            calls.append("role")

        def fake_graphql(query, variables=None):
            calls.append("graphql")
            return {"agents": []}

        try:
            with patch.object(reads, "_check_admin_role", side_effect=fake_role), \
                 patch.object(reads, "_graphql", side_effect=fake_graphql):
                reads.list_agents("tenant-A")
        finally:
            cleanup()

        self.assertEqual(calls, ["role", "graphql"])

    def test_every_exported_read_enforces_role_gate(self):
        """Parametric: for every function in reads.__all__, a member
        role-check refusal surfaces as a structured refused shape and
        _graphql is never called."""
        cleanup = _set_env()

        # Minimal args per function — enough to type-satisfy.
        arg_recipes: dict[str, tuple[tuple, dict]] = {
            "me": ((), {}),
            "get_tenant": (("t-1",), {}),
            "get_tenant_by_slug": (("foo",), {}),
            "get_user": (("u-1",), {}),
            "list_tenant_members": (("t-1",), {}),
            "list_agents": (("t-1",), {}),
            "get_agent": (("a-1",), {}),
            "list_all_tenant_agents": (("t-1",), {}),
            "list_templates": (("t-1",), {}),
            "get_template": (("tpl-1",), {}),
            "list_linked_agents_for_template": (("tpl-1",), {}),
            "list_teams": (("t-1",), {}),
            "get_team": (("team-1",), {}),
            "list_artifacts": (("t-1",), {}),
            "get_artifact": (("art-1",), {}),
        }
        # Any missing entry is a test-coverage bug — fail if reads.__all__
        # grows without a recipe.
        self.assertEqual(
            sorted(reads.__all__), sorted(arg_recipes.keys()),
            "arg_recipes out of sync with reads.__all__",
        )

        graphql_called = {"count": 0}

        def fake_graphql(query, variables=None):
            graphql_called["count"] += 1
            return {}

        try:
            for fn_name in reads.__all__:
                args, kwargs = arg_recipes[fn_name]
                with patch.object(reads, "_check_admin_role", side_effect=_member_role_check), \
                     patch.object(reads, "_graphql", side_effect=fake_graphql):
                    raw = getattr(reads, fn_name)(*args, **kwargs)
                payload = json.loads(raw)
                self.assertTrue(
                    payload.get("refused"),
                    f"{fn_name}: member-role caller not refused (got {payload!r})",
                )
                self.assertEqual(
                    payload["reason"], "missing_admin_role",
                    f"{fn_name}: wrong refusal reason",
                )
        finally:
            cleanup()

        self.assertEqual(
            graphql_called["count"], 0,
            "_graphql was called despite role-check refusal — early-fail broken",
        )


class ReadQueryShapeTests(unittest.TestCase):
    """Spot-check that each read wraps the right query + returns the expected key."""

    def tearDown(self):
        for k in ENV:
            os.environ.pop(k, None)

    def _run(self, fn, response: dict, *args, **kwargs) -> str:
        cleanup = _set_env()
        captured = {}

        def fake_graphql(query, variables=None):
            captured["query"] = query
            captured["variables"] = variables
            return response

        try:
            with patch.object(reads, "_check_admin_role", side_effect=_admin_ok_role_check), \
                 patch.object(reads, "_graphql", side_effect=fake_graphql):
                out = fn(*args, **kwargs)
        finally:
            cleanup()
        return out, captured

    def test_me_unwraps_response(self):
        out, cap = self._run(reads.me, {"me": {"id": "u-1", "email": "a@b"}})
        self.assertIn("me {", cap["query"])
        self.assertEqual(json.loads(out), {"id": "u-1", "email": "a@b"})

    def test_get_tenant_passes_id(self):
        out, cap = self._run(
            reads.get_tenant, {"tenant": {"id": "t-1"}}, "t-1"
        )
        self.assertEqual(cap["variables"], {"id": "t-1"})
        self.assertEqual(json.loads(out), {"id": "t-1"})

    def test_list_agents_filter_args_forwarded(self):
        out, cap = self._run(
            reads.list_agents, {"agents": []}, "t-1", status="active",
            type="agent", include_system=True,
        )
        self.assertEqual(
            cap["variables"],
            {"tenantId": "t-1", "status": "active", "type": "agent", "includeSystem": True},
        )
        self.assertEqual(json.loads(out), [])

    def test_list_agents_omits_optional_args_when_absent(self):
        _, cap = self._run(reads.list_agents, {"agents": []}, "t-1")
        self.assertEqual(
            cap["variables"], {"tenantId": "t-1", "includeSystem": False}
        )
        self.assertNotIn("status", cap["variables"])
        self.assertNotIn("type", cap["variables"])

    def test_list_artifacts_forwards_all_optional_filters(self):
        _, cap = self._run(
            reads.list_artifacts,
            {"artifacts": []},
            "t-1",
            thread_id="thread-1",
            agent_id="agent-1",
            type="document",
            status="ready",
            limit=10,
        )
        self.assertEqual(
            cap["variables"],
            {
                "tenantId": "t-1",
                "threadId": "thread-1",
                "agentId": "agent-1",
                "type": "document",
                "status": "ready",
                "limit": 10,
            },
        )

    def test_list_tenant_members_returns_list(self):
        out, _ = self._run(
            reads.list_tenant_members,
            {"tenantMembers": [{"id": "m-1"}, {"id": "m-2"}]},
            "t-1",
        )
        self.assertEqual(len(json.loads(out)), 2)


class ManifestRegistrationTests(unittest.TestCase):
    """skill.yaml must declare every function in reads.__all__."""

    def test_every_read_registered_with_default_enabled_true(self):
        manifest_path = os.path.normpath(
            os.path.join(HERE, "..", "skill.yaml")
        )
        with open(manifest_path) as f:
            yaml_text = f.read()

        for fn_name in reads.__all__:
            # Match `  - name: fn_name` at any indentation; each entry
            # must then declare default_enabled: true. Split-by-name
            # trick below gives the chunk-local check.
            name_pattern = re.compile(
                rf"^\s*-\s*name:\s*{fn_name}\s*$", re.MULTILINE
            )
            self.assertTrue(
                name_pattern.search(yaml_text),
                msg=f"skill.yaml missing registration for '{fn_name}'",
            )
            # Loose locality check: the next `default_enabled` after the
            # name line must be `true`. Split on `- name:` and look.
            chunks = yaml_text.split("- name:")
            # chunks[0] is the preamble; chunk[i] starts with `   fn_name\n`.
            matched_chunk = None
            for chunk in chunks[1:]:
                if chunk.lstrip().startswith(fn_name):
                    matched_chunk = chunk
                    break
            self.assertIsNotNone(matched_chunk, f"no chunk for {fn_name}")
            self.assertRegex(
                matched_chunk,
                r"default_enabled:\s*true",
                msg=f"{fn_name} not declared default_enabled: true",
            )


if __name__ == "__main__":
    unittest.main()
