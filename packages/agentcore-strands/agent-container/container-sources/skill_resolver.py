"""Skill resolver for composed Fat-folder workspaces — Plan §008 U10.

Given a skill slug referenced in an `AGENTS.md` routing row, locate the
authoritative `SKILL.md` content using the standard precedence:

    1.  Local skill at the current folder:
            ``{folder_path}/skills/{slug}/SKILL.md``
    2.  Local skill at any ancestor folder, walking upward:
            ``{parent}/skills/{slug}/SKILL.md`` … ``skills/{slug}/SKILL.md``
    3.  Platform skill in ``packages/skill-catalog`` — supplied to the
        runtime as a ``platform_catalog_manifest`` mapping ``slug ->
        ResolvedSkill``-shaped dict (the lookup table the dispatcher
        already builds at boot).

First match wins. A local ``SKILL.md`` that lacks frontmatter is treated
as not-present and the walk falls through — operators staging an empty
file shouldn't accidentally shadow the platform skill they meant to
keep using.

The resolver is **pure**: no S3, no HTTP, no filesystem. The composed
tree comes from ``fetch_composed_workspace`` (the parent agent's full
list of `{path, source, sha256, content}` records) and the catalog
manifest is whatever the runtime already has in memory.

Ships inert per ``feedback_ship_inert_pattern``; ``delegate_to_workspace``
(U9) is the first caller. Until then this module is reachable via boot-
assert and the unit tests below — nothing else imports it yet.

Reserved-folder names (``memory``, ``skills``) at any depth in
``folder_path`` are rejected up front: they are never sub-agents, so a
caller asking the resolver to walk *into* them is a programming error,
not an operator typo.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from skill_md_parser import (
    ParsedSkillMd,
    SkillMdParseError,
    parse_skill_md_string,
)

logger = logging.getLogger(__name__)

# Reserved folder names — mirrored from
# `packages/api/src/lib/reserved-folder-names.ts` (Plan §008 U8) and
# `packages/agentcore/agent-container/agents_md_parser.py`. The Strands
# runtime is offline from npm, so we inline the constant here per the
# `inline-helpers-vs-shared-package-for-cross-surface-code` learning.
RESERVED_FOLDER_NAMES: frozenset[str] = frozenset({"memory", "skills"})

# Maximum sub-agent recursion / folder depth — Plan §008 Key Decision (line 155):
# "Recursion depth cap = 5 with soft warn at 4". Single source of truth shared by
# `delegate_to_workspace_tool.py` (delegation depth) and `write_memory_tool.py`
# (memory-path folder-prefix depth) so a future cap change is single-file.
MAX_FOLDER_DEPTH: int = 5


class SkillNotResolvable(LookupError):
    """Raised when a slug resolves neither locally nor in the platform catalog.

    Carries the slug and the folder path the caller was scoped to so the
    runtime can surface a useful operator-facing message (the U9
    delegation path turns this into a "skill `<slug>` not resolvable"
    abort, with the folder context attached).
    """

    def __init__(self, slug: str, folder_path: str) -> None:
        super().__init__(
            f"skill {slug!r} is not resolvable from folder {folder_path!r}"
        )
        self.slug = slug
        self.folder_path = folder_path


@dataclass(frozen=True)
class ResolvedSkill:
    """Resolution result. Either a local `SKILL.md` from the composed
    tree or a platform-catalog entry.
    """

    slug: str
    source: str
    """One of ``"local"`` or ``"platform"``."""

    skill_md_content: str
    """Verbatim ``SKILL.md`` body — frontmatter + prose. Callers that need
    the parsed shape can re-feed this to ``parse_skill_md_string``; the
    resolver does not bake the parsed result into its return value
    because callers vary in what they need (the dispatcher needs
    ``execution``; the routing-table parser already has the slug)."""

    composed_tree_path: str | None = None
    """For ``source="local"``: the full composed-tree path that won the
    lookup, e.g. ``"expenses/skills/approve-receipt/SKILL.md"``. ``None``
    for platform resolutions."""

    folder_segment: str | None = None
    """For ``source="local"``: the folder segment that contained the
    winning ``skills/`` directory (``""`` for the root agent, ``"expenses"``
    for a depth-1 sub-agent, etc.). ``None`` for platform resolutions."""


def _normalize_folder_path(folder_path: str) -> str:
    """Strip leading/trailing slashes, collapse runs of ``/``, and reject
    reserved-name or dot segments.

    The resolver's caller passes either ``""`` (root agent), ``"expenses"``,
    or ``"expenses/escalation"``. We tolerate stray slashes the caller may
    have inherited from a routing-table cell — including internal runs
    like ``"foo//bar"`` from a naive ``parent + "/" + child`` concat — and
    reject path traversal and reserved-name reuse. Those rejections are
    precondition violations, not operator-facing errors.
    """
    cleaned = folder_path.strip().strip("/")
    # Collapse internal runs of '/' so an operator typo like "foo//bar"
    # doesn't hard-abort delegation — trailing-slash tolerance already
    # set the expectation that internal doubles are also tolerated.
    cleaned = re.sub(r"/+", "/", cleaned)
    if not cleaned:
        return ""
    segments = cleaned.split("/")
    for seg in segments:
        if seg in (".", ".."):
            raise ValueError(
                f"folder_path {folder_path!r} contains a dot segment"
            )
        if seg in RESERVED_FOLDER_NAMES:
            raise ValueError(
                f"folder_path {folder_path!r} addresses reserved folder "
                f"{seg!r}; reserved names are never sub-agents"
            )
    return cleaned


def _ancestor_segments(folder_path: str) -> list[str]:
    """Return folder prefixes deepest → root.

    ``"expenses/escalation"`` → ``["expenses/escalation", "expenses", ""]``
    ``"expenses"``           → ``["expenses", ""]``
    ``""``                    → ``[""]``
    """
    if not folder_path:
        return [""]
    parts = folder_path.split("/")
    out: list[str] = []
    while parts:
        out.append("/".join(parts))
        parts.pop()
    out.append("")
    return out


def _build_path_index(composed_tree: Sequence[Mapping[str, Any]]) -> dict[str, str]:
    """Index the composed tree by ``path`` → ``content``.

    Skips entries with missing path or absent content (the composer omits
    ``content`` when ``includeContent=false``, which is never this caller's
    path). Also skips entries whose ``path`` or ``content`` is non-string
    — defends against upstream drift (e.g. raw ``bytes`` from S3) so a
    schema regression falls through to the platform copy with a warning
    rather than escaping uncaught from ``parse_skill_md_string``.

    Raises :class:`TypeError` when ``composed_tree`` is itself a
    :class:`Mapping` — a dict iterates its keys (strings) and crashes
    with ``AttributeError`` on the first ``entry.get(...)``. The
    ``Sequence[Mapping]`` annotation does not catch this at runtime.
    """
    if isinstance(composed_tree, Mapping):
        raise TypeError(
            "composed_tree must be a Sequence of Mapping records, not a Mapping; "
            "iterating a dict yields its keys (strings) which break entry.get(...)."
        )
    index: dict[str, str] = {}
    for entry in composed_tree:
        if not isinstance(entry, Mapping):
            logger.warning(
                "[skill_resolver] composed_tree entry is not a mapping (got %s) — skipping",
                type(entry).__name__,
            )
            continue
        path = entry.get("path")
        content = entry.get("content")
        if content is None or not path:
            continue
        if not isinstance(path, str) or not isinstance(content, str):
            logger.warning(
                "[skill_resolver] composed_tree entry has non-string path/content "
                "(path=%s, content=%s) — skipping",
                type(path).__name__,
                type(content).__name__,
            )
            continue
        index[path.lstrip("/")] = content
    return index


def _is_usable_local(parsed: ParsedSkillMd) -> tuple[bool, str | None]:
    """Decide whether a local ``SKILL.md`` is authoritative for resolution.

    Returns ``(usable, reason)`` so the caller can emit an actionable log
    line when falling through. ``reason`` is ``None`` on success.

    A local file is usable only when its frontmatter is present **and**
    declares both ``name`` and ``description`` as non-empty strings —
    matching the SI-4 plugin shape ``skill_md_parser`` documents. This is
    intentionally tighter than "any non-empty frontmatter": a near-correct
    file (frontmatter present, missing required fields) silently shadowed
    the platform copy across every descendant agent under the looser gate.
    """
    if not parsed.frontmatter_present:
        return False, "no frontmatter"
    if not parsed.data:
        return False, "frontmatter is present but empty"
    name = parsed.data.get("name")
    description = parsed.data.get("description")
    if not isinstance(name, str) or not name.strip():
        return False, "frontmatter is missing a non-empty 'name' field"
    if not isinstance(description, str) or not description.strip():
        return False, "frontmatter is missing a non-empty 'description' field"
    return True, None


def _read_platform_content(slug: str, platform: Mapping[str, Any]) -> str:
    """Read ``skill_md_content`` from a platform-catalog manifest entry.

    ``skill_md_content`` is the canonical key. ``content`` is accepted as
    a tolerated alias only when the canonical key is *absent* — empty
    string on the canonical key wins (so an explicit tombstone surfaces
    as ``ValueError`` rather than silently falling through to ``content``).

    Raises :class:`ValueError` when neither key is present, when the
    canonical key is present but empty, or when the resolved value is
    not a non-empty string.
    """
    if "skill_md_content" in platform:
        canonical = platform["skill_md_content"]
        if not isinstance(canonical, str) or not canonical:
            raise ValueError(
                f"platform_catalog_manifest entry for {slug!r} has empty or "
                "non-string 'skill_md_content'"
            )
        return canonical
    alias = platform.get("content")
    if isinstance(alias, str) and alias:
        return alias
    raise ValueError(
        f"platform_catalog_manifest entry for {slug!r} has no "
        "'skill_md_content' (canonical) or non-empty 'content' (alias)"
    )


def resolve_skill(
    slug: str,
    folder_path: str,
    composed_tree: Sequence[Mapping[str, Any]],
    platform_catalog_manifest: Mapping[str, Mapping[str, Any]] | None = None,
) -> ResolvedSkill:
    """Resolve ``slug`` for an agent rooted at ``folder_path``.

    ``composed_tree`` is the ``fetch_composed_workspace`` payload — a list
    of ``{path, source, sha256, content}`` records. ``platform_catalog_manifest``
    is the in-memory map the dispatcher already maintains; pass ``None``
    when the caller wants to test local-only resolution.

    Raises ``SkillNotResolvable`` if the slug matches nowhere.
    Raises ``ValueError`` if ``slug`` or ``folder_path`` are
    structurally invalid (empty slug, reserved folder, traversal).
    """
    if not slug or "/" in slug or slug.strip() != slug:
        raise ValueError(f"skill slug {slug!r} is empty or contains '/'")

    cleaned_folder = _normalize_folder_path(folder_path)
    path_index = _build_path_index(composed_tree)

    for ancestor in _ancestor_segments(cleaned_folder):
        candidate = (
            f"{ancestor}/skills/{slug}/SKILL.md" if ancestor else f"skills/{slug}/SKILL.md"
        )
        content = path_index.get(candidate)
        if content is None:
            continue
        try:
            parsed = parse_skill_md_string(content, candidate)
        except SkillMdParseError as exc:
            # A parse failure on a present file is a real authoring bug
            # (malformed YAML, bad `execution` value). Surface it via
            # log + fall through; an operator who shadowed a platform
            # skill with a broken local file shouldn't lose access to
            # the platform fallback.
            logger.warning(
                "[skill_resolver] local SKILL.md at %s failed to parse: %s",
                candidate,
                exc,
            )
            continue
        usable, reason = _is_usable_local(parsed)
        if not usable:
            logger.info(
                "[skill_resolver] local SKILL.md at %s falling through — %s",
                candidate,
                reason,
            )
            continue
        return ResolvedSkill(
            slug=slug,
            source="local",
            skill_md_content=content,
            composed_tree_path=candidate,
            folder_segment=ancestor,
        )

    if platform_catalog_manifest is not None:
        platform = platform_catalog_manifest.get(slug)
        if platform is not None:
            content = _read_platform_content(slug, platform)
            return ResolvedSkill(
                slug=slug,
                source="platform",
                skill_md_content=content,
                composed_tree_path=None,
                folder_segment=None,
            )

    raise SkillNotResolvable(slug=slug, folder_path=cleaned_folder)
