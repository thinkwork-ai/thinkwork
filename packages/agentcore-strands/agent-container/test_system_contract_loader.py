"""Tests for system_contract_loader (plan 2026-05-21-004 §U1).

Pinned scenarios:

  - Happy path — one matching contract returns its body.
  - Happy path — two matching contracts return both, sorted by slug.
  - Negative match — condition key absent → no load (fail-closed).
  - Negative match — partial key match → no load (every key must match).
  - Discrimination — skill without ``contract: system`` is not loaded.
  - Template substitution — declared variables substitute; missing variable
    substitutes to empty string.
  - Robustness — malformed SKILL.md is skipped, other contracts still load.
  - Determinism — same inputs return bodies in the same order.
  - Edge — missing ``activates_on`` field treats the contract as always-on
    for system contracts (the ``contract: system`` discriminator already
    filters non-contracts out).
  - Edge — non-mapping ``activates_on`` (typo, e.g. a list) fails closed.
  - Edge — catalog_dir does not exist returns empty list, no crash.
"""

from __future__ import annotations

import os
import tempfile
import textwrap
import unittest

from system_contract_loader import load_system_contracts


def _write_skill(catalog_dir: str, slug: str, frontmatter: str, body: str) -> str:
    """Create ``<catalog_dir>/<slug>/SKILL.md`` and return its path."""
    skill_dir = os.path.join(catalog_dir, slug)
    os.makedirs(skill_dir, exist_ok=True)
    path = os.path.join(skill_dir, "SKILL.md")
    with open(path, "w") as fh:
        fh.write(textwrap.dedent(frontmatter).strip("\n"))
        fh.write("\n")
        fh.write(textwrap.dedent(body).strip("\n"))
        fh.write("\n")
    return path


class LoadSystemContractsHappyPathTests(unittest.TestCase):
    def test_single_matching_contract_returns_its_body(self) -> None:
        with tempfile.TemporaryDirectory() as catalog_dir:
            _write_skill(
                catalog_dir,
                "computer-thread-contract",
                """
                ---
                name: computer-thread-contract
                description: Behavioral contract for Computer turns
                contract: system
                activates_on:
                  thread_mode: computer
                ---
                """,
                "Computer turn rules apply here.",
            )

            bodies = load_system_contracts(
                catalog_dir,
                conditions={"thread_mode": "computer"},
            )

        self.assertEqual(len(bodies), 1)
        self.assertIn("Computer turn rules apply here.", bodies[0])

    def test_two_matching_contracts_return_both_sorted_by_slug(self) -> None:
        with tempfile.TemporaryDirectory() as catalog_dir:
            _write_skill(
                catalog_dir,
                "z-second-contract",
                """
                ---
                name: z-second-contract
                description: Second alphabetically
                contract: system
                activates_on:
                  thread_mode: computer
                ---
                """,
                "Body Z.",
            )
            _write_skill(
                catalog_dir,
                "a-first-contract",
                """
                ---
                name: a-first-contract
                description: First alphabetically
                contract: system
                activates_on:
                  thread_mode: computer
                ---
                """,
                "Body A.",
            )

            bodies = load_system_contracts(
                catalog_dir,
                conditions={"thread_mode": "computer"},
            )

        self.assertEqual(len(bodies), 2)
        self.assertIn("Body A.", bodies[0])
        self.assertIn("Body Z.", bodies[1])


class LoadSystemContractsNegativeMatchTests(unittest.TestCase):
    def test_missing_condition_key_fails_closed(self) -> None:
        """A frontmatter key absent from conditions must not match.

        The fail-closed semantics prevent a typo'd ``activates_on`` from
        silently activating a contract on every turn.
        """
        with tempfile.TemporaryDirectory() as catalog_dir:
            _write_skill(
                catalog_dir,
                "needs-eval-mode",
                """
                ---
                name: needs-eval-mode
                description: Only fires in eval mode
                contract: system
                activates_on:
                  eval_mode: true
                ---
                """,
                "Eval rules here.",
            )

            bodies = load_system_contracts(
                catalog_dir,
                conditions={"thread_mode": "computer"},  # no eval_mode key
            )

        self.assertEqual(bodies, [])

    def test_partial_match_does_not_load(self) -> None:
        """Every key in activates_on must match — partial overlap is not enough."""
        with tempfile.TemporaryDirectory() as catalog_dir:
            _write_skill(
                catalog_dir,
                "computer-and-eval",
                """
                ---
                name: computer-and-eval
                description: Requires both flags
                contract: system
                activates_on:
                  thread_mode: computer
                  eval_mode: true
                ---
                """,
                "Both required.",
            )

            bodies = load_system_contracts(
                catalog_dir,
                conditions={"thread_mode": "computer", "eval_mode": False},
            )

        self.assertEqual(bodies, [])


