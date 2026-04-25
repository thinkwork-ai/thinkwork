"""Skill resolver — Plan §008 U10 unit tests.

Pure-function coverage for ``skill_resolver.resolve_skill``. The module
ships inert (U9 wires it into ``delegate_to_workspace``); these tests
are the only consumer until that lands.
"""

from __future__ import annotations

import logging

import pytest
from skill_resolver import (
    RESERVED_FOLDER_NAMES,
    ResolvedSkill,
    SkillNotResolvable,
    resolve_skill,
)

# A minimal SKILL.md body with frontmatter the parser will accept.
LOCAL_SKILL_MD = """---
name: approve-receipt
description: Approve an expense receipt
execution: script
---
Body text for the local skill.
"""

# A second variant so tests can assert *which* file won (when two depths
# both shadow the same slug).
ROOT_LOCAL_SKILL_MD = """---
name: approve-receipt
description: Root-level approval (overridden by deeper folders)
execution: script
---
Root body.
"""

PLATFORM_SKILL_MD = """---
name: approve-receipt
description: Platform skill from skill-catalog
execution: script
---
Platform body.
"""


def _entry(path: str, content: str) -> dict:
    return {"path": path, "source": "agent-override", "sha256": "x", "content": content}


def test_local_wins_over_platform():
    """AE6: a local `expenses/skills/<slug>/SKILL.md` shadows the platform catalog."""
    composed = [
        _entry("expenses/skills/approve-receipt/SKILL.md", LOCAL_SKILL_MD),
        _entry("expenses/CONTEXT.md", "Sub-agent."),
    ]
    catalog = {
        "approve-receipt": {"skill_md_content": PLATFORM_SKILL_MD},
    }
    result = resolve_skill(
        "approve-receipt", "expenses", composed, platform_catalog_manifest=catalog
    )
    assert isinstance(result, ResolvedSkill)
    assert result.source == "local"
    assert result.skill_md_content == LOCAL_SKILL_MD
    assert result.composed_tree_path == "expenses/skills/approve-receipt/SKILL.md"
    assert result.folder_segment == "expenses"


def test_falls_through_to_platform_when_no_local():
    composed = [_entry("expenses/CONTEXT.md", "Sub-agent.")]
    catalog = {"approve-receipt": {"skill_md_content": PLATFORM_SKILL_MD}}
    result = resolve_skill(
        "approve-receipt", "expenses", composed, platform_catalog_manifest=catalog
    )
    assert result.source == "platform"
    assert result.skill_md_content == PLATFORM_SKILL_MD
    assert result.composed_tree_path is None
    assert result.folder_segment is None


def test_raises_when_resolves_nowhere():
    """No local hit, no catalog entry, no fallback — surface to delegation."""
    composed: list[dict] = []
    with pytest.raises(SkillNotResolvable) as exc:
        resolve_skill("bogus-slug", "expenses", composed, platform_catalog_manifest={})
    assert exc.value.slug == "bogus-slug"
    assert exc.value.folder_path == "expenses"


def test_raises_when_resolves_nowhere_with_no_manifest():
    """`platform_catalog_manifest=None` is the local-only test mode and
    must still raise when nothing matches."""
    with pytest.raises(SkillNotResolvable):
        resolve_skill("bogus", "expenses", [], platform_catalog_manifest=None)


def test_nearer_folder_wins_over_ancestor():
    """Same slug at root + at sub-agent — nearer folder is authoritative."""
    composed = [
        _entry("skills/approve-receipt/SKILL.md", ROOT_LOCAL_SKILL_MD),
        _entry("expenses/skills/approve-receipt/SKILL.md", LOCAL_SKILL_MD),
    ]
    result = resolve_skill("approve-receipt", "expenses", composed)
    assert result.source == "local"
    assert result.folder_segment == "expenses"
    assert result.skill_md_content == LOCAL_SKILL_MD


def test_ancestor_skill_wins_when_current_folder_has_none():
    """Sub-agent without a local override falls back to the ancestor's
    `skills/{slug}/SKILL.md` before reaching the platform catalog."""
    composed = [_entry("skills/approve-receipt/SKILL.md", ROOT_LOCAL_SKILL_MD)]
    catalog = {"approve-receipt": {"skill_md_content": PLATFORM_SKILL_MD}}
    result = resolve_skill(
        "approve-receipt", "expenses", composed, platform_catalog_manifest=catalog
    )
    assert result.source == "local"
    assert result.folder_segment == ""  # root
    assert result.composed_tree_path == "skills/approve-receipt/SKILL.md"


def test_root_agent_resolves_root_skill():
    """`folder_path=""` (root agent) checks `skills/{slug}/SKILL.md` only."""
    composed = [_entry("skills/approve-receipt/SKILL.md", ROOT_LOCAL_SKILL_MD)]
    result = resolve_skill("approve-receipt", "", composed)
    assert result.source == "local"
    assert result.folder_segment == ""


