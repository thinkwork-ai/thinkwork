"""Tests for agents_md_parser.py — Plan §008 U7.

Mirrors every U6 TS scenario plus a Unicode test and the cross-side
fixture-parity assertion. The shared fixture lives at
``packages/agentcore/agent-container/fixtures/agents-md-sample.md`` and is
the source of truth for the U6/U7 contract — both parsers are tested
against it; either side drifting trips the assertion.
"""

import pathlib

import pytest
from agents_md_parser import (
    AgentsMdContext,
    RoutingRow,
    parse_agents_md,
)

FIXTURE_DIR = pathlib.Path(__file__).parent / "fixtures"


# ─── Happy path ─────────────────────────────────────────────────────────


def test_extracts_four_column_table_three_rows() -> None:
    md = """# AGENTS.md

## Routing

| Task             | Go to       | Read                  | Skills                       |
| ---------------- | ----------- | --------------------- | ---------------------------- |
| Expense receipts | expenses/   | expenses/CONTEXT.md   | approve-receipt,tag-vendor   |
| Recruiting       | recruiting/ | recruiting/CONTEXT.md | score-candidate              |
| Legal review     | legal/      | legal/CONTEXT.md      | review-contract              |
"""
    result = parse_agents_md(md)
    assert isinstance(result, AgentsMdContext)
    assert len(result.routing) == 3
    assert result.routing[0] == RoutingRow(
        task="Expense receipts",
        go_to="expenses/",
        reads=["expenses/CONTEXT.md"],
        skills=["approve-receipt", "tag-vendor"],
    )
    assert result.routing[2].skills == ["review-contract"]
    assert result.raw_markdown == md


def test_tolerates_column_reordering() -> None:
    md = """## Routing

| Skills | Task | Go to | Read |
| --- | --- | --- | --- |
| approve-receipt,tag-vendor | Expense receipts | expenses/ | expenses/CONTEXT.md |
"""
    result = parse_agents_md(md)
    assert len(result.routing) == 1
    row = result.routing[0]
    assert row.task == "Expense receipts"
    assert row.go_to == "expenses/"
    assert row.reads == ["expenses/CONTEXT.md"]
    assert row.skills == ["approve-receipt", "tag-vendor"]


def test_header_aliases_case_insensitive() -> None:
    md = """## Routing

| TASK | GO TO | READS | SKILL |
| --- | --- | --- | --- |
| Expense receipts | expenses/ | expenses/CONTEXT.md | approve-receipt |
"""
    result = parse_agents_md(md)
    assert len(result.routing) == 1
    assert result.routing[0].go_to == "expenses/"


def test_empty_skills_cell_yields_empty_list() -> None:
    md = """## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| Bare | bare/ | bare/CONTEXT.md | |
"""
    result = parse_agents_md(md)
    assert result.routing[0].skills == []


def test_falls_back_to_only_table_when_no_routing_heading() -> None:
    md = """# AGENTS.md

Some prose, no Routing heading.

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| Specialist | spec/ | spec/CONTEXT.md | one |
"""
    result = parse_agents_md(md)
    assert len(result.routing) == 1
    assert result.routing[0].go_to == "spec/"


# ─── Tolerances ────────────────────────────────────────────────────────


def test_skips_invalid_go_to_rows_with_warn(caplog: pytest.LogCaptureFixture) -> None:
    md = """## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| _add a row when you create a sub-agent_ | _e.g. `expenses/`_ | _e.g. `expenses/CONTEXT.md`_ | _comma-separated slugs_ |
| Real specialist | expenses/ | expenses/CONTEXT.md | approve-receipt |
"""
    with caplog.at_level("WARNING"):
        result = parse_agents_md(md)
    assert len(result.routing) == 1
    assert result.routing[0].go_to == "expenses/"
    assert any("not a valid folder path" in rec.message for rec in caplog.records)


def test_rejects_reserved_go_to_names(caplog: pytest.LogCaptureFixture) -> None:
    md = """## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| Hidden mem | memory | memory/CONTEXT.md | x |
| Hidden skill | skills/ | skills/CONTEXT.md | x |
| Real | expenses/ | expenses/CONTEXT.md | x |
"""
    with caplog.at_level("WARNING"):
        result = parse_agents_md(md)
    assert len(result.routing) == 1
    assert result.routing[0].go_to == "expenses/"
    reserved_warns = [r for r in caplog.records if "reserved folder name" in r.message]
    assert len(reserved_warns) == 2


# ─── Skipped-row surfacing (Plan 2026-04-25-004 U4) ───────────────────


def test_reserved_go_to_populates_warnings_and_skipped_rows() -> None:
    """A reserved-name skip records both a human-readable ``warnings`` entry
    and a structured ``skipped_rows`` record so callers can surface the
    drop to the LLM rather than losing the row's skills silently.
    """
    md = """## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| Hidden mem | memory/ | memory/CONTEXT.md | x |
| Real | expenses/ | expenses/CONTEXT.md | y |
"""
    result = parse_agents_md(md)
    assert len(result.routing) == 1
    assert result.routing[0].go_to == "expenses/"
    assert result.warnings == [
        "row 0 skipped — go_to 'memory/' is reserved",
    ]
    assert result.skipped_rows == [
        {"row_index": 0, "go_to": "memory/", "reason": "reserved"},
    ]


def test_invalid_path_go_to_populates_warnings_and_skipped_rows() -> None:
    """A malformed-path skip records both surfaces with reason=invalid_path."""
    md = """## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| Bad path | Not A Path | x | y |
| Real | expenses/ | expenses/CONTEXT.md | y |
"""
    result = parse_agents_md(md)
    assert len(result.routing) == 1
    assert result.routing[0].go_to == "expenses/"
    assert len(result.warnings) == 1
    assert "not a valid folder path" in result.warnings[0]
    assert result.skipped_rows == [
        {"row_index": 0, "go_to": "Not A Path", "reason": "invalid_path"},
    ]


