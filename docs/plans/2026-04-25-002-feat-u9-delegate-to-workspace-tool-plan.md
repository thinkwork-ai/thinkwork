---
title: "feat: U9 — `delegate_to_workspace` Strands tool (inert spawn)"
type: feat
status: active
date: 2026-04-25
origin: docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md
---

# feat: U9 — `delegate_to_workspace` Strands tool (inert spawn)

## Overview

Land the `delegate_to_workspace(path, task)` tool in the Strands runtime container as a registered `@tool` callable, with full path validation, depth-cap enforcement, composer fetch, AGENTS.md parse, and skill resolution — but with the Bedrock sub-agent spawn deliberately stubbed (inert) for this PR. Spawn wiring is a follow-up unit so this PR stays reviewable and so the depth-cap, parser-integration, and resolver-integration surfaces can be exercised in isolation.

This is a narrowed slice of master-plan-008 U9 (`docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md` lines 614-654). All U9 dependencies are merged on origin/main: U1 (#566), U5 (#570), U7 (#572), U8 (#573), U10 + followup (#574, #575).

---

## Problem Frame

The Strands runtime today has a generic `delegate(task, context)` tool that spawns an empty-toolset sub-agent. The Fat-folder sub-agent product (`AGENTS.md` routing table, recursive overlay, scoped skills, reserved-name semantics) requires a *path-addressed* delegation tool whose sub-agent inherits the composed workspace at `{folder}` plus the skills its `AGENTS.md` resolves to. Master plan §008 U9 owns this. Phases A and B shipped the dependencies; the resolver (U10 + #575) is the last piece U9 was waiting on.

Two scope adjustments vs master plan U9:

1. **Depth cap.** Master plan U9 unit body says "depth 3" but Key Decisions §008 (line 155, "Recursion depth cap = 5 with soft warn at 4") supersedes the unit body. This plan honors the Key Decision: hard cap 5, soft warn at 4 (logged, not rejected).
2. **Bedrock spawn is inert.** Master plan U9 includes "spawn a new Bedrock Strands sub-agent". This plan ships everything *up to* the spawn — path validation, composer fetch, parse, resolve — and stubs the spawn step behind a single seam (`_spawn_sub_agent`) that returns a structured "not yet wired" result. Real spawn lands in a follow-up unit, exercising the same pattern as U10's "ship inert" approach (`feedback_ship_inert_pattern`).

---

## Requirements Trace

- R1. Tool is registered in the Strands runtime, callable as `delegate_to_workspace(path, task)`. (Master R9, F3.)
- R2. Path validation rejects `..`, absolute paths, reserved-name suffixes (`memory`, `skills`), and depth > 5. (Master AE7, Key Decisions §008.)
- R3. Depth 4 emits a soft warning via `logger.warning` and proceeds. Depth 5 succeeds. Depth 6 rejects. (Key Decisions §008.)
- R4. Composer fetch uses the existing `workspace_composer_client.fetch_composed_workspace` helper with a `sub_path` argument; tool surfaces composer errors verbatim to the operator. (Master U9 Approach.)
- R5. AGENTS.md parsing uses `agents_md_parser.parse_agents_md`; routing-table skill slugs are extracted in declared order. (Master AE6.)
- R6. Each declared skill is resolved via `skill_resolver.resolve_skill`. A `SkillNotResolvable` for any slug aborts delegation with an operator-facing error naming the slug. (Master Key Decision; U10 contract.)
- R7. The Bedrock sub-agent spawn is stubbed: a single seam returns `{ ok: false, reason: "spawn not yet wired" }` with the resolved context attached so a follow-up PR can swap in the real spawn without re-touching validation/fetch/parse/resolve. (Plan-local; per `feedback_ship_inert_pattern`.)
- R8. `_boot_assert.EXPECTED_CONTAINER_SOURCES` includes the new module so deploy-time integrity check fails fast on a missing file. (Master U9 Files.)

**Origin actors:** A4 (agent runtime), A5 (sub-agent).
**Origin flows:** F3 (sub-agent delegation).
**Origin acceptance examples:** AE2, AE6, AE7 (composer-side already covered by U5/U8; this plan covers the tool-side surfaces).

---

## Scope Boundaries

- Not implementing real Bedrock sub-agent spawn (model selection, system-prompt construction, child usage accumulator, tool-loop orchestration). Spawn is stubbed via `_spawn_sub_agent` seam and returns a structured no-op.
- Not modifying `skill_resolver.py`, `agents_md_parser.py`, or `workspace_composer_client.py`. They are consumed as-is.
- Not implementing `write_memory` path-parameter behavior (master U12). The integration scenario "sub-agent's `write_memory` lands at `{agent}/expenses/memory/lessons.md`" is excluded from this plan's tests since the spawn is inert.
- Not touching the existing generic `delegate(task, context)` tool. Both coexist (master Scope Boundary).
- Not changing skill-name normalization in the admin builder or any front-end surface.

### Deferred to Follow-Up Work

- **Real Bedrock spawn** wiring `_spawn_sub_agent` to the same Strands sub-agent pattern used by `_make_delegate_fn` (server.py:1373-1412). Captures `sub_agent_usage` in the parent `usage_acc`. Lands as a separate plan-008 follow-up unit before any UI exposes the tool.

---

## Context & Research

### Relevant Code and Patterns

- `packages/agentcore-strands/agent-container/container-sources/server.py:1373-1412` — `_make_delegate_fn` factory closure that wires the existing generic `delegate` tool. Captures `cfg_model` and `usage_acc`, returns an `@tool`-decorated callable. U9 mirrors the closure shape so the follow-up PR can swap the spawn body in directly.
- `packages/agentcore-strands/agent-container/container-sources/server.py:1303-1340` — `make_skill_agent_fn` shows the existing pattern for child-usage accumulation. The follow-up spawn PR will mirror this.
- `packages/agentcore-strands/agent-container/container-sources/workspace_composer_client.py` — `fetch_composed_workspace(agent_id, sub_path=None, include_content=True)`. U9 calls with `sub_path=path`.
- `packages/agentcore-strands/agent-container/container-sources/skill_resolver.py` — `resolve_skill(slug, folder_path, composed_tree, platform_catalog_manifest)` raises `SkillNotResolvable(slug)` on miss. Hardened by #575 (string-typed inputs, normalized folder paths).
- `packages/agentcore/agent-container/agents_md_parser.py` — `parse_agents_md(markdown)` returns `AgentsMdContext { routing: list[RoutingRow], raw_markdown: str }`. Each `RoutingRow.skills` is `list[str]`.
- `packages/api/src/lib/reserved-folder-names.ts` + Python frozenset mirror — `isReservedFolderSegment` / `RESERVED_FOLDER_NAMES = ("memory", "skills")`. U9 imports the Python frozenset for path-suffix rejection.
- `packages/agentcore-strands/agent-container/_boot_assert.py` — `EXPECTED_CONTAINER_SOURCES` list; appending the new module makes a missing file a deploy-time fail-fast.

### Institutional Learnings

- `feedback_ship_inert_pattern` — In multi-PR plans, new modules land with tests but no live wiring; integration waits for the plan's own dependency gate. U10 itself shipped inert; U9's spawn deferral follows the same shape.
- `feedback_dont_overgate_baseline_agent_capability` — Don't add admin-approval ceremony on top of a baseline runtime tool. The tool is registered; gating happens via `AGENTS.md` routing rows, not config.
- `feedback_completion_callback_snapshot_pattern` — Snapshot environment / context at function entry rather than re-reading os.environ later. The tool factory should snapshot composer-client config + platform-catalog manifest at registration time, not per call.
- `feedback_verify_wire_format_empirically` — Before integrating with composer/parser/resolver, dispatch one sample call against a fixture to validate field-name and shape assumptions. Plan tests do this via fixture round-trip.
- `feedback_lambda_zip_build_entry_required` — Not directly applicable (Strands container, not Lambda zip), but the analogous integrity gate here is `_boot_assert.EXPECTED_CONTAINER_SOURCES`.

### External References

- None gathered. The work is well-patterned by existing `delegate` tool, U10 resolver, and U7 parser; no thin-grounding signal triggers external research.

---

## Key Technical Decisions

- **Depth cap = 5, soft-warn at 4.** Honors Key Decisions §008 over the unit-body number. Implementation: depth = `path.count("/") + 1`. Empty/single-segment path = depth 1. Depth ≥ 6 → reject. Depth == 4 → `logger.warning("delegate_to_workspace approaching cap", extra={...})` then proceed.
- **Path validation order: cheap → expensive.** Reject `..` / `.` / leading `/` / empty / reserved-suffix first (no I/O). Then check depth. Then call composer. This makes adversarial inputs return error in O(string-parse) time and keeps composer cost off the rejection path.
- **`_spawn_sub_agent` is the single seam for the inert→live swap.** Spawn signature accepts the resolved context dict and returns a result dict. The current implementation returns `{ ok: false, reason: "spawn not yet wired", resolved_context: {...} }`. The follow-up PR replaces the body only; the tool's outer call site does not change.
- **Skill resolution is fail-closed.** First `SkillNotResolvable` aborts the whole delegation with the slug name; no partial sub-agent. This matches master plan U9 Key Decision and U10's contract.
- **Snapshot composer + catalog config at factory time, not per call.** Per `feedback_completion_callback_snapshot_pattern`. The tool factory closure captures `composer_endpoint`, `auth_secret`, and `platform_catalog_manifest` references; the per-call body uses those snapshots even if env mutates mid-invocation.
- **Reserved-name suffix check rejects the *last* segment only, not arbitrary depth.** `expenses/memory/lessons.md` is a reserved memory file; `expenses/memory` is the reserved memory folder; both are rejected as a delegation target. `memory-team` (different last-segment string) is not rejected. Match `RESERVED_FOLDER_NAMES` exactly, not as a prefix.
- **No environment-variable read for the platform catalog manifest.** It already comes through the existing tool-registration plumbing in `server.py`. Pass it into the factory; do not re-read at call time.

---

## Open Questions

### Resolved During Planning

- "Should the soft-warn at depth 4 be a structured log or also surface in the tool's response?" — Structured `logger.warning` only. The agent author shouldn't see it; only operators investigating logs need it.
- "Does the path argument accept a trailing slash?" — Normalize: strip exactly one trailing `/` if present, then validate. `expenses/` and `expenses` are equivalent. Empty string after strip → reject.
- "Does `_spawn_sub_agent` need a real return shape now?" — Yes. The shape `{ ok, reason?, sub_agent_response?, sub_agent_usage?, resolved_context? }` is finalized so callers and tests can mock against it. The inert version sets `ok=false, reason="spawn not yet wired", resolved_context={...}`.

### Deferred to Implementation

- Exact log-extra-field names for the depth-warn structured log. Pick something searchable like `delegate_target_path`, `delegate_depth`.
- Whether the platform catalog manifest is passed by reference or deep-copied at factory time. Defaults to reference (it's a read-only cache); revisit only if a test reveals mutation.
- Whether the tool factory takes `kwargs` or a dataclass for the deps. Implementer's call; the unit footprint is small enough that kwargs are fine.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
delegate_to_workspace(path, task)
  ├─ validate_path(path)              # ../, abs, reserved-suffix, depth ≤ 5
  │   └─ depth == 4 → logger.warning(soft cap)
  ├─ composer.fetch_composed_workspace(agent_id, sub_path=path, include_content=True)
  ├─ parse_agents_md(composed_tree["AGENTS.md"].content)
  ├─ for row in routing:
  │     for slug in row.skills:
  │         resolved = skill_resolver.resolve_skill(slug, path, composed_tree, manifest)
  │         # SkillNotResolvable → abort whole delegation with slug name
  ├─ resolved_context = {composed_tree, routing, resolved_skills, parent_agent_id, depth, task}
  └─ return _spawn_sub_agent(resolved_context)   # inert: {ok: false, reason: "spawn not yet wired", resolved_context}
```

The seam is `_spawn_sub_agent`. Everything above the seam is real and tested in this PR. The seam's body is a single-line stub.

---

## Implementation Units

- U1. **`delegate_to_workspace_tool.py` with inert spawn seam, tests, and boot-assert wiring**

**Goal:** Land the tool factory + tool implementation + pytest coverage + boot-assert entry as one atomic unit.

**Requirements:** R1, R2, R3, R4, R5, R6, R7, R8.

**Dependencies:** None within this plan. External deps (U5, U7, U8, U10 + #575, U1 Dockerfile) are all merged on origin/main.

**Files:**
- Create: `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py`
- Create: `packages/agentcore-strands/agent-container/test_delegate_to_workspace_tool.py`
- Modify: `packages/agentcore-strands/agent-container/container-sources/server.py` — register the new tool alongside `_make_delegate_fn` (no change to the existing generic `delegate`).
- Modify: `packages/agentcore-strands/agent-container/_boot_assert.py` — append `delegate_to_workspace_tool` to `EXPECTED_CONTAINER_SOURCES`.

**Approach:**
- Module exports two factory functions: `make_delegate_to_workspace_fn(...)` (returns the `@tool`-decorated callable) and `_spawn_sub_agent(resolved_context) -> dict` (the swap seam, currently inert).
- Factory takes (in any order, kwargs OK): `parent_agent_id`, `composer_client`, `agents_md_parser`, `skill_resolver`, `platform_catalog_manifest`, `usage_acc`, `cfg_model` (kept for spawn-PR symmetry even though unused here), `logger`. Snapshot at factory time.
- `validate_path` is a module-level pure function (testable without factory state). Returns the normalized path on success; raises `ValueError` with operator-readable message on failure (`"path traversal not allowed"`, `"reserved folder name 'memory'"`, `"delegation depth 6 exceeds cap of 5"`, etc.).
- Reserved-name rejection imports from the Python `RESERVED_FOLDER_NAMES` frozenset (already exists alongside `agents_md_parser.py`).
- Composer call: `composer_client.fetch_composed_workspace(agent_id=parent_agent_id, sub_path=normalized_path, include_content=True)`. Catch the existing client exception types (whatever it raises today — see `workspace_composer_client.py`) and re-raise with a `delegate_to_workspace failed: <reason>` message. Don't swallow.
- AGENTS.md parse: pull `composed_tree["AGENTS.md"].content` (or whatever the existing return shape uses) and feed to `parse_agents_md`. If `AGENTS.md` is missing from the composed tree, raise `ValueError("target folder has no AGENTS.md")`.
- Resolution loop: `for row in ctx.routing: for slug in row.skills: resolved = skill_resolver.resolve_skill(slug, normalized_path, composed_tree, platform_catalog_manifest)`. Collect results in declaration order; first `SkillNotResolvable` aborts with the slug. Resolved entries go into `resolved_context["resolved_skills"]` keyed by slug.
- Build `resolved_context = {composed_tree, routing, resolved_skills, parent_agent_id, depth, task, normalized_path}` and return `_spawn_sub_agent(resolved_context)`.
- `_spawn_sub_agent(resolved_context)` body for this PR: `return {"ok": False, "reason": "spawn not yet wired", "resolved_context": resolved_context}`. The follow-up PR replaces the body only.

**Execution note:** Implement test-first for `validate_path` (pure function, fast feedback) and for the resolver-abort path (operator-facing error message is contract). Other surfaces test-after is fine since they delegate to already-merged primitives.

**Patterns to follow:**
- `server.py:1373-1412` `_make_delegate_fn` for the factory closure shape and `@tool` decoration.
- `server.py:1303-1340` `make_skill_agent_fn` for `usage_acc` accumulator handling (kept as a no-op pass-through here; the spawn PR populates it).
- `feedback_ship_inert_pattern` precedent set by U10 (#574) — module lands with full tests but the integration is gated.
- `feedback_completion_callback_snapshot_pattern` for env / config snapshotting at factory time.

**Test scenarios:**
- Covers AE7. Happy path: `delegate_to_workspace("expenses", "submit receipt")` with a fixture composed tree containing `expenses/AGENTS.md` and one resolvable skill returns `{ok: false, reason: "spawn not yet wired", resolved_context: {... resolved_skills includes the skill ...}}`.
- Happy path: depth 5 (`a/b/c/d/e`) succeeds without warning.
- Edge case: depth 4 (`a/b/c/d`) succeeds and emits exactly one `logger.warning` with `delegate_depth=4`.
- Edge case: depth 6 (`a/b/c/d/e/f`) raises `ValueError` with message containing "exceeds cap of 5"; composer is NOT called (assert via `composer_client.fetch_composed_workspace.assert_not_called()`).
- Edge case: trailing-slash normalization — `"expenses/"` and `"expenses"` produce identical resolved_context (compare-by-keys; spawn is inert so output identity is meaningful).
- Edge case: empty path after strip raises `ValueError("path is empty")`; composer not called.
- Error path: path with `..` segment raises `ValueError("path traversal not allowed")`; composer not called.
- Error path: absolute path (`"/expenses"`) raises `ValueError("absolute paths not allowed")`; composer not called.
- Error path: reserved-suffix path (`"memory"`, `"expenses/memory"`, `"skills"`, `"expenses/skills"`) raises `ValueError` naming which reserved name was hit; composer not called.
- Error path: composer raises (mock `composer_client.fetch_composed_workspace.side_effect = SomeComposerError("boom")`) — tool re-raises with message containing `delegate_to_workspace failed` and the cause; resolver is NOT called.
- Error path: composed tree missing `AGENTS.md` — raises `ValueError("target folder has no AGENTS.md")`.
- Error path: parser succeeds but resolver raises `SkillNotResolvable("approve-receipt")` for one slug — tool aborts before any spawn-side state is built; raised error names the slug.
- Integration: factory snapshots `platform_catalog_manifest` at construction; mutating the source dict after factory call does not change resolution behavior on subsequent invocations.
- Integration: `_boot_assert` smoke — assert that running the existing `_boot_assert` entrypoint passes with the new module present.

**Verification:**
- All test scenarios pass via `uv run pytest packages/agentcore-strands/agent-container/test_delegate_to_workspace_tool.py`.
- `_boot_assert` still passes (deploy-time integrity check stays green).
- The follow-up spawn PR can change only `_spawn_sub_agent`'s body and re-use every other test.

---

## System-Wide Impact

- **Interaction graph:** New tool registered in the Strands runtime alongside `delegate`. The composer client, AGENTS.md parser, and skill resolver are exercised in production for the first time via this tool — but each has shipped tests and (per `feedback_ship_inert_pattern` for U10) was already validated.
- **Error propagation:** All errors leave the tool as `ValueError` (validation) or the composer-client's existing exception types wrapped with a `delegate_to_workspace failed: ...` prefix. No silent swallow. The agent author sees these as failed tool calls; no operator dashboard surfacing in this PR.
- **State lifecycle risks:** None. Spawn is inert; nothing is persisted. The follow-up spawn PR will introduce `sub_agent_usage` accumulation — note in that PR's scope.
- **API surface parity:** `delegate_to_workspace` is a peer of `delegate`. No admin / CLI / mobile parity needed in this PR — the tool is invoked only by the LLM via tool-calling.
- **Integration coverage:** Composer fetch, AGENTS.md parse, and skill resolution exercise three already-shipped libraries. Tests use real parser + resolver against fixture composed trees (not mocks of the libraries themselves) so library contract drift surfaces immediately.
- **Unchanged invariants:** Existing generic `delegate(task, context)` is untouched. `EXPECTED_TOOLS` / `EXPECTED_SHARED` / `EXPECTED_CONTAINER_SOURCES` lists grow by exactly one entry. `server.py`'s tool-registration loop pattern does not change shape.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| The composer-client return shape (composed tree key naming) drifts vs what U9 expects | Tests use the real `workspace_composer_client.fetch_composed_workspace` against a fixture-served HTTP layer where possible; otherwise the test asserts on the exact key path the tool reads (`composed_tree["AGENTS.md"].content` or the actual current shape). Implementer must read the current return shape before writing the parse step. |
| The resolver contract (#575 hardening) requires string-typed inputs; passing a `Path` or non-str slug crashes | Type annotations on the tool's internals + a test scenario that passes a non-str slug and asserts the failure happens at the resolver boundary (TypeError), not silently |
| Reserved-name rejection is mis-applied to `memory-team` or `skills-2026` | Exact-match against `RESERVED_FOLDER_NAMES` frozenset on each path segment, not prefix or substring. Test scenario locks this. |
| Depth-cap off-by-one (does `expenses` count as depth 1 or 0?) | Decision recorded: depth = `path.count("/") + 1` after normalization. Single-segment path is depth 1. Tests assert depth 5 succeeds and depth 6 rejects. |
| Spawn PR forgets to clear `_spawn_sub_agent`'s inert body and ships with `ok: false` | Spawn PR's plan must include a test scenario that asserts `ok: true` for a happy path; the inert test in this plan only asserts `ok: false`, so the contradiction is forced. |

---

## Documentation / Operational Notes

- Update `packages/agentcore-strands/AGENTS.md` (or local module comment) noting that `delegate_to_workspace` exists as a registered tool but spawn is inert pending the follow-up unit. Avoid surfacing in user-facing docs until spawn lands.
- No deploy / migration / feature-flag notes — Strands container redeploys on PR merge per existing pipeline.
- Memory: after this lands, update `project_plan_008_progress.md` to record U9 inert completion and name the spawn follow-up unit number.

---

## Sources & References

- **Origin plan:** `docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md` (master plan §008, U9 unit body lines 614-654, Key Decisions line 155).
- Master plan dependency PRs: #566 (U1), #570 (U5), #572 (U7), #573 (U8), #574 (U10), #575 (U10 followup).
- Memory: `project_plan_008_progress.md`, `feedback_ship_inert_pattern`, `feedback_completion_callback_snapshot_pattern`, `feedback_dont_overgate_baseline_agent_capability`.
