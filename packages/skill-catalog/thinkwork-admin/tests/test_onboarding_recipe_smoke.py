"""End-to-end smoke for a stamp-out-an-enterprise recipe (Unit 13).

The per-unit tests pin each piece in isolation. This test exercises
the integrated story: the admin skill's Python wrappers chained into
a recipe-style sequence, asserting:

  * Role check runs once per tool call (not cached across the turn).
  * Turn counter accumulates across the sequence — 4 mutations →
    current_count == 4 at the end.
  * Audit log emits exactly one STRUCTURED_LOG line per call.
  * Each call forwards its idempotency_key into the GraphQL payload.
  * Refusal mid-recipe does NOT roll back prior-call audit lines;
    the operator can see which steps succeeded vs failed.
"""

from __future__ import annotations

import json
import os
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
import thinkwork_admin as ta  # noqa: E402
import turn_cap  # noqa: E402


ENV = {
    "THINKWORK_API_URL": "https://api.test.invalid",
    "THINKWORK_API_SECRET": "smoke-secret-value",
    "TENANT_ID": "tenant-foo",
    "AGENT_ID": "onboarding-agent",
    "CURRENT_USER_ID": "admin-1",
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


class OnboardingRecipeSmokeTests(unittest.TestCase):
    """Happy-path recipe: create template → create agent from template →
    add agent to team → accept template update.

    Four sequential mutations, each with its own idempotency key
    keyed by the enterprise being onboarded.
    """

    def tearDown(self):
        for k in ENV:
            os.environ.pop(k, None)
        turn_cap.reset_for_tests()

    def test_full_onboarding_sequence(self):
        cleanup = _set_env()
        try:
            role_calls = []
            audit_calls = []
            graphql_calls = []

            def fake_role():
                role_calls.append("role")

            def fake_audit(**kw):
                audit_calls.append(kw)

            def fake_graphql(query, variables=None):
                graphql_calls.append({"query": query, "variables": variables})
                # Return plausible per-mutation fixtures.
                if "createAgentTemplate" in query:
                    return {"createAgentTemplate": {"id": "tpl-foo", "name": "Onboarder"}}
                if "createAgentFromTemplate" in query:
                    return {"createAgentFromTemplate": {"id": "agent-marco", "name": "Marco"}}
                if "addTeamAgent" in query:
                    return {"addTeamAgent": {"id": "ta-1"}}
                if "acceptTemplateUpdate" in query:
                    return {"acceptTemplateUpdate": {"id": "agent-marco"}}
                return {}

            patches = (
                patch.object(ta, "_check_admin_role", side_effect=fake_role),
                patch.object(audit, "emit", side_effect=fake_audit),
                patch.object(templates_ops, "_graphql", side_effect=fake_graphql),
                patch.object(teams_ops, "_graphql", side_effect=fake_graphql),
            )
            for p in patches:
                p.start()
            try:
                # Step 1 — template.
                out1 = templates_ops.create_agent_template(
                    "tenant-foo", "Onboarder", "onboarder",
                    model="claude-sonnet",
                    idempotency_key="onboard-foo:step-1:template",
                )
                self.assertEqual(json.loads(out1)["id"], "tpl-foo")

                # Step 2 — agent from template.
                out2 = templates_ops.create_agent_from_template(
                    "tpl-foo", "Marco", "marco",
                    idempotency_key="onboard-foo:step-2:agent",
                )
                self.assertEqual(json.loads(out2)["id"], "agent-marco")

                # Step 3 — add to team.
                out3 = teams_ops.add_team_agent(
                    "team-A", "agent-marco",
                    idempotency_key="onboard-foo:step-3:team",
                )
                self.assertEqual(json.loads(out3)["id"], "ta-1")

                # Step 4 — accept pinned-file update.
                out4 = templates_ops.accept_template_update(
                    "agent-marco", "GUARDRAILS.md",
                    idempotency_key="onboard-foo:step-4:pin",
                )
                self.assertEqual(json.loads(out4)["id"], "agent-marco")
            finally:
                for p in patches:
                    p.stop()

            # Role check ran EVERY step — not cached across calls (R16).
            self.assertEqual(len(role_calls), 4)
            # Turn counter accumulated across the full sequence.
            self.assertEqual(turn_cap.current_count(), 4)
            # Exactly one audit line per call.
            self.assertEqual(len(audit_calls), 4)
            for call in audit_calls:
                self.assertEqual(call["status"], "success")
                self.assertEqual(call["invoker_user_id"], "admin-1")
                self.assertEqual(call["agent_tenant_id"], "tenant-foo")
            # turn_count field on each audit line matches its position
            # in the sequence.
            self.assertEqual(
                [c["turn_count"] for c in audit_calls], [1, 2, 3, 4],
            )
            # Every GraphQL variable payload forwards its idempotency key.
            keys = []
            for call in graphql_calls:
                v = call["variables"]
                if "input" in v and "idempotencyKey" in v["input"]:
                    keys.append(v["input"]["idempotencyKey"])
                elif "idempotencyKey" in v:
                    keys.append(v["idempotencyKey"])
            self.assertEqual(
                keys,
                [
                    "onboard-foo:step-1:template",
                    "onboard-foo:step-2:agent",
                    "onboard-foo:step-3:team",
                    "onboard-foo:step-4:pin",
                ],
            )
        finally:
            cleanup()

    def test_refusal_mid_recipe_preserves_prior_audit_lines(self):
        """If step 3 fails, steps 1+2 audit lines stay — the operator
        can see the partial progress. Step 3 emits a refused line."""
        cleanup = _set_env()
        try:
            audit_calls = []

            role_call_count = {"n": 0}

            def fake_role():
                role_call_count["n"] += 1
                # Steps 1 and 2 pass. Step 3 is refused (pretend the
                # role was revoked mid-recipe — R16 DB-live revocation).
                if role_call_count["n"] >= 3:
                    raise ta.AdminSkillRefusal(
                        "missing_admin_role", "role revoked", role="member",
                    )

            def fake_audit(**kw):
                audit_calls.append(kw)

            def fake_graphql(query, variables=None):
                if "createAgentTemplate" in query:
                    return {"createAgentTemplate": {"id": "tpl-foo"}}
                if "createAgentFromTemplate" in query:
                    return {"createAgentFromTemplate": {"id": "agent-marco"}}
                return {}

            patches = (
                patch.object(ta, "_check_admin_role", side_effect=fake_role),
                patch.object(audit, "emit", side_effect=fake_audit),
                patch.object(templates_ops, "_graphql", side_effect=fake_graphql),
                patch.object(teams_ops, "_graphql", side_effect=fake_graphql),
            )
            for p in patches:
                p.start()
            try:
                out1 = templates_ops.create_agent_template(
                    "tenant-foo", "Onboarder", "onboarder",
                )
                out2 = templates_ops.create_agent_from_template(
                    "tpl-foo", "Marco", "marco",
                )
                # Step 3 refused — @_safe turns the exception into
                # a structured JSON refusal.
                out3 = teams_ops.add_team_agent("team-A", "agent-marco")
            finally:
                for p in patches:
                    p.stop()

            # Steps 1/2 succeeded; step 3 refused.
            self.assertEqual(json.loads(out1)["id"], "tpl-foo")
            self.assertEqual(json.loads(out2)["id"], "agent-marco")
            self.assertTrue(json.loads(out3).get("refused"))

            # Audit: steps 1/2 emitted success lines BEFORE the refusal;
            # step 3 did not reach _end_mutation because the role check
            # raised before _begin_mutation completed. The @_safe-caught
            # AdminSkillRefusal surfaces as a JSON refusal without
            # emitting its own audit line (that's Unit 12's deliberate
            # design: @_safe refusals are already structured).
            self.assertEqual(len(audit_calls), 2)
            self.assertEqual(audit_calls[0]["status"], "success")
            self.assertEqual(audit_calls[1]["status"], "success")
            # Turn counter reflects the successful calls only; step 3's
            # role-check refusal raised before the counter incremented.
            self.assertEqual(turn_cap.current_count(), 2)
        finally:
            cleanup()


if __name__ == "__main__":
    unittest.main()
