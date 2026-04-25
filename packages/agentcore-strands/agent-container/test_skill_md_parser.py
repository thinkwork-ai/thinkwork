"""Frontmatter-shape tests for skill_md_parser (plan 2026-04-24-009 §U1).

Pinned scenarios (cross-checked with the TS test suite at
`packages/api/src/lib/__tests__/skill-md-parser.test.ts`):

  - Happy path — minimal frontmatter (name + description).
  - Happy path — full frontmatter exercising every supported field.
  - Edge — `name` missing → lenient parser tolerates it; SI-4-style
    callers enforce required-field policy themselves.
  - Edge — file missing → `parse_skill_md_file` returns None.
  - Edge — malformed YAML → `SkillMdParseError` carries the path.
  - Edge — `execution: composition` → rejected (U6 audit tripwire).
  - Edge — file with no frontmatter → empty data + frontmatter_present=False.
  - Edge — scripts list with mixed scalar types → coerced consistently.
  - Integration — every existing skill-catalog SKILL.md parses without raising.
"""

from __future__ import annotations

import glob
import os
import tempfile
import textwrap
import unittest

from skill_md_parser import (
    ALLOWED_EXECUTION_VALUES,
    SkillMdParseError,
    parse_skill_md_file,
    parse_skill_md_string,
)


def _md(frontmatter: str, body: str = "body") -> str:
    return f"---\n{frontmatter}\n---\n{body}"


# Full canonical frontmatter — same shape as the TS test's FULL_FRONTMATTER.
FULL_FRONTMATTER = textwrap.dedent(
    """
    name: full-skill
    description: A skill with every supported field populated.
    version: "2.1.0"
    license: Proprietary
    display_name: Full Skill
    metadata:
      author: thinkwork
      version: "2.1.0"
    execution: script
    mode: tool
    model: anthropic.claude-3-5-sonnet
    scripts:
      - name: do_thing
        path: scripts/do_thing.py
        description: "Does the thing"
        default_enabled: true
    inputs:
      customer:
        type: string
        required: true
        resolver: resolve_customer
        on_missing_input: ask
      focus:
        type: enum
        values: [financial, expansion, risks, general]
        default: general
    triggers:
      chat_intent:
        examples:
          - "do the thing for {customer}"
        disambiguation: ask
      schedule:
        type: cron
        expression: "0 14 ? * MON-FRI *"
        bindings:
          customer:
            from_tenant_config: default_customer
      webhook:
        examples:
          - "POST /thing"
    tenant_overridable:
      - inputs.focus.default
      - triggers.schedule.expression
    requires_skills:
      - package
      - web-search
    permissions_model: operations
    category: productivity
    icon: sparkle
    tags: [example, full, productivity]
    requires_env:
      - THINKWORK_API_URL
      - THINKWORK_API_SECRET
    oauth_provider: google_productivity
    oauth_scopes: [gmail, calendar, identity]
    mcp_server: example-mcp
    mcp_tools: [tool_a, tool_b]
    dependencies:
      - other-skill
    is_default: true
    compatibility: Requires Google OAuth credentials
    allowed-tools:
      - render_package
      - hindsight_recall
    """
).strip()


class ParseSkillMdStringHappyPathTests(unittest.TestCase):
    def test_minimal_frontmatter(self) -> None:
        parsed = parse_skill_md_string(
            _md("name: minimal\ndescription: just the basics"),
            "skills/minimal/SKILL.md",
        )
        self.assertTrue(parsed.frontmatter_present)
        self.assertEqual(parsed.data["name"], "minimal")
        self.assertEqual(parsed.data["description"], "just the basics")
        self.assertIsNone(parsed.execution)
        self.assertEqual(parsed.body, "body")

    def test_full_frontmatter_preserves_every_field(self) -> None:
        parsed = parse_skill_md_string(_md(FULL_FRONTMATTER), "skills/full/SKILL.md")
        self.assertTrue(parsed.frontmatter_present)
        self.assertEqual(parsed.data["name"], "full-skill")
        self.assertEqual(parsed.execution, "script")
        # Pyyaml coerces native scalar types — pin the contract.
        self.assertIs(parsed.data["is_default"], True)
        self.assertEqual(parsed.data["tags"], ["example", "full", "productivity"])
        self.assertEqual(
            parsed.data["oauth_scopes"], ["gmail", "calendar", "identity"]
        )
        self.assertEqual(
            parsed.data["scripts"][0]["path"], "scripts/do_thing.py"
        )
        self.assertIs(parsed.data["scripts"][0]["default_enabled"], True)
        self.assertEqual(
            parsed.data["triggers"]["schedule"]["expression"],
            "0 14 ? * MON-FRI *",
        )
        self.assertEqual(
            parsed.data["allowed-tools"], ["render_package", "hindsight_recall"]
        )

    def test_explicit_context_execution(self) -> None:
        parsed = parse_skill_md_string(
            _md("name: ctx\ndescription: context skill\nexecution: context"),
            "skills/ctx/SKILL.md",
        )
        self.assertEqual(parsed.execution, "context")

    def test_empty_string_execution_treated_as_absent(self) -> None:
        parsed = parse_skill_md_string(
            _md('name: e\ndescription: ok\nexecution: ""'),
            "skills/e/SKILL.md",
        )
        self.assertIsNone(parsed.execution)


