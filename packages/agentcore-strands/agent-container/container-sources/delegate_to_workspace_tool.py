"""``delegate_to_workspace`` Strands tool — Plan §008 U9 (inert spawn).

Path-addressed delegation. Spawns a focused sub-agent for the workspace
folder at ``path`` (e.g. ``"expenses"`` or ``"support/escalation"``),
inheriting the parent's overlay-composed files and the skills declared in
that folder's ``AGENTS.md`` routing table.

Pipeline shape (per master plan §008 U9 Approach):

    delegate_to_workspace(path, task)
      │
      ├─ validate_path(path)           # ../, abs, reserved-suffix, depth ≤ 5
      │   └─ depth == 4 → logger.warning(soft cap)
      ├─ composer.fetch_composed_workspace(...)            (full tree)
      ├─ parse_agents_md(target_folder/AGENTS.md content)
      ├─ for slug in row.skills:
      │       resolve_skill(slug, normalized_path, composed_tree, manifest)
      │       SkillNotResolvable → abort whole delegation with slug name
      ├─ resolved_context = {composed_tree, routing, resolved_skills, …}
      └─ return _spawn_sub_agent(resolved_context)

The Bedrock sub-agent spawn is **inert** in this PR: ``_spawn_sub_agent``
returns ``{"ok": False, "reason": "spawn not yet wired", "resolved_context": …}``.
Everything *up to* the spawn is real and tested. The follow-up plan-008
unit replaces only the spawn body — every test in
``test_delegate_to_workspace_tool.py`` continues to apply.

Honors **Key Decisions §008**: depth cap = 5 hard, soft-warn at 4 — the
unit-body number ``3`` is superseded.
"""

from __future__ import annotations

import dataclasses
import logging
from collections.abc import Callable, Mapping, Sequence
from copy import deepcopy
from typing import Any

from agents_md_parser import parse_agents_md
from skill_resolver import (
    MAX_FOLDER_DEPTH,
    RESERVED_FOLDER_NAMES,
    ResolvedSkill,
    SkillNotResolvable,
    resolve_skill,
)
from workspace_composer_client import fetch_composed_workspace_cached

logger = logging.getLogger(__name__)

# Depth cap policy (Key Decisions §008, supersedes the U9 unit-body's "3").
# `MAX_FOLDER_DEPTH` is the shared constant in `skill_resolver`; aliased here
# as `MAX_DEPTH` to keep the existing read sites intact. `WARN_DEPTH` stays
# delegate-tool-local because `write_memory_tool` doesn't soft-warn on depth.
MAX_DEPTH = MAX_FOLDER_DEPTH
WARN_DEPTH = 4


# ────────────────────────────────────────────────────────────────────────────
# Errors
# ────────────────────────────────────────────────────────────────────────────


class DelegateToWorkspaceError(RuntimeError):
    """Raised when delegation fails after path validation passed.

    Wraps composer errors, missing-AGENTS.md, and SkillNotResolvable so
    callers see a single ``delegate_to_workspace failed: …`` shape with
    the original cause attached on ``__cause__``.
    """


# ────────────────────────────────────────────────────────────────────────────
# Pure path validation
# ────────────────────────────────────────────────────────────────────────────


