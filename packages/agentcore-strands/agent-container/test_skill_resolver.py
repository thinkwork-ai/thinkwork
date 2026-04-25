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


# ---------------------------------------------------------------------------
# Followup fixes (PR #574 review residuals)
# ---------------------------------------------------------------------------


# --- Fix 1: double-slash collapse in _normalize_folder_path ----------------


def test_double_slash_in_folder_path_is_tolerated():
    """`parent + '/' + child` operator typos must not hard-abort delegation.
    Trailing-slash tolerance already set the expectation that internal
    doubles are also tolerated."""
    composed = [_entry("expenses/skills/approve-receipt/SKILL.md", LOCAL_SKILL_MD)]
    result = resolve_skill("approve-receipt", "//expenses//", composed)
    assert result.folder_segment == "expenses"


def test_triple_slash_in_folder_path_is_tolerated():
    composed = [
        _entry("expenses/escalation/skills/approve-receipt/SKILL.md", LOCAL_SKILL_MD)
    ]
    result = resolve_skill(
        "approve-receipt", "expenses///escalation", composed
    )
    assert result.folder_segment == "expenses/escalation"


def test_only_slashes_normalises_to_root():
    """A folder_path of '///' collapses to root without raising."""
    composed = [_entry("skills/approve-receipt/SKILL.md", LOCAL_SKILL_MD)]
    result = resolve_skill("approve-receipt", "///", composed)
    assert result.folder_segment == ""


def test_dot_segment_still_rejected_after_collapse():
    """The collapse only touches `/+` runs; `.` and `..` still raise."""
    for path in ("expenses/.", "./expenses", "expenses/./foo", "expenses/../foo"):
        with pytest.raises(ValueError):
            resolve_skill("approve-receipt", path, [])


# --- Fix 2: isinstance guards in _build_path_index -------------------------


def test_non_string_content_falls_through_to_platform(caplog):
    """Bytes content (e.g. raw S3 read) used to raise TypeError that
    escaped the SkillMdParseError catch and aborted delegation. Now it
    skips with a warning and the platform copy wins."""
    composed = [
        {
            "path": "expenses/skills/approve-receipt/SKILL.md",
            "content": LOCAL_SKILL_MD.encode("utf-8"),
        }
    ]
    catalog = {"approve-receipt": {"skill_md_content": PLATFORM_SKILL_MD}}
    with caplog.at_level(logging.WARNING, logger="skill_resolver"):
        result = resolve_skill(
            "approve-receipt", "expenses", composed, platform_catalog_manifest=catalog
        )
    assert result.source == "platform"
    assert any(
        "non-string path/content" in rec.getMessage() for rec in caplog.records
    )


def test_non_string_path_in_composed_tree_is_skipped(caplog):
    composed = [
        {"path": 123, "content": LOCAL_SKILL_MD},
        _entry("skills/approve-receipt/SKILL.md", ROOT_LOCAL_SKILL_MD),
    ]
    with caplog.at_level(logging.WARNING, logger="skill_resolver"):
        result = resolve_skill("approve-receipt", "expenses", composed)
    assert result.composed_tree_path == "skills/approve-receipt/SKILL.md"
    assert any(
        "non-string path/content" in rec.getMessage() for rec in caplog.records
    )


def test_non_mapping_entry_in_composed_tree_is_skipped(caplog):
    """A bare string (or any non-Mapping) in the composed tree must not
    crash the index builder."""
    composed: list = ["unexpected", _entry("skills/approve-receipt/SKILL.md", ROOT_LOCAL_SKILL_MD)]
    with caplog.at_level(logging.WARNING, logger="skill_resolver"):
        result = resolve_skill("approve-receipt", "expenses", composed)
    assert result.source == "local"
    assert any(
        "not a mapping" in rec.getMessage() for rec in caplog.records
    )


def test_dict_as_composed_tree_raises_type_error():
    """Sequence[Mapping] in the type annotation can't catch this at runtime;
    a Mapping passed where a Sequence is expected iterates keys (strings)
    and crashes inside `_build_path_index`. We surface the misuse as a
    TypeError with an actionable message instead."""
    composed_tree_dict = {"expenses/skills/approve-receipt/SKILL.md": LOCAL_SKILL_MD}
    with pytest.raises(TypeError) as exc:
        resolve_skill("approve-receipt", "expenses", composed_tree_dict)  # type: ignore[arg-type]
    assert "Sequence" in str(exc.value)


# --- Fix 3: platform manifest precedence -----------------------------------


def test_canonical_skill_md_content_wins_when_both_set():
    """`skill_md_content` is canonical; `content` is a tolerated alias.
    When both are set the canonical wins. Pin this so a future refactor
    can't silently flip it."""
    composed: list[dict] = []
    catalog = {
        "approve-receipt": {
            "skill_md_content": PLATFORM_SKILL_MD,
            "content": "stale alias body",
        }
    }
    result = resolve_skill(
        "approve-receipt", "expenses", composed, platform_catalog_manifest=catalog
    )
    assert result.skill_md_content == PLATFORM_SKILL_MD


