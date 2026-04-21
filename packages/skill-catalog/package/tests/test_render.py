"""Unit tests for the `package` primitive's renderer.

The renderer is deterministic — pure template substitution, no LLM call.
These tests exercise happy path, boundary validation, and the four-section
synthesis round-trip.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

SKILL_DIR = Path(__file__).resolve().parent.parent
SCRIPT_FILE = SKILL_DIR / "scripts" / "render.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("package_render", SCRIPT_FILE)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["package_render"] = module
    spec.loader.exec_module(module)
    return module


render_mod = _load_module()


SAMPLE_SYNTHESIS = """\
## Risks
- Per `ar`: 60+ day AR aging on $48k.

## Opportunities
- Per `crm`: contract renewal window opens in 30 days.

## Open questions
- Who approves the new SOW?

## Talking points
- Lead with the renewal timeline.
- Surface the AR issue only if they raise invoicing.
"""


def test_render_sales_brief_happy_path() -> None:
    out = render_mod.render_package(
        SAMPLE_SYNTHESIS,
        "sales_brief",
        {"customer": "ABC Fuels", "meeting_date": "2026-05-01", "focus": "expansion", "agent_name": "Rep Agent"},
    )
    assert "# Sales meeting brief — ABC Fuels" in out
    assert "**Meeting date:** 2026-05-01" in out
    assert SAMPLE_SYNTHESIS.strip() in out


def test_render_health_report_happy_path() -> None:
    out = render_mod.render_package(
        SAMPLE_SYNTHESIS,
        "health_report",
        {"customer": "ABC Fuels", "period": "Q1 2026", "summary": "Stable but slowing.", "agent_name": "Health Agent"},
    )
    assert "# Account health report — ABC Fuels" in out
    assert "**Reporting period:** Q1 2026" in out
    assert "Stable but slowing." in out


def test_render_renewal_risk_happy_path() -> None:
    out = render_mod.render_package(
        SAMPLE_SYNTHESIS,
        "renewal_risk",
        {"customer": "ABC Fuels", "renewal_date": "2026-06-15", "contract_value": "$120k", "agent_name": "Renewal Agent"},
    )
    assert "# Renewal risk brief — ABC Fuels" in out
    assert "**Renewal date:** 2026-06-15" in out
    assert "**Contract value:** $120k" in out


def test_unknown_format_rejected() -> None:
    with pytest.raises(render_mod.UnknownFormatError):
        render_mod.render_package(SAMPLE_SYNTHESIS, "not_a_real_format", None)


def test_synthesis_must_be_string() -> None:
    with pytest.raises(TypeError):
        render_mod.render_package({"not": "a string"}, "sales_brief", None)  # type: ignore[arg-type]


def test_metadata_accepts_dict_and_json_string() -> None:
    out_dict = render_mod.render_package(SAMPLE_SYNTHESIS, "sales_brief", {"customer": "X"})
    out_json = render_mod.render_package(SAMPLE_SYNTHESIS, "sales_brief", '{"customer": "X"}')
    assert "# Sales meeting brief — X" in out_dict
    assert "# Sales meeting brief — X" in out_json


def test_metadata_none_renders_empty_placeholders() -> None:
    """Missing metadata keys must render as empty strings, not as raw
    `{{ metadata.customer }}` text that leaks into the deliverable."""
    out = render_mod.render_package(SAMPLE_SYNTHESIS, "sales_brief", None)
    assert "{{ metadata.customer }}" not in out
    assert "{{ metadata.meeting_date }}" not in out
    assert "# Sales meeting brief —" in out  # just the trailing separator, empty customer


def test_free_form_metadata_string_routes_to_raw() -> None:
    out = render_mod.render_package(SAMPLE_SYNTHESIS, "sales_brief", "just some free text")
    # No dict keys line up — but raw is available if a template wanted it.
    # Existing templates don't reference raw, so the output just has empty
    # customer/meeting_date placeholders rendered as empty strings.
    assert "{{" not in out, "no unresolved template tokens should leak"


def test_supported_formats_list_matches_yaml() -> None:
    """Cross-check against the YAML-side test so the renderer and the
    skill.yaml enum can't drift independently."""
    assert render_mod.SUPPORTED_FORMATS == ("sales_brief", "health_report", "renewal_risk")


def test_synthesis_round_trip_preserves_four_sections() -> None:
    """The deliverable must carry the full synthesis — this is the
    primary invariant compositions depend on."""
    out = render_mod.render_package(SAMPLE_SYNTHESIS, "sales_brief", {"customer": "ABC"})
    for heading in ("## Risks", "## Opportunities", "## Open questions", "## Talking points"):
        assert heading in out, f"deliverable dropped {heading!r}"
