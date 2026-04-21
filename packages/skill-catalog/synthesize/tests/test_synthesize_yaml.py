"""Structural tests for the `synthesize` primitive's skill.yaml.

YAML-only validation — no imports from Unit 1's composition_runner or
skill_inputs. Once both units are on main, the validate-skill-catalog.sh
script and composition_runner tests cover deeper integration.
"""

from __future__ import annotations

from pathlib import Path

import yaml

SKILL_DIR = Path(__file__).resolve().parent.parent
SKILL_YAML = SKILL_DIR / "skill.yaml"
SKILL_MD = SKILL_DIR / "SKILL.md"
PROMPT_FILE = SKILL_DIR / "prompts" / "synthesize.md"


def _load() -> dict:
    with open(SKILL_YAML) as fh:
        return yaml.safe_load(fh)


def test_yaml_parses_as_mapping() -> None:
    data = _load()
    assert isinstance(data, dict)


def test_required_metadata_present() -> None:
    data = _load()
    for key in ("slug", "display_name", "description", "version", "execution"):
        assert key in data
    assert data["slug"] == "synthesize"
    assert data["execution"] == "context"


def test_inputs_match_composition_placeholders() -> None:
    """Compositions pass named outputs from prior steps as `framed` and
    `gathered`. Synthesize must accept both."""
    data = _load()
    inputs = data["inputs"]
    assert inputs["framed"]["required"] is True
    assert inputs["gathered"]["required"] is True
    # focus + prior_learnings are optional — they steer the analysis but
    # shouldn't block the step if absent.
    assert inputs["focus"].get("required") in (False, None)
    assert inputs["prior_learnings"].get("required") in (False, None)


def test_composition_only_flag() -> None:
    data = _load()
    assert data.get("invocable_from") == "composition"


def test_declares_output_name() -> None:
    data = _load()
    assert data.get("output") == "synthesis"


def test_skill_md_and_prompt_file_exist() -> None:
    assert SKILL_MD.is_file()
    assert PROMPT_FILE.is_file()


def test_prompt_references_all_inputs() -> None:
    text = PROMPT_FILE.read_text(encoding="utf-8")
    for placeholder in ("{framed}", "{gathered}", "{focus}", "{prior_learnings}"):
        assert placeholder in text, f"prompt missing placeholder {placeholder!r}"


def test_prompt_locks_four_output_sections() -> None:
    """Package templates embed synthesis verbatim — the four-section
    shape must stay stable or deliverables degrade silently."""
    text = PROMPT_FILE.read_text(encoding="utf-8")
    for heading in ("## Risks", "## Opportunities", "## Open questions", "## Talking points"):
        assert heading in text, f"prompt missing required heading {heading!r}"


def test_no_tenant_specific_strings_in_prompt() -> None:
    text = PROMPT_FILE.read_text(encoding="utf-8")
    for marker in ("@homecareintel.com", "@thinkwork.internal"):
        assert marker not in text
