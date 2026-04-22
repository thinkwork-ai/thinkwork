"""Test that _parse_skill_yaml coerces bool/int scalars inside list-item dicts.

The thinkwork-admin plan's manifest puts `default_enabled: true` on
each `scripts:` entry, and every wrapper + sync-catalog-db check
relies on that value landing as Python `True` — not the literal string
`"true"`. Before the fix at lines 59-76, list-item dict values were
passed through `.strip().strip('"')` with no bool/int coercion, so any
`is True` / `== True` check silently always failed.
"""

from __future__ import annotations

import os
import sys
import tempfile
import textwrap
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import skill_runner  # noqa: E402


class SkillYamlCoercionTests(unittest.TestCase):
    def _parse(self, yaml: str) -> dict:
        fd, path = tempfile.mkstemp(suffix=".yaml")
        try:
            os.write(fd, yaml.encode("utf-8"))
            os.close(fd)
            parsed = skill_runner._parse_skill_yaml(path)
            assert parsed is not None
            return parsed
        finally:
            os.unlink(path)

    def test_permissions_model_top_level_key_roundtrips(self):
        """Unit 3 adds `permissions_model: operations` to thinkwork-admin's
        manifest. The parser must tolerate it as a plain top-level string
        key so sync-catalog-db (which stores the full parsed YAML in
        tier1_metadata) surfaces it unchanged to downstream consumers."""
        parsed = self._parse(
            textwrap.dedent(
                """
                slug: thinkwork-admin
                permissions_model: operations
                scripts:
                  - name: create_agent
                    path: scripts/operations/agents.py
                    default_enabled: true
                """
            ).lstrip()
        )
        self.assertEqual(parsed.get("permissions_model"), "operations")
        # Adjacent scripts list still parses correctly — the new top-level
        # key must not disturb the parser's list handling.
        self.assertEqual(parsed["scripts"][0]["default_enabled"], True)

    def test_default_enabled_true_is_python_true_in_list_item(self):
        parsed = self._parse(
            textwrap.dedent(
                """
                slug: thinkwork-admin
                scripts:
                  - name: create_agent
                    path: scripts/operations/agents.py
                    default_enabled: true
                """
            ).lstrip()
        )
        entry = parsed["scripts"][0]
        self.assertIs(entry["default_enabled"], True)
        # Guardrail against the "default_enabled == 'true'" footgun:
        # `is True` must succeed.
        self.assertTrue(entry["default_enabled"] is True)

    def test_default_enabled_false_is_python_false_in_list_item(self):
        parsed = self._parse(
            textwrap.dedent(
                """
                slug: thinkwork-admin
                scripts:
                  - name: sync_template_to_all_agents
                    path: scripts/operations/templates.py
                    default_enabled: false
                """
            ).lstrip()
        )
        self.assertIs(parsed["scripts"][0]["default_enabled"], False)

    def test_ints_coerce_in_list_item(self):
        parsed = self._parse(
            textwrap.dedent(
                """
                slug: demo
                scripts:
                  - name: op
                    path: scripts/op.py
                    max_retries: 3
                """
            ).lstrip()
        )
        self.assertEqual(parsed["scripts"][0]["max_retries"], 3)
        self.assertIsInstance(parsed["scripts"][0]["max_retries"], int)

    def test_strings_still_pass_through_unchanged(self):
        parsed = self._parse(
            textwrap.dedent(
                """
                slug: demo
                scripts:
                  - name: op
                    path: scripts/op.py
                """
            ).lstrip()
        )
        self.assertEqual(parsed["scripts"][0]["name"], "op")
        self.assertEqual(parsed["scripts"][0]["path"], "scripts/op.py")

    def test_top_level_bool_coercion_unchanged_by_the_fix(self):
        parsed = self._parse(
            textwrap.dedent(
                """
                slug: demo
                is_default: false
                """
            ).lstrip()
        )
        self.assertIs(parsed["is_default"], False)


if __name__ == "__main__":
    unittest.main()
