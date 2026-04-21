"""Structural tests for the `gather` primitive's skill.yaml.

Gather is a declarative stub — the real parallel semantics live in the
composition_runner. These tests lock down the stub's shape so admins
and composition authors see a coherent catalog entry.
"""

from __future__ import annotations

from pathlib import Path

import yaml

SKILL_DIR = Path(__file__).resolve().parent.parent
SKILL_YAML = SKILL_DIR / "skill.yaml"
SKILL_MD = SKILL_DIR / "SKILL.md"


def _load() -> dict:
    with open(SKILL_YAML) as fh:
        return yaml.safe_load(fh)


def test_yaml_parses_as_mapping() -> None:
    data = _load()
    assert isinstance(data, dict)


def test_execution_is_declarative() -> None:
    """`declarative` signals: do not register as an agent tool. The
    composition runner special-cases parallel steps — gather has no
    script or prompt of its own."""
    data = _load()
    assert data["execution"] == "declarative"


def test_no_scripts_or_prompts() -> None:
    data = _load()
    assert "scripts" not in data, "gather must not declare scripts — it's declarative"
    # If a prompts/ directory existed that would be a misleading signal
    # to tool loaders; enforce its absence.
    assert not (SKILL_DIR / "prompts").exists()


def test_composition_only_flag() -> None:
    data = _load()
    assert data.get("invocable_from") == "composition"


def test_standalone_invocation_error_is_actionable() -> None:
    """If an admin tries to enable gather as a direct agent tool, the
    skill registry is expected to surface this message verbatim."""
    data = _load()
    msg = data.get("standalone_invocation_error")
    assert isinstance(msg, str) and msg.strip()
    # Must point the reader at the right fix.
    assert "composition" in msg.lower()
    assert "parallel" in msg.lower()


def test_skill_md_exists_and_documents_contract() -> None:
    assert SKILL_MD.is_file()
    text = SKILL_MD.read_text(encoding="utf-8")
    for marker in ("mode: parallel", "branches:", "critical", "timeout_seconds"):
        assert marker in text, f"SKILL.md missing marker {marker!r}"


def test_skill_md_warns_against_blocking_waits() -> None:
    """The reconciler contract forbids sub-skills from blocking on external
    events. SKILL.md must remind authors of this — the CI lint catches
    the Python violation, but the doc should set the expectation."""
    text = SKILL_MD.read_text(encoding="utf-8").lower()
    assert "reconciler" in text or "do not block" in text or "does not block" in text
