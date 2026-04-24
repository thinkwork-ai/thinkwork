"""Structural tests for the `gather` catalog entry.

Post-U8 gather is authoring guidance (execution: context), not a
runtime primitive. These tests lock down the stub's shape so admins
and skill authors see a coherent catalog entry.
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


def test_execution_is_context() -> None:
    """Post-U8 gather ships as a context skill with authoring
    guidance. The legacy runtime scaffolding is gone with U6."""
    data = _load()
    assert data["execution"] == "context"


def test_no_scripts() -> None:
    data = _load()
    assert "scripts" not in data, (
        "gather must not declare scripts — it is documentation"
    )


def test_standalone_invocation_error_is_actionable() -> None:
    """If an admin tries to enable gather as a direct agent tool, the
    skill registry is expected to surface this message verbatim."""
    data = _load()
    msg = data.get("standalone_invocation_error")
    assert isinstance(msg, str) and msg.strip()
    # Must point the reader at the right fix.
    assert "skill" in msg.lower()
    assert "parallel" in msg.lower() or "fan-out" in msg.lower() or "fan out" in msg.lower()


def test_skill_md_exists_and_documents_contract() -> None:
    assert SKILL_MD.is_file()
    text = SKILL_MD.read_text(encoding="utf-8").lower()
    # The SKILL.md body is authoring guidance — must still call out the
    # core shape (parallel, critical-branch semantics, bounded timeout).
    for marker in ("parallel", "critical", "timeout"):
        assert marker in text, f"SKILL.md missing marker {marker!r}"


def test_skill_md_warns_against_blocking_waits() -> None:
    """The reconciler contract forbids sub-skills from blocking on external
    events. SKILL.md must remind authors of this — the doc sets the
    expectation even though the legacy runtime enforcement is gone."""
    text = SKILL_MD.read_text(encoding="utf-8").lower()
    assert "reconciler" in text or "do not block" in text or "does not block" in text
