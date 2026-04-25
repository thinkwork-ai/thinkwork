"""Structural tests for the `package` primitive's SKILL.md + templates.

Deterministic template rendering is the whole point of this primitive —
keep the frontmatter, the script entry point, and the supported-format
enum in lockstep. Python-side rendering behavior is tested in
test_render.py.

Plan 2026-04-24-009 §U3 — frontmatter on SKILL.md is the canonical
metadata source; the parallel `skill.yaml` was retired.
"""

from __future__ import annotations

from pathlib import Path

import yaml

SKILL_DIR = Path(__file__).resolve().parent.parent
SKILL_MD = SKILL_DIR / "SKILL.md"
SCRIPT_FILE = SKILL_DIR / "scripts" / "render.py"
TEMPLATE_DIR = SKILL_DIR / "templates"

EXPECTED_FORMATS = ("sales_brief", "health_report", "renewal_risk")


def _load() -> dict:
    """Parse the SKILL.md frontmatter block (between the two ``---`` markers)."""
    text = SKILL_MD.read_text(encoding="utf-8")
    if not text.startswith("---"):
        raise AssertionError("SKILL.md is missing leading frontmatter marker")
    rest = text.split("\n", 1)[1]
    end = rest.find("\n---")
    if end < 0:
        raise AssertionError("SKILL.md is missing closing frontmatter marker")
    parsed = yaml.safe_load(rest[:end])
    if not isinstance(parsed, dict):
        raise AssertionError("SKILL.md frontmatter is not a mapping")
    return parsed


def test_yaml_parses_as_mapping() -> None:
    assert isinstance(_load(), dict)


def test_required_metadata_present() -> None:
    data = _load()
    # Post-U2: `name` is the canonical slug field.
    for key in ("name", "display_name", "description", "version", "execution", "scripts"):
        assert key in data
    assert data["name"] == "package"
    assert data["execution"] == "script"


def test_script_entry_is_render_package() -> None:
    data = _load()
    scripts = data["scripts"]
    assert isinstance(scripts, list) and len(scripts) == 1
    entry = scripts[0]
    assert entry["name"] == "render_package"
    assert entry["path"] == "scripts/render.py"
    assert SCRIPT_FILE.is_file()


def test_format_enum_matches_templates() -> None:
    """The enum in SKILL.md frontmatter and the templates on disk must
    stay in lockstep — adding a format means adding the template file,
    and vice versa. If this test fails, the contract drifted."""
    data = _load()
    inputs = data["inputs"]
    fmt = inputs["format"]
    assert fmt["type"] == "enum"
    assert fmt["required"] is True
    values = tuple(fmt["values"])
    assert values == EXPECTED_FORMATS, (
        f"expected format enum {EXPECTED_FORMATS}, got {values}"
    )

    template_map = data["templates"]
    for name in EXPECTED_FORMATS:
        assert name in template_map, f"templates map missing {name!r}"
        template_path = SKILL_DIR / template_map[name]
        assert template_path.is_file(), f"template file missing: {template_path}"


def test_template_files_embed_synthesis_placeholder() -> None:
    """Every template must include the synthesis body — that's the whole
    point of the package primitive. A template without it would silently
    drop the deliverable's substance."""
    for name in EXPECTED_FORMATS:
        tmpl = TEMPLATE_DIR / f"{name}.md.tmpl"
        text = tmpl.read_text(encoding="utf-8")
        assert "{{ synthesis }}" in text, (
            f"template {name} is missing {{{{ synthesis }}}} placeholder"
        )


def test_composition_only_flag() -> None:
    data = _load()
    assert data.get("invocable_from") == "composition"


def test_declares_output_name() -> None:
    data = _load()
    assert data.get("output") == "deliverable"


def test_no_tenant_specific_strings_in_templates() -> None:
    for name in EXPECTED_FORMATS:
        text = (TEMPLATE_DIR / f"{name}.md.tmpl").read_text(encoding="utf-8")
        for marker in ("@homecareintel.com", "@thinkwork.internal"):
            assert marker not in text, (
                f"template {name} contains tenant-specific string: {marker}"
            )
