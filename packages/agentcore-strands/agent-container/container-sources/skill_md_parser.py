"""Canonical SKILL.md frontmatter parser for the Strands runtime.

Plan 2026-04-24-009 §U1 — replaces the hand-rolled `_parse_skill_yaml`
in `skill_runner.py` (which still exists for U1 to ship inert; U3
deletes it). This module is the future home of every skill-catalog
read in the Python runtime: catalog discovery, dispatcher index,
template-skill registration, and any future loader.

Shape contract (matches `packages/api/src/lib/skill-md-parser.ts`):

  ---
  name: sales-prep            # required for SI-4 plugins; lenient mode tolerates absence
  description: Short prose    # required for SI-4 plugins; lenient mode tolerates absence
  execution: script           # one of {script, context}; missing → None (caller defaults context)
  # ... every other field passes through verbatim
  ---
  body prose

The parser is **lenient** by default — `parse_skill_md` returns a
`ParsedSkillMd` for files with no frontmatter (empty `data`,
`frontmatter_present=False`) so callers can `if not parsed.data: continue`
the way the legacy `_parse_skill_yaml` returned `None`.

Two entry points mirror the TS parser:
  - `parse_skill_md_string(source, source_label)` — for content from S3 or
    other in-memory sources. `source_label` shows up in error messages.
  - `parse_skill_md_file(path)` — for on-disk reads. Returns `None` when
    the file does not exist (matching `_parse_skill_yaml` semantics for
    the existing callers we replace in U3).

Errors raise `SkillMdParseError` with the source path threaded through
the message. The two paths the parser must reject regardless of
caller-leniency:
  1. Malformed YAML — `yaml.YAMLError` is wrapped with file context.
  2. `execution: composition` (or any value not in `{script, context}`)
     — U6 of the composition-skills retirement plan removed composition
     orchestrators; an audit drift is the only reason a file would still
     declare it. Empty/missing execution is fine and means "context".
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

import yaml

# Allowed values for the `execution` field. Empty/missing is also fine —
# the loader defaults to "context" — but anything else is the audit
# tripwire we trip in U1.
ALLOWED_EXECUTION_VALUES: tuple[str, ...] = ("script", "context")


class SkillMdParseError(ValueError):
    """Raised when a SKILL.md frontmatter block cannot be parsed.

    Carries the source path on `.source_path` so callers can attach it
    to log lines without re-parsing the message string.
    """

    def __init__(self, message: str, source_path: str) -> None:
        super().__init__(message)
        self.source_path = source_path


@dataclass
class ParsedSkillMd:
    """Parsed result for both `parse_skill_md_string` and `parse_skill_md_file`.

    Mirrors the TS `SkillMdInternalParsed` interface. Callers that need
    a strict equivalent of the SI-4 surface enforce
    `name`/`description`/etc themselves on `.data`.
    """

    source_path: str
    frontmatter_present: bool
    data: dict[str, Any] = field(default_factory=dict)
    body: str = ""
    execution: str | None = None


def _split_frontmatter(source: str) -> tuple[str, str] | None:
    """Split a SKILL.md document into (yaml_text, body).

    Returns None when no frontmatter block is present so callers can
    distinguish "this is a body-only file" from "the YAML in the
    frontmatter is malformed."

    Mirrors the TS `splitFrontmatter` exactly: BOM-tolerant opening,
    requires the `---` markers at column 0, body is whatever follows
    the closing marker plus its trailing newline(s).
    """
    # Strip a leading BOM. Some editors save with one; the spec is
    # quiet on the matter, so we tolerate it like the TS parser does.
    if source.startswith("﻿"):
        source = source[1:]
    if not source.startswith("---"):
        return None

    opening_newline = source.find("\n")
    if opening_newline == -1:
        return None

    rest = source[opening_newline + 1 :]
    # Find the closing `---` on its own line (column 0).
    closing_idx = -1
    if rest.startswith("---\r") or rest.startswith("---\n") or rest == "---":
        closing_idx = 0
    else:
        marker = "\n---"
        idx = rest.find(marker)
        while idx != -1:
            after = idx + len(marker)
            # Closing marker must end at EOL or EOF — otherwise it's
            # a stray `---` inside prose.
            if after == len(rest) or rest[after] in ("\r", "\n"):
                closing_idx = idx + 1  # skip the leading newline
                break
            idx = rest.find(marker, after)

    if closing_idx == -1:
        return None

    yaml_text = rest[:closing_idx].rstrip("\n")
    if closing_idx == 0:
        yaml_text = ""

    after_close = rest[closing_idx:]
    # Strip the closing `---` and its trailing newlines.
    after_close = after_close.lstrip("\n")
    if after_close.startswith("---"):
        after_close = after_close[3:]
    after_close = after_close.lstrip("\r\n")
    return yaml_text, after_close


def _validate_execution(raw: Any, source_path: str) -> str | None:
    """Validate `execution`. Returns the resolved value or None.

    Raises `SkillMdParseError` for unsupported values (notably the
    legacy `composition`) and non-string types. Empty/missing return
    None so callers can default to "context".
    """
    if raw is None or raw == "":
        return None
    if not isinstance(raw, str):
        raise SkillMdParseError(
            f"SKILL.md at {source_path} field 'execution' must be a string, "
            f"got {type(raw).__name__}",
            source_path,
        )
    if raw not in ALLOWED_EXECUTION_VALUES:
        raise SkillMdParseError(
            f"SKILL.md at {source_path} field 'execution' must be one of "
            f"{list(ALLOWED_EXECUTION_VALUES)} (got {raw!r}); 'composition' "
            "was retired in U6 of plan 2026-04-22-005",
            source_path,
        )
    return raw


def parse_skill_md_string(source: str, source_path: str) -> ParsedSkillMd:
    """Parse a SKILL.md document from an in-memory string.

    `source_path` is the label that appears in error messages — pass
    the on-disk path, the S3 key, or any other identifier the caller
    has handy.

    Lenient by default: a SKILL.md without frontmatter is returned with
    `frontmatter_present=False` and an empty `data`. Malformed YAML and
    `execution: composition` always raise `SkillMdParseError`.
    """
    split = _split_frontmatter(source)
    if split is None:
        return ParsedSkillMd(
            source_path=source_path,
            frontmatter_present=False,
            data={},
            body=source,
            execution=None,
        )

    yaml_text, body = split
    try:
        parsed = yaml.safe_load(yaml_text) if yaml_text.strip() else None
    except yaml.YAMLError as e:
        raise SkillMdParseError(
            f"SKILL.md at {source_path} has malformed YAML frontmatter: {e}",
            source_path,
        ) from e

    if parsed is None:
        # `---\n---` or whitespace-only frontmatter — present but empty.
        return ParsedSkillMd(
            source_path=source_path,
            frontmatter_present=True,
            data={},
            body=body,
            execution=None,
        )

    if not isinstance(parsed, dict):
        raise SkillMdParseError(
            f"SKILL.md at {source_path} frontmatter is not a mapping "
            f"(got {type(parsed).__name__})",
            source_path,
        )

    execution = _validate_execution(parsed.get("execution"), source_path)

    return ParsedSkillMd(
        source_path=source_path,
        frontmatter_present=True,
        data=parsed,
        body=body,
        execution=execution,
    )


def parse_skill_md_file(filepath: str) -> ParsedSkillMd | None:
    """Parse a SKILL.md document from disk.

    Returns `None` when the file does not exist — matches the legacy
    `_parse_skill_yaml(filepath)` semantics so the U3 swap is a
    drop-in. Read errors and YAML errors raise `SkillMdParseError`
    with the filepath threaded through.
    """
    if not os.path.isfile(filepath):
        return None
    try:
        with open(filepath, encoding="utf-8") as f:
            source = f.read()
    except OSError as e:
        raise SkillMdParseError(
            f"SKILL.md at {filepath} could not be read: {e}",
            filepath,
        ) from e
    return parse_skill_md_string(source, filepath)
