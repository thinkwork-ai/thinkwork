"""Structural tests for the `package` primitive's skill.yaml + templates.

Deterministic template rendering is the whole point of this primitive —
keep the YAML, the script entry point, and the supported-format enum in
lockstep. Python-side rendering behavior is tested in test_render.py.
"""

from __future__ import annotations

from pathlib import Path

import yaml

SKILL_DIR = Path(__file__).resolve().parent.parent
SKILL_YAML = SKILL_DIR / "skill.yaml"
SKILL_MD = SKILL_DIR / "SKILL.md"
SCRIPT_FILE = SKILL_DIR / "scripts" / "render.py"
TEMPLATE_DIR = SKILL_DIR / "templates"

EXPECTED_FORMATS = ("sales_brief", "health_report", "renewal_risk")


def _load() -> dict:
    with open(SKILL_YAML) as fh:
        return yaml.safe_load(fh)


def test_yaml_parses_as_mapping() -> None:
    assert isinstance(_load(), dict)


def test_required_metadata_present() -> None:
    data = _load()
    for key in ("slug", "display_name", "description", "version", "execution", "scripts"):
        assert key in data
    assert data["slug"] == "package"
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
    """The enum in skill.yaml and the templates on disk must stay in
    lockstep — adding a format means adding the template file, and
    vice versa. If this test fails, the contract drifted."""
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