def validate_path(path: str) -> str:
    """Validate and normalize a delegation target path.

    Returns the normalized path on success; raises :class:`ValueError`
    with an operator-readable message on any rejection.

    Rejection order (cheap → expensive, no I/O):
        1. Empty / whitespace-only after strip
        2. Absolute (leading ``/``)
        3. Per-segment: empty (double slash), dot, traversal, reserved name
        4. Depth > 5 (the ``MAX_DEPTH`` cap)

    Side effect: depth == 4 emits a single ``logger.warning`` so operators
    investigating logs see the soft cap was approached. The agent author
    does not see this — the call still succeeds.
    """
    if path is None:
        raise ValueError("path is empty")
    stripped = path.strip()
    if not stripped:
        raise ValueError("path is empty")
    if stripped.startswith("/"):
        raise ValueError(f"path {path!r}: absolute paths not allowed")
    # Strip exactly one trailing slash (per plan resolution).
    if stripped.endswith("/"):
        stripped = stripped[:-1]
    if not stripped:
        raise ValueError("path is empty")
    segments = stripped.split("/")
    for seg in segments:
        if seg == "":
            raise ValueError(
                f"path {path!r}: empty segment (double slash) not allowed"
            )
        if seg in (".", ".."):
            raise ValueError(
                f"path {path!r}: path traversal not allowed (segment {seg!r})"
            )
        if seg in RESERVED_FOLDER_NAMES:
            raise ValueError(
                f"path {path!r}: reserved folder name {seg!r}; "
                "memory/skills are never sub-agents"
            )
    depth = len(segments)
    if depth > MAX_DEPTH:
        raise ValueError(
            f"path {path!r}: delegation depth {depth} exceeds cap of {MAX_DEPTH}"
        )
    if depth == WARN_DEPTH:
        logger.warning(
            "delegate_to_workspace approaching cap (depth=%d, cap=%d)",
            depth,
            MAX_DEPTH,
            extra={"delegate_target_path": stripped, "delegate_depth": depth},
        )
    return stripped


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────


def _find_agents_md_content(
    composed_tree: Sequence[Mapping[str, Any]], normalized_path: str
) -> str:
    """Return the ``AGENTS.md`` content at ``{normalized_path}/AGENTS.md``.

    Raises :class:`DelegateToWorkspaceError` if absent.
    """
    target_key = f"{normalized_path}/AGENTS.md"
    for entry in composed_tree:
        if not isinstance(entry, Mapping):
            continue
        entry_path = entry.get("path")
        if entry_path == target_key:
            content = entry.get("content")
            if isinstance(content, str):
                return content
            break  # path matched but content is missing/wrong type → treat as absent
    raise DelegateToWorkspaceError(
        f"target folder {normalized_path!r} has no AGENTS.md in composed workspace"
    )


# ────────────────────────────────────────────────────────────────────────────
# Spawn seam — INERT in this PR
# ────────────────────────────────────────────────────────────────────────────


def _spawn_sub_agent_inert(resolved_context: dict[str, Any]) -> dict[str, Any]:
    """Inert seam — this PR ships path validation + composer + parse +
    resolve, but **not** the Bedrock sub-agent spawn. The follow-up
    plan-008 unit replaces this body only; the outer call site does not
    change.

    Return shape is finalized so the spawn-PR can substitute without
    breaking callers or tests:

        {"ok": bool, "reason"?: str, "sub_agent_response"?: str,
         "sub_agent_usage"?: dict, "resolved_context"?: dict}
    """
    return {
        "ok": False,
        "reason": "spawn not yet wired",
        "resolved_context": resolved_context,
    }


# ────────────────────────────────────────────────────────────────────────────
# Factory
# ────────────────────────────────────────────────────────────────────────────