class LoadSystemContractsDiscriminationTests(unittest.TestCase):
    def test_skill_without_contract_system_is_not_loaded(self) -> None:
        """User-invocable skills (no ``contract: system``) must never load via this path."""
        with tempfile.TemporaryDirectory() as catalog_dir:
            _write_skill(
                catalog_dir,
                "user-invocable-skill",
                """
                ---
                name: user-invocable-skill
                description: A regular skill, not a system contract
                activates_on:
                  thread_mode: computer
                ---
                """,
                "Should not load.",
            )

            bodies = load_system_contracts(
                catalog_dir,
                conditions={"thread_mode": "computer"},
            )

        self.assertEqual(bodies, [])

    def test_contract_field_with_wrong_value_is_not_loaded(self) -> None:
        with tempfile.TemporaryDirectory() as catalog_dir:
            _write_skill(
                catalog_dir,
                "wrong-contract-value",
                """
                ---
                name: wrong-contract-value
                description: Has contract field but wrong value
                contract: user
                activates_on:
                  thread_mode: computer
                ---
                """,
                "Should not load.",
            )

            bodies = load_system_contracts(
                catalog_dir,
                conditions={"thread_mode": "computer"},
            )

        self.assertEqual(bodies, [])


class LoadSystemContractsTemplateSubstitutionTests(unittest.TestCase):
    def test_declared_variables_substitute_in_body(self) -> None:
        with tempfile.TemporaryDirectory() as catalog_dir:
            _write_skill(
                catalog_dir,
                "with-variables",
                """
                ---
                name: with-variables
                description: Templated contract
                contract: system
                activates_on:
                  thread_mode: computer
                template_variables:
                  - thread_id
                  - prompt
                ---
                """,
                "Current threadId: {{thread_id}} / prompt: {{prompt}}",
            )

            bodies = load_system_contracts(
                catalog_dir,
                conditions={"thread_mode": "computer"},
                variables={"thread_id": "t-1", "prompt": "hello"},
            )

        self.assertEqual(len(bodies), 1)
        self.assertIn("Current threadId: t-1", bodies[0])
        self.assertIn("prompt: hello", bodies[0])
        self.assertNotIn("{{thread_id}}", bodies[0])
        self.assertNotIn("{{prompt}}", bodies[0])

    def test_missing_variable_substitutes_to_empty_string(self) -> None:
        with tempfile.TemporaryDirectory() as catalog_dir:
            _write_skill(
                catalog_dir,
                "with-variables",
                """
                ---
                name: with-variables
                description: Templated contract
                contract: system
                activates_on:
                  thread_mode: computer
                template_variables:
                  - thread_id
                  - prompt
                ---
                """,
                "Current threadId: {{thread_id}} / prompt: {{prompt}}",
            )

            bodies = load_system_contracts(
                catalog_dir,
                conditions={"thread_mode": "computer"},
                variables={"thread_id": "t-1"},  # no prompt
            )

        self.assertEqual(len(bodies), 1)
        self.assertIn("Current threadId: t-1", bodies[0])
        # missing variable became empty string
        self.assertIn("prompt: ", bodies[0])
        self.assertNotIn("{{prompt}}", bodies[0])

    def test_undeclared_variable_in_body_is_not_substituted(self) -> None:
        """``template_variables`` is the authoritative declaration.

        A ``{{foo}}`` in body without ``foo`` in ``template_variables``
        stays verbatim even if ``variables`` contains ``foo`` — prevents
        accidental substitution of strings the contract author did not
        intend as variables.
        """
        with tempfile.TemporaryDirectory() as catalog_dir:
            _write_skill(
                catalog_dir,
                "limited-variables",
                """
                ---
                name: limited-variables
                description: Declares only thread_id
                contract: system
                activates_on:
                  thread_mode: computer
                template_variables:
                  - thread_id
                ---
                """,
                "thread_id={{thread_id}} foo={{foo}}",
            )

            bodies = load_system_contracts(
                catalog_dir,
                conditions={"thread_mode": "computer"},
                variables={"thread_id": "t-1", "foo": "BAR"},
            )

        self.assertEqual(len(bodies), 1)
        self.assertIn("thread_id=t-1", bodies[0])
        self.assertIn("foo={{foo}}", bodies[0])  # not substituted