def test_empty_canonical_raises_rather_than_falling_through_to_alias():
    """An empty `skill_md_content` is an explicit tombstone; we surface it
    as ValueError instead of silently using `content` (which would mask
    the tombstone). Pre-fix `or` short-circuit collapsed empty string to
    falsy and let `content` win."""
    composed: list[dict] = []
    catalog = {
        "approve-receipt": {
            "skill_md_content": "",
            "content": "alias body that should not win",
        }
    }
    with pytest.raises(ValueError) as exc:
        resolve_skill(
            "approve-receipt", "expenses", composed, platform_catalog_manifest=catalog
        )
    assert "empty" in str(exc.value)


def test_alias_content_wins_only_when_canonical_absent():
    composed: list[dict] = []
    catalog = {"approve-receipt": {"content": PLATFORM_SKILL_MD}}
    result = resolve_skill(
        "approve-receipt", "expenses", composed, platform_catalog_manifest=catalog
    )
    assert result.skill_md_content == PLATFORM_SKILL_MD


def test_non_string_canonical_raises_value_error():
    composed: list[dict] = []
    catalog = {"approve-receipt": {"skill_md_content": 123}}
    with pytest.raises(ValueError):
        resolve_skill(
            "approve-receipt", "expenses", composed, platform_catalog_manifest=catalog
        )


# --- Fix 4: tighten _is_usable_local cascade gate --------------------------


_NO_NAME_SKILL_MD = """---
description: Has description but no name
execution: script
---
Body.
"""

_NO_DESCRIPTION_SKILL_MD = """---
name: approve-receipt
execution: script
---
Body.
"""

_EMPTY_NAME_SKILL_MD = """---
name: ""
description: Has description, empty name
execution: script
---
"""

_EMPTY_FRONTMATTER_SKILL_MD = """---
---
Body.
"""


def test_local_missing_name_falls_through_to_platform(caplog):
    """A near-correct local SKILL.md with no `name` would silently shadow
    the platform copy across every descendant agent under the original
    `frontmatter_present and bool(data)` gate. Tightened to require non-
    empty name + description fields."""
    composed = [_entry("expenses/skills/approve-receipt/SKILL.md", _NO_NAME_SKILL_MD)]
    catalog = {"approve-receipt": {"skill_md_content": PLATFORM_SKILL_MD}}
    with caplog.at_level(logging.INFO, logger="skill_resolver"):
        result = resolve_skill(
            "approve-receipt", "expenses", composed, platform_catalog_manifest=catalog
        )
    assert result.source == "platform"
    assert any(
        "non-empty 'name'" in rec.getMessage() for rec in caplog.records
    )


def test_local_missing_description_falls_through_to_platform(caplog):
    composed = [_entry("expenses/skills/approve-receipt/SKILL.md", _NO_DESCRIPTION_SKILL_MD)]
    catalog = {"approve-receipt": {"skill_md_content": PLATFORM_SKILL_MD}}
    with caplog.at_level(logging.INFO, logger="skill_resolver"):
        result = resolve_skill(
            "approve-receipt", "expenses", composed, platform_catalog_manifest=catalog
        )
    assert result.source == "platform"
    assert any(
        "non-empty 'description'" in rec.getMessage() for rec in caplog.records
    )


def test_local_empty_name_falls_through_to_platform():
    composed = [_entry("expenses/skills/approve-receipt/SKILL.md", _EMPTY_NAME_SKILL_MD)]
    catalog = {"approve-receipt": {"skill_md_content": PLATFORM_SKILL_MD}}
    result = resolve_skill(
        "approve-receipt", "expenses", composed, platform_catalog_manifest=catalog
    )
    assert result.source == "platform"


def test_local_empty_frontmatter_falls_through(caplog):
    """`---/---` (present but empty) — second clause of `_is_usable_local`
    that was uncovered before."""
    composed = [
        _entry("expenses/skills/approve-receipt/SKILL.md", _EMPTY_FRONTMATTER_SKILL_MD)
    ]
    catalog = {"approve-receipt": {"skill_md_content": PLATFORM_SKILL_MD}}
    with caplog.at_level(logging.INFO, logger="skill_resolver"):
        result = resolve_skill(
            "approve-receipt", "expenses", composed, platform_catalog_manifest=catalog
        )
    assert result.source == "platform"
    assert any(
        "frontmatter is present but empty" in rec.getMessage()
        for rec in caplog.records
    )


def test_local_with_full_frontmatter_still_wins():
    """Regression guard: tightening the cascade gate must not break the
    happy path."""
    composed = [_entry("expenses/skills/approve-receipt/SKILL.md", LOCAL_SKILL_MD)]
    catalog = {"approve-receipt": {"skill_md_content": PLATFORM_SKILL_MD}}
    result = resolve_skill(
        "approve-receipt", "expenses", composed, platform_catalog_manifest=catalog
    )
    assert result.source == "local"
    assert result.skill_md_content == LOCAL_SKILL_MD