def test_malformed_local_falls_through_to_platform(caplog):
    """A SKILL.md without frontmatter is not-present from the resolver's
    perspective — the walk falls through and the platform copy wins."""
    no_frontmatter = "Just body prose, no YAML.\n"
    composed = [_entry("expenses/skills/approve-receipt/SKILL.md", no_frontmatter)]
    catalog = {"approve-receipt": {"skill_md_content": PLATFORM_SKILL_MD}}
    with caplog.at_level(logging.INFO, logger="skill_resolver"):
        result = resolve_skill(
            "approve-receipt", "expenses", composed, platform_catalog_manifest=catalog
        )
    assert result.source == "platform"
    candidate = "expenses/skills/approve-receipt/SKILL.md"
    fallthrough = [
        rec for rec in caplog.records if "no frontmatter" in rec.getMessage()
    ]
    assert fallthrough, "expected an info log noting the fall-through"
    assert any(
        candidate in rec.getMessage() for rec in fallthrough
    ), "fall-through log should name the candidate path so operators can find the offending file"


def test_unparseable_local_logs_and_falls_through(caplog):
    """If local frontmatter parses but contains the retired
    `execution: composition` value (or similar parse error), the
    resolver logs a warning and falls through rather than aborting the
    delegation."""
    bad_md = """---
execution: composition
---
"""
    composed = [_entry("expenses/skills/approve-receipt/SKILL.md", bad_md)]
    catalog = {"approve-receipt": {"skill_md_content": PLATFORM_SKILL_MD}}
    with caplog.at_level(logging.WARNING, logger="skill_resolver"):
        result = resolve_skill(
            "approve-receipt", "expenses", composed, platform_catalog_manifest=catalog
        )
    assert result.source == "platform"
    candidate = "expenses/skills/approve-receipt/SKILL.md"
    parse_warns = [
        rec for rec in caplog.records if "failed to parse" in rec.getMessage()
    ]
    assert parse_warns, "expected a warning that the local SKILL.md failed to parse"
    assert any(
        candidate in rec.getMessage() for rec in parse_warns
    ), "parse-failure log should name the candidate path so operators can find the offending file"


def test_rejects_reserved_folder_path():
    """Asking the resolver to walk into `memory/` or `skills/` is a
    programming error — those are never sub-agents."""
    for reserved in RESERVED_FOLDER_NAMES:
        with pytest.raises(ValueError) as exc:
            resolve_skill("approve-receipt", reserved, [])
        assert "reserved" in str(exc.value)


def test_rejects_traversal_segments():
    for path in ("expenses/..", "../expenses", "expenses/./foo"):
        with pytest.raises(ValueError):
            resolve_skill("approve-receipt", path, [])


def test_rejects_empty_slug():
    with pytest.raises(ValueError):
        resolve_skill("", "expenses", [])
    with pytest.raises(ValueError):
        resolve_skill(" leading-space", "expenses", [])
    with pytest.raises(ValueError):
        resolve_skill("has/slash", "expenses", [])


def test_strips_leading_trailing_slashes_in_folder_path():
    """Routing-row cells often include trailing slashes (`expenses/`).
    The resolver tolerates them rather than treating them as path
    traversal."""
    composed = [_entry("expenses/skills/approve-receipt/SKILL.md", LOCAL_SKILL_MD)]
    for raw in ("expenses", "expenses/", "/expenses/", "  expenses  "):
        result = resolve_skill("approve-receipt", raw, composed)
        assert result.folder_segment == "expenses"


def test_platform_manifest_supports_alt_content_field():
    """Some catalog builders ship `content`, some ship `skill_md_content`.
    The resolver tolerates either."""
    composed: list[dict] = []
    catalog = {"approve-receipt": {"content": PLATFORM_SKILL_MD}}
    result = resolve_skill(
        "approve-receipt", "expenses", composed, platform_catalog_manifest=catalog
    )
    assert result.source == "platform"
    assert result.skill_md_content == PLATFORM_SKILL_MD


def test_platform_manifest_with_no_content_field_raises_value_error():
    """Defensive: an empty entry in the manifest is a programming bug,
    not a delegation-time operator error — surface it as ValueError so
    we don't return an empty SKILL.md to the dispatcher."""
    composed: list[dict] = []
    catalog = {"approve-receipt": {}}
    with pytest.raises(ValueError):
        resolve_skill(
            "approve-receipt", "expenses", composed, platform_catalog_manifest=catalog
        )


def test_composed_tree_entries_with_missing_content_are_skipped():
    """Index builder ignores entries lacking content (the composer omits
    them when `includeContent=false`); they must not match as local."""
    composed = [
        {"path": "expenses/skills/approve-receipt/SKILL.md"},
        _entry("skills/approve-receipt/SKILL.md", ROOT_LOCAL_SKILL_MD),
    ]
    result = resolve_skill("approve-receipt", "expenses", composed)
    assert result.composed_tree_path == "skills/approve-receipt/SKILL.md"
