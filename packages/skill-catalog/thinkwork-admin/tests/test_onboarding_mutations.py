"""Contract tests for Unit 8's onboarding mutation wrappers.

Invariants pinned here:

1. Every wrapper runs the same pre-pipeline:
   `_env()` → `_check_admin_role()` → `turn_cap.check_and_increment()`
   → `_graphql(...)`. Each gate can refuse; @_safe turns refusals
   into structured JSON.
2. Every wrapper emits exactly one `audit.emit` call — success or
   failure — and never on an @_safe-caught refusal (because the
   refusal short-circuits before `_end_mutation`).
3. Every wrapper forwards `idempotency_key` into the GraphQL payload
   when truthy; absent / empty string → no field sent.
4. skill.yaml registers all 18 mutations. Opt-in ops
   (remove_tenant_member, remove_team_*, sync_template_to_all_agents)
   must have `default_enabled: false`; everything else true.
"""

from __future__ import annotations

import importlib
import json
import os
import re
import sys
import unittest
from unittest.mock import patch

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.normpath(os.path.join(HERE, "..", "scripts"))
OPERATIONS_DIR = os.path.join(SCRIPTS_DIR, "operations")
for p in (SCRIPTS_DIR, OPERATIONS_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

import agents as agents_ops  # noqa: E402
import audit  # noqa: E402
import teams as teams_ops  # noqa: E402
import templates as templates_ops  # noqa: E402
import tenants as tenants_ops  # noqa: E402
import thinkwork_admin as ta  # noqa: E402
import turn_cap  # noqa: E402


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
        turn_cap.reset_for_tests()

    return cleanup


# Recipe per mutation: (module, fn_name, args, kwargs,
# expected_graphql_result, expected_return_check)
# Keeps the parametric test DRY.
MUTATIONS = [
    # tenants
    (tenants_ops, "update_tenant",
     ("t-1",), {"name": "Acme"},
     {"updateTenant": {"id": "t-1", "name": "Acme"}},
     lambda r: json.loads(r)["id"] == "t-1"),
    (tenants_ops, "add_tenant_member",
     ("t-1", "u-1"), {"role": "member"},
     {"addTenantMember": {"id": "m-1"}},
     lambda r: json.loads(r)["id"] == "m-1"),
    (tenants_ops, "update_tenant_member",
     ("m-1",), {"role": "admin"},
     {"updateTenantMember": {"id": "m-1", "role": "admin"}},
     lambda r: json.loads(r)["role"] == "admin"),
    (tenants_ops, "remove_tenant_member",
     ("m-1",), {},
     {"removeTenantMember": True},
     lambda r: json.loads(r) == {"removed": True}),
    (tenants_ops, "invite_member",
     ("t-1", "x@y.com"), {"name": "X", "role": "admin"},
     {"inviteMember": {"id": "m-2"}},
     lambda r: json.loads(r)["id"] == "m-2"),

    # teams
    (teams_ops, "create_team",
     ("t-1", "Team A"), {"description": "d"},
     {"createTeam": {"id": "team-1"}},
     lambda r: json.loads(r)["id"] == "team-1"),
    (teams_ops, "add_team_agent",
     ("team-1", "agent-1"), {},
     {"addTeamAgent": {"id": "ta-1"}},
     lambda r: json.loads(r)["id"] == "ta-1"),
    (teams_ops, "add_team_user",
     ("team-1", "user-1"), {},
     {"addTeamUser": {"id": "tu-1"}},
     lambda r: json.loads(r)["id"] == "tu-1"),
    (teams_ops, "remove_team_agent",
     ("team-1", "agent-1"), {},
     {"removeTeamAgent": True},
     lambda r: json.loads(r) == {"removed": True}),
    (teams_ops, "remove_team_user",
     ("team-1", "user-1"), {},
     {"removeTeamUser": True},
     lambda r: json.loads(r) == {"removed": True}),

    # agents
    (agents_ops, "create_agent",
     ("t-1", "tpl-1", "Marco"), {"role": "assistant"},
     {"createAgent": {"id": "agent-1", "name": "Marco"}},
     lambda r: json.loads(r)["name"] == "Marco"),
    (agents_ops, "set_agent_skills",
     ("agent-1", [{"skillId": "email"}]), {},
     {"setAgentSkills": [{"agentId": "agent-1"}]},
     lambda r: len(json.loads(r)) == 1),
    (agents_ops, "set_agent_capabilities",
     ("agent-1", [{"capability": "email_channel"}]), {},
     {"setAgentCapabilities": [{"agentId": "agent-1"}]},
     lambda r: len(json.loads(r)) == 1),

    # templates
    (templates_ops, "create_agent_template",
     ("t-1", "Onboarder", "onboarder"), {"model": "claude-sonnet"},
     {"createAgentTemplate": {"id": "tpl-1"}},
     lambda r: json.loads(r)["id"] == "tpl-1"),
    (templates_ops, "create_agent_from_template",
     ("tpl-1", "Marco", "marco"), {"team_id": "team-1"},
     {"createAgentFromTemplate": {"id": "agent-1"}},
     lambda r: json.loads(r)["id"] == "agent-1"),
    (templates_ops, "sync_template_to_agent",
     ("tpl-1", "agent-1"), {},
     {"syncTemplateToAgent": {"id": "agent-1"}},
     lambda r: json.loads(r)["id"] == "agent-1"),
    (templates_ops, "sync_template_to_all_agents",
     ("tpl-1",), {},
     {"syncTemplateToAllAgents": {"agentsSynced": 5, "agentsFailed": 0}},
     lambda r: json.loads(r)["agentsSynced"] == 5),
    (templates_ops, "accept_template_update",
     ("agent-1", "GUARDRAILS.md"), {},
     {"acceptTemplateUpdate": {"id": "agent-1"}},
     lambda r: json.loads(r)["id"] == "agent-1"),
]


class HappyPathPipelineTests(unittest.TestCase):
    """Each wrapper runs the full pre/post pipeline on the happy path."""

    def tearDown(self):
        for k in ENV:
            os.environ.pop(k, None)
        turn_cap.reset_for_tests()

    def test_every_mutation_runs_role_check_turn_cap_graphql_audit(self):
        cleanup = _set_env()
        try:
            for module, fn_name, args, kwargs, gql_result, check in MUTATIONS:
                turn_cap.reset_for_tests()
                calls = []

                def fake_role():
                    calls.append("role")

                def fake_graphql(query, variables=None, _gql=gql_result):
                    calls.append("graphql")
                    return _gql

                audit_calls = []

                def fake_audit(**kw):
                    audit_calls.append(kw)

                with patch.object(ta, "_check_admin_role", side_effect=fake_role), \
                     patch.object(ta, "_graphql", side_effect=fake_graphql), \
                     patch.object(module, "_graphql", side_effect=fake_graphql), \
                     patch.object(audit, "emit", side_effect=fake_audit):
                    result = getattr(module, fn_name)(*args, **kwargs)

                self.assertTrue(
                    check(result),
                    msg=f"{fn_name}: return check failed (got {result!r})",
                )
                # role check fired before graphql call.
                self.assertEqual(
                    calls[:2], ["role", "graphql"],
                    msg=f"{fn_name}: pipeline order wrong (got {calls})",
                )
                # turn counter bumped.
                self.assertEqual(
                    turn_cap.current_count(), 1,
                    msg=f"{fn_name}: turn counter not incremented",
                )
                # exactly one audit line, status=success.
                self.assertEqual(len(audit_calls), 1, msg=fn_name)
                self.assertEqual(audit_calls[0]["status"], "success", msg=fn_name)
                self.assertEqual(
                    audit_calls[0]["operation_name"], fn_name, msg=fn_name,
                )
                self.assertEqual(
                    audit_calls[0]["turn_count"], 1, msg=fn_name,
                )
        finally:
            cleanup()


class RefusalPathTests(unittest.TestCase):
    """A role-check refusal short-circuits before _graphql runs."""

    def tearDown(self):
        for k in ENV:
            os.environ.pop(k, None)
        turn_cap.reset_for_tests()

    def test_member_role_refused_wrapper_side_never_calls_graphql(self):
        cleanup = _set_env()

        def fake_role():
            raise ta.AdminSkillRefusal(
                "missing_admin_role", "not admin", role="member",
            )

        try:
            for module, fn_name, args, kwargs, _gql, _check in MUTATIONS:
                turn_cap.reset_for_tests()
                graphql_calls = {"count": 0}

                def fake_graphql(query, variables=None):
                    graphql_calls["count"] += 1
                    return {}

                with patch.object(ta, "_check_admin_role", side_effect=fake_role), \
                     patch.object(module, "_graphql", side_effect=fake_graphql), \
                     patch.object(ta, "_graphql", side_effect=fake_graphql):
                    raw = getattr(module, fn_name)(*args, **kwargs)

                payload = json.loads(raw)
                self.assertTrue(
                    payload.get("refused"),
                    msg=f"{fn_name}: member caller not refused (got {payload})",
                )
                self.assertEqual(
                    payload["reason"], "missing_admin_role", msg=fn_name,
                )
                self.assertEqual(
                    graphql_calls["count"], 0,
                    msg=f"{fn_name}: _graphql called despite role refusal",
                )
                # Counter MUST NOT bump when _check_admin_role refuses
                # BEFORE the counter runs. _begin_mutation runs role check
                # first, so a pre-counter refusal never touches the cap.
                self.assertEqual(
                    turn_cap.current_count(), 0,
                    msg=f"{fn_name}: counter bumped despite role refusal",
                )
        finally:
            cleanup()

    def test_turn_cap_exceeded_surfaces_structured_refusal(self):
        """When the per-turn cap trips, the wrapper returns a refused shape
        carrying the cap/count — the agent can reason about its budget."""
        cleanup = _set_env()
        try:
            # Pre-burn the cap.
            for _ in range(turn_cap.DEFAULT_MAX_MUTATIONS_PER_TURN):
                turn_cap.check_and_increment()

            graphql_calls = {"count": 0}

            def fake_graphql(query, variables=None):
                graphql_calls["count"] += 1
                return {"createAgent": {"id": "x"}}

            with patch.object(ta, "_check_admin_role", side_effect=lambda: None), \
                 patch.object(agents_ops, "_graphql", side_effect=fake_graphql), \
                 patch.object(ta, "_graphql", side_effect=fake_graphql):
                raw = agents_ops.create_agent("t-1", "tpl-1", "Marco")

            payload = json.loads(raw)
            self.assertTrue(payload.get("refused"))
            # The exception name lands in reason — sanity-check the
            # agent-facing shape.
            self.assertIn("turn", payload.get("message", "").lower())
            self.assertEqual(
                graphql_calls["count"], 0,
                "turn-cap-exceeded must not reach _graphql",
            )
        finally:
            cleanup()


class IdempotencyKeyForwardingTests(unittest.TestCase):
    """idempotency_key kwarg flows into the GraphQL payload when truthy."""

    def tearDown(self):
        for k in ENV:
            os.environ.pop(k, None)
        turn_cap.reset_for_tests()

    def test_create_agent_forwards_key_into_input_object(self):
        cleanup = _set_env()
        captured = {}

        def fake_graphql(query, variables=None):
            captured["vars"] = variables
            return {"createAgent": {"id": "a-1"}}

        try:
            with patch.object(ta, "_check_admin_role", side_effect=lambda: None), \
                 patch.object(agents_ops, "_graphql", side_effect=fake_graphql):
                agents_ops.create_agent(
                    "t-1", "tpl-1", "Marco",
                    idempotency_key="onboard-foo:create-agent:marco",
                )
            self.assertEqual(
                captured["vars"]["input"]["idempotencyKey"],
                "onboard-foo:create-agent:marco",
            )
        finally:
            cleanup()

    def test_bare_arg_mutation_forwards_key_as_top_level_arg(self):
        """sync_template_to_agent is bare-arg — key goes at the top
        level, not inside an input object."""
        cleanup = _set_env()
        captured = {}

        def fake_graphql(query, variables=None):
            captured["vars"] = variables
            return {"syncTemplateToAgent": {"id": "a-1"}}

        try:
            with patch.object(ta, "_check_admin_role", side_effect=lambda: None), \
                 patch.object(templates_ops, "_graphql", side_effect=fake_graphql):
                templates_ops.sync_template_to_agent(
                    "tpl-1", "agent-1", idempotency_key="step-3",
                )
            self.assertEqual(captured["vars"]["idempotencyKey"], "step-3")
            self.assertNotIn("input", captured["vars"])
        finally:
            cleanup()

    def test_absent_idempotency_key_omits_the_field(self):
        cleanup = _set_env()
        captured = {}

        def fake_graphql(query, variables=None):
            captured["vars"] = variables
            return {"createTeam": {"id": "team-1"}}

        try:
            with patch.object(ta, "_check_admin_role", side_effect=lambda: None), \
                 patch.object(teams_ops, "_graphql", side_effect=fake_graphql):
                teams_ops.create_team("t-1", "Team A")
            self.assertNotIn("idempotencyKey", captured["vars"]["input"])
        finally:
            cleanup()


class ManifestRegistrationTests(unittest.TestCase):
    """skill.yaml registers every mutation with the correct default_enabled flag."""

    # Plan's inventory table — opt-in = default_enabled:false.
    EXPECTED = {
        "update_tenant": True,
        "add_tenant_member": True,
        "update_tenant_member": True,
        "remove_tenant_member": False,
        "invite_member": True,
        "create_team": True,
        "add_team_agent": True,
        "add_team_user": True,
        "remove_team_agent": False,
        "remove_team_user": False,
        "create_agent": True,
        "set_agent_skills": True,
        "set_agent_capabilities": True,
        "create_agent_template": True,
        "create_agent_from_template": True,
        "sync_template_to_agent": True,
        "sync_template_to_all_agents": False,
        "accept_template_update": True,
    }

    def test_all_mutations_registered_with_correct_default_enabled(self):
        manifest_path = os.path.normpath(
            os.path.join(HERE, "..", "skill.yaml")
        )
        with open(manifest_path) as f:
            yaml_text = f.read()

        for fn_name, expected_default in self.EXPECTED.items():
            # Find the chunk for this op (starts with `- name:` and
            # continues until the next `- name:` or EOF).
            chunks = re.split(r"^(\s*)-\s*name:\s*", yaml_text, flags=re.M)
            # chunks shape: [preamble, indent, op_content, indent, op_content, ...]
            found = None
            for i in range(2, len(chunks), 2):
                content = chunks[i]
                if content.lstrip().startswith(fn_name):
                    found = content
                    break
            self.assertIsNotNone(
                found,
                msg=f"skill.yaml missing registration for '{fn_name}'",
            )
            expected_literal = "true" if expected_default else "false"
            self.assertRegex(
                found,
                rf"default_enabled:\s*{expected_literal}",
                msg=(
                    f"{fn_name}: wrong default_enabled "
                    f"(expected {expected_literal})"
                ),
            )

    def test_exported_mutations_match_expected_set(self):
        """Guard against drift between the modules' __all__ and the
        test's EXPECTED dict."""
        exported = set()
        for mod in (tenants_ops, teams_ops, agents_ops, templates_ops):
            exported.update(mod.__all__)
        self.assertEqual(
            exported, set(self.EXPECTED.keys()),
            "module __all__ lists drifted from EXPECTED in this test",
        )


if __name__ == "__main__":
    unittest.main()
