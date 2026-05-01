---
title: "feat: Routines rebuild Phase C — authoring"
type: feat
status: active
date: 2026-05-01
origin: docs/plans/2026-05-01-003-feat-routines-step-functions-rebuild-plan.md
---

# feat: Routines rebuild Phase C — authoring

## Summary

Retarget the existing mobile chat builder to emit ASL instead of Python `code`, replace the routine-builder system prompt for the v0 recipe vocabulary, wire validator feedback into the chat session for live correction, and ship `create_routine` + `routine_invoke` MCP tools (inert by env flag) so agents can self-stamp and call routines on subsequent turns. After Phase C, end users on mobile can describe a routine in natural language and have it created via the new ASL pipeline; agents can author routines via MCP. The admin chat surface lands in Phase D alongside the nav restructure.

---

## Problem Frame

Phase C of the master plan (`docs/plans/2026-05-01-003-feat-routines-step-functions-rebuild-plan.md`). Phase B's runtime is live but no surface produces ASL — the existing mobile builder still emits Python that targets the deprecated path. Until the mobile prompt is rewritten and the agent-side MCP tools land, Phase B's substrate has no authoring inputs.

---

## Requirements

R-IDs trace to the origin requirements doc.

- R1, R2, R5, R10. Same chat builder for end users + admin (admin surface in Phase D); validator integrated for live feedback (U10).
- R3. HITL phrase recognition + `inbox_approval` insertion (U10 prompt rules).
- R4, R19, R20, R21. Agent-side `create_routine` + `routine_invoke` MCP tools, inert until env-flag flip (U11).
- R7. `tool_invoke` agent visibility into existing tenant inventory (consumed by U10 prompt; resolver from Phase A U4).

**Origin actors:** A1 (end user), A3 (tenant agent).
**Origin flows:** F1 (end-user authoring), F3 (agent self-stamps).
**Origin acceptance examples:** AE1 (HITL phrase recognition — chat side), AE2 (no-recipe → `python()`).

---

## Scope Boundaries

- No admin chat surface in this phase — that ships with the admin nav restructure in Phase D U12 (admin and mobile share the prompt, but the admin route + chrome land in Phase D).
- No run-detail or run-list UI (Phase D).
- No legacy archival (Phase E U15).
- Origin Scope Boundaries carried forward unchanged.

### Deferred to Follow-Up Work

- Phase A (Substrate) — `docs/plans/2026-05-01-004-feat-routines-phase-a-substrate-plan.md` (must merge first)
- Phase B (Runtime) — `docs/plans/2026-05-01-005-feat-routines-phase-b-runtime-plan.md` (must merge first)
- Phase D (UI) — `docs/plans/2026-05-01-007-feat-routines-phase-d-ui-plan.md`
- Phase E (Cleanup + observability) — `docs/plans/2026-05-01-008-feat-routines-phase-e-cleanup-plan.md`

---

## Context & Research

Defer to the master plan's "Context & Research" section. Phase-C-specific highlights:

- `apps/mobile/prompts/routine-builder.ts` — current `ROUTINE_BUILDER_PROMPT` (Python/`thinkwork_sdk`-shaped); full rewrite needed
- `apps/mobile/app/routines/{builder,builder-chat,new,edit}.tsx` — existing builder UI; retargets to `publishRoutineVersion`
- `apps/mobile/app/routines/new.tsx:60` — phantom `evaluate_routine` MCP call (no tool by that name exists); replace
- `packages/lambda/admin-ops-mcp.ts` — canonical MCP tool registration; `create_routine` and `routine_invoke` slot in
- `packages/agentcore-strands/agent-container/Dockerfile` — explicit COPY list + `_boot_assert` manifest; update for any new agent-container modules (institutional learning)
- `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md` — pattern for shipping MCP tools inert until env flag flip
- `docs/solutions/workflow-issues/agentcore-runtime-no-auto-repull-requires-explicit-update-2026-04-24.md` — `UpdateAgentRuntime` required after container changes
- `docs/solutions/workflow-issues/agentcore-completion-callback-env-shadowing-2026-04-25.md` — snapshot env at coroutine entry

---

## Key Technical Decisions

Carry from the master plan (Phase C-relevant subset):

