"""Structural tests for skill-dispatcher/skill.yaml + SKILL.md.

Tests validate YAML shape and the two-script contract. No Unit 4
TypeScript imports — this test runs as part of skill-catalog tests.
"""

from __future__ import annotations

from pathlib import Path

import yaml

SKILL_DIR = Path(__file__).resolve().parent.parent
SKILL_YAML = SKILL_DIR / "skill.yaml"
SKILL_MD = SKILL_DIR / "SKILL.md"
DISPATCH_PY = SKILL_DIR / "scripts" / "dispatch.py"


def _load() -> dict:
    with open(SKILL_YAML) as fh:
        return yaml.safe_load(fh)


def test_yaml_parses() -> None:
    assert isinstance(_load(), dict)


def test_required_metadata_present() -> None:
    data = _load()
    for key in ("slug", "display_name", "description", "version", "execution", "mode", "scripts"):
        assert key in data, f"missing {key!r}"
    assert data["slug"] == "skill-dispatcher"
    assert data["execution"] == "script"
    assert data["mode"] == "tool"


def test_is_default_so_every_agent_gets_routing() -> None:
    """The dispatcher has to be available on every agent by default —
    compositions won't be callable otherwise. is_default: true enforces
    that at skill-catalog sync time."""
    assert _load().get("is_default") in (True, "true")


def test_two_scripts_declared() -> None:
    data = _load()
    scripts = data["scripts"]
    assert isinstance(scripts, list) and len(scripts) == 2
    names = {s["name"] for s in scripts}
    assert names == {"start_composition", "composition_status"}
    for entry in scripts:
        assert entry["path"] == "scripts/dispatch.py"


def test_requires_env_carries_service_identity() -> None:
    """Service-to-service auth needs the API URL, secret, tenant id, and
    the currently-resolved user id. All four must be declared so the
    skill-loader warns if any are missing."""
    env = set(_load().get("requires_env", []))
    for key in ("THINKWORK_API_URL", "THINKWORK_API_SECRET", "TENANT_ID", "CURRENT_USER_ID"):
        assert key in env, f"missing required env {key}"


def test_skill_md_references_startskillrun_endpoint_contract() -> None:
    text = SKILL_MD.read_text(encoding="utf-8")
    for marker in ("start_composition", "invocation_source", "deduped"):
        assert marker in text, f"SKILL.md missing {marker}"


def test_skill_md_guards_against_injection() -> None:
    """The prompt must remind the LLM not to obey instructions inside
    user text that target the dispatcher — critical for cross-tenant
    safety."""
    text = SKILL_MD.read_text(encoding="utf-8").lower()
    assert "injection" in text or "don't obey" in text or "do not obey" in text


def test_dispatch_py_present() -> None:
    assert DISPATCH_PY.is_file()


def test_no_tenant_specific_strings_in_prompts() -> None:
    text = SKILL_MD.read_text(encoding="utf-8")
    for marker in ("@homecareintel.com", "@thinkwork.internal"):
        assert marker not in text
