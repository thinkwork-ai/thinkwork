"""``delegate_to_workspace`` Strands tool — Plan §008 U9 (live spawn).

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

Plan 2026-04-25-004 U5 (this revision): the spawn body is **live**. When
``spawn_fn=None`` the factory builds a closure that calls Strands'
``BedrockModel`` + ``Agent`` with a system prompt derived from the
composed tree and a tool list derived from the resolved skills. Returns
``{ok: True, sub_agent_response, sub_agent_usage, warnings, skipped_rows,
resolved_context}`` on success. ``_spawn_sub_agent_inert`` is kept as a
documented no-op fallback that tests inject explicitly via ``spawn_fn=``;
it is no longer the production default.

Honors **Key Decisions §008**: depth cap = 5 hard, soft-warn at 4 — the
unit-body number ``3`` is superseded.
"""

from __future__ import annotations

import dataclasses
import logging
import os
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
# Spawn seam
# ────────────────────────────────────────────────────────────────────────────
#
# Plan 2026-04-25-004 U5: the seam name + signature is unchanged
# (`_spawn_sub_agent(resolved_context: dict) -> dict`), but the production
# default is now a live Bedrock spawn (built by `_make_live_spawn_fn` and
# wired in `make_delegate_to_workspace_fn` when `spawn_fn=None`).
# `_spawn_sub_agent_inert` is kept as a documented no-op so explicit
# `spawn_fn=` injection in tests still works exactly as before.

# Verbatim copy of the token-efficiency section appended to skill sub-agent
# system prompts in `server.py:_build_skill_agent_prompt`. Kept as a module
# constant so the prompt-composition tests can do a direct substring
# assertion without coupling to server.py.
_TOKEN_EFFICIENCY_RULES = """## Token Efficiency Rules

- When calling tools, request ONLY the fields you need. Never use `select *` patterns.
- After receiving tool results, extract and remember only the key data points needed for your response.
- If a tool returns a large JSON response, do NOT repeat the entire response in your reasoning. Summarize the relevant parts.
- Prefer concise, direct answers over verbose explanations."""


# Sub-agent path-composition rule. The parent agent loads MEMORY_GUIDE.md
# from a container-local path and so reads this rule via its workspace
# overlay, but the SUB-agent's prompt builder only sources composed-tree
# files (PLATFORM, GUARDRAILS, the sub-folder's CONTEXT/AGENTS) — so
# without inlining, the sub-agent never sees the rule and would clobber
# the parent's root memory on its first write_memory call. This is the
# exact bug U12 was written to make fixable; agent-native review for
# Plan §008 U9-spawn-live caught the gap before it shipped.
_SUB_AGENT_PATH_COMPOSITION_RULES = """## How to scope your memory writes

You are a sub-agent. When you call `write_memory`, prefix the path with
your own folder so writes land at your scope, not the parent agent's:

- Sub-agent at `{folder}/` → `write_memory("{folder}/memory/lessons.md", ...)`
- Nested sub-agent at `{parent}/{folder}/` → `write_memory("{parent}/{folder}/memory/lessons.md", ...)`

The path is **from the agent root, not from your sub-folder**. Passing
just `"memory/lessons.md"` would write to the parent agent's notes —
overwriting work that isn't yours. The basename allowlist is unchanged
(`lessons.md`, `preferences.md`, `contacts.md`); only the folder prefix
is yours to compose."""