class ParseSkillMdStringMissingFrontmatterTests(unittest.TestCase):
    def test_no_frontmatter_returns_empty_data(self) -> None:
        parsed = parse_skill_md_string(
            "# Customer Onboarding\n\nSome prose body.\n",
            "skills/customer-onboarding/SKILL.md",
        )
        self.assertFalse(parsed.frontmatter_present)
        self.assertEqual(parsed.data, {})
        self.assertIsNone(parsed.execution)
        self.assertIn("Customer Onboarding", parsed.body)

    def test_empty_frontmatter_block_is_present_but_empty(self) -> None:
        parsed = parse_skill_md_string("---\n---\nbody\n", "skills/empty-fm/SKILL.md")
        self.assertTrue(parsed.frontmatter_present)
        self.assertEqual(parsed.data, {})
        self.assertIsNone(parsed.execution)

    def test_lenient_does_not_enforce_required_fields(self) -> None:
        # Lenient by design — the strict equivalent (SI-4 plugin upload)
        # lives in the TS parser. Catalog readers may temporarily ship
        # SKILL.md with partial frontmatter while migrating off skill.yaml.
        parsed = parse_skill_md_string(
            _md("category: productivity\nexecution: script"),
            "skills/loose/SKILL.md",
        )
        self.assertTrue(parsed.frontmatter_present)
        self.assertEqual(parsed.data["category"], "productivity")
        self.assertEqual(parsed.execution, "script")


class ParseSkillMdStringRejectionTests(unittest.TestCase):
    def test_malformed_yaml_raises_with_path(self) -> None:
        source = _md("name: x\ndescription: {")
        with self.assertRaises(SkillMdParseError) as ctx:
            parse_skill_md_string(source, "skills/bad-yaml/SKILL.md")
        self.assertIn("skills/bad-yaml/SKILL.md", str(ctx.exception))
        self.assertEqual(ctx.exception.source_path, "skills/bad-yaml/SKILL.md")

    def test_execution_composition_rejected(self) -> None:
        with self.assertRaises(SkillMdParseError) as ctx:
            parse_skill_md_string(
                _md("name: legacy\ndescription: legacy\nexecution: composition"),
                "skills/legacy/SKILL.md",
            )
        self.assertIn("composition", str(ctx.exception))
        self.assertIn("execution", str(ctx.exception))

    def test_arbitrary_unknown_execution_rejected(self) -> None:
        with self.assertRaises(SkillMdParseError):
            parse_skill_md_string(
                _md("name: weird\ndescription: weird\nexecution: parallel"),
                "skills/weird/SKILL.md",
            )

    def test_non_string_execution_rejected(self) -> None:
        with self.assertRaises(SkillMdParseError):
            parse_skill_md_string(
                _md("name: weird\ndescription: weird\nexecution: 1"),
                "skills/weird-type/SKILL.md",
            )

    def test_non_mapping_frontmatter_rejected(self) -> None:
        # Frontmatter parses to a list — not a mapping.
        source = "---\n- a\n- b\n---\nbody\n"
        with self.assertRaises(SkillMdParseError):
            parse_skill_md_string(source, "skills/list-fm/SKILL.md")

    def test_allowed_execution_values_constant_is_pinned(self) -> None:
        # If composition ever creeps back into the allowlist, this
        # assertion catches it before any caller does.
        self.assertEqual(ALLOWED_EXECUTION_VALUES, ("script", "context"))


class ParseSkillMdFileTests(unittest.TestCase):
    def test_missing_file_returns_none(self) -> None:
        # Matches the legacy `_parse_skill_yaml` semantic — the U3 swap
        # depends on this so callers can keep `if not parsed: continue`.
        result = parse_skill_md_file("/tmp/definitely-not-a-real-path-skill.md")
        self.assertIsNone(result)

    def test_disk_read_round_trips(self) -> None:
        fd, path = tempfile.mkstemp(suffix=".md")
        try:
            os.write(fd, _md("name: disk\ndescription: from disk").encode("utf-8"))
            os.close(fd)
            parsed = parse_skill_md_file(path)
            self.assertIsNotNone(parsed)
            assert parsed is not None  # narrow for mypy/static analysis
            self.assertEqual(parsed.data["name"], "disk")
            self.assertEqual(parsed.source_path, path)
        finally:
            os.unlink(path)


