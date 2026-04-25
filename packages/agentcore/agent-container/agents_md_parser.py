"""AGENTS.md routing-table parser — Python mirror of the TS parser.

Plan §008 U7. Parses the `| Task | Go to | Read | Skills |` markdown table
inside an AGENTS.md document into typed routing rows. Surrounding prose is
preserved on `raw_markdown` so callers can edit a row without clobbering
the rest of the document.

Used by the Strands runtime (`packages/agentcore-strands/agent-container/
container-sources/`) for delegation-time skill resolution and sub-agent
enumeration. The TS counterpart at `packages/api/src/lib/agents-md-parser.ts`
serves the admin builder routing-row editor and the bundle importer.

═════════════════════════════════════════════════════════════════════════
PINNED_SHAPE_CONTRACT
═════════════════════════════════════════════════════════════════════════
TS mirror: `packages/api/src/lib/agents-md-parser.ts`
Shared fixture: `packages/agentcore/agent-container/fixtures/agents-md-sample.md`

Both parsers run a fixture-parity test that fails when either side drifts.

Public surface (must stay in sync, both sides):
    parse_agents_md(md) -> AgentsMdContext
        AgentsMdContext { routing: list[RoutingRow], raw_markdown: str }
        RoutingRow {
            task:    str         # human-readable label, decoration-stripped
            go_to:   str         # sub-agent folder path, e.g. "expenses/"
            reads:   list[str]   # file paths the operator referenced (verbatim)
            skills:  list[str]   # skill slugs (verbatim, dedup is U11's job)
        }

Tolerances (both sides):
    - Column reordering — header names locate columns; aliases case-insensitive
    - Whitespace variation in cells, header rows, separator rows
    - Italics / bold / backticks stripped before validation
    - Trailing empty rows skipped
    - Rows with invalid go_to paths skipped + WARN-logged (not raised)
    - Rows with reserved go_to names ("memory", "skills") skipped + WARN-logged

Hard errors (both sides):
    - Routing table present but no `Go to` column → raise ValueError
    - Multiple top-level tables and no `## Routing` heading → raise ValueError

Per `inline-helpers-vs-shared-package` learning the parser is inlined here
(TS+Py mirrors) rather than extracted to a shared package — total parser is
~80 lines per side; the fixture-parity test is the drift detector.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# Reserved folder names — never sub-agents at any depth.
#
# Mirrors `RESERVED_FOLDER_NAMES` exported from
# `packages/api/src/lib/reserved-folder-names.ts` (Plan §008 U8 single source
# of truth on the TS side). The Strands runtime is offline from npm, so we
# inline the constant here per the
# `inline-helpers-vs-shared-package-for-cross-surface-code` learning.
# Add to both sides + refresh the shared
# `fixtures/agents-md-sample.md` if you change the set.
RESERVED_FOLDER_NAMES: frozenset[str] = frozenset({"memory", "skills"})

_HEADING_RE = re.compile(r"^##\s+Routing(\s+Table)?\s*$", re.IGNORECASE)
_NEXT_H2_RE = re.compile(r"^##\s+")
_SEPARATOR_CELL_RE = re.compile(r"^:?-+:?$")
_FOLDER_PATH_RE = re.compile(r"^[a-z0-9][a-z0-9-]*(?:/[a-z0-9][a-z0-9-]*)*/?$")


@dataclass
class RoutingRow:
    task: str
    go_to: str
    reads: list[str] = field(default_factory=list)
    skills: list[str] = field(default_factory=list)


@dataclass
class AgentsMdContext:
    routing: list[RoutingRow] = field(default_factory=list)
    raw_markdown: str = ""


def parse_agents_md(markdown: str) -> AgentsMdContext:
    """Parse AGENTS.md content. Never raises on a row-level malformation;
    raises ValueError on document-level ambiguity (missing Go to column or
    multiple top-level tables with no Routing heading).
    """
    table = _locate_routing_table(markdown)
    if table is None:
        return AgentsMdContext(routing=[], raw_markdown=markdown)
    routing = _parse_routing_block(table)
    return AgentsMdContext(routing=routing, raw_markdown=markdown)


def _locate_routing_table(markdown: str) -> tuple[str, list[str]] | None:
    """Return (header_line, data_lines) for the routing table, or None."""
    lines = markdown.split("\n")

    # Preferred: '## Routing' (or 'Routing Table') heading.
    heading_idx = -1
    for i, line in enumerate(lines):
        if _HEADING_RE.match(line.strip()):
            heading_idx = i
            break

    if heading_idx != -1:
        section = _slice_until_next_h2(lines, heading_idx + 1)
        return _extract_first_table(section)

    # Fallback: a single top-level table when no routing heading exists.
    tables = _extract_all_tables(lines)
    if not tables:
        return None
    if len(tables) == 1:
        return tables[0]
    raise ValueError(
        "AGENTS.md has multiple tables but no '## Routing' heading — "
        "add a heading to disambiguate."
    )


def _slice_until_next_h2(lines: list[str], start: int) -> list[str]:
    end = len(lines)
    for i in range(start, len(lines)):
        if _NEXT_H2_RE.match(lines[i].strip()):
            end = i
            break
    return lines[start:end]


def _extract_first_table(lines: list[str]) -> tuple[str, list[str]] | None:
    tables = _extract_all_tables(lines)
    return tables[0] if tables else None


def _extract_all_tables(lines: list[str]) -> list[tuple[str, list[str]]]:
    out: list[tuple[str, list[str]]] = []
    i = 0
    while i < len(lines):
        if not _is_table_line(lines[i]):
            i += 1
            continue
        header = lines[i]
        if i + 1 >= len(lines) or not _is_separator_row(lines[i + 1]):
            i += 1
            continue
        data: list[str] = []
        j = i + 2
        while j < len(lines) and _is_table_line(lines[j]):
            data.append(lines[j])
            j += 1
        out.append((header, data))
        i = j
    return out


def _is_table_line(line: str) -> bool:
    return line.strip().startswith("|")


def _is_separator_row(line: str) -> bool:
    cells = _parse_row_cells(line)
    return bool(cells) and all(_SEPARATOR_CELL_RE.match(c) for c in cells)


def _parse_row_cells(line: str) -> list[str]:
    trimmed = line.strip()
    if not trimmed.startswith("|"):
        return []
    body = trimmed[1:]
    if body.endswith("|"):
        body = body[:-1]
    return [c.strip() for c in body.split("|")]


def _index_columns(header_cells: list[str]) -> dict[str, int]:
    idx = {"task": -1, "go_to": -1, "reads": -1, "skills": -1}
    for i, raw in enumerate(header_cells):
        normalized = re.sub(r"[\s_\-]", "", raw).lower()
        if normalized == "task":
            idx["task"] = i
        elif normalized == "goto":
            idx["go_to"] = i
        elif normalized in ("read", "reads"):
            idx["reads"] = i
        elif normalized in ("skill", "skills"):
            idx["skills"] = i
    return idx


def _parse_routing_block(block: tuple[str, list[str]]) -> list[RoutingRow]:
    header_line, data_lines = block
    header_cells = _parse_row_cells(header_line)
    cols = _index_columns(header_cells)
    if cols["go_to"] == -1:
        raise ValueError(
            "AGENTS.md routing table is missing the 'Go to' column. "
            "Add a 'Go to' header to the routing table."
        )

    out: list[RoutingRow] = []
    for line in data_lines:
        cells = _parse_row_cells(line)
        if not cells or all(c == "" for c in cells):
            continue

        raw_go_to = cells[cols["go_to"]] if cols["go_to"] < len(cells) else ""
        go_to = _strip_decorations(raw_go_to)
        if not go_to:
            continue

        go_to_folder = go_to[:-1] if go_to.endswith("/") else go_to
        if go_to_folder in RESERVED_FOLDER_NAMES:
            logger.warning(
                "[agents_md_parser] Skipping row — go_to %r is a reserved folder name "
                "(memory/skills).",
                go_to,
            )
            continue
        if not _is_valid_folder_path(go_to):
            logger.warning(
                "[agents_md_parser] Skipping row — go_to %r is not a valid folder path.",
                raw_go_to,
            )
            continue

        task = (
            _strip_decorations(cells[cols["task"]])
            if cols["task"] >= 0 and cols["task"] < len(cells)
            else ""
        )
        reads = (
            _split_list(cells[cols["reads"]])
            if cols["reads"] >= 0 and cols["reads"] < len(cells)
            else []
        )
        skills = (
            _split_list(cells[cols["skills"]])
            if cols["skills"] >= 0 and cols["skills"] < len(cells)
            else []
        )

        out.append(
            RoutingRow(
                task=task,
                go_to=go_to,
                reads=[s for s in reads if s],
                skills=[s for s in skills if s],
            )
        )
    return out


def _strip_decorations(s: str) -> str:
    out = unicodedata.normalize("NFKC", s).strip()
    # Strip wrapping bold first (so we don't half-strip ** as italics).
    out = re.sub(r"^(\*\*|__)(.*?)(\*\*|__)$", r"\2", out)
    # Strip wrapping italics.
    out = re.sub(r"^(\*|_)(.*?)(\*|_)$", r"\2", out)
    # Strip backticks anywhere; routing-row cells don't contain code spans.
    out = out.replace("`", "")
    return out.strip()


def _split_list(cell: str) -> list[str]:
    return [_strip_decorations(p) for p in cell.split(",")]


def _is_valid_folder_path(p: str) -> bool:
    return bool(_FOLDER_PATH_RE.match(p))
