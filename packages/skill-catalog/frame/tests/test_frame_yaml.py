"""Structural tests for the `frame` primitive's skill.yaml.

Deliberately does NOT import composition_runner or skill_inputs — those
are Unit 1's runtime code. This test only validates the YAML shape so
Unit 2 can merge independently. Once both units are on main,
scripts/validate-skill-catalog.sh and the composition_runner's own
test suite cover the deeper contract.
"""

from __future__ import annotations

from pathlib import Path

import yaml

SKILL_DIR = Path(__file__).resolve().parent.parent
SKILL_YAML = SKILL_DIR / "skill.yaml"
SKILL_MD = SKILL_DIR / "SKILL.md"
PROMPT_FILE = SKILL_DIR / "prompts" / "frame.md"


def _load() -> dict:
    with open(SKILL_YAML) as fh:
        return yaml.safe_load(fh)


def test_yaml_parses_as_mapping() -> None:
    data = _load()
    assert isinstance(data, dict), "skill.yaml must be a mapping at its root"


def test_required_metadata_present() -> None:
    data = _load()
    for key in ("slug", "display_name", "description", "version", "execution"):
        assert key in data, f"missing required key {key!r}"
    assert data["slug"] == "frame"
    assert data["execution"] == "context"


def test_inputs_are_typed() -> None:
    data = _load()
    inputs = data.get("inputs")
    assert isinstance(inputs, dict) and "problem" in inputs
    assert inputs["problem"]["required"] is True
    assert inputs["problem"]["type"] == "string"
    # `context` is optional — it's where prior_learnings flow in.
    assert "context" in inputs
    assert inputs["context"].get("required") in (False, None)


def test_composition_only_flag() -> None:
    """Frame is a composition-only primitive; admins should not enable it as a
    direct agent tool. The flag captures that intent declaratively so later
    units can enforce it at registration time."""
    data = _load()
    assert data.get("invocable_from") == "composition"


def test_declares_output_name() -> None:
    """composition_runner uses `output` as the named-output key for the step."""
    data = _load()
    assert data.get("output") == "framed"


def test_skill_md_and_prompt_file_exist() -> None:
    assert SKILL_MD.is_file(), "SKILL.md must exist for admin surface"
    assert PROMPT_FILE.is_file(), "prompts/frame.md must exist — execution is prompt-only"


def test_prompt_file_references_required_placeholders() -> None:
    text = PROMPT_FILE.read_text(encoding="utf-8")
    # Prompt must accept the two inputs declared in the YAML.
    assert "{problem}" in text
    assert "{context}" in text


def test_prompt_file_declares_four_output_sections() -> None:
    """The synthesize step reads frame's output by heading — keep the
    four-section contract load-bearing so drift shows up here first."""
    text = PROMPT_FILE.read_text(encoding="utf-8")
    for heading in ("## Goal", "## Constraints", "## Known unknowns", "## Decision criteria"):
        assert heading in text, f"prompt missing required heading {heading!r}"


def test_no_tenant_specific_strings_in_prompt() -> None:
    """Mirrors the scripts/validate-skill-catalog.sh lint locally so a broken
    prompt fails in the skill's own test run, not only at CI time."""
    text = PROMPT_FILE.read_text(encoding="utf-8")
    forbidden = ("@homecareintel.com", "@thinkwork.internal")
    for marker in forbidden:
        assert marker not in text, f"prompt contains tenant-specific string: {marker}"