class ParseSkillMdScalarCoercionTests(unittest.TestCase):
    """Pyyaml + js-yaml both coerce native YAML scalars. Pin the
    behavior so a future swap to a stricter loader can't silently
    regress the boolean/int/string mix used by `scripts:` entries."""

    def test_scripts_default_enabled_true_is_python_true(self) -> None:
        parsed = parse_skill_md_string(
            _md(
                textwrap.dedent(
                    """
                    name: gcal
                    description: g
                    execution: script
                    scripts:
                      - name: do_thing
                        path: scripts/x.py
                        default_enabled: true
                    """
                ).strip()
            ),
            "p",
        )
        entry = parsed.data["scripts"][0]
        self.assertIs(entry["default_enabled"], True)

    def test_scripts_default_enabled_false_is_python_false(self) -> None:
        parsed = parse_skill_md_string(
            _md(
                textwrap.dedent(
                    """
                    name: gcal
                    description: g
                    execution: script
                    scripts:
                      - name: do_thing
                        path: scripts/x.py
                        default_enabled: false
                    """
                ).strip()
            ),
            "p",
        )
        self.assertIs(parsed.data["scripts"][0]["default_enabled"], False)

    def test_scripts_int_field_is_int(self) -> None:
        parsed = parse_skill_md_string(
            _md(
                textwrap.dedent(
                    """
                    name: gcal
                    description: g
                    execution: script
                    scripts:
                      - name: do_thing
                        path: scripts/x.py
                        max_retries: 3
                    """
                ).strip()
            ),
            "p",
        )
        self.assertEqual(parsed.data["scripts"][0]["max_retries"], 3)
        self.assertIsInstance(parsed.data["scripts"][0]["max_retries"], int)

    def test_scripts_string_field_passes_through(self) -> None:
        parsed = parse_skill_md_string(
            _md(
                textwrap.dedent(
                    """
                    name: gcal
                    description: g
                    execution: script
                    scripts:
                      - name: do_thing
                        path: scripts/x.py
                    """
                ).strip()
            ),
            "p",
        )
        self.assertEqual(parsed.data["scripts"][0]["name"], "do_thing")
        self.assertEqual(parsed.data["scripts"][0]["path"], "scripts/x.py")


class SkillCatalogIntegrationTests(unittest.TestCase):
    """U1 verification — every existing SKILL.md in packages/skill-catalog
    must parse without raising. The 2 frontmatter-less files
    (`customer-onboarding/SKILL.md`, `sandbox-pilot/SKILL.md`) should
    round-trip with `frontmatter_present=False` + empty data so callers
    can `if not parsed.data: continue`.
    """

    @staticmethod
    def _catalog_dir() -> str:
        # Tests live at packages/agentcore-strands/agent-container/, so
        # the catalog is two levels up + packages/skill-catalog.
        here = os.path.dirname(os.path.abspath(__file__))
        return os.path.normpath(
            os.path.join(here, "..", "..", "skill-catalog")
        )

    def test_every_existing_skill_md_parses(self) -> None:
        catalog = self._catalog_dir()
        if not os.path.isdir(catalog):
            self.skipTest(f"skill-catalog not found at {catalog}")
        skill_md_files = sorted(
            glob.glob(os.path.join(catalog, "*", "SKILL.md"))
        )
        self.assertGreater(
            len(skill_md_files),
            0,
            "expected at least one SKILL.md under skill-catalog/",
        )

        bare_files: list[str] = []
        framed_files: list[str] = []
        for path in skill_md_files:
            parsed = parse_skill_md_file(path)
            self.assertIsNotNone(parsed, f"parse returned None for {path}")
            assert parsed is not None  # narrow
            if parsed.frontmatter_present:
                framed_files.append(os.path.basename(os.path.dirname(path)))
            else:
                bare_files.append(os.path.basename(os.path.dirname(path)))

        # We expect exactly the two known bare-body files. If new ones
        # appear, that's worth surfacing — failing the test with the
        # actual list lets the migration plan track them.
        self.assertEqual(
            sorted(bare_files),
            ["customer-onboarding", "sandbox-pilot"],
            f"frontmatter-less SKILL.md set drifted: {bare_files!r}",
        )
        # Sanity — every framed file has a non-empty data dict.
        for slug in framed_files:
            parsed = parse_skill_md_file(
                os.path.join(self._catalog_dir(), slug, "SKILL.md")
            )
            assert parsed is not None
            self.assertTrue(parsed.data, f"{slug}: framed but data is empty")


if __name__ == "__main__":
    unittest.main()
