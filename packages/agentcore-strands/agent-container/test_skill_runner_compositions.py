"""Tests for skill_runner.load_composition_skills — Unit 1's loader that picks
composition-mode skills out of the invocation payload and validates them via
the Pydantic schema.

Run with: uv run --no-project --with pydantic --with PyYAML --with pytest \\
    pytest packages/agentcore-strands/agent-container/test_skill_runner_compositions.py
"""

from __future__ import annotations

import os
import tempfile
import textwrap
import unittest

import skill_runner

VALID_COMPOSITION_YAML = textwrap.dedent(
    """
    id: prep-for-meeting
    version: 1
    execution: composition
    name: Prep for Meeting
    description: Sales meeting prep.
    inputs:
      customer:
        type: string
        required: true
    steps:
      - id: frame
        skill: frame
        mode: sequential
      - id: gather
        mode: parallel
        branches:
          - id: crm
            skill: crm_lookup
            critical: true
          - id: ar
            skill: ar_lookup
    """
).strip()


SCRIPT_SKILL_YAML = textwrap.dedent(
    """
    id: some-script-skill
    version: 1
    execution: script
    name: Script Skill
    description: A script skill.
    """
).strip()


INVALID_COMPOSITION_YAML = textwrap.dedent(
    """
    id: broken
    version: 1
    execution: composition
    name: Broken
    description: Duplicate branch ids.
    steps:
      - id: gather
        mode: parallel
        branches:
          - id: dup
            skill: a
          - id: dup
            skill: b
    """
).strip()


class TestLoadCompositionSkills(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self._orig_skills_dir = skill_runner.SKILLS_DIR
        skill_runner.SKILLS_DIR = self.tmpdir

    def tearDown(self):
        import shutil

        shutil.rmtree(self.tmpdir, ignore_errors=True)
        skill_runner.SKILLS_DIR = self._orig_skills_dir

    def _write_skill(self, skill_id: str, yaml_body: str):
        skill_dir = os.path.join(self.tmpdir, skill_id)
        os.makedirs(skill_dir, exist_ok=True)
        with open(os.path.join(skill_dir, "skill.yaml"), "w") as f:
            f.write(yaml_body)

    def test_loads_valid_composition(self):
        self._write_skill("prep-for-meeting", VALID_COMPOSITION_YAML)
        compositions = skill_runner.load_composition_skills(
            [{"skillId": "prep-for-meeting"}]
        )
        self.assertIn("prep-for-meeting", compositions)
        self.assertEqual(compositions["prep-for-meeting"].version, 1)

    def test_skips_script_skills_silently(self):
        self._write_skill("some-script-skill", SCRIPT_SKILL_YAML)
        compositions = skill_runner.load_composition_skills(
            [{"skillId": "some-script-skill"}]
        )
        self.assertEqual(compositions, {})

    def test_skips_invalid_composition_without_raising(self):
        self._write_skill("broken", INVALID_COMPOSITION_YAML)
        compositions = skill_runner.load_composition_skills([{"skillId": "broken"}])
        self.assertEqual(compositions, {})  # load error logged, not raised

    def test_mixed_skills_load_correctly(self):
        self._write_skill("prep-for-meeting", VALID_COMPOSITION_YAML)
        self._write_skill("some-script-skill", SCRIPT_SKILL_YAML)
        self._write_skill("broken", INVALID_COMPOSITION_YAML)
        compositions = skill_runner.load_composition_skills(
            [
                {"skillId": "prep-for-meeting"},
                {"skillId": "some-script-skill"},
                {"skillId": "broken"},
                {"skillId": "nonexistent"},
            ]
        )
        self.assertEqual(list(compositions.keys()), ["prep-for-meeting"])

    def test_script_skills_still_register_via_existing_path(self):
        """Sanity check: composition loader does not interfere with the
        existing execution: script registration path."""
        # We don't actually register a real script tool (requires strands lib
        # and a real Python function) — just confirm that load_composition_skills
        # doesn't pull the script skill into its result set, so the existing
        # register_skill_tools path stays as-is.
        self._write_skill("some-script-skill", SCRIPT_SKILL_YAML)
        compositions = skill_runner.load_composition_skills(
            [{"skillId": "some-script-skill"}]
        )
        self.assertNotIn("some-script-skill", compositions)


if __name__ == "__main__":
    unittest.main()