def test_mixed_skips_record_per_row_indices() -> None:
    """row_index counts each non-blank data row, including those skipped, so
    a downstream editor can map a record back to its source row.
    """
    md = """## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| Hidden mem | memory/ | x | y |
| Real | expenses/ | expenses/CONTEXT.md | y |
| Bad | NOPE | x | y |
"""
    result = parse_agents_md(md)
    assert len(result.routing) == 1
    assert [r["row_index"] for r in result.skipped_rows] == [0, 2]
    assert [r["reason"] for r in result.skipped_rows] == ["reserved", "invalid_path"]


def test_warnings_and_skipped_rows_default_to_empty() -> None:
    """A clean parse leaves both surfaces empty (no false positives)."""
    md = """## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| Real | expenses/ | expenses/CONTEXT.md | y |
"""
    result = parse_agents_md(md)
    assert result.warnings == []
    assert result.skipped_rows == []


def test_no_table_returns_empty_warnings_and_skipped_rows() -> None:
    """Markdown without a routing table still exposes the new fields as []."""
    result = parse_agents_md("# Just prose, no table.")
    assert result.warnings == []
    assert result.skipped_rows == []


def test_ignores_trailing_empty_rows() -> None:
    md = """## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| Real | expenses/ | expenses/CONTEXT.md | a |
| | | | |
"""
    result = parse_agents_md(md)
    assert len(result.routing) == 1


def test_strips_italics_bold_backticks() -> None:
    md = """## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| **Expense receipts** | `expenses/` | `expenses/CONTEXT.md` | `approve-receipt` |
"""
    result = parse_agents_md(md)
    assert result.routing[0] == RoutingRow(
        task="Expense receipts",
        go_to="expenses/",
        reads=["expenses/CONTEXT.md"],
        skills=["approve-receipt"],
    )


def test_returns_empty_when_no_table_present() -> None:
    result = parse_agents_md("# Just prose, no table.")
    assert result.routing == []


def test_unicode_content_in_task_column_normalizes() -> None:
    # NFKC normalization: full-width letters collapse to ASCII.
    md = """## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| Expense receipts ｆｕｌｌ | expenses/ | expenses/CONTEXT.md | approve-receipt |
"""
    result = parse_agents_md(md)
    assert len(result.routing) == 1
    assert "full" in result.routing[0].task


# ─── Error paths ───────────────────────────────────────────────────────


def test_raises_when_go_to_column_missing_in_routing() -> None:
    md = """## Routing

| Task | Read | Skills |
| --- | --- | --- |
| Recruiting | recruiting/CONTEXT.md | score |
"""
    with pytest.raises(ValueError, match=r"(?i)Go to"):
        parse_agents_md(md)


def test_raises_when_go_to_missing_in_fallback_single_table() -> None:
    md = """# AGENTS.md

| Task | Read | Skills |
| --- | --- | --- |
| Recruiting | recruiting/CONTEXT.md | score |
"""
    with pytest.raises(ValueError, match=r"(?i)Go to"):
        parse_agents_md(md)


def test_raises_on_multiple_top_level_tables_with_no_routing_heading() -> None:
    md = """# AGENTS.md

| A | B |
| - | - |
| 1 | 2 |

| C | D |
| - | - |
| 3 | 4 |
"""
    with pytest.raises(ValueError, match=r"(?i)multiple tables"):
        parse_agents_md(md)


# ─── Fixture parity ────────────────────────────────────────────────────


def test_shared_fixture_parses_to_expected_shape() -> None:
    """The shared U6/U7 fixture is the source of truth — drift between the
    TS and Py parsers is caught by both sides asserting the same shape.
    """
    fixture = (FIXTURE_DIR / "agents-md-sample.md").read_text()
    result = parse_agents_md(fixture)
    assert [r.go_to for r in result.routing] == [
        "expenses/",
        "recruiting/",
        "legal/",
    ]
    assert result.routing[0].skills == ["approve-receipt", "tag-vendor"]
    assert result.routing[1].task == "Recruiting"


def test_shared_skipped_rows_fixture_emits_warnings_and_skipped_rows() -> None:
    """Plan 2026-04-25-004 U4 fixture parity. The shared skipped-rows
    fixture has one reserved row, one invalid-path row, and one valid
    row. Both parsers must emit the same shape.
    """
    fixture = (FIXTURE_DIR / "agents-md-skipped-rows.md").read_text()
    result = parse_agents_md(fixture)
    assert [r.go_to for r in result.routing] == ["expenses/"]
    assert result.skipped_rows == [
        {"row_index": 0, "go_to": "memory/", "reason": "reserved"},
        {"row_index": 1, "go_to": "Not A Path", "reason": "invalid_path"},
    ]
    assert len(result.warnings) == 2
    assert "memory/" in result.warnings[0]
    assert "reserved" in result.warnings[0]
    assert "Not A Path" in result.warnings[1]
    assert "valid folder path" in result.warnings[1]


def test_seeded_workspace_defaults_AGENTS_md_parses_cleanly() -> None:
    """Seeded AGENTS.md (Plan §008 U3) only has a placeholder row; expected
    parsed rows = 0 after skip.
    """
    seeded = (
        pathlib.Path(__file__).parent.parent.parent
        / "workspace-defaults"
        / "files"
        / "AGENTS.md"
    ).read_text()
    result = parse_agents_md(seeded)
    assert result.routing == []