def _build_sub_agent_system_prompt(
    *, normalized_path: str, composed_tree: Sequence[Mapping[str, Any]]
) -> str:
    """Compose the sub-agent's system prompt from the composed tree.

    Sources, in order (whichever entries exist in ``composed_tree``):

    1. Inherited system guardrails from the composed-tree overlay —
       ``PLATFORM.md`` and ``GUARDRAILS.md`` at the workspace root.
    2. The sub-agent's own ``CONTEXT.md`` (the behavioral context).
    3. The sub-agent's own ``AGENTS.md`` (routing context the sub-agent
       sees and the parent LLM does not).
    4. Sub-agent path-composition rules (inlined; parent reads these via
       MEMORY_GUIDE.md but that file isn't on the sub-agent's prompt
       allowlist).
    5. Token-efficiency rules (verbatim from
       ``server.py:_build_skill_agent_prompt``).

    Missing files are skipped silently — this matches the parent prompt's
    composition shape and lets thin sub-agents (only ``CONTEXT.md`` +
    ``AGENTS.md``) work without ceremony.
    """
    parts: list[str] = []

    # `composed_tree` comes from the parent's full composition and includes
    # both root-level inherited files and sub-agent-folder-scoped files.
    # We index by path so we can pick the four prompt sources cheaply.
    by_path: dict[str, str] = {}
    for entry in composed_tree:
        if not isinstance(entry, Mapping):
            continue
        path = entry.get("path")
        content = entry.get("content")
        if isinstance(path, str) and isinstance(content, str):
            by_path[path] = content

    # 1. System guardrails inherited from the workspace root.
    for sysfile in ("PLATFORM.md", "GUARDRAILS.md"):
        body = by_path.get(sysfile)
        if body and body.strip():
            parts.append(body.strip())

    # 2. Sub-agent's CONTEXT.md (behavioral context).
    ctx_body = by_path.get(f"{normalized_path}/CONTEXT.md")
    if ctx_body and ctx_body.strip():
        parts.append(ctx_body.strip())

    # 3. Sub-agent's AGENTS.md (routing context the sub-agent itself reads).
    agents_body = by_path.get(f"{normalized_path}/AGENTS.md")
    if agents_body and agents_body.strip():
        parts.append(agents_body.strip())

    # 4. Path-composition rules — inlined so the sub-agent sees them
    #    even though MEMORY_GUIDE.md is loaded by the parent only.
    parts.append(_SUB_AGENT_PATH_COMPOSITION_RULES)

    # 5. Token-efficiency rules.
    parts.append(_TOKEN_EFFICIENCY_RULES)

    return "\n\n---\n\n".join(parts)


def _build_sub_agent_tools(
    resolved_skills: Mapping[str, ResolvedSkill],
    *,
    tool_decorator: Callable[..., Any] | None = None,
) -> list[Any]:
    """Build the sub-agent's tool list from resolved skills.

    For v1 (Plan 2026-04-25-004 U5) every resolved skill — local or
    platform — is exposed to the sub-agent as a minimal in-memory @tool
    callable that returns the skill's ``SKILL.md`` body. Full local-skill
    script execution is U11 / Phase D scope; the sub-agent in v1 just
    needs to be *able to see* each skill's content.

    The default ``tool_decorator`` is ``strands.tool``; tests inject a
    no-op or capture decorator. Resolves the import lazily so importing
    this module doesn't pull in Strands at container boot.
    """
    if tool_decorator is None:
        from strands import tool as _strands_tool

        tool_decorator = _strands_tool

    out: list[Any] = []
    for slug, rs in resolved_skills.items():
        # Build a per-slug closure so each tool returns its own body.
        # The function name + docstring is what Strands surfaces to the
        # LLM as the tool's identity, so we set both per-slug. All
        # per-iteration values are passed as arguments to bind freshly
        # rather than captured by reference.
        decorated = tool_decorator(
            _make_skill_tool(
                _slug=slug,
                _body=rs.skill_md_content,
                _source=rs.source,
                _tool_name=slug.replace("-", "_"),
            )
        )
        out.append(decorated)
    return out


def _make_skill_tool(
    *, _slug: str, _body: str, _source: str, _tool_name: str
) -> Callable[[], str]:
    """Build a single skill @tool callable.

    Each call returns a fresh function whose ``__name__`` /
    ``__doc__`` identify the skill to the sub-agent's LLM and whose
    body returns the verbatim SKILL.md content. Pulled out of
    :func:`_build_sub_agent_tools` so the closure captures
    function-local arguments — never loop-variable references.
    """

    def _skill_tool() -> str:
        return _body

    _skill_tool.__name__ = _tool_name
    _skill_tool.__qualname__ = _tool_name
    _skill_tool.__doc__ = (
        f"Read the {_slug} skill's SKILL.md ({_source} source). "
        "Returns the verbatim SKILL.md body so the sub-agent can "
        "follow the skill's documented procedure."
    )
    return _skill_tool