def make_delegate_to_workspace_fn(
    *,
    parent_tenant_id: str,
    parent_agent_id: str,
    api_url: str,
    api_secret: str,
    platform_catalog_manifest: Mapping[str, Mapping[str, Any]] | None,
    cfg_model: str,
    usage_acc: list,
    composer_fetch: Callable[..., list[dict]] = fetch_composed_workspace_cached,
    spawn_fn: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
) -> Callable[..., dict[str, Any]]:
    """Build the ``delegate_to_workspace`` callable.

    All dependencies are snapshotted at factory time per
    ``feedback_completion_callback_snapshot_pattern`` — env mutation
    after registration cannot change resolution behavior on subsequent
    invocations.

    The platform-catalog manifest is **deep-copied** so a caller mutating
    the source dict (e.g. catalog reload) does not retroactively change
    what an already-registered tool can resolve. The catalog is read-only
    by contract; the cost of one deep-copy at registration is dwarfed by
    a per-call lookup.

    The ``spawn_fn`` parameter exists so tests can substitute the inert
    default with a capture/assertion lambda. In production it stays
    ``None`` and the inert seam is used; the spawn-PR replaces the seam
    body, not the parameter.
    """
    snapshot_catalog: dict[str, dict[str, Any]] | None
    if platform_catalog_manifest is None:
        snapshot_catalog = None
    else:
        snapshot_catalog = deepcopy(dict(platform_catalog_manifest))

    snapshot_tenant_id = parent_tenant_id
    snapshot_agent_id = parent_agent_id
    snapshot_api_url = api_url
    snapshot_api_secret = api_secret
    snapshot_cfg_model = cfg_model  # captured for the spawn-PR follow-up
    snapshot_composer = composer_fetch
    snapshot_spawn = spawn_fn or _spawn_sub_agent_inert
    # `usage_acc` is intentionally not captured here — the spawn-PR follow-up
    # is what writes to it from inside the live spawn body. Keeping the
    # parameter on the factory signature lets the spawn-PR consume it without
    # changing the registration call site.
    del usage_acc

    def delegate_to_workspace(path: str, task: str) -> dict[str, Any]:
        """Delegate a task to a sub-agent rooted at the workspace folder ``path``.

        Use when an ``AGENTS.md`` routing row sends work to a named sub-agent
        folder (e.g. ``expenses/`` or ``support/escalation/``). The sub-agent
        receives the parent's composed workspace plus the folder's local
        files, and the skills declared in the folder's ``AGENTS.md`` routing
        table. Recursion is hard-capped at depth 5.

        Returns a dict ``{ok, reason?, sub_agent_response?, sub_agent_usage?,
        resolved_context?}``. Sub-agent spawning is currently a no-op
        returning ``ok=False, reason="spawn not yet wired"`` until the
        follow-up plan-008 unit lands.
        """
        normalized_path = validate_path(path)
        depth = len(normalized_path.split("/"))

        try:
            files = snapshot_composer(
                tenant_id=snapshot_tenant_id,
                agent_id=snapshot_agent_id,
                api_url=snapshot_api_url,
                api_secret=snapshot_api_secret,
            )
        except Exception as exc:
            raise DelegateToWorkspaceError(
                f"delegate_to_workspace failed: composer fetch error — {exc}"
            ) from exc

        agents_md = _find_agents_md_content(files, normalized_path)
        ctx = parse_agents_md(agents_md)

        resolved_skills: dict[str, ResolvedSkill] = {}
        for row in ctx.routing:
            for slug in row.skills:
                if slug in resolved_skills:
                    continue  # first-seen wins; dedup is U11's job upstream
                try:
                    resolved_skills[slug] = resolve_skill(
                        slug,
                        normalized_path,
                        files,
                        platform_catalog_manifest=snapshot_catalog,
                    )
                except SkillNotResolvable as exc:
                    raise DelegateToWorkspaceError(
                        f"delegate_to_workspace failed: skill {slug!r} "
                        f"not resolvable from {normalized_path!r}"
                    ) from exc

        resolved_context: dict[str, Any] = {
            "composed_tree": list(files),
            "routing": [dataclasses.asdict(row) for row in ctx.routing],
            "resolved_skills": {
                slug: dataclasses.asdict(rs)
                for slug, rs in resolved_skills.items()
            },
            "parent_agent_id": snapshot_agent_id,
            "parent_tenant_id": snapshot_tenant_id,
            "depth": depth,
            "task": task,
            "normalized_path": normalized_path,
            # The spawn-PR follow-up reads this to build the sub-agent.
            "cfg_model": snapshot_cfg_model,
            # Parser-skipped routing rows (reserved-name go_to, malformed
            # path) — the spawn body surfaces these in the sub-agent's
            # tool-result envelope so the parent LLM can recover from a
            # silent skill drop. ``warnings`` is the human-readable list;
            # ``skipped_rows`` is the structured shape for programmatic
            # consumers. (Plan 2026-04-25-004 U4.)
            "warnings": list(ctx.warnings),
            "skipped_rows": [dict(r) for r in ctx.skipped_rows],
        }

        return snapshot_spawn(resolved_context)

    return delegate_to_workspace
