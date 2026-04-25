---
title: "feat: U9 spawn live — replace inert seam + bundle U9/U12 residuals"
type: feat
status: active
date: 2026-04-25
origin: docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md
---

# feat: U9 spawn live — replace inert seam + bundle U9/U12 residuals

## Overview

Replace `_spawn_sub_agent_inert`'s body in `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py` with the real Bedrock sub-agent spawn so `delegate_to_workspace(path, task)` is functionally live, AND bundle six high-impact residuals from U9 (#578) and U12 (#584) reviews. After this PR merges, master plan §008 Phase C is functionally complete and the next effort can start.

The seam contract from U9 (`_spawn_sub_agent(resolved_context: dict) -> dict`) is preserved exactly — only the inert body is replaced. Tests' explicit `spawn_fn=` injection continues to work; the production path's `spawn_fn=None` fallback now resolves to a live spawn.

---

## Problem Frame

U9 (#578) shipped `delegate_to_workspace` with an inert spawn seam — every adversarial path validates correctly, the composer fetches, the parser parses, the resolver resolves, and then `_spawn_sub_agent_inert` returns `{ok: false, reason: "spawn not yet wired", resolved_context: {...}}`. The runtime contract is fully exercised; only the Bedrock spawn itself is missing.

U12 (#584) shipped `write_memory(path, content)` with sub-agent-aware path validation, so a sub-agent rooted at `{folder}/` can write to `{folder}/memory/{basename}.md` once it actually exists. The destination side is ready; the source side (the sub-agent itself) is the gap.

Two reviews flagged 35 residuals between them (22 from U9, 13 from U12). Most are deferrable to Phase D/E/F. **Six are gated by inert** — they describe behavior that's impossible to manifest while spawn returns `ok: false` but flips to broken-in-prod the moment the seam goes live:

1. **U9 P0** `server.py:1433` hard-codes `platform_catalog_manifest=None`. The resolver's platform-fallback branch at `skill_resolver.py:313` is gated `if manifest is not None`. The first AGENTS.md row that references a platform skill aborts with `SkillNotResolvable` — and since most workspaces will have at least one platform skill in their routing table, "first delegation = fail" is the default behavior the moment spawn lights up.
2. **U9 P1** Cascade fetch — `fetch_composed_workspace` doesn't accept `sub_path`; the tool fetches the FULL composed tree per call. At enterprise scale (4 enterprises × 100+ agents) an agent loop calling `delegate_to_workspace` per turn fans out to dozens of files per call → self-DDoS of `/api/workspaces/files`.
3. **U9 P1** Routing-row reserved-name silent skill drop — the parser WARN+skips a row whose `goTo` is reserved (`memory/`, `skills/`); the row's skills disappear from `ctx.routing`, so the sub-agent boots without expected skills with no LLM-visible signal.
4. **U9 P1** Body-swap safety — production registration uses `spawn_fn=None` → falls back to inert. Tests pass `spawn_fn` explicitly → exercise a different code path. A spawn-PR that adds `_spawn_sub_agent_real()` in a sibling function instead of editing the seam ships with prod silently keeping inert.
5. **U12 P2 (high)** `MEMORY_GUIDE.md` and `AGENTS.md` (workspace-defaults) don't teach sub-agent path composition. System-prompt-resident; once spawn is live, sub-agents reading them call `write_memory("memory/lessons.md", ...)` and clobber the parent's root file — the exact bug U12 was written to make fixable.
6. **U12 P2** Depth-cap drift: `_MAX_FOLDER_DEPTH = 5` and `MAX_DEPTH = 5` in two files for the same Key Decisions §008 policy. A future cap change must touch both.

Two more from the U9 P1 set are operationally important and folded in:
- Registration silently logs `info` on missing env (warm container env-injection race per `project_agentcore_deploy_race_env`) → promote to `warning` + emit a CloudWatch metric.
- Server.py registration block has 4 untested branches (env-fallback, gate, `except ImportError`, else-log).

---

## Requirements Trace

- R1. `delegate_to_workspace(path, task)` returns a real sub-agent response (`ok: true, sub_agent_response: str, sub_agent_usage: {...}`) when the resolved context is valid; the inert seam is gone from the production code path. (Master R9, F3.)
- R2. The platform catalog manifest is wired through registration so the resolver's platform-fallback branch is reachable from production. The catalog source is `register_skill_tools(skills_config)`'s `skill_meta` return (mirrors how `_make_delegate_fn` already gets its model from `effective_model`). (U9 P0 closure.)
- R3. The composer client supports a `sub_path` filter, AND/OR an in-process short-TTL cache reduces fan-out for repeated `delegate_to_workspace` calls within a 60s window. (U9 P1 cascade closure.)
- R4. Parser-skipped routing rows (reserved-name `goTo`, malformed) are bubbled into `resolved_context["warnings"]` and surfaced in the sub-agent's tool-result envelope so the parent LLM can recover. (U9 P1 silent-drop closure.)
- R5. Body-swap safety: an integration test exercises the zero-arg registration code path (no explicit `spawn_fn`) and asserts `ok: true` for a happy path. A future spawn change that re-introduces inert behavior fails this test. (U9 P1 body-swap closure.)
- R6. Server.py registration: `logger.info` → `logger.warning` on missing env; CloudWatch metric emitted (or stand-in counter). All 4 registration branches have tests. (U9 P1 reliability + testing closure.)
- R7. `MEMORY_GUIDE.md` (system-prompt-resident) teaches sub-agents to compose `{folder}/memory/{basename}.md` from the agent root. `AGENTS.md` (workspace-defaults) writable-folder map legend mentions per-sub-agent `memory/`. (U12 P2 docs closure.)
- R8. `MAX_FOLDER_DEPTH = 5` lifted to `skill_resolver.py` as a single shared constant; `delegate_to_workspace_tool.py` and `write_memory_tool.py` import from there. (U12 P2 drift closure.)
- R9. Spawn body honors `feedback_completion_callback_snapshot_pattern`: factory-snapshotted `cfg_model`, `usage_acc`, `parent_tenant_id`, `parent_agent_id` are used; no `os.environ` re-reads inside the spawn body or sub-agent dispatch.
- R10. The seam signature stays `_spawn_sub_agent(resolved_context: dict) -> dict`. Tests' explicit `spawn_fn=` injection continues to work unchanged.

**Origin actors:** A4 (agent runtime), A5 (sub-agent), A6 (operator — for the env-warn metric).
**Origin flows:** F3 (sub-agent delegation).
**Origin acceptance examples:** AE2 (thin sub-agent inheritance — runtime side), AE3 (override path — runtime side), AE6 (local skill resolution — runtime side).

---

## Scope Boundaries

- Not implementing ETag-guarded optimistic concurrency for memory writes (master plan §008 line 160). Separate plan-008 follow-up. v1 last-writer-wins is acceptable per the master plan and U12 review residuals.
- Not aligning `packages/skill-catalog/workspace-memory/scripts/memory.py` validation (looser `path.startswith("memory/")` only). Real bypass surface today (LLM can switch tools mid-turn), but separate scope; address in a focused follow-up plan.
- Not implementing U11 (`derive-agent-skills.ts`). Independent of spawn.
- Not implementing Phase D (U14-U16 import pipeline), Phase E (U17-U23 admin builder), or Phase F (U13/U24-U28 pin propagation + retirement).
- Not refactoring the existing generic `delegate(task, context)` tool. Both coexist.
- Not adding new admin / mobile / www UI surfaces.

### Deferred to Follow-Up Work

- **ETag concurrency for memory writes** (master plan §008 line 160; U12 deferred): separate plan-008 follow-up unit touching `packages/api/workspace-files.ts` `put` action handler.
- **Skill-script `workspace_memory_write` validation alignment**: separate follow-up. Today's gap is documented in `docs/residual-review-findings/feat-u12-write-memory-path-param.md`.
- **U11 derive-agent-skills.ts**: ships in parallel from a separate worktree.
- **Phase D / E / F**: ship after the next effort lights up.

---

## Context & Research

### Relevant Code and Patterns

**Spawn patterns (server.py — already in production):**
- `_make_delegate_fn` at `server.py:1295-1322`: shape for `BedrockModel(model_id, region_name, streaming, cache_config)` + `Agent(model, system_prompt, tools=[], callback_handler=None)` + `result.metrics.accumulated_usage` extraction. This is the minimal spawn shape U9 inherits.
- `make_skill_agent_fn` at `server.py:1225-1261`: shape for sub-agent with **scoped tools** (each skill's scripts). Captures `cfg_model`, `cfg_prompt`, `cfg_tools`, `usage_acc` in closure. Returns text or GenUI-wrapped JSON. This is the closer match for U9 because U9 sub-agents have scoped skills.
- `_build_skill_agent_prompt` at `server.py:1138-1180`: builds the sub-agent system prompt from system guardrails (`PLATFORM.md`, `GUARDRAILS.md` from `SYSTEM_WORKSPACE_DIR`) + SKILL.md content + token-efficiency rules. U9 spawn extends this pattern by composing the prompt from `resolved_context["composed_tree"]` (sub-agent's `AGENTS.md` + `CONTEXT.md` + inherited `SOUL/IDENTITY/PLATFORM/GUARDRAILS`).
- `register_skill_tools(skills_config)` at `server.py:1127`: returns `(tool_mode_tools, agent_mode_tools, skill_meta)`. The `skill_meta` map is `slug → {model, description, ...}` — the platform catalog manifest U9 needs. Threading this into `make_delegate_to_workspace_fn` closes the P0.

**Composer client (Python):**
- `packages/agentcore-strands/agent-container/container-sources/workspace_composer_client.py` — `fetch_composed_workspace(tenant_id, agent_id, api_url, api_secret, timeout_seconds=15.0) -> list[dict]`. Body sets `{"action": "list", "agentId": agent_id, "includeContent": True}`. **No `sub_path` parameter today.** Adding one requires the API-side handler to honor it (or client-side filtering).

**Composer client (TS, API side):**
- `packages/api/workspace-files.ts` `put` and `list` handlers. `list` returns `{ok, files: [{path, source, sha256, content}]}` for the agent's full tree. A `subPath` body field would let the client request only `{normalized_path}/...` entries.

**Resolver (already shipped):**
- `packages/agentcore-strands/agent-container/container-sources/skill_resolver.py:313`: `if platform_catalog_manifest is not None`. The platform branch is reachable only when registration passes a non-None manifest. The platform manifest is `Mapping[str, Mapping[str, Any]]` — slug → `{skill_md_content: str, ...}`.

**Parser (already shipped):**
- `packages/agentcore/agent-container/agents_md_parser.py:217`: `if go_to_folder in RESERVED_FOLDER_NAMES: logger.warning(...) continue`. Currently silent to the LLM. Adding a `warnings: list[str]` field to `AgentsMdContext` and a `skipped_rows: list[dict]` field captures both reserved-name skips and invalid-path skips.

**Existing U9 + U12 code:**
- `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py:172-180` — `_spawn_sub_agent_inert` body to replace.
- `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py:52` — `MAX_DEPTH = 5` (U9).
- `packages/agentcore-strands/agent-container/container-sources/write_memory_tool.py:65` — `_MAX_FOLDER_DEPTH = 5` (U12).
- `packages/agentcore-strands/agent-container/container-sources/skill_resolver.py:56` — `RESERVED_FOLDER_NAMES = frozenset({"memory", "skills"})`. Already the centralization pattern; lift `MAX_FOLDER_DEPTH = 5` here too.

**Workspace defaults (system-prompt-resident docs):**
- `packages/workspace-defaults/files/MEMORY_GUIDE.md` — loaded into the system prompt every turn via `server.py` startup composition.
- `packages/workspace-defaults/files/AGENTS.md:18` — writable-folder map.

### Institutional Learnings

- `feedback_completion_callback_snapshot_pattern` — spawn body MUST NOT re-read `os.environ` inside the per-call body. Use the factory-snapshotted `cfg_model`, `usage_acc`, `parent_tenant_id`, `parent_agent_id`. The U9 factory already snapshots these correctly; the new spawn body just consumes them.
- `feedback_ship_inert_pattern` — this PR is the inverse: replacing the inert body with the live one. The seam (`_spawn_sub_agent` function name + signature) does not change; the production registration site does not change shape.
- `feedback_dont_overgate_baseline_agent_capability` — sub-agent delegation is baseline; no admin-approval ceremony around it. The `AgentSkills`-style progressive disclosure pattern is already in use; sub-agent delegation extends it without gating.
- `agentcore-completion-callback-env-shadowing-2026-04-25.md` (PR #563) — env-shadow bug that motivates the snapshot pattern. The U9 spawn body is dispatched inside the agent loop, so env should still be valid; still, snapshot at registration time is the safe pattern and U9 already does it.
- `dockerfile-explicit-copy-list-drops-new-tool-modules-2026-04-22.md` — this PR doesn't add new container modules; the existing `delegate_to_workspace_tool` is in `_boot_assert.EXPECTED_CONTAINER_SOURCES`. No new boot-assert work.
- `bedrock-agentcore-sdk-version-drift-prefer-raw-boto3-2026-04-24.md` (PR #495) — for Bedrock client work prefer raw `boto3.client("bedrock-agentcore")` over wrapper SDKs. **Doesn't apply here:** the spawn body uses Strands' `BedrockModel` + `Agent`, the established pattern from `_make_delegate_fn` and `make_skill_agent_fn`. Don't reach for new wrappers.
- `project_v1_agent_architecture_progress` — this is the unit that completes Phase C of the v1 agent architecture.
- `project_agentcore_deploy_race_env` — warm container env-injection race: registration log-warn + metric is the operational countermeasure.

### External References

- None — well-patterned local work; the spawn body has 2+ direct examples in `server.py`. Skip external research.

---

## Key Technical Decisions

- **Mirror `make_skill_agent_fn` shape, not `_make_delegate_fn`.** The skill-agent shape (scoped `cfg_tools`, scoped `cfg_prompt` from a SKILL.md analog) matches U9's sub-agent better than the empty-toolset generic `delegate`. The spawn body builds `cfg_prompt` from `resolved_context["composed_tree"]` (sub-agent's `AGENTS.md` + `CONTEXT.md` + system guardrails) and `cfg_tools` from `resolved_context["resolved_skills"]`.
- **Resolved skills become sub-agent tools via the existing `register_skill_tools` flow when possible.** Each `ResolvedSkill` carries `skill_md_content` (verbatim SKILL.md). For platform skills (`source: "platform"`), the slug is already in `skill_meta` and `register_skill_tools` produces the right tool — no extra work. For local skills (`source: "local"`), the SKILL.md content is in memory, not on disk; build a minimal in-memory tool wrapper that exposes the skill's scripts as @tool functions. Spawn body composes the union.
- **`platform_catalog_manifest` plumbing:** server.py builds `skill_meta` from `register_skill_tools(skills_config)`. Pass `skill_meta` into `make_delegate_to_workspace_fn(... platform_catalog_manifest=skill_meta ...)` instead of the current `=None`. The factory already deepcopies it; no resolver changes needed.
- **Composer cache over `sub_path` extension.** Adding `sub_path` to `fetch_composed_workspace` requires both the Python client AND the TS API-side handler to change — bigger surface. A short-TTL in-process cache keyed on `(tenant_id, agent_id)` reduces fan-out within a single agent loop without cross-language work and matches U5's existing 60s LRU pattern in `workspace-overlay.ts`. Cache is per-Lambda-instance; cross-replica consistency is not a concern at this layer (composer-side cache invalidates on writes already). Decision: **ship the cache; defer `sub_path`** to a future composer optimization.
- **Cache invalidation:** the cache invalidates on `write_memory` calls from the same agent (composer-side cache invalidation already handles the S3 side; the Python-side cache piggybacks). For v1 simplicity, use TTL-only — 30s window. If we observe read-after-write staleness in practice, add invalidate-on-write.
- **Parser-warning bubble-up:** add `warnings: list[str]` and `skipped_rows: list[dict]` to `AgentsMdContext`. Both parsers (TS + Python) update; both fixture-parity tests update. The U9 spawn body reads these fields and includes them in `resolved_context["warnings"]` and the sub-agent's tool-result envelope so the parent LLM sees `{"ok": true, "sub_agent_response": "...", "warnings": ["row 'memory/' skipped — reserved folder name"]}`.
- **Body-swap safety test:** a new test in `test_delegate_to_workspace_tool.py` registers the tool with `spawn_fn=None` (zero-arg, mirrors production), mocks the composer/resolver dependencies, and asserts `result["ok"] is True` on a happy path. This test fails any future change that re-introduces an inert default.
- **Registration log-warn + metric:** `logger.warning` on missing env. For the metric, use the existing CloudWatch logger pattern (one structured log line at WARN level with `event_type="tool_registration_skipped"` and tool name) — the agentcore CloudWatch dashboards already aggregate WARN logs by event_type per `project_v1_agent_architecture_progress`. No new EMF / metric SDK code needed.
- **Shared depth-cap constant:** `MAX_FOLDER_DEPTH = 5` lives in `skill_resolver.py` next to `RESERVED_FOLDER_NAMES`. Both tool modules import from there. Future cap changes are single-file. The Key Decisions §008 line 155 reference moves to `skill_resolver.py`'s docstring.
- **Doc updates are first-class units.** Per agent-native review: `MEMORY_GUIDE.md` and `AGENTS.md` are system-prompt-resident — the LLM reads them every turn. Updating them is part of "spawn live"; doc lag would silently mis-train sub-agents on day one.

---

## Open Questions

### Resolved During Planning

- "Should the spawn use `_call_strands_agent` recursion or build a minimal `Agent`?" — **Build a minimal Agent**, mirroring `make_skill_agent_fn`. The full `_call_strands_agent` pulls in MCP clients, KB, evals, and other parent-only state; sub-agents don't need it.
- "How do local skills (in-memory `skill_md_content`) become sub-agent tools?" — Build a minimal in-memory wrapper. The `skill_runner.register_skill_tools` reads from `/tmp/skills/<slug>/`; for local-source skills, write a small adapter that wraps the in-memory SKILL.md into a callable tool with the same shape. Implementation detail; pick during execution.
- "Should `fetch_composed_workspace` get a `sub_path` parameter?" — No (this PR). Composer-side cache is simpler and avoids cross-language coordination. Revisit when measured fan-out becomes a real cost.
- "Where does the platform catalog manifest come from at registration?" — `skill_meta` returned by `register_skill_tools(skills_config)`. Already computed in `_call_strands_agent`; thread it into `make_delegate_to_workspace_fn` at line 1340 (after `register_skill_tools` returns) instead of the current registration site at line 1340-1424.

### Deferred to Implementation

- Exact CloudWatch metric event-type string (`tool_registration_skipped` is a working name; the operator dashboard naming conventions can override).
- Whether the cache key includes `sub_path` once that lands as a follow-up — for now `(tenant_id, agent_id)` is sufficient.
- Token-efficiency rules in the sub-agent system prompt: copy verbatim from `_build_skill_agent_prompt` lines 1170-1180 OR omit if the sub-agent's `composed_tree` already contains them via `PLATFORM.md`.
- Exact placement of the `warnings` field in the sub-agent's tool-result envelope: top-level vs nested under `resolved_context`. Test scenarios will lock in.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
delegate_to_workspace(path, task)  [factory closure, U9-shipped]
  ├─ validate_path(path)
  ├─ snapshot_composer_cached(tenant, agent)        ← NEW (U2 cache)
  │     └─ in-process LRU 30s on (tenant, agent)
  ├─ parse_agents_md(target_folder/AGENTS.md)
  │     ↓ now returns warnings + skipped_rows       ← NEW (U4 parser)
  ├─ resolve_skill(slug, ..., platform_catalog_manifest=snapshot_catalog)
  │     ↑ snapshot_catalog is non-None at registration  ← NEW (U3 manifest)
  ├─ resolved_context = {…, warnings, skipped_rows}  ← extended
  └─ snapshot_spawn(resolved_context)                ← NEW (U5 live spawn)

snapshot_spawn = _spawn_sub_agent  (U5 live body)
  ├─ build_sub_agent_prompt(resolved_context["composed_tree"])
  │     ├─ system guardrails (PLATFORM.md, GUARDRAILS.md from composed tree)
  │     ├─ sub-agent CONTEXT.md
  │     ├─ sub-agent AGENTS.md
  │     └─ token-efficiency rules
  ├─ build_sub_agent_tools(resolved_context["resolved_skills"])
  │     ├─ for source="platform": route via existing register_skill_tools path
  │     └─ for source="local":   minimal in-memory tool wrapper
  ├─ BedrockModel(cfg_model, region_name, streaming, cache_config)
  ├─ Agent(model, system_prompt, tools, callback_handler=None)
  ├─ result = a(task)
  ├─ usage_acc.append({input_tokens, output_tokens})
  └─ return {ok: true, sub_agent_response, sub_agent_usage, warnings, resolved_context}
```

The seam (`_spawn_sub_agent`, signature `(resolved_context: dict) -> dict`) is unchanged. The factory's `spawn_fn=None` fallback now resolves to the live body. Tests' explicit `spawn_fn=` injection continues to override.

---

## Implementation Units

- U1. **Lift `MAX_FOLDER_DEPTH` to a shared constant in `skill_resolver.py`**

**Goal:** Single source of truth for the Key Decisions §008 depth cap. Both U9 and U12 import from `skill_resolver`; future cap changes are single-file.

**Requirements:** R8.

**Dependencies:** None.

**Files:**
- Modify: `packages/agentcore-strands/agent-container/container-sources/skill_resolver.py` — export `MAX_FOLDER_DEPTH = 5` next to `RESERVED_FOLDER_NAMES`. Add docstring referencing Key Decisions §008.
- Modify: `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py:52` — replace `MAX_DEPTH = 5` with `from skill_resolver import MAX_FOLDER_DEPTH as MAX_DEPTH`.
- Modify: `packages/agentcore-strands/agent-container/container-sources/write_memory_tool.py:65` — replace `_MAX_FOLDER_DEPTH = 5` with `from skill_resolver import MAX_FOLDER_DEPTH as _MAX_FOLDER_DEPTH`.
- Test: `packages/agentcore-strands/agent-container/test_skill_resolver.py` — add a test asserting `skill_resolver.MAX_FOLDER_DEPTH == 5` and that U9/U12's tool modules import the same value.

**Approach:**
- Re-export the same numeric value; both consumers behave identically. No behavior change in the delegate or write_memory tools.
- Both tool modules already import from `skill_resolver`; this is a one-line addition to each import block.

**Patterns to follow:**
- Existing `RESERVED_FOLDER_NAMES` centralization pattern in `skill_resolver.py:56`.

**Test scenarios:**
- Happy path: `from skill_resolver import MAX_FOLDER_DEPTH` returns `5`.
- Integration: `delegate_to_workspace_tool.MAX_DEPTH is skill_resolver.MAX_FOLDER_DEPTH`.
- Integration: `write_memory_tool._MAX_FOLDER_DEPTH is skill_resolver.MAX_FOLDER_DEPTH`.
- Regression: U9 and U12 existing test suites (`test_delegate_to_workspace_tool.py`, `test_write_memory_tool.py`) continue to pass unchanged.

**Verification:**
- All three tests above green.
- Existing test suites unchanged — no test modifications needed.
- A grep of the codebase for `MAX_DEPTH = 5` returns only `skill_resolver.py`.

---

- U2. **Update `MEMORY_GUIDE.md` and `AGENTS.md` for sub-agent path composition**

**Goal:** Teach sub-agents (via system-prompt-resident docs) that `write_memory` paths are from the agent root, so they prefix their folder. Closes the U12 P2 doc gap before sub-agents are real.

**Requirements:** R7.

**Dependencies:** None.

**Files:**
- Modify: `packages/workspace-defaults/files/MEMORY_GUIDE.md` — append a paragraph in the "When to use these vs `write_memory`" section explaining the sub-agent path-composition rule.
- Modify: `packages/workspace-defaults/files/AGENTS.md` — update the writable-folder map legend to note that each sub-agent folder also has its own `memory/`.

**Approach:**
- The `MEMORY_GUIDE.md` paragraph (verbatim from U12 review): "When you are a sub-agent rooted at `{folder}/`, prefix the path with your folder: `write_memory('{folder}/memory/lessons.md', ...)`. The path is from the agent root, not your sub-folder; passing just `'memory/lessons.md'` would write to the parent agent's notes."
- The `AGENTS.md` legend tweak: one sentence near line 18 noting that each sub-agent folder gets its own `memory/`.
- These files are loaded into the parent agent's system prompt at `_call_strands_agent` startup; sub-agents inherit them via the composed-tree overlay (U5 recursive composer).

**Patterns to follow:**
- Existing prose style of `MEMORY_GUIDE.md` (paragraph form, second-person voice).
- Existing legend-line style of `AGENTS.md`.

**Test scenarios:**
- Test expectation: none — pure prose change to instruction-prose files. The behavioral assertion is that the sub-agent system prompt actually contains the new text once the composed-tree overlay runs; that's covered indirectly by U5's tests, not by adding a redundant assertion here.

**Verification:**
- `MEMORY_GUIDE.md` contains the literal phrase "from the agent root" in the sub-agent-path-composition paragraph.
- `AGENTS.md` writable-folder map legend mentions sub-agent `memory/`.
- After deploy, the parent agent's system prompt (sample CloudWatch log of `_build_system_prompt`) contains the new text.

---

- U3. **Wire `platform_catalog_manifest` at registration; add composer cache**

**Goal:** Close U9 P0 (`platform_catalog_manifest=None` at registration) AND U9 P1 cascade fetch. Both happen at the registration site in `server.py` and the composer-client wrapper.

**Requirements:** R2, R3.

**Dependencies:** None.

**Files:**
- Modify: `packages/agentcore-strands/agent-container/container-sources/server.py` — at the `delegate_to_workspace` registration site (~line 1340-1424, post-U9): pass `platform_catalog_manifest=skill_meta` into `make_delegate_to_workspace_fn` instead of `=None`. `skill_meta` is already in scope from `register_skill_tools(skills_config)` at line 1127.
- Modify: `packages/agentcore-strands/agent-container/container-sources/workspace_composer_client.py` — add a `fetch_composed_workspace_cached(tenant_id, agent_id, api_url, api_secret, ttl_seconds=30)` wrapper with an in-process LRU keyed on `(tenant_id, agent_id)`. Pure-function cache (no instance state on the existing function); module-level dict + lock.
- Modify: `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py` — change the factory's default `composer_fetch` from `fetch_composed_workspace` to `fetch_composed_workspace_cached`. The `composer_fetch` kwarg stays so tests can inject either.
- Test: `packages/agentcore-strands/agent-container/test_workspace_composer_client.py` (existing) — extend with cache tests.
- Test: `packages/agentcore-strands/agent-container/test_delegate_to_workspace_tool.py` (existing) — add a test that two sequential calls within TTL hit the cache (composer mock called once).

**Approach:**
- Cache implementation: small wrapper with `time.monotonic()`-based TTL check + module-level `dict[tuple[str, str], (timestamp, files)]` + `threading.Lock`. No external cache library.
- Cache invalidation: TTL-only for v1. Cross-replica concurrent writes during the 30s window can return slightly stale composed trees; that's acceptable for delegation (the sub-agent re-fetches via composed-tree overlay if the staleness matters at deeper levels).
- Catalog manifest: `skill_meta` from `register_skill_tools` is already a `dict[str, dict]` mirroring the resolver's `Mapping[str, Mapping[str, Any]]` shape. The resolver reads `skill_md_content` from each manifest entry (per `_read_platform_content`). `skill_meta` carries `description` + `model` + … — implementer must verify the entries have `skill_md_content` populated, OR build a minimal adapter (`{slug: {"skill_md_content": load_skill_md(slug)}}`) at the registration site if `skill_meta` doesn't carry the body. **Open implementation question: what's `skill_meta`'s exact shape today vs the resolver's expectation?** Pin during execution by reading `register_skill_tools` and `_read_platform_content`.

**Execution note:** Verify `skill_meta`'s shape against `_read_platform_content`'s expectations before wiring. The plan assumes adapter-may-be-needed; the worktree exec should determine the exact mismatch.

**Patterns to follow:**
- 60s LRU pattern in `packages/api/src/lib/workspace-overlay.ts` (TS-side composer cache) — similar shape, similar TTL.
- Existing `fetch_composed_workspace` body in `workspace_composer_client.py` for the un-cached call shape.
- `register_skill_tools(skills_config)` at `server.py:1127` for catalog source.

**Test scenarios:**
- Happy path: two sequential `fetch_composed_workspace_cached(t, a, u, s)` calls within 30s — composer is called once, second returns cached result. (Mock `urlopen`.)
- Edge case: third call after TTL expires (mock `time.monotonic` advancing past 30s) — composer is called again.
- Edge case: different `(tenant_id, agent_id)` keys — separate cache entries; concurrent calls don't collide.
- Edge case: cache disabled / TTL=0 — pass-through to underlying function.
- Integration: `delegate_to_workspace` factory with default `composer_fetch=fetch_composed_workspace_cached` and two consecutive `delegate_to_workspace(path, task)` calls in the same agent loop — `urlopen` mock called once.
- Happy path (manifest plumbing): registration with non-empty `skills_config` produces a non-None `platform_catalog_manifest` argument to `make_delegate_to_workspace_fn`. Captured via spy on `make_delegate_to_workspace_fn`.
- Error path (manifest plumbing): registration with empty `skills_config` produces an empty-but-non-None manifest. Resolver's platform-fallback branch is reachable but no platform skill resolves.
- Integration: a workspace whose AGENTS.md routing row references a platform skill (slug in `skill_meta`) — the `delegate_to_workspace` call's resolver no longer raises `SkillNotResolvable`; resolves via `source: "platform"`.

**Verification:**
- Cache tests green; composer mock called the expected number of times.
- Resolver platform-fallback branch is reachable in production code paths (covered by integration test).
- No `os.environ` re-reads inside the cache wrapper (`feedback_completion_callback_snapshot_pattern`).

---

- U4. **Bubble parser warnings + skipped rows into spawn result**

**Goal:** Surface parser-skipped rows (reserved-name `goTo`, malformed) in `resolved_context["warnings"]` and the sub-agent's tool-result envelope. Closes U9 P1 silent skill drop.

**Requirements:** R4.

**Dependencies:** None (lands in parallel with U3).

**Files:**
- Modify: `packages/agentcore/agent-container/agents_md_parser.py` — extend `AgentsMdContext` dataclass with `warnings: list[str]` and `skipped_rows: list[dict[str, str]]` fields (default empty lists). Update `_parse_routing_block` to append a `warnings` entry and a `skipped_rows` record on each WARN-skip.
- Modify: `packages/api/src/lib/agents-md-parser.ts` — mirror the TS parser. Update fixture-parity test.
- Modify: `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py` — read `ctx.warnings` and `ctx.skipped_rows` after `parse_agents_md`; add to `resolved_context`.
- Test: `packages/agentcore/agent-container/test_agents_md_parser.py` — add tests asserting `warnings` and `skipped_rows` are populated for reserved-name + invalid-path skips.
- Test: `packages/api/src/__tests__/agents-md-parser.test.ts` — mirror TS tests.
- Test: `packages/agentcore-strands/agent-container/test_delegate_to_workspace_tool.py` — assert `resolved_context["warnings"]` is propagated through the inert seam (set spawn_fn explicitly to capture).

**Approach:**
- Parser change is additive: existing `routing` and `raw_markdown` fields unchanged; new fields default to empty so no caller breaks.
- Each WARN-skip records: `{"row_index": int, "go_to": str, "reason": "reserved" | "invalid_path"}` plus a one-line human-readable string in `warnings`.
- The U9 spawn body (U5 below) reads these and forwards them to the LLM in the tool-result envelope.

**Patterns to follow:**
- Existing `routing` + `raw_markdown` fields on `AgentsMdContext`.
- Fixture-parity test pattern between TS + Python parsers.

**Test scenarios:**
- Happy path: AGENTS.md with one reserved `goTo` row → parser returns `warnings=["row 0 skipped — go_to 'memory/' is reserved"]` and `skipped_rows=[{"row_index": 0, "go_to": "memory/", "reason": "reserved"}]`.
- Happy path: AGENTS.md with one invalid-path `goTo` → similar shape with `reason: "invalid_path"`.
- Edge case: multi-table ambiguity that throws does NOT populate warnings (already raises ValueError).
- Integration: TS + Python fixture parity — both parsers emit equivalent structures for the same fixture markdown.
- Integration: `delegate_to_workspace` with a routing-row reserved-name skip — `resolved_context["warnings"]` contains the corresponding entry. Verified through inert seam (explicit `spawn_fn=` injection captures resolved_context).

**Verification:**
- All test scenarios pass.
- Existing parser tests unchanged.
- TS + Python fixture parity test asserts the same `warnings`/`skipped_rows` shape.

---

- U5. **Replace `_spawn_sub_agent_inert` with real Bedrock spawn**

**Goal:** The headline change — `delegate_to_workspace` actually spawns a sub-agent, returns its response, accumulates usage, and surfaces parser warnings. Phase C runtime is functionally live after this lands.

**Requirements:** R1, R5, R9, R10.

**Dependencies:** U3 (manifest plumbing — sub-agent's resolved skills must include platform skills), U4 (parser warnings — sub-agent result envelope includes them).

**Files:**
- Modify: `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py` — replace `_spawn_sub_agent_inert` body. Rename to `_spawn_sub_agent` (the seam name) but keep `_spawn_sub_agent_inert` as a tested no-op fallback exported for reference. Tests' explicit `spawn_fn=` injection continues to use the test double.
- Test: `packages/agentcore-strands/agent-container/test_delegate_to_workspace_tool.py` — add the body-swap safety integration test (zero-arg registration, mocked composer + mocked `BedrockModel`, asserts `ok: true`); add tests covering sub-agent prompt composition (composed_tree → system prompt), tool registration (resolved skills → @tool functions), usage accumulation, warning propagation.

**Approach:**
- Build sub-agent system prompt from `resolved_context["composed_tree"]`:
  - Concatenate sub-agent `AGENTS.md` (the routing context the sub-agent itself sees) + `CONTEXT.md` (the sub-agent's behavioral context) + inherited `SOUL/IDENTITY/PLATFORM/GUARDRAILS` (from the composed-tree overlay)
  - Append token-efficiency rules verbatim from `_build_skill_agent_prompt:1170-1180`
- Build sub-agent tools from `resolved_context["resolved_skills"]`:
  - For `source: "platform"`: use the existing `register_skill_tools` flow with the platform slug — produces tool/agent-mode tools as usual
  - For `source: "local"`: build a minimal in-memory tool wrapper (file_read-style) that exposes the skill's SKILL.md content; full local-skill execution is U11/Phase D scope
  - The implementer may merge platform + local into a single tool list; ordering is local-first per resolver precedence
- Spawn:
  - `BedrockModel(cfg_model, region_name=AWS_REGION, streaming=True, cache_config=...)` — mirror `make_skill_agent_fn:1235-1240`
  - `Agent(model, system_prompt, tools=sub_agent_tools, callback_handler=None)`
  - `result = a(task)`
  - `usage_acc.append({input_tokens: u.get("inputTokens", 0), output_tokens: u.get("outputTokens", 0)})` — mirror `make_skill_agent_fn:1245-1250`
  - Return `{ok: true, sub_agent_response: str(result), sub_agent_usage: {...}, warnings: resolved_context.get("warnings", []), resolved_context: resolved_context}`
- Recursion depth guard already enforced by `validate_path` at call time; the spawn body doesn't need to recheck.
- Skill-not-resolvable abort already enforced at the resolver call site (U9 inert path); spawn body sees only resolved skills.
- The seam preserves `_spawn_sub_agent(resolved_context: dict) -> dict`; the production registration site stays at `make_delegate_to_workspace_fn(... spawn_fn=None ...)` so the fallback resolves to live spawn.

**Execution note:** Implement test-first for the body-swap safety test (it has to fail loudly if the inert default ever resurfaces). Then expand to prompt-composition + usage-accumulation tests. The platform-skill-resolution path is exercised end-to-end by reusing U3's manifest-plumbing integration test.

**Patterns to follow:**
- `make_skill_agent_fn` at `server.py:1225-1261` — the canonical sub-agent spawn shape with scoped tools and prompt + usage accumulation.
- `_build_skill_agent_prompt` at `server.py:1138-1180` — system-prompt composition pattern (system guardrails + skill body + token-efficiency rules).
- `_make_delegate_fn` at `server.py:1295-1322` — the simpler spawn shape for reference; the U9 spawn is closer to `make_skill_agent_fn` than to this.
- `register_skill_tools` at `server.py:1127` for skill → @tool conversion.

**Test scenarios:**
- Covers AE2. Happy path: delegate to thin sub-agent (`expenses/` with only `CONTEXT.md` + AGENTS.md + one platform skill in routing) — `result["ok"] is True`, `result["sub_agent_response"]` contains the mocked sub-agent reply, `result["sub_agent_usage"]` reflects mocked token counts.
- Covers AE6. Happy path: delegate to sub-agent with a local skill in `expenses/skills/approve-receipt/SKILL.md` — sub-agent's tool list includes a callable that exposes the skill body.
- Body-swap safety: registration with `spawn_fn=None` (zero-arg, production mirror) + mocked composer + mocked BedrockModel — `result["ok"] is True`. **This test fails the moment a future change reverts to inert.**
- Edge case: `resolved_context["warnings"]` is non-empty (parser skipped a reserved-name routing row) → `result["warnings"]` includes the entry; `result["sub_agent_response"]` still resolves; sub-agent's system prompt does NOT include the skipped row's `goTo`.
- Edge case: usage accumulator captures tokens; mock `result.metrics.accumulated_usage = {"inputTokens": 100, "outputTokens": 50}` → `usage_acc[-1] == {"input_tokens": 100, "output_tokens": 50}`.
- Error path: BedrockModel raises (mock `Agent(...)` to raise) — wrapped in `DelegateToWorkspaceError` with the underlying cause; `usage_acc` unchanged for the failed call.
- Integration: sub-agent system prompt sourced from `resolved_context["composed_tree"]` — assert the prompt contains the sub-agent's AGENTS.md content (snapshot-style assertion on a fixture composed tree).
- Integration: sub-agent tool list contains the resolved skill (mock `register_skill_tools` and assert it was called with the resolved slug set).
- Integration (snapshot): `feedback_completion_callback_snapshot_pattern` — the spawn body does NOT call `os.environ.get(...)`. Patch `os.environ` mid-call and assert the snapshotted `cfg_model` is what BedrockModel sees.

**Verification:**
- All test scenarios pass.
- Body-swap safety test fails any future change that re-introduces an inert default.
- No `os.environ` reads inside the spawn body.
- 33 existing U9 tests pass unchanged (the inert seam stays available for tests that explicitly inject `spawn_fn=`).

---

- U6. **Server.py registration: log-warn on missing env + tests for all 4 branches**

**Goal:** Promote silent-no-op to a loud warn + a structured log line that operator dashboards can aggregate. Test all 4 registration branches. Closes U9 P1 reliability + testing.

**Requirements:** R6.

**Dependencies:** None (lands in parallel; runs against the existing U9 registration block).

**Files:**
- Modify: `packages/agentcore-strands/agent-container/container-sources/server.py` — at the `delegate_to_workspace` registration block (~line 1340-1424): change `logger.info("delegate_to_workspace tool not registered — ...")` to `logger.warning(...)` with structured `extra={"event_type": "tool_registration_skipped", "tool": "delegate_to_workspace", "missing": [...]}`. Same for the `except ImportError` branch.
- Test: `packages/agentcore-strands/agent-container/test_server_registration.py` (new file or extend existing) — exercise all 4 branches:
  1. All env present → registration log is INFO with `tool registered`
  2. Missing env → registration log is WARNING with `event_type="tool_registration_skipped"`
  3. `ImportError` on the module import → registration log is WARNING with `event_type="tool_registration_failed"`
  4. Else-log path (registered but no spawn config) → no-op (or covered by case 1 — confirm during execution)

**Approach:**
- Test file uses `caplog` fixture to capture log records and assert level + extra fields.
- Mock `make_delegate_to_workspace_fn` to avoid real registration side effects; assert it's called with the expected (or NOT called) under each env permutation.
- The structured `extra={"event_type": ...}` field is the dashboard-aggregation key; CloudWatch Logs Insights queries the dashboard already runs filter on this. No new SDK / EMF code.

**Patterns to follow:**
- Existing `caplog` usage in U12 / U9 test suites.
- Existing `logger.warning` + structured-extra pattern at `delegate_to_workspace_tool.py:113-117` (depth-cap soft-warn).

**Test scenarios:**
- Branch 1 (all env present): registration produces INFO log, `make_delegate_to_workspace_fn` called once.
- Branch 2 (missing `THINKWORK_API_URL`): WARNING log, factory NOT called.
- Branch 3 (missing `API_AUTH_SECRET`): WARNING log, factory NOT called.
- Branch 4 (missing `TENANT_ID`): WARNING log, factory NOT called.
- Branch 5 (missing `AGENT_ID` AND `_ASSISTANT_ID`): WARNING log, factory NOT called.
- Branch 6 (`ImportError` on `from delegate_to_workspace_tool import`): WARNING log with `event_type="tool_registration_failed"`, factory NOT called. Mock by patching `sys.modules` to make the import fail.
- Edge case: structured `extra` field is present and queryable (assert `record.event_type == "tool_registration_skipped"` via caplog).

**Verification:**
- All 7 test scenarios pass.
- Existing server.py tests (if any) unchanged.
- A CloudWatch Logs Insights query like `fields @timestamp, event_type, tool, missing | filter event_type = "tool_registration_skipped"` would return matches in dev (operator dashboard hook).

---

## System-Wide Impact

- **Interaction graph:** The spawn body invokes Bedrock via Strands' `Agent`. Sub-agent inherits the parent's region + cache config; doesn't re-read env. The composer cache reduces fan-out on repeated calls within a 30s TTL window. The parser additions are read-only with respect to existing callers.
- **Error propagation:** `DelegateToWorkspaceError` continues to wrap composer + resolver + new sub-agent spawn errors. The sub-agent's own `Agent(...)` raises propagate up, get wrapped at the spawn body's outer try/except, and surface as `ok: false` with reason — the existing tool-result envelope shape covers this without changing the seam contract.
- **State lifecycle risks:** The composer cache is per-Lambda-instance, in-process. Cross-replica reads see independent caches; that's fine because the underlying composer-side cache invalidates on writes. Cache miss after TTL is the normal path. No persistence; cold-start drops the cache.
- **API surface parity:** The seam (`_spawn_sub_agent`) signature is unchanged. The factory's `spawn_fn=` kwarg behavior is unchanged for tests. The TS parser change ripples into both the api-server's parser and the Python mirror (fixture-parity test enforces).
- **Integration coverage:** Body-swap safety test exercises the production-mirror code path (zero-arg `spawn_fn=None`). U3 manifest-plumbing test covers the `register_skill_tools` → resolver flow. U5 system-prompt-composition test asserts the actual prompt is built from the composed tree, not a hard-coded string.
- **Unchanged invariants:** `validate_path`, the resolver's `RESERVED_FOLDER_NAMES`, the tool's `@tool` decoration, the `_boot_assert` module list, and the existing 33 + 46 (U9 + U12) test suites all continue to pass without modification. The generic `delegate(task, context)` tool at `server.py:1323` is unchanged. `write_memory_tool.py`'s validator, regex, and runtime behavior are unchanged (it only re-imports `MAX_FOLDER_DEPTH` per U1).

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `skill_meta`'s shape doesn't match the resolver's `Mapping[str, Mapping[str, Any]]` expectation (e.g., missing `skill_md_content`) | U3's execution note flags this; implementer verifies and either uses `skill_meta` directly or builds an adapter at the registration site. The integration test exercises end-to-end resolution. |
| Composer cache returns stale tree after a write | TTL-only invalidation for v1; 30s window is short enough to bound staleness; composer-side cache invalidates on writes already (U5 in master plan). If observed in practice, add invalidate-on-write in a follow-up. |
| Local skills (composed_tree-resident SKILL.md) need disk-resident scripts to actually run | Out of scope. v1 spawn body wraps local SKILL.md as a file_read-style tool; full local-skill execution is U11/Phase D. The resolver returns local skills successfully; the sub-agent has them visible but cannot execute scripts that aren't on disk. Document explicitly. |
| Sub-agent token cost spikes at enterprise scale | `usage_acc` accumulator already feeds the existing usage-tracking pipeline. Existing cost dashboards apply. Recursion depth cap (5) bounds worst-case; soft-warn at 4 already implemented. |
| Body-swap regression — a future PR adds a new spawn function instead of editing the seam | Body-swap safety test fails loudly. Production registration path (`spawn_fn=None`) goes through the live default. |
| Parser additions break TS+Python fixture parity | U4 updates both fixtures and the parity test in the same diff. |
| Doc updates (`MEMORY_GUIDE.md`, `AGENTS.md`) drift from runtime contract | The runtime tool's docstring is the canonical contract; the docs reinforce it for in-prompt teaching. If they drift, agent-native review catches on the next code review. |

---

## Documentation / Operational Notes

- After merge, verify via CloudWatch Logs Insights that `delegate_to_workspace` is registered without `event_type="tool_registration_skipped"` warnings on dev. Per `dockerfile-explicit-copy-list-drops-new-tool-modules-2026-04-22.md` post-deploy hygiene.
- Update `project_plan_008_progress.md` after merge to record Phase C functional completion.
- The plan body (`docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md`) stays at `status: active` because U11/Phase D/E/F still remain — Phase C is functionally complete but the master plan's full surface is not.
- Capture a fresh `docs/solutions/patterns/` entry on the inert→live seam pattern after merge — used by U10, U9 (this PR), and likely future work.

---

## Sources & References

- **Master plan:** [docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md](docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md) (U9 unit body lines 614-654; Key Decisions §008 line 155).
- **U9 narrowed plan (precedent):** [docs/plans/2026-04-25-002-feat-u9-delegate-to-workspace-tool-plan.md](docs/plans/2026-04-25-002-feat-u9-delegate-to-workspace-tool-plan.md).
- **U12 narrowed plan (precedent):** [docs/plans/2026-04-25-003-feat-u12-write-memory-path-param-plan.md](docs/plans/2026-04-25-003-feat-u12-write-memory-path-param-plan.md).
- **U9 residuals:** [docs/residual-review-findings/feat-u9-delegate-to-workspace.md](docs/residual-review-findings/feat-u9-delegate-to-workspace.md).
- **U12 residuals:** [docs/residual-review-findings/feat-u12-write-memory-path-param.md](docs/residual-review-findings/feat-u12-write-memory-path-param.md).
- **Dependency PRs:** #566 (U1 Dockerfile), #570 (U5 recursive composer), #571 (U6 TS parser), #572 (U7 Python parser), #573 (U8 reserved-folder-names), #574 (U10 resolver inert), #575 (U10 followup), #578 (U9 inert), #584 (U12 path param).
- **Memory:** `feedback_completion_callback_snapshot_pattern`, `feedback_ship_inert_pattern`, `feedback_dont_overgate_baseline_agent_capability`, `project_agentcore_deploy_race_env`, `project_v1_agent_architecture_progress`, `project_plan_008_progress`.