def _make_live_spawn_fn(
    *,
    cfg_model: str,
    aws_region: str,
    usage_acc: list,
    model_factory: Callable[..., Any] | None = None,
    agent_factory: Callable[..., Any] | None = None,
    tool_decorator: Callable[..., Any] | None = None,
) -> Callable[[dict[str, Any]], dict[str, Any]]:
    """Build the live ``_spawn_sub_agent`` closure.

    Honors ``feedback_completion_callback_snapshot_pattern``:
    ``cfg_model``, ``aws_region``, and ``usage_acc`` are captured here
    (factory time) and never re-read from ``os.environ`` inside the spawn
    body.

    ``model_factory`` and ``agent_factory`` exist so tests can stub the
    Strands ``BedrockModel`` and ``Agent`` constructors without patching
    module-level imports. ``tool_decorator`` lets tests bypass the real
    Strands ``@tool`` wrapping. In production all three default to the
    real Strands implementations resolved lazily.
    """
    snap_cfg_model = cfg_model
    snap_aws_region = aws_region
    snap_usage_acc = usage_acc
    snap_model_factory = model_factory
    snap_agent_factory = agent_factory
    snap_tool_decorator = tool_decorator

    def _spawn_sub_agent(resolved_context: dict[str, Any]) -> dict[str, Any]:
        # Lazy-import Strands so importing this module never requires
        # the Strands SDK to be present (matches existing skill-runner
        # pattern in `server.py`).
        if snap_model_factory is None:
            from strands.models import BedrockModel as _BedrockModel
        else:
            _BedrockModel = snap_model_factory

        if snap_agent_factory is None:
            from strands import Agent as _Agent
        else:
            _Agent = snap_agent_factory

        # Optional cache_config (mirrors `make_skill_agent_fn:1359-1364`).
        cache_kwargs: dict[str, Any] = {}
        try:
            from strands.models.bedrock import CacheConfig as _CC

            cache_kwargs["cache_config"] = _CC(strategy="auto")
        except ImportError:
            pass

        composed_tree: Sequence[Mapping[str, Any]] = resolved_context.get(
            "composed_tree", []
        )
        normalized_path: str = resolved_context["normalized_path"]
        task: str = resolved_context["task"]
        resolved_skills_raw = resolved_context.get("resolved_skills", {})

        # `resolved_skills` in the context is a mapping of slug → asdict()
        # of ResolvedSkill (the factory serializes via dataclasses.asdict).
        # Re-hydrate to dataclass form so the tool builder reads typed
        # attrs without caring about the on-the-wire shape.
        resolved_skills: dict[str, ResolvedSkill] = {}
        for slug, rs_dict in resolved_skills_raw.items():
            if isinstance(rs_dict, ResolvedSkill):
                resolved_skills[slug] = rs_dict
            elif isinstance(rs_dict, Mapping):
                resolved_skills[slug] = ResolvedSkill(
                    slug=rs_dict.get("slug", slug),
                    source=rs_dict.get("source", "local"),
                    skill_md_content=rs_dict.get("skill_md_content", ""),
                    composed_tree_path=rs_dict.get("composed_tree_path"),
                    folder_segment=rs_dict.get("folder_segment"),
                )

        system_prompt = _build_sub_agent_system_prompt(
            normalized_path=normalized_path,
            composed_tree=composed_tree,
        )
        sub_agent_tools = _build_sub_agent_tools(
            resolved_skills, tool_decorator=snap_tool_decorator
        )

        try:
            model = _BedrockModel(
                model_id=snap_cfg_model,
                region_name=snap_aws_region,
                streaming=True,
                **cache_kwargs,
            )
            agent = _Agent(
                model=model,
                system_prompt=system_prompt,
                tools=sub_agent_tools,
                callback_handler=None,
            )
            result = agent(task)
        except Exception as exc:
            raise DelegateToWorkspaceError(
                f"delegate_to_workspace failed: sub-agent spawn raised — {exc}"
            ) from exc

        usage_dict = {"input_tokens": 0, "output_tokens": 0}
        try:
            metrics = getattr(result, "metrics", None)
            accumulated = getattr(metrics, "accumulated_usage", None) if metrics else None
            if accumulated:
                usage_dict = {
                    "input_tokens": accumulated.get("inputTokens", 0),
                    "output_tokens": accumulated.get("outputTokens", 0),
                }
        except Exception as exc:  # pragma: no cover — defensive
            logger.warning(
                "delegate_to_workspace usage extraction failed: %s", exc,
            )
        snap_usage_acc.append(usage_dict)

        return {
            "ok": True,
            "sub_agent_response": str(result),
            "sub_agent_usage": usage_dict,
            "warnings": list(resolved_context.get("warnings", [])),
            "skipped_rows": [
                dict(r) for r in resolved_context.get("skipped_rows", [])
            ],
            "resolved_context": resolved_context,
        }

    return _spawn_sub_agent


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
    aws_region: str | None = None,
    model_factory: Callable[..., Any] | None = None,
    agent_factory: Callable[..., Any] | None = None,
    tool_decorator: Callable[..., Any] | None = None,
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

    Plan 2026-04-25-004 U5: when ``spawn_fn`` is ``None`` (production
    default) the factory builds a live Bedrock spawn closure via
    :func:`_make_live_spawn_fn`, capturing ``cfg_model``, ``aws_region``,
    and ``usage_acc``. Tests can still inject a custom ``spawn_fn=`` —
    the live default is only used when the caller doesn't.

    ``aws_region`` is snapshotted at factory time. If ``None`` we read
    ``AWS_REGION`` / ``AWS_DEFAULT_REGION`` from the environment **once,
    here**, never inside the per-call spawn body. ``model_factory``,
    ``agent_factory``, and ``tool_decorator`` are seams for tests; in
    production they default to the real Strands constructors (resolved
    lazily inside the spawn body).
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
    snapshot_cfg_model = cfg_model
    snapshot_composer = composer_fetch
    # Snapshot AWS_REGION here so a per-call os.environ.get(...) inside
    # the spawn body cannot drift (feedback_completion_callback_snapshot_pattern).
    snapshot_aws_region = aws_region or (
        os.environ.get("AWS_REGION")
        or os.environ.get("AWS_DEFAULT_REGION")
        or "us-east-1"
    )

    if spawn_fn is None:
        snapshot_spawn = _make_live_spawn_fn(
            cfg_model=snapshot_cfg_model,
            aws_region=snapshot_aws_region,
            usage_acc=usage_acc,
            model_factory=model_factory,
            agent_factory=agent_factory,
            tool_decorator=tool_decorator,
        )
    else:
        snapshot_spawn = spawn_fn

    def delegate_to_workspace(path: str, task: str) -> dict[str, Any]:
        """Delegate a task to a sub-agent rooted at the workspace folder ``path``.

        Use when an ``AGENTS.md`` routing row sends work to a named sub-agent
        folder (e.g. ``expenses/`` or ``support/escalation/``). The sub-agent
        receives the parent's composed workspace plus the folder's local
        files, and the skills declared in the folder's ``AGENTS.md`` routing
        table. Recursion is hard-capped at depth 5.

        Returns ``{ok, sub_agent_response, sub_agent_usage, warnings,
        skipped_rows, resolved_context}`` on success. ``warnings`` /
        ``skipped_rows`` carry parser-skipped routing rows (reserved
        ``goTo`` like ``memory/``, malformed paths) so the parent LLM
        can recover from a silent skill drop. Failed delegations either
        raise :class:`DelegateToWorkspaceError` (composer / parser /
        resolver / spawn errors) or return ``ok=False`` from a custom
        injected ``spawn_fn``.
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