- **Same chat builder, same prompt, two surfaces** (mobile in C; admin in D). One ASL generator.
- **Mobile builder calls `publishRoutineVersion`** (Phase B U7) on Build; validator (Phase A U5) is consulted live during chat for feedback.
- **JSONata over JSONPath** in emitted ASL — fewer LLM hallucination modes.
- **`create_routine` and `routine_invoke` ship inert** (env-flag `ROUTINES_AGENT_TOOLS_ENABLED=true` gates them) until the runtime is warm-flushed.
- **Agent-stamped routines default to `agent_private`** (per origin R21).
- **Phantom `evaluate_routine` MCP call removed** from mobile; replaced by validator REST call.

---

## Open Questions

### Resolved During Planning

All Phase C open questions resolved in the master plan.

### Deferred to Implementation

- Markdown summary template structure — agent decides freeform within the new prompt; revisit if quality is uneven after first 5-10 routines.
- Whether to ship the prompt change behind a tenant-flag for staged rollout — decide based on which tenants are actively building routines.
- Validator-feedback UX in chat — single-shot retry vs. user-prompted "try again" — pin to existing chat-builder retry pattern.

---

## Implementation Units

Units carried verbatim from the master plan. U-IDs preserved.

- U10. **Routine builder system prompt rewrite + mobile chat retarget**

**Goal:** Replace `apps/mobile/prompts/routine-builder.ts` with an ASL-targeting system prompt, retarget mobile builder UI to call `publishRoutineVersion` instead of `update_routine`-with-code, and wire the validator into the chat session for live feedback.

**Requirements:** R1, R2, R3, R5, R10

**Dependencies:** Phase B U7 (publishRoutineVersion exists), Phase A U5 (validator), Phase A U4 (recipe catalog — agent needs recipe shapes)

**Files:**
- Modify: `apps/mobile/prompts/routine-builder.ts` (full rewrite)
- Modify: `apps/mobile/app/routines/builder.tsx` (Build calls `publishRoutineVersion`; remove Python `code` references)
- Modify: `apps/mobile/app/routines/builder-chat.tsx` (live validator integration)
- Modify: `apps/mobile/app/routines/new.tsx` (replace phantom `evaluate_routine` with new validator REST call)
- Modify: `apps/mobile/app/routines/edit.tsx` (load latest `routine_asl_versions` row instead of legacy code field)
- Modify: `apps/mobile/lib/hooks/use-routines.ts` (codegen consumer of new fields)

**Approach:**
- New prompt: scopes the agent to v0 recipe catalog (injected at session start from `tenantToolInventory`), instructs JSONata syntax, instructs HITL signal recognition (R3 phrase patterns), instructs markdown summary structure (intro + step-by-step + HITL points), forbids raw ASL emission outside the `publishRoutineVersion` tool, demands one tool call only at Build phase.
- Build button calls `publishRoutineVersion` with `{ asl, markdownSummary, stepManifest }`; on validator error, response is fed back into chat as a system message and the agent retries (per AE3).
- Phantom `evaluate_routine` removed; validator REST call (`POST /api/routines/validate`) replaces it for live feedback.

**Execution note:** Hand-test against dev tenant. The prompt's recipe-set + JSONata syntax compliance is hardest to verify via unit tests; gate behind a tenant-flag if rollout needs staging.

**Patterns to follow:**
- `apps/mobile/prompts/routine-builder.ts` (existing — for chat structure conventions)
- `apps/mobile/app/threads/$threadId.tsx` (tool-call → mutation flow)

**Test scenarios:**
- Happy path: user describes "fetch from API hourly, post to Slack" → builder emits ASL with `http_request` + `slack_send`; validator passes; routine created
- Happy path: covers AE1 — user phrase "require approval before sending" inserts `inbox_approval` step before send
- Happy path: covers AE2 — user describes routine that needs un-recipe'd third-party API → builder falls back to `python()` step with explicit network grants
- Edge case: validator rejects emitted ASL → agent retries; if 3x failure, chat surfaces "I'm having trouble building this routine — let's try a different approach"
- Error path: phantom `evaluate_routine` call removed; existing routes don't reference it
- Integration: end-to-end against dev — describe a routine, click Build, routine created with correct ASL

**Verification:**
- New routine creation flow works end-to-end on dev tenant
- `grep -rn "evaluate_routine" apps/` returns zero results
- `pnpm --filter @thinkwork/mobile typecheck` passes

---

- U11. **MCP tools: create_routine + routine_invoke in admin-ops-mcp**

**Goal:** Add `create_routine` and `routine_invoke` MCP tool definitions to `admin-ops-mcp.ts`. Ship inert until U10 lands and the agent runtime has been warm-flushed.