class LoadSystemContractsRobustnessTests(unittest.TestCase):
    def test_malformed_skill_is_skipped_others_still_load(self) -> None:
        with tempfile.TemporaryDirectory() as catalog_dir:
            # Malformed: YAML frontmatter that fails to parse.
            broken_dir = os.path.join(catalog_dir, "broken-contract")
            os.makedirs(broken_dir, exist_ok=True)
            with open(os.path.join(broken_dir, "SKILL.md"), "w") as fh:
                fh.write("---\ncontract: system\n  bad: indent\n---\n\nbody\n")

            # Valid contract that should still load.
            _write_skill(
                catalog_dir,
                "valid-contract",
                """
                ---
                name: valid-contract
                description: This one is fine
                contract: system
                activates_on:
                  thread_mode: computer
                ---
                """,
                "Valid body.",
            )

            bodies = load_system_contracts(
                catalog_dir,
                conditions={"thread_mode": "computer"},
            )

        self.assertEqual(len(bodies), 1)
        self.assertIn("Valid body.", bodies[0])

    def test_catalog_dir_does_not_exist_returns_empty_list(self) -> None:
        bodies = load_system_contracts(
            "/tmp/does-not-exist-system-contract-test-dir",
            conditions={"thread_mode": "computer"},
        )
        self.assertEqual(bodies, [])

    def test_non_mapping_activates_on_fails_closed(self) -> None:
        """A typo'd ``activates_on`` (e.g., a list) must not silently activate."""
        with tempfile.TemporaryDirectory() as catalog_dir:
            _write_skill(
                catalog_dir,
                "typo-contract",
                """
                ---
                name: typo-contract
                description: activates_on as a list (typo)
                contract: system
                activates_on:
                  - thread_mode
                  - computer
                ---
                """,
                "Should not load.",
            )

            bodies = load_system_contracts(
                catalog_dir,
                conditions={"thread_mode": "computer"},
            )

        self.assertEqual(bodies, [])


class LoadSystemContractsEdgeCaseTests(unittest.TestCase):
    def test_missing_activates_on_is_always_on(self) -> None:
        """A ``contract: system`` without ``activates_on`` activates on every turn.

        The discriminator ``contract: system`` already filters this out
        from user-invocable skills; ``activates_on`` is the additional
        per-condition gate. Omitting it is the operator's signal that
        the contract is unconditional.
        """
        with tempfile.TemporaryDirectory() as catalog_dir:
            _write_skill(
                catalog_dir,
                "always-on-contract",
                """
                ---
                name: always-on-contract
                description: No activates_on field
                contract: system
                ---
                """,
                "Always applies.",
            )

            bodies = load_system_contracts(
                catalog_dir,
                conditions={"thread_mode": "default", "eval_mode": False},
            )

        self.assertEqual(len(bodies), 1)
        self.assertIn("Always applies.", bodies[0])

    def test_determinism_same_inputs_same_order(self) -> None:
        with tempfile.TemporaryDirectory() as catalog_dir:
            for slug, body in [
                ("c-third", "Body C"),
                ("a-first", "Body A"),
                ("b-second", "Body B"),
            ]:
                _write_skill(
                    catalog_dir,
                    slug,
                    f"""
                    ---
                    name: {slug}
                    description: Determinism check
                    contract: system
                    activates_on:
                      thread_mode: computer
                    ---
                    """,
                    body,
                )

            first = load_system_contracts(
                catalog_dir,
                conditions={"thread_mode": "computer"},
            )
            second = load_system_contracts(
                catalog_dir,
                conditions={"thread_mode": "computer"},
            )

        self.assertEqual(first, second)
        self.assertEqual(len(first), 3)
        # alphabetical-by-slug
        self.assertIn("Body A", first[0])
        self.assertIn("Body B", first[1])
        self.assertIn("Body C", first[2])

    def test_non_skill_directory_entries_are_ignored(self) -> None:
        """``catalog_dir`` may contain non-skill subdirectories (scripts/, etc.)."""
        with tempfile.TemporaryDirectory() as catalog_dir:
            # Non-skill directory without SKILL.md
            os.makedirs(os.path.join(catalog_dir, "scripts"), exist_ok=True)
            with open(os.path.join(catalog_dir, "scripts", "helper.py"), "w") as fh:
                fh.write("# not a skill\n")

            # Actual skill
            _write_skill(
                catalog_dir,
                "real-contract",
                """
                ---
                name: real-contract
                description: The only contract here
                contract: system
                ---
                """,
                "Real body.",
            )

            bodies = load_system_contracts(catalog_dir, conditions={})

        self.assertEqual(len(bodies), 1)
        self.assertIn("Real body.", bodies[0])


if __name__ == "__main__":
    unittest.main()