**Requirements:** R4, R19, R20, R21

**Dependencies:** Phase B U7 (publish path), U10 (mobile validation that the prompt + ASL flow work end-to-end before agents author at scale)

**Files:**
- Modify: `packages/lambda/admin-ops-mcp.ts` (two new tool definitions in `buildTools()` + dispatch cases)
- Create: `packages/api/src/lib/routines/agent-stamp.ts` (helper for agent-default visibility = `agent_private` per R21)
- Modify: `packages/agentcore-strands/agent-container/Dockerfile` (verify tool modules COPY list + `_boot_assert` manifest if any new Python tool wrapper added — likely unchanged since tools are TS-side)

**Approach:**
- `create_routine` tool: `{ tenantId, agentId (= caller), name, description?, intent: string, suggestedSteps?: string[] }`. Internal `agent-stamp` helper constructs a routine via the validator + publish path with `visibility: 'agent_private'`. Returns new routine id.
- `routine_invoke` tool: `{ tenantId, routineId, args }`. Calls `triggerRoutineRun` mutation under the hood (or directly to SFN via `StartExecution.sync` for sync flow). Mirrors `tool_invoke` shape.
- Both snapshot env at coroutine entry (`THINKWORK_API_URL` + `API_AUTH_SECRET`).
- Inert pattern: tool definitions exist; dispatch returns `not_yet_enabled` until `ROUTINES_AGENT_TOOLS_ENABLED=true` is set on the runtime.
- Agents calling `routine_invoke` against a routine they don't own (and that isn't tenant-promoted) get a permission error. Visibility check centralized in the helper.

**Execution note:** After landing, force-flush AgentCore warm containers (`UpdateAgentRuntime` per institutional learning) so the new tool list propagates to agents.

**Patterns to follow:**
- `packages/lambda/admin-ops-mcp.ts` (existing 34 tools)
- `packages/agentcore-strands/agent-container/container-sources/server.py:560` (`_build_mcp_clients` — tool list fetched at session start)

**Test scenarios:**
- Happy path: covers F3 — agent calls `create_routine` with intent, gets routine id; row has `engine: 'step_functions'`, `visibility: 'agent_private'`, `owning_agent_id: caller`
- Happy path: agent calls `routine_invoke` against own routine; execution starts, returns success with output
- Edge case: agent calls `create_routine` with empty intent — validator error "intent must be specific enough to generate ASL"
- Error path: agent calls `routine_invoke` against another agent's private routine — permission error
- Error path: `ROUTINES_AGENT_TOOLS_ENABLED` not set — both tools return `not_yet_enabled`
- Integration: agent in dev tenant stamps a routine, then invokes it on the next turn

**Verification:**
- `tools/list` MCP call returns `create_routine` and `routine_invoke` (after warm flush)
- Tools work end-to-end in dev when env flag set

---

## System-Wide Impact

- **Interaction graph:** Mobile chat builder → `validator` REST + `publishRoutineVersion` GraphQL. Agents → `admin-ops-mcp` → publish path. No new substrate; consumes Phase A + Phase B.
- **API surface parity:** Mobile is the first surface; admin chat lands in Phase D U13/U14 (sharing the same prompt + tool-call flow).
- **Unchanged invariants:** Existing Python-code mobile path is removed cleanly; any references caught by typecheck or grep.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| LLM emits invalid ASL repeatedly during chat | Validator returns actionable errors; agent retries up to 3x; final fallback "try a different approach" |
| AgentCore warm flush window blocks agent-side rollout | Inert pattern (env flag) lets the code merge first; flip flag after `UpdateAgentRuntime` confirmed |
| New agent-container modules silently dropped from Dockerfile COPY | Update COPY list + `_boot_assert` manifest in same PR (institutional learning) |
| Mobile prompt regression breaks existing user routines | Feature-flag the prompt rewrite per tenant; rollback by env flag |
| Phantom `evaluate_routine` removal breaks unrelated mobile flow | Grep for all references before deletion; tested in U10 |

---

## Sources & References

- **Master design plan:** `docs/plans/2026-05-01-003-feat-routines-step-functions-rebuild-plan.md`
- **Origin requirements:** `docs/brainstorms/2026-05-01-routines-step-functions-rebuild-requirements.md`
- **Predecessors:** `docs/plans/2026-05-01-004-feat-routines-phase-a-substrate-plan.md`, `docs/plans/2026-05-01-005-feat-routines-phase-b-runtime-plan.md` (both must merge first)
