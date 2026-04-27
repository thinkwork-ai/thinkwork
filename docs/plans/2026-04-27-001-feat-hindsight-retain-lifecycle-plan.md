---
title: "feat: Hindsight retain lifecycle and integration cleanup"
type: feat
status: active
date: 2026-04-27
origin: docs/brainstorms/2026-04-27-hindsight-retain-lifecycle-and-integration-requirements.md
---

# feat: Hindsight retain lifecycle and integration cleanup

## Overview

Replace the Strands runtime's per-turn pair retain (which creates fragmented Hindsight documents) with a per-turn full-thread upsert keyed by `document_id=thread_id`. Replace the module-level monkey-patches on the `Hindsight` client with custom `@tool` wrappers that capture `response.usage` in their function bodies. Result: one Hindsight document per thread, zero monkey-patches in the Hindsight integration model, and an unchanged downstream cost-events contract.

The vendor SDK loop-fix patch (`install_loop_fix`) stays — that's a separate vendor bug workaround, not part of the integration model.

---

## Problem Frame

Two compounding problems with the Strands runtime's Hindsight integration today (origin §Problem Frame):

1. **Per-turn fragmentation.** `_execute_agent_turn`'s success path fires `api_memory_client.retain_turn_pair(thread_id, user_message, assistant_response, ...)`, which async-invokes the `memory-retain` Lambda with just the latest user/assistant pair. The Lambda's `HindsightAdapter.retainConversation` is **already** structured correctly — it sets `document_id=threadId`, `update_mode=replace`, `context="thinkwork_thread"` — but because the runtime only ships 2 messages, each turn upserts a doc containing only those 2 messages, wiping prior turns from Hindsight's view of the thread. Hindsight's API docs are explicit: *"A full conversation should be retained as a single item."*

2. **Module-level monkey-patches.** `hindsight_usage_capture.install()` patches `Hindsight.retain_batch` / `reflect` / `aretain_batch` / `areflect` at module scope to capture Bedrock token usage from agent-driven retain/reflect tool calls. The patches predated the realization that we already replace recall/reflect with custom `@tool` wrappers — usage capture can move into the tool bodies directly with no patch surface.

Both fixes are mostly already-shaped on disk (`HindsightAdapter.retainConversation` exists; custom `recall`/`reflect` wrappers exist in `hindsight_tools.py`). The work is to wire them up correctly and retire the workarounds.

---

## Requirements Trace

- R1. Per-turn upsert SHALL ship the full thread transcript with `document_id=thread_id`, `update_mode=replace`, replacing the legacy per-pair `retain_turn_pair` path. *(origin R1, R2, R3)*
- R2. The runtime SHALL stay engine-agnostic: it ships `{tenantId, userId, threadId, transcript}` to the `memory-retain` Lambda, which dispatches to the active engine adapter. *(origin R2)*
- R3. The runtime SHALL ship its **available** transcript (truncated `messages_history` + current user message + assistant response) to the `memory-retain` Lambda. The Lambda SHALL assemble the canonical full thread by reading the `messages` table by `threadId` and merging that result with the runtime-supplied tail (the latest pair, which may not yet be committed when the Lambda runs). The Hindsight adapter MUST receive the **full** thread transcript so long threads (>30 turns) do not have early turns silently dropped on every replace. The runtime never performs an extra fetch — that work lives in the Lambda. *(origin R1, R2, R3)*
- R4. Sub-agent invocations (`delegate_to_workspace_tool`, `mode:agent` skills, `as_tool()` agents) SHALL NOT trigger auto-retain. The runtime-driven retain stays at the chat-handler call site, never inside `_execute_agent_turn` itself. *(origin R5; preserved naturally because skill/sub-agent paths don't traverse the chat handler)*
- R5. Failure of the upsert MUST NOT block the agent response or change the agent's user-visible status. Best-effort with a warning log. *(origin R6)*
- R6. Bedrock token usage from agent-driven retain/reflect tool calls SHALL be captured inside the `@tool` body of custom wrappers — not via module-level monkey-patches and not via Strands hooks. *(origin R4 reshaped — see Open Questions §"Resolved During Planning")*
- R7. The `hindsight_usage` list shape returned in `_execute_agent_turn`'s `strands_usage` dict (`[{phase, model, input_tokens, output_tokens}]`) MUST remain byte-identical so downstream `chat-agent-invoke` cost-event writes are untouched. *(origin R8 — frozen contract)*
- R8. The `hindsight_usage_capture.install()` monkey-patch is removed. The `_run_async` loop-fix patch is **kept** — it is a vendor SDK bug workaround, not part of the integration model. *(origin R9)*
- R9. The agent-callable `retain` tool from `make_hindsight_tools()` is **kept**. Its implementation changes from the vendored `hindsight_strands.tools.retain` to a custom `@tool` wrapper, but its name, signature, and the model-facing behavior stay the same. *(origin R11)*
- R10. The existing custom `hindsight_recall` and `hindsight_reflect` wrappers keep their async / fresh-client / aclose / retry structure (per repo `feedback_hindsight_async_tools` constraint and origin R12). The reflect wrapper additionally captures usage; the recall wrapper has no usage to capture. *(origin R12)*
- R11. Skill-run dispatch (`run_skill_dispatch.dispatch_run_skill`) continues to NOT auto-retain. The retain call site stays in `do_POST` chat handler, not in `_execute_agent_turn`. *(origin §Scope Boundaries)*

**Origin actors:** A1 Strands runtime root, A2 Strands runtime sub-agent, A3 agent model, A4 memory-retain Lambda, A5 Hindsight service.
**Origin flows:** F1 per-turn upsert, F2 agent-driven explicit retain, F3 sub-agent isolation.
**Origin acceptance examples:** AE1 (covers R1, R2, R3), AE2 (covers R5), AE3 (covers R4, R8, R11), AE4 (covers R6), AE5 (covers R10).

---

## Scope Boundaries

- **Daily-memory retain (`api_memory_client.retain_daily`)** — unchanged. Already document-id-keyed by date.
- **`hindsight_client._run_async` monkey-patch** — kept as-is. Replacement requires an `hindsight-client` SDK upgrade and is a separate piece of work.
- **`hindsight_recall` / `hindsight_reflect` wrapper structure** — async + fresh client + `aclose` + retry stays. Only the reflect wrapper adds a one-line `_push_usage(...)` before returning.
- **AgentCore-managed memory engine adapter** — out of scope. Origin commits per-turn upsert as Hindsight-only behavior. AgentCore's `retainTurn` adapter path is untouched.
- **Cost-events sink schema and `chat-agent-invoke` consumer** — frozen. R7 freezes the runtime → consumer contract; no schema or shape changes.
- **Pruning, archival, retention policies** on the Hindsight bank — deferred.
- **Pi parallel-substrate runtime** — out of scope. This plan targets the existing Strands runtime only.
- **Bank-merge / dual-bank read compat** (in-flight in plan `2026-04-26-007-fix-hindsight-legacy-bank-merge-and-wiki-rebuild-plan.md`) — orthogonal; this plan writes to `user_<userId>` banks and assumes the merge plan handles legacy bank reconciliation independently.

### Deferred to Follow-Up Work

- **`hindsight-client` SDK upgrade that retires `install_loop_fix()`** — separate dependency-upgrade PR. Tracked in origin §Outstanding Questions.
- **Cost attribution for runtime-driven retain extraction LLM calls** — see Open Questions. The current monkey-patches never captured this anyway (the `memory-retain` Lambda calls Hindsight's HTTP API directly from TypeScript; the Python-side patches couldn't see it). Adding Lambda-side cost-event emission is a separate plan.

---

## Context & Research

### Relevant Code and Patterns

**Runtime (Python — agent container):**
- `packages/agentcore-strands/agent-container/container-sources/server.py`
  - Lines 2173-2193: current `retain_turn_pair` call site inside `do_POST` chat handler — the focal change point for U3.
  - Lines 1819-2022: `_execute_agent_turn` helper — read-only here; auto-retain stays outside this helper to keep skill runs and sub-agents excluded.
  - Lines 1936-1951: `messages_history` payload field shape (`{role, content}`). Truncated to last 30 by `chat-agent-invoke.ts`.
  - Lines 1061-1067: `hindsight_usage_capture.install()` and `install_loop_fix()` invocation site — U6 removes the first call, keeps the second.
  - Lines 1721-1747: `hindsight_usage_capture.drain()` site after `_execute_agent_turn` — preserved unchanged in U6.
- `packages/agentcore-strands/agent-container/container-sources/api_memory_client.py`
  - `retain_turn_pair` (lines 29-86): legacy per-pair entry point — removed in U2.
  - `retain_conversation` (lines 89-111): existing unused full-transcript entry point — adopted (and renamed if desired) in U2.
  - Pattern: best-effort, never raises, returns `False` on failure.
- `packages/agentcore-strands/agent-container/container-sources/hindsight_tools.py`
  - `make_hindsight_tools` factory (lines 43-242): assembled in U4. Currently uses `hindsight_strands.create_hindsight_tools(..., enable_recall=False, enable_reflect=False)` for retain only; custom wrappers for recall/reflect. After U4, all three are custom wrappers.
  - `_close_client` helper (lines 81-90): mirrored in the new custom retain wrapper.
  - Closure-snapshot pattern: `hs_endpoint`, `hs_bank` captured in tool closures so env mutation can't change scope.
- `packages/agentcore-strands/agent-container/container-sources/hindsight_usage_capture.py`
  - `_push`, `_lock`, `_usage_log`, `drain`, `reset` (lines 51-67, 198-209): kept unchanged in U6.
  - `install()` (lines 70-150): removed in U6.
  - `install_loop_fix()` (lines 153-195): kept in U6.
- `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py`
  - Lines 342-358: sub-agent Hindsight tool registration via `tool_context["hindsight_tool_factory"]` test seam — read-only here. Confirms sub-agents share the user's bank but inherit `make_hindsight_tools` shape (so U4's custom retain wrapper applies to sub-agents too — but R4 is enforced because retain auto-call happens at chat handler level, not in agent loops).

**Lambda (TypeScript — memory-retain):**
- `packages/api/src/handlers/memory-retain.ts`
  - Handler entry, `MemoryRetainEvent` shape (top of file).
  - Lines 92-119: routing — already prefers `adapter.retainConversation` when available.
  - The full-history fetch (U1) lives here; reads `messages` table by `threadId`.
- `packages/api/src/lib/memory/adapters/hindsight-adapter.ts`
  - Lines 221-247: `retainConversation` — already constructs the correct `document_id` / `update_mode` / `context` / metadata shape. **No adapter changes needed.**
  - Lines 461-469: HTTP shape POSTed to Hindsight `/v1/default/banks/{bankId}/memories`.
- `packages/api/src/lib/memory/adapters/agentcore-adapter.ts`
  - Line 180: AgentCore adapter implements `retainTurn` only, not `retainConversation` — out of scope; the Lambda's `if (adapter.retainConversation)` fallback keeps AgentCore's `retainTurn` path working.
- `packages/database-pg` schema for `messages` table — used by U1 to fetch by `threadId`.

**Cost-events consumer (frozen contract):**
- `packages/api/src/handlers/chat-agent-invoke.ts` lines 614-654 — drain `hindsight_usage` and write `cost_events` rows. Empty-list tolerated (`if (hindsightUsage.length > 0)`). The contract test pinning this shape lives in U6 alongside the monkey-patch retirement.

**Test fixture conventions:**
- Pytest tests live at `packages/agentcore-strands/agent-container/test_*.py` (NOT inside `container-sources/`). `conftest.py` at agent-container level wires sys.path.
- Vitest for `packages/api/src/handlers/memory-retain.ts` mirrors the `hindsight-adapter.test.ts` pattern: `vi.hoisted()` mocks for `getDb`, `vi.spyOn(globalThis, "fetch")` for outbound HTTP.
- Existing `test_hindsight_tools.py` injects `client_factory` and `vendor_factory` test seams — extend the same pattern in U4 for the new custom retain wrapper.

### Institutional Learnings

- `docs/brainstorms/2026-04-24-hindsight-retain-reshape-and-daily-memory-requirements.md` — first articulation of the `document_id=threadId` + `update_mode=replace` + `context="thinkwork_thread"` wire format. The 2026-04-27 origin narrows scope but inherits the wire format verbatim.
- `docs/plans/2026-04-24-001-refactor-user-scope-memory-and-hindsight-ingest-plan.md` (line 830) — chose `RequestResponse` invocation for boundary-flush retain. **This plan supersedes that decision for runtime-driven retain**: per-turn cadence makes `RequestResponse` latency unacceptable on every user-visible turn (~1-2s × every turn vs every 20th). We stay on `Event` invoke and document idempotency from `document_id` + `replace` (see Open Questions).
- `project_async_retry_idempotency_lessons.md` (auto-memory, PR #552) — Lambda Event invokes default to 2 retries; non-idempotent loops set `MaximumRetryAttempts=0`. **Per-turn replace is idempotent by construction** (same `document_id` + `replace` = same end state), so retries are safe. A future flip to `update_mode=append` would re-introduce the double-ingest class — guarded by an adapter unit test.
- `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md` — applied here: U2 lands the new `retain_full_thread` entry point alongside the old `retain_turn_pair` (inert), U3 swaps the call site to live, U6 deletes the old path. Three small PRs preferred over one big one (per `feedback_ship_inert_pattern`); see §Phased Delivery.
- `docs/solutions/workflow-issues/agentcore-completion-callback-env-shadowing-2026-04-25.md` — applied to U2: snapshot `MEMORY_RETAIN_FN_NAME`, `TENANT_ID`, `USER_ID` at call entry rather than re-reading after the agent turn.
- `docs/solutions/best-practices/bedrock-agentcore-sdk-version-drift-prefer-raw-boto3-2026-04-24.md` — generalizes to "stable surfaces over wrapper releases." Custom `@tool` wrappers (U4) are stable surfaces; the vendored `hindsight_strands.tools.retain` is a wrapper release that can drift.
- Repo-root `CLAUDE.md` line 102 / `AGENTS.md` line 128 — Hindsight `recall` / `reflect` wrappers must stay async + fresh client + `aclose` + retry. Honored by R10.

### External References

- [Hindsight retain API docs](https://hindsight.vectorize.io/developer/api/retain) — confirms `document_id` upsert semantics, `update_mode=replace` ("Hindsight will delete the previous version and reprocess from scratch"), and the rule that "a full conversation should be retained as a single item."
- [Hindsight Strands integration docs](https://hindsight.vectorize.io/sdks/integrations/strands) — confirms vendor `create_hindsight_tools()` returns plain `@tool`-compatible callables; no separate Hindsight-side hook system.
- [Strands SDK hooks user guide](https://strandsagents.com/docs/user-guide/concepts/agents/hooks/) and [API reference](https://strandsagents.com/docs/api/python/strands.hooks.events/) — confirms the hook system is stable in 1.x. Reviewed during planning to confirm hooks **cannot** read `RetainResponse.usage` because the `@tool` decorator serializes returns via `model_dump_json()` before `AfterToolCallEvent` fires; usage capture must happen inside the `@tool` body.
- Strands installed source at `strands-agents>=1.34.0` (per `packages/agentcore-strands/agent-container/requirements.txt:2`) — verified during planning.

---

## Key Technical Decisions

- **Per-turn upsert, replace mode, every turn.** Origin §Key Decisions, reaffirmed. Idempotency comes from `document_id=thread_id` + `update_mode=replace`; retries on `Event` invocation are safe.
- **Lambda fetches full thread history from `messages` table.** Runtime can only ship up to 30 prior + current pair (truncated by `chat-agent-invoke.ts`). The Lambda re-reads the full transcript by `threadId` so per-turn replace doesn't destroy turns 1-N on a 50-turn thread. The runtime stays engine-agnostic; the Lambda is already engine-aware.
- **`InvocationType=Event` (fire-and-forget).** Per-turn cadence makes `RequestResponse` latency-prohibitive (~1-2s × every turn). Idempotency under retries is structural (R1's `replace` mode). Supersedes plan `2026-04-24-001`'s boundary-cadence choice of `RequestResponse`.
- **Custom `@tool` wrapper for retain, not Strands hooks (explicit deviation from origin R4).** Origin R4 proposed registering a Strands `AfterToolInvocationEvent` (now `AfterToolCallEvent`) hook for usage capture. Planning research showed hooks **cannot** reach `RetainResponse.usage` — the `@tool` decorator wraps non-`str` returns via `model_dump_json()` before the event fires, and the vendored `hindsight_strands.tools.retain` already returns `str`, so the `usage` block is dropped on the floor before any hook can see it. The plan deviates from origin R4 by capturing `response.usage` inside the `@tool` body of a custom retain wrapper — strictly simpler, equivalent in coverage, and no Strands version pin required. (See Open Questions §Resolved for the verification trail.)
- **Entry-point inventory for auto-retain.** Auto-retain fires from `do_POST` (server.py chat handler) only. Inventory of paths that produce a user-visible turn:
  - **`do_POST`** — fires `retain_full_thread`. Used by both interactive chat (the API's `chat-agent-invoke` Lambda forwards every chat turn) and **wakeup-driven turns** (per `project_automations_eb_provisioning`: `scheduled_jobs` → `job-trigger` Lambda → AgentCore invoke → `do_POST`). Wakeups DO retain. This matches today's `retain_turn_pair` behavior — no regression.
  - **`run_skill_dispatch.dispatch_run_skill`** — calls `_execute_agent_turn` directly, never traversing `do_POST`. Skill runs do NOT retain. Same as today.
  - **`delegate_to_workspace_tool` / `mode:agent` skills / `as_tool()` agents** — sub-agents run via `Agent.__call__` inside the parent's `_execute_agent_turn`. No retain fires from these paths; the parent's single `do_POST`-level retain captures the user-visible turn that contains them.
  - This enumeration is the load-bearing mechanism for R4 (sub-agent isolation) and R11 (skill runs don't retain). Don't move the retain call into `_execute_agent_turn` — it would break both at once.
- **Runtime-driven retain usage NOT captured** in `hindsight_usage`. The current monkey-patches never captured it — the Lambda calls Hindsight's HTTP API directly from TypeScript, never through the Python `Hindsight` client. R7's premise was wrong; dissolving cleanly. If future cost attribution is needed, add Lambda-side cost-event emission as a separate plan.
- **No Strands hook usage in this plan.** All usage capture lives inside `@tool` bodies. We don't add hook infrastructure for sub-agent attribution either; the plan addresses sub-agent isolation by keeping the runtime-driven retain at the chat handler level only.
- **Auto-retain stays at the `do_POST` chat handler call site, not inside `_execute_agent_turn`.** This naturally excludes skill-run dispatch (which calls `_execute_agent_turn` from `run_skill_dispatch.py`) and sub-agents (which run via `Agent.__call__` inside `delegate_to_workspace_tool.py`).
- **Drop-in replacement for `retain_turn_pair`.** The new `retain_full_thread` (in `api_memory_client.py`) preserves the exact best-effort + `try/except` + warning-log + return-False contract. Same defense-in-depth.

---

## Open Questions

### Resolved During Planning

- **Q: How does the runtime get the full transcript when `messages_history` is capped at 30?** → Lambda fetches from `messages` table by `threadId`. Runtime ships what it has (up to ~32 messages) plus identifying fields; Lambda assembles the canonical full transcript from DB. Keeps runtime engine-agnostic.
- **Q: Strands hook surface for `AfterToolInvocationEvent` (origin R4)?** → Hooks exist (`AfterToolCallEvent` in `strands.hooks` since v1.x graduation) but **cannot see `RetainResponse.usage`** — the @tool decorator wraps non-`str` returns via `model_dump_json()` before the event fires, and the vendored Hindsight tools return `str` already. Pivot: replace the vendored retain `@tool` with a custom wrapper that captures usage in its body. Cleaner than hooks, no Strands version bump required.
- **Q: How to capture runtime-driven retain Bedrock usage (origin R7 — note: distinct from this plan's R7, which captures origin R8's frozen-contract requirement)?** → Premise was wrong: the existing monkey-patches never captured it. The `memory-retain` Lambda calls Hindsight's HTTP API directly from TypeScript, never through the Python client. There's nothing to preserve. **Origin R7 dissolved**; plan accepts that runtime-driven retain LLM cost is observable only via Hindsight infrastructure metrics for now (see Risks & Dependencies for the named follow-up trigger).
- **Q: `Event` vs `RequestResponse` invocation for runtime-driven retain?** → `Event`. Per-turn cadence makes `RequestResponse` latency prohibitive. Idempotency is structural. Plan `2026-04-24-001`'s `RequestResponse` choice was for the boundary-cadence design; this plan supersedes that decision for the per-turn design.
- **Q: Does the `messages_history` payload field exist and carry full-shape messages?** → Yes. `payload["messages_history"]` is a `list[{role, content}]`, role ∈ {user, assistant}, capped at 30 by `chat-agent-invoke.ts` (`HISTORY_LIMIT = 30`). See `server.py:1936-1951`.
- **Q: Does `HindsightAdapter.retainConversation` already implement the target shape?** → Yes. `document_id=threadId`, `update_mode=replace`, `context="thinkwork_thread"`, role/timestamp-prefixed transcript, full metadata. Already routed to from the Lambda's `if (adapter.retainConversation)` branch. No adapter changes needed; only Lambda-side full-history fetch.
- **Q: Sub-agent retain rule enforcement?** → Natural consequence of keeping the auto-retain call at the `do_POST` chat handler level. Sub-agents run via `Agent.__call__` inside `delegate_to_workspace_tool.py` and never traverse the chat handler. Skill runs go through `run_skill_dispatch.dispatch_run_skill` (which calls `_execute_agent_turn` directly, bypassing the chat handler) and likewise don't auto-retain. No flag, no opt-out logic needed.

### Deferred to Implementation

- Exact Drizzle/SQL query for full-history fetch in the Lambda (U1) — knowable when reading `packages/database-pg/src/schema/messages.ts` during U1 implementation. Order ASC by `created_at`, filter by `threadId`. Likely a thin helper alongside other thread queries.
- Whether the runtime-side `retain_turn_pair` shape needs to be deleted vs deprecated-with-warning. If any other caller exists outside the runtime container, deprecate; otherwise delete. Verified during U2.
- Exact wording of the structured log line emitted on retain success / failure (per `oauth-binding-2026-04-21` learning recommending row-count logs). Format: `[hindsight-adapter] retainConversation ok bank=<prefix> thread=<prefix> turns=<n> bytes=<n>`.
- Whether to set `MaximumRetryAttempts=0` on the `memory-retain` Lambda's resource policy (per `project_async_retry_idempotency_lessons`). Replace mode is idempotent under retries, so 2 retries is safe; default is fine. Defer unless dev observability shows duplicate-document symptoms.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
                                                  ┌─ DROPPED in U6 ─────────────────┐
                                                  │  Hindsight.retain_batch          │
BEFORE                                            │  Hindsight.aretain_batch         │
                                                  │  Hindsight.reflect               │
runtime turn ─┐                                   │  Hindsight.areflect              │
              │                                   │   (module-scope monkey-patches)  │
              ▼                                   └──────────────────────────────────┘
   server.py do_POST
      │
      ├──► _execute_agent_turn ──► agent loop ─┬─► [vendor retain @tool] ─► Hindsight.retain_batch
      │                                        │      └─ patched to push usage ─► _usage_log
      │                                        ├─► [custom hindsight_recall] ─► Hindsight.arecall (no usage)
      │                                        └─► [custom hindsight_reflect] ─► Hindsight.areflect
      │                                                  └─ patched to push usage ─► _usage_log
      │
      ├──► drain _usage_log ──► hindsight_usage[] ──► response
      │
      └──► api_memory_client.retain_turn_pair ──► [Event] memory-retain Lambda
                                                       └─► HindsightAdapter.retainConversation
                                                              └─► HTTP POST /memories
                                                                  (only the latest pair! BUG)


AFTER

runtime turn ─┐
              │
              ▼
   server.py do_POST
      │
      ├──► _execute_agent_turn ──► agent loop ─┬─► [custom retain @tool]   ──► client.aretain_batch
      │                                        │      └─ pushes response.usage ─► _usage_log    (U4)
      │                                        ├─► [custom hindsight_recall] ─► client.arecall (no usage)
      │                                        └─► [custom hindsight_reflect] ─► client.areflect
      │                                                  └─ pushes response.usage ─► _usage_log (U5)
      │
      ├──► drain _usage_log ──► hindsight_usage[] ──► response  (shape unchanged)
      │
      └──► api_memory_client.retain_full_thread ──► [Event] memory-retain Lambda
                                                       ├─► fetch full transcript by threadId       (U1)
                                                       └─► HindsightAdapter.retainConversation
                                                              └─► HTTP POST /memories
                                                                  (full thread, document_id=threadId, replace)
```

**Cost-events shape (frozen):** `[{phase, model, input_tokens, output_tokens}]` — drained from `_usage_log` by `_call_strands_agent`, bubbled through `_execute_agent_turn` → chat-completion response → `chat-agent-invoke.ts:614-654` → `recordHindsightCost` → `cost_events`. Empty list tolerated. No schema or shape changes.

---

## Implementation Units

- U1. **Lambda full-thread fetch in `memory-retain`**

**Goal:** When the `memory-retain` Lambda is invoked with a `threadId`, fetch the canonical full thread transcript from the `messages` table and pass that to `adapter.retainConversation` instead of (or in addition to) the messages shipped in the event payload. Eliminates the destructive truncation that would otherwise happen on threads >30 turns.

**Requirements:** R1, R2, R3.

**Dependencies:** None.

**Files:**
- Modify: `packages/api/src/handlers/memory-retain.ts`
- Test: `packages/api/src/handlers/memory-retain.test.ts` (new)

**Approach:**
- After resolving `tenantId`/`userId`/`threadId` and the active engine adapter, if the adapter implements `retainConversation` AND `threadId` is present, call a new helper `fetchThreadTranscript(db, tenantId, threadId)` that returns `Array<{role: "user" | "assistant", content: string, createdAt: string}>` in ASC order. **The SQL query MUST filter on BOTH `tenant_id` AND `thread_id`** (`WHERE thread_id = $threadId AND tenant_id = $tenantId`) — `thread_id` is a non-secret UUID, and a confused-deputy `Event` invoke with a forged `threadId` could otherwise return another tenant's transcript. The cross-tenant rejection is a regression-guarded test scenario below.
- **Merge the runtime-supplied tail with the DB fetch.** `event.transcript` carries the latest user/assistant pair from the runtime, which may not yet be committed to the `messages` table when the Lambda runs (the writer that inserts the just-finished assistant row commits asynchronously relative to the runtime's `Event` invoke). Concatenate DB rows (canonical for already-committed turns) with any tail entries from `event.transcript` whose `(role, content, createdAt)` aren't already at the tail. Dedup by that triple. This closes the messages-table-commit-vs-Lambda-fire race.
- **R2 satisfied here:** the existing `HindsightAdapter.retainConversation` already implements `document_id=threadId, update_mode=replace`, role/timestamp-prefixed transcript, and metadata. This unit only adds the Lambda-side full-history fetch + tail merge — no adapter changes.
- If the merge produces zero rows (rare: thread deleted, brand-new thread, AND empty `event.transcript`), no-op and return `{ ok: false, error: "no_content" }` rather than calling the adapter with nothing.
- If `threadId` is absent (e.g., daily-memory `kind: "daily"` event), bypass the fetch entirely and route as today.
- Snapshot ENV resolution at handler entry (`feedback_completion_callback_snapshot_pattern`).
- Log a one-line success record per `oauth-binding-2026-04-21`: `[memory-retain] retainConversation ok bank=<prefix> thread=<prefix> turns=<n> bytes=<n>` with bank/thread prefixes (first 8 chars) only — never the full IDs in logs.
- **Logging hygiene:** Warning logs (zero-row fallback, error paths) MUST NOT include message content. Log only `threadId` prefix, `tenantId` prefix, turn count, and byte length. The existing `memory-retain.ts` plain-text identifier log line at the handler entry (`tenant=`, `user=`, `thread=` untruncated) is an open follow-up to tighten — see Risks & Dependencies.
- **Tenant anomaly is ERROR-level, not WARNING.** If the DB fetch returns rows whose `tenant_id` does not match the event's `tenantId` (defense-in-depth — the predicate above should already prevent this), emit a structured ERROR log so the Lambda DLQ + CloudWatch alarm can fire. `Event` invocation hides errors from the runtime, so DLQ alarms are the only operator surface.

**Patterns to follow:**
- `packages/api/src/lib/memory/adapters/hindsight-adapter.ts` lines 221-247 — `retainConversation` shape (no changes here, just confirms the input format).
- `packages/api/src/lib/memory/adapters/hindsight-adapter.test.ts` — vitest mock pattern: `vi.hoisted()` for `getDb`, `vi.spyOn(globalThis, "fetch")` for HTTP.

**Test scenarios:**
- Happy path: event with `threadId` and 32 messages in DB → adapter receives 32 messages in ASC order. *Covers AE1, AE5.*
- Happy path: DB has 30 messages (turns 1-15), `event.transcript` has the latest user/assistant pair (turn 16) not yet committed → merged transcript has 32 messages with the runtime tail appended. *Covers MERGE1 — the messages-table commit-vs-Lambda-fire race.*
- Happy path: DB has 32 messages including the latest pair (write committed before Lambda fired), `event.transcript` repeats the same pair → dedup by `(role, content, createdAt)` keeps the merged transcript at 32. No double-counting.
- Happy path: event with `threadId` and 0 messages in DB but non-empty `event.transcript` → adapter receives the 2 messages from `event.transcript` and a warning is logged. (New thread.)
- **Tenant-scope rejection (S1):** event with `threadId=T-X` but `tenantId=A` where T-X actually belongs to tenant B → `fetchThreadTranscript` returns zero rows because the WHERE clause filters by both. Falls through to the `event.transcript` path (which carries A's content from the runtime). *Pins the tenant-scope predicate against regression; an attacker who guesses or harvests `threadId` cannot extract another tenant's transcript via the Lambda.*
- **Tenant anomaly defense-in-depth:** test that injects rows whose `tenant_id != tenantId` into the fetch result → handler emits ERROR log, returns `{ ok: false, error: "tenant_anomaly" }` without calling the adapter. (Won't happen in production with the predicate in place; this guards future query refactors.)
- Happy path: `kind: "daily"` event with no `threadId` → bypasses fetch entirely, calls `retainDaily` (today's path). *Covers R2 contract.*
- Happy path: adapter is AgentCore (no `retainConversation`) → falls back to today's `retainTurn` path with `event.messages` unchanged. *Confirms AgentCore engine is untouched.*
- Edge case: `threadId` present but `event.transcript` empty AND DB returns zero → no-op, return `{ ok: false, error: "no_content" }` without calling adapter.
- Edge case: DB query throws → catch, log warning (no message content), fall back to `event.transcript`. Never propagate the error to the caller.
- Integration: when merged transcript exceeds 100 messages, the adapter receives all of them in order — no silent capping. (Plan does not impose a cap; defer if observability shows runaway documents.)
- Error path: adapter throws on `retainConversation` (e.g., Hindsight 5xx) → handler returns `{ ok: false, error: ... }`; caller decides what to do.

**Verification:**
- `pnpm --filter @thinkwork/api test memory-retain` passes.
- Manual: in dev, send a thread to 5 turns, then 30 turns, then 50 turns; query the user's Hindsight bank by `document_id`; one document with the **full** transcript content present at each checkpoint.

---

- U2. **`retain_full_thread` in `api_memory_client.py` (replaces `retain_turn_pair`)**

**Goal:** Add a new entry point in the Strands runtime's bridge to the `memory-retain` Lambda. Sends `{tenantId, userId, threadId, transcript}` where transcript is `messages_history + current user pair + assistant response`, fire-and-forget Event invoke. Preserves `retain_turn_pair`'s best-effort never-raises contract.

**Requirements:** R1, R2, R3, R5.

**Dependencies:** None for landing inert. U1 should land before U3 swaps the call site, so U2 is also a soft prerequisite for U3.

**Files:**
- Modify: `packages/agentcore-strands/agent-container/container-sources/api_memory_client.py`
- Test: `packages/agentcore-strands/agent-container/test_api_memory_client.py` (new)

**Approach:**
- Add `retain_full_thread(thread_id, transcript, tenant_id=None, user_id=None) -> bool`.
- Snapshot `MEMORY_RETAIN_FN_NAME`, `TENANT_ID` / `_MCP_TENANT_ID`, `USER_ID` / `CURRENT_USER_ID` at call entry (`feedback_completion_callback_snapshot_pattern`).
- Reject early (return `False` with debug log) if any of: function name unset, `thread_id` empty, transcript empty, tenant unset, user unset.
- Build payload `{"tenantId": tenant, "userId": user, "threadId": thread_id, "transcript": list(transcript)}`. Note: NO `agentId` — origin §retain is user-scoped (consistent with existing `retain_conversation`).
- Use `InvocationType="Event"` (fire-and-forget). Do NOT switch to `RequestResponse` — see Key Technical Decisions.
- Wrap the boto3 invoke in `try/except Exception` returning `False` with a warning log; never raise.
- Choice: rename existing `retain_conversation` to `retain_full_thread`, OR add `retain_full_thread` as a thin alias and leave `retain_conversation` as dead-code. Prefer **rename** to keep one entry point. The existing `retain_conversation` is unused (no production callers; confirmed during planning).
- Decide during U2: delete `retain_turn_pair` (zero callers after U3) or keep as deprecated. Default: delete — `feedback_decisive_over_hybrid`.

**Execution note:** Test-first. Land the new function with passing tests in this unit; the chat handler still uses `retain_turn_pair` until U3 flips the call site.

**Patterns to follow:**
- Existing `retain_turn_pair` (lines 29-86) — same shape minus `agentId`, plus full transcript.
- Existing `retain_conversation` (lines 89-111) — payload shape; switch invocation type from `RequestResponse` to `Event`.
- `_invoke_request_response` helper structure can be discarded (or kept and parallel `_invoke_event` helper added — match whichever yields cleaner tests).

**Test scenarios:**
- Happy path: env populated, valid 5-message transcript → boto3.lambda.invoke called once with `InvocationType="Event"`, correct `FunctionName`, correct JSON-encoded payload. Returns `True`. *Covers AE1.*
- Happy path: 50-message transcript → same shape, no truncation. *Covers AE5.*
- Edge case: `thread_id=""` → returns `False` without calling boto3. No log noise above debug.
- Edge case: `transcript=[]` → returns `False` without calling boto3.
- Edge case: `MEMORY_RETAIN_FN_NAME` unset → returns `False`, debug log only. (Production doesn't have this; tests do.)
- Edge case: `TENANT_ID` and `_MCP_TENANT_ID` both unset → returns `False`, debug log.
- Error path: boto3 raises (network failure, IAM denied) → returns `False` with WARNING log including thread prefix. *Covers AE4 — never propagates.*
- Snapshot regression: env vars unset between snapshot and invoke → snapshot value used; no re-read of `os.environ`. (Mirror `test_snapshot_params_override_empty_env` pattern from `run_skill_dispatch` tests.)

**Verification:**
- `uv run pytest packages/agentcore-strands/agent-container/test_api_memory_client.py` all pass.
- `retain_full_thread` is the only public entry point added; if `retain_turn_pair` is deleted, `grep -r "retain_turn_pair" packages/agentcore-strands/` returns zero hits except the test file (if any retained for migration reference) and CHANGELOG.

---

- U3. **Swap `do_POST` chat handler to call `retain_full_thread`**

**Goal:** Replace the `retain_turn_pair(thread_id, user_message, assistant_response, tenant_id)` call at `server.py:2185` with a `retain_full_thread(thread_id, transcript=[...], tenant_id, user_id)` call where transcript is assembled from `payload["messages_history"] + [user, assistant]`. Move the auto-retain firing to live behavior.

**Requirements:** R1, R2, R3, R4, R5, R11.

**Dependencies:** U1 (Lambda must accept the new payload shape — but Lambda already routes `event.transcript` through `retainConversation`, so U1 is technically a strict ordering requirement only when verifying production behavior). U2 (the new entry point must exist).

**Files:**
- Modify: `packages/agentcore-strands/agent-container/container-sources/server.py` (lines 2173-2193 region)
- Test: `packages/agentcore-strands/agent-container/test_server_chat_handler_retain.py` (new — focused contract test for the call site, mocking `api_memory_client.retain_full_thread`)

**Approach:**
- At the existing retain-firing block in `do_POST`, build `transcript` from:
  1. The validated `messages_history` list (already filtered to `{role, content}` shape).
  2. Append `{"role": "user", "content": message}` (the validated current user message).
  3. Append `{"role": "assistant", "content": response_text}` (just returned from `_execute_agent_turn`).
- Call `api_memory_client.retain_full_thread(thread_id=ticket_id, transcript=transcript, tenant_id=tenant_id, user_id=user_id)`. Resolve `user_id` from the same env path as `_load_nova_act_key` and other identity sites — `USER_ID` or `CURRENT_USER_ID`.
- Keep the outer `try/except Exception as retain_err: logger.warning(...)` around the call — defense-in-depth (per existing pattern at `server.py:2191-2193`).
- Do NOT move this into `_execute_agent_turn`. The location IS the sub-agent / skill-run isolation mechanism (R4, R11).
- Remove the import of `retain_turn_pair` if U2 deleted it.

**Execution note:** Land alongside a mock-based contract test that asserts the exact `(thread_id, transcript=[...], tenant_id, user_id)` arguments passed to `retain_full_thread`. Don't rely on existing server tests catching this.

**Patterns to follow:**
- The existing `try/except` block at `server.py:2183-2193`.
- Skill-dispatch path's NON-call to retain (`run_skill_dispatch.py:454`) — confirms the call site choice is correct.

**Test scenarios:**
- Happy path: 3-turn thread (history=4 messages, current+response=2) → `retain_full_thread` called with transcript of length 6, correct ordering (user, assistant, user, assistant, user, assistant). *Covers AE1.*
- Happy path: brand-new thread (history=[], current+response=2) → transcript of length 2.
- Edge case: `messages_history` payload missing → empty list assumed; transcript = [user, assistant].
- Edge case: `messages_history` contains non-`user`/`assistant` roles (e.g., system) → already filtered out by validator; transcript only contains user/assistant. (Pre-existing invariant from server.py:1942-1951.)
- Edge case: `response_text` empty (rare; agent returned no content) → still call retain with the user message as the only new content. (Hindsight reprocesses gracefully.)
- Error path: `retain_full_thread` raises (shouldn't, given U2's contract) → outer try/except logs warning; response still returned to user. *Covers AE4.*
- Sub-agent isolation regression: a turn that includes a `delegate_to_workspace_tool` call internally → `retain_full_thread` called exactly ONCE for the whole turn, not once per sub-agent invocation. *Covers AE2.*
- Skill-run path (`run_skill_dispatch`) → `retain_full_thread` NOT called. (Probably exercised by test_run_skill_dispatch.py; assert by mock-call-count if needed.)

**Verification:**
- All existing server tests still pass.
- `grep "retain_turn_pair" packages/agentcore-strands/agent-container/` returns zero hits (assuming U2 deletion).
- Manual smoke in dev: 5-turn thread → exactly one Hindsight document for that thread, matching `document_id=<thread_id>`, full transcript content.

---

- U4. **Custom retain `@tool` wrapper with in-body usage capture**

**Goal:** Replace the vendored `hindsight_strands.tools.retain` with a custom async `@tool` wrapper that calls `client.aretain_batch(...)` directly, captures `response.usage` to the per-process `_usage_log` via `hindsight_usage_capture._push("retain", retain_model, response.usage)`, and returns the same `str` shape the vendor tool returned (`"Memory stored successfully."` or similar). The model-facing tool name and signature are unchanged.

**Requirements:** R6, R7 (preserves contract), R9 (keeps the agent-callable retain tool), R10 (recall/reflect structure preserved).

**Dependencies:** None for landing inert (the module has no consumers until tools registration at agent boot).

**Files:**
- Modify: `packages/agentcore-strands/agent-container/container-sources/hindsight_tools.py`
- Test: `packages/agentcore-strands/agent-container/test_hindsight_tools.py` (extend)

**Approach:**
- In `make_hindsight_tools(...)`, drop the `vendor_factory(... enable_recall=False, enable_reflect=False)` call. Replace the lone vendor retain tool with a custom `@strands_tool async def retain(content: str) -> str:` wrapper that:
  1. Creates a fresh `Hindsight` client via `client_factory()` (mirrors recall/reflect pattern).
  2. Calls `client.aretain_batch(bank_id=hs_bank, items=[{"content": content, "tags": list(hs_tags or [])}])` (or whichever batch shape matches `hindsight-client>=0.4.22` — verify during U4 implementation against the installed package).
  3. Reads `response.usage` (TokenUsage with `input_tokens`, `output_tokens`).
  4. Calls `hindsight_usage_capture._push("retain", retain_model, response.usage)` where `retain_model` is read from `HINDSIGHT_API_RETAIN_LLM_MODEL` env (default `"openai.gpt-oss-20b-1:0"`, mirroring existing patch defaults). Snapshot at registration time, not per-call (closure capture).
  5. Returns a model-facing string identical to what the vendor returned (capture during U4; likely `"Memory stored successfully."`).
  6. `try/except` retry semantics matching the existing `hindsight_recall` / `hindsight_reflect` wrappers (3 attempts on transient errors, exponential backoff).
  7. `await _close_client(client, tool_name="retain")` in `finally`.
- Remove the `vendor_factory` parameter from `make_hindsight_tools` if no other tool relies on it. (Or keep it as a test seam if it simplifies tests.)
- Keep the docstring agent-facing — the model uses it to decide when to call retain. Match the tone/intent of the vendor tool's docstring ("Store information to long-term memory…"). Coordinate with `feedback_hindsight_recall_reflect_pair` if you touch the recall/reflect docstrings (U5).

**Execution note:** Land alongside a Strands-decorator-stubbed test that asserts the new retain tool calls `_push("retain", model, usage)` exactly once per successful retain, regardless of vendor-tool absence. Mirror the `_FakeClient` pattern from existing `test_hindsight_tools.py`.

**Patterns to follow:**
- Existing `hindsight_recall` (`hindsight_tools.py:92-178`) and `hindsight_reflect` (`hindsight_tools.py:180-232`) — async + fresh client + retry + `finally aclose`.
- `_close_client` helper (lines 81-90).
- `_is_transient_error` helper (lines 20-31).

**Test scenarios:**
- Happy path: fake client returns `aretain_batch` response with `usage(input_tokens=42, output_tokens=10)` → tool returns success string AND `_push` called once with `("retain", retain_model, usage)`. *Covers AE3.*
- Happy path: fresh client per call (calling retain twice produces two factory invocations).
- Edge case: response has no `usage` attr → `_push` NOT called; tool still returns success. (Defense for client lib variance.)
- Error path: `aretain_batch` raises transient `(503)` → retry once, succeed on second; `_push` called exactly once.
- Error path: `aretain_batch` raises non-transient → returns error string without crashing; `_push` NOT called.
- Closure-snapshot regression: change `os.environ["HINDSIGHT_API_RETAIN_LLM_MODEL"]` after registration → tool still uses the original model name. (Mirror `test_make_hindsight_tools_snapshots_env` style.)
- Tool-list regression: `make_hindsight_tools` returns `(retain, hindsight_recall, hindsight_reflect)` in that order, with the names `retain` / `hindsight_recall` / `hindsight_reflect`. Existing `test_make_hindsight_tools_returns_vendor_and_custom_async_tools` asserts a similar shape — update the assertion.
- Empty-config short-circuit: `make_hindsight_tools(strands_tool, hs_endpoint="", hs_bank="")` returns `()` — already covered by `test_make_hindsight_tools_missing_endpoint_degrades_to_empty_tuple`. Re-run.

**Verification:**
- `uv run pytest packages/agentcore-strands/agent-container/test_hindsight_tools.py -v` all pass.
- `grep "vendor_factory\|hindsight_strands" packages/agentcore-strands/agent-container/container-sources/hindsight_tools.py` returns zero matches (after U4 + U6 cleanup).

---

- U5. **Add usage capture inside `hindsight_reflect` wrapper**

**Goal:** Read `response.usage` from `client.areflect(...)` inside the existing custom reflect wrapper and push it to `_usage_log`. Mirrors U4 for the reflect path. `hindsight_recall` is untouched — it has no LLM cost.

**Requirements:** R6, R7 (preserves contract), R10 (structure preserved).

**Dependencies:** None.

**Files:**
- Modify: `packages/agentcore-strands/agent-container/container-sources/hindsight_tools.py` (the existing `hindsight_reflect` body, lines 180-232)
- Test: `packages/agentcore-strands/agent-container/test_hindsight_tools.py` (extend)

**Approach:**
- Inside the `hindsight_reflect` body, after `response = await client.areflect(...)` and before reading `response.text`, call `hindsight_usage_capture._push("reflect", reflect_model, getattr(response, "usage", None))`. The push helper already no-ops on `None`/zero-token usage.
- Snapshot `reflect_model` at registration time alongside `retain_model` from U4, reading `HINDSIGHT_API_REFLECT_LLM_MODEL` env (default `"openai.gpt-oss-120b-1:0"` per existing `install()` defaults).
- Do NOT touch `hindsight_recall` — recall uses local embeddings + Postgres, no Bedrock cost (origin §Background).

**Patterns to follow:**
- Same as U4's helpers.
- Existing `hindsight_reflect` wrapper structure stays intact; this is a one-line insert plus an env snapshot.

**Test scenarios:**
- Happy path: `areflect` returns response with `usage(input_tokens=80, output_tokens=120)` → tool returns `response.text`, AND `_push` called once with `("reflect", reflect_model, usage)`.
- Edge case: response has no `usage` → `_push` NOT called; tool still returns text.
- Snapshot regression: change `HINDSIGHT_API_REFLECT_LLM_MODEL` env after registration → snapshot value used.
- Recall non-regression: `hindsight_recall` does NOT call `_push` — assert by mock that the recall path leaves `_usage_log` empty.

**Verification:**
- `uv run pytest packages/agentcore-strands/agent-container/test_hindsight_tools.py::test_hindsight_reflect_pushes_usage` passes.
- All existing reflect tests still pass.

---

- U6. **Retire `hindsight_usage_capture.install()`; keep `install_loop_fix()`; preserve `_push` / `drain` / `reset`**

**Goal:** Delete the `install()` function and its four method-replacement patches on `Hindsight.retain_batch` / `aretain_batch` / `reflect` / `areflect`. Keep `_push`, `_lock`, `_usage_log`, `drain`, and `reset` as the module's public surface — U4 and U5 call `_push` directly. The `install_loop_fix()` patch on `hindsight_client._run_async` stays unchanged (vendor SDK bug workaround, separate scope per origin R9).

**Requirements:** R8.

**Dependencies:** U4 and U5. Once they push directly via `_push`, the monkey-patches are redundant. Land U6 in the same PR or immediately after to avoid a window where usage is double-counted (patches push AND custom tools push).

**Files:**
- Modify: `packages/agentcore-strands/agent-container/container-sources/hindsight_usage_capture.py`
- Modify: `packages/agentcore-strands/agent-container/container-sources/server.py` (line 1064 — remove `hindsight_usage_capture.install()` call; keep `install_loop_fix()` and `reset()`)
- Test: `packages/agentcore-strands/agent-container/test_hindsight_usage_capture.py` (new — covers `_push` / `drain` / `reset` semantics, idempotency)

**Approach:**
- Delete the `install()` function body and its `_installed` global. Update the module docstring to reflect that usage is captured by `@tool` wrappers, not by patching the Hindsight client.
- Keep `install_loop_fix()` exactly as-is. Update its docstring to explicitly call out it is a vendor SDK workaround scoped separately from the integration model, citing the SDK upgrade as the long-term fix.
- Keep `_push`, `_lock`, `_usage_log`, `drain`, `reset` unchanged.
- In `server.py`, at lines 1061-1067:
  - Keep `install_loop_fix()` call.
  - Keep `reset()` call (clears `_usage_log` at agent registration time so prior-invoke residue doesn't leak).
  - **Remove** `install()` call.
- Run `grep -r "hindsight_usage_capture.install" packages/agentcore-strands/agent-container/` after U6 — only `install_loop_fix` references should remain.

**Patterns to follow:**
- Existing `_push` / `drain` / `reset` (`hindsight_usage_capture.py:51-67, 198-209`).

**Test scenarios:**
- Happy path: `_push("retain", "model-x", TokenUsage(input_tokens=10, output_tokens=5))` → `drain()` returns `[{"phase": "retain", "model": "model-x", "input_tokens": 10, "output_tokens": 5}]` and `_usage_log` is now empty. *Covers AE3, R7 contract.*
- Happy path: multiple pushes accumulate; one drain returns all in order; second drain returns `[]`.
- Edge case: usage with `input_tokens=0` and `output_tokens=0` → push no-ops (existing `_push` early-returns when both are ≤0).
- Edge case: usage object is `None` → push no-ops without raising.
- Edge case: malformed usage object (no `input_tokens` / `output_tokens` attrs) → push no-ops; warning logged.
- Idempotency: `install_loop_fix()` called twice → second call returns `False`, no double-patching.
- Concurrency: parallel pushes on same lock → all entries appear; no drops. (Use `threading.Thread` in the test.)
- Non-regression: `install()` and its `_installed` global no longer exist. Importing the module does NOT patch `Hindsight.*` methods (assert by checking `Hindsight.aretain_batch is original_aretain_batch` after import).
- **Equivalence with prior monkey-patch behavior (A5):** simulate a representative turn that calls `retain` 2× and `reflect` 3× through the new in-body push path. Assert `_usage_log` accumulates exactly 5 entries with the same `(phase, model, input_tokens, output_tokens)` tuples that the prior `install()` patch would have produced. Pins the cost-events row count contract — protects against drift between in-body push frequency and patched-push frequency (e.g., if `aretain_batch` internally retries at a layer the patch saw differently from the wrapper).

**Verification:**
- `uv run pytest packages/agentcore-strands/agent-container/test_hindsight_usage_capture.py` passes.
- `grep -E "Hindsight\.(retain_batch|aretain_batch|reflect|areflect)\s*=" packages/agentcore-strands/agent-container/container-sources/` returns zero matches.
- `hindsight_client._run_async` is still patched (loop fix retained).
- Cost-events end-to-end: in dev, run a turn that calls `retain` and `reflect`; assert the `cost_events` table has one row each with the correct phase/model/tokens. (Manual integration check.)

---

## System-Wide Impact

- **Interaction graph:** The chat handler `do_POST` → `_execute_agent_turn` → drain → response path is unchanged in shape; only the auto-retain block at the end of `do_POST` switches Lambda entry point. Sub-agents and skill runs are unaffected because they don't traverse `do_POST`.
- **Error propagation:** Best-effort failure semantics are preserved at three layers: `retain_full_thread` returns `False` on any failure (never raises); the `do_POST` outer `try/except` logs and continues; the Lambda's `Event` invocation type means runtime never sees adapter-side errors (acceptable per Key Decisions). Custom `@tool` wrappers retain the existing 3-attempt-with-backoff retry on transient errors.
- **State lifecycle risks:** Per-turn upsert with `replace` is idempotent under retries — `MaximumRetryAttempts=2` (Lambda default) is safe. A future flip to `update_mode=append` would re-introduce double-ingest risk; guarded by an adapter unit test (deferred to U1's test plan as a regression assertion: `expect(call.update_mode).toBe("replace")`).
- **API surface parity:** The `chat-agent-invoke.ts` cost-events consumer contract (`hindsight_usage[]` shape) is byte-identical. The `MemoryRetainEvent` shape gains an effectively-mandatory `threadId` for the Hindsight `retainConversation` path; AgentCore engine still works without it. No breaking changes for downstream consumers.
- **Integration coverage:** Two scenarios that pure unit tests cannot prove and need to be verified manually in dev:
  - One Hindsight document per thread after a 30-turn conversation (long enough to exceed the runtime's `messages_history` cap and force the U1 DB-fetch path).
  - One `cost_events` row per agent-driven retain call after the monkey-patch removal (proves U4 + U5 + U6 wired correctly).
- **Unchanged invariants:**
  - `MemoryRetainEvent` structure and `MemoryRetainResult` shape are additive — `transcript` field already exists in the schema.
  - `HindsightAdapter.retainConversation` body is untouched; the change is purely "what messages are passed in."
  - `AgentCoreAdapter.retainTurn` is untouched; AgentCore engine continues to work via the `retainTurn` fallback.
  - `hindsight_recall` recall semantics, retrieval filter, and docstring stay intact (R10).
  - `chat-agent-invoke.ts:614-654` cost-event write loop is untouched.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Per-turn replace destroys turns 1-N when `messages_history` is truncated to last 30 by `chat-agent-invoke.ts` | U1 fetches full transcript from `messages` table by `threadId` before passing to `retainConversation`. Acceptance test asserts a 50-turn thread retains all 50 turns in the document. |
| Adapter throws or Hindsight is unreachable mid-turn | Three layers of best-effort: `retain_full_thread` `try/except`, the `do_POST` outer `try/except`, and `Event` invocation type means even a 5xx propagates only via the Lambda DLQ — never to the user. |
| Window where U4 pushes via `_push` AND `install()` is still patched → double-counted usage | Land U4 + U5 + U6 in the **same PR** (or U6 immediately follows in a follow-up commit before merge). Don't ship U4 + U5 to main without U6. |
| Strands SDK or `hindsight-client` SDK ships a breaking rename of `aretain_batch` / `areflect` / `arecall` | Existing `feedback_hindsight_async_tools` constraint already pins to current async surface. Add an import-time assertion in `hindsight_tools.py` if drift becomes a recurring issue (deferred). |
| Dev observability: no per-thread document inspection tooling exists | U1 emits a structured log line per retain success (`bank=<prefix> thread=<prefix> turns=<n> bytes=<n>`). Operators can verify via CloudWatch insight queries during dev verification. |
| Origin R7 (runtime-driven retain usage capture) was based on a wrong premise — silently dropping it could surprise stakeholders | Plan explicitly documents the dissolution under Open Questions §Resolved. Cost attribution for runtime-driven retain LLM calls is a separate plan (Hindsight infrastructure metrics serve as interim observability). |
| **Concurrent turns on the same thread (A1)** — rapid double-send, wakeup colliding with chat, retry of a slow turn while a new turn arrives → two `Event`-invoked Lambdas fire for the same `document_id`. `replace`-mode is idempotent only when both invocations carry the same intended end state, which they don't when fired from different turns; out-of-order Lambda execution leaves a stale doc until the next turn writes again. | **Accepted eventual-consistency window**: each subsequent turn upserts again, so the worst case is one turn's worth of stale recall. U1's DB-fetch + tail-merge means the later Lambda always sees at least as much content as the earlier one; the only divergence is the latest pair. If observability shows persistent stale-doc symptoms, add an ordering token (e.g., `max(messages.created_at)` from the DB fetch) to the upsert; the Lambda no-ops if the token is older than the last-known good timestamp. |
| **Event invoke silently drops Lambda errors (S2)** — including any tenant-isolation anomaly detected during U1's fetch. Operators have no runtime-side visibility into Lambda-side failures. | U1 emits structured ERROR (not WARNING) on tenant-mismatch and Hindsight 5xx. Configure Lambda DLQ + CloudWatch alarms on (a) DLQ depth > 0, (b) ERROR-level log count > N per minute. DLQ + alarm is the only operator surface for `Event` invocations; not optional. |
| **Lambda trusts payload `tenantId`/`userId` from runtime env (S4)** — no IAM-identity-to-tenant binding is verified inside the Lambda. | **Trust model**: the AgentCore execution role is per-tenant (verify during U1 implementation against the Terraform `agentcore-runtime` module). The Lambda's IAM resource policy restricts invocation to that per-tenant role, so the tenantId in the payload is bound to the principal at invoke time. **If this binding is shared across tenants** (one execution role for all AgentCore agents), document the accepted risk in this row and open a follow-up to scope it. The U1 tenant-scope predicate provides defense-in-depth regardless. |
| **Existing `memory-retain.ts` plain-text identifier logging (S3 follow-up)** — the handler entry log line at lines 121-124 already emits full untruncated `tenant=`, `user=`, `thread=` to CloudWatch. This plan only constrains NEW logs added in U1. | Out of scope for this plan. Open a separate small PR to tighten the existing log to prefix-only. Not blocking. |
| **Per-turn full-thread reprocess cost at scale (MERGE2 / P2+A9)** — `update_mode=replace` ("delete the previous version and reprocess from scratch") fires on every turn. At 4 enterprises × 100+ agents × N-turn threads, retain-LLM volume scales with O(turns × thread_length). | Add dev-stage observability: emit per-retain `bytes_in`, `tokens_used`, and `extraction_latency_ms` to CloudWatch metrics. Set a daily Hindsight retain spend dashboard before Phase 2 deploys to prod. Revisit boundary-cadence (only retain every N turns OR on idle) if observed cost trajectory exceeds budget. The brainstorm's "every-turn replace" decision is explicit; this risk row makes the cost contract observable. |
| **Per-tenant cost attribution lost for runtime-driven retain (P1 product)** — the dissolution of origin R7 means runtime-driven retain extraction-LLM calls aren't attributed in `cost_events`. Per-turn cadence increases that volume vs the superseded boundary design. | Track Lambda-side cost-event emission as a named follow-up plan. **Trigger condition**: monthly Hindsight retain spend per enterprise exceeds a tenant-attributable threshold, OR before the 4-enterprise GA milestone, whichever comes first. Until then, Hindsight infrastructure metrics serve as aggregate (not per-tenant) observability. |

---

## Phased Delivery

Per `feedback_ship_inert_pattern` and `inert-to-live-seam-swap-pattern`, split into three PRs to keep blast radius small and rollback boundaries clean:

### Phase 1 — Lambda full-history fetch + new runtime entry point (inert)

- U1 (Lambda fetch)
- U2 (`retain_full_thread` in `api_memory_client.py`)

Both are inert: the Lambda already routes `transcript` to `retainConversation` correctly, so U1 just adds the DB-fetch enrichment which is no-op when called with today's per-pair payload. U2 is unused until Phase 2. Tests prove both work in isolation.

### Phase 2 — Live swap

- U3 (chat handler call site swap)

The single behavioral change. Once merged and deployed to dev, every chat turn upserts the full thread to Hindsight via U1's enriched path. Verify with the dev smoke test (5-turn → 30-turn → 50-turn checkpoints).

**Deploy ordering invariant (A4):** Phase 1 (U1 + U2) must be **deployed AND verified live** in each stage (dev → prod) before Phase 2 deploys to that stage. Phase 1 is "inert" relative to user-visible behavior, but Phase 2's correctness depends on Phase 1 being LIVE — without U1's full-history fetch + tail merge, U3 will silently truncate every thread to the runtime's last-30-message cap, replacing prior turns with stale content on every turn. **Add a deploy-runbook gate:** before tagging Phase 2 for a stage, confirm the stage's `memory-retain` Lambda includes the U1 fetch path (e.g., grep deployed Lambda code for `fetchThreadTranscript` or run the U1 cross-tenant-rejection smoke test). Do not cherry-pick U3 forward without U1 in any environment.

### Phase 3 — Custom retain `@tool` + monkey-patch retirement

- U4 (custom retain wrapper)
- U5 (reflect usage capture)
- U6 (`install()` removal, `install_loop_fix` preserved)

Land all three in the same PR (avoid the double-count window). Verify with cost_events row counts matching tool invocations during a dev session.

---

## Documentation / Operational Notes

- After Phase 2 deploy: in dev, send a 50-turn thread, query `cost_events` for `phase IN ('retain', 'reflect')` rows by `tenantId` for that turn, query Hindsight bank for `document_id=<threadId>` and confirm the document content includes all 50 turns. If turns 1-N are missing, U1 has a bug.
- After Phase 3 deploy: confirm `cost_events` rows continue to land with non-zero token counts on agent-driven retain/reflect calls. If counts drop to zero, U4/U5 in-body capture has a bug.
- Rollback story: each phase is independently revertible. Phase 2's revert restores `retain_turn_pair` calls (still in code post-U2 if U2 keeps it; deleted if U2 chose deletion — in which case the revert restores it). Phase 3's revert restores `install()` and the monkey-patches. None of the phases create migrations or schema changes.
- No CHANGELOG / release-note callout needed — internal infra change with no user-visible behavior shift beyond "memory recall improves on long threads after Phase 2."

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-27-hindsight-retain-lifecycle-and-integration-requirements.md](../brainstorms/2026-04-27-hindsight-retain-lifecycle-and-integration-requirements.md)
- **Earlier related brainstorm:** `docs/brainstorms/2026-04-24-hindsight-retain-reshape-and-daily-memory-requirements.md` (wire format origin)
- **Superseded boundary-cadence plan:** `docs/plans/2026-04-24-001-refactor-user-scope-memory-and-hindsight-ingest-plan.md` (this plan adopts per-turn cadence over boundary flush)
- **In-flight bank-merge plan:** `docs/plans/2026-04-26-007-fix-hindsight-legacy-bank-merge-and-wiki-rebuild-plan.md` (orthogonal; provides legacy bank reconciliation)
- Related code: `packages/agentcore-strands/agent-container/container-sources/{server.py, api_memory_client.py, hindsight_tools.py, hindsight_usage_capture.py, delegate_to_workspace_tool.py, run_skill_dispatch.py}`
- Related code: `packages/api/src/handlers/{memory-retain.ts, chat-agent-invoke.ts}`, `packages/api/src/lib/memory/adapters/{hindsight-adapter.ts, agentcore-adapter.ts}`, `packages/api/src/lib/hindsight-cost.ts`
- External docs: [Hindsight retain API](https://hindsight.vectorize.io/developer/api/retain), [Hindsight Strands integration](https://hindsight.vectorize.io/sdks/integrations/strands), [Strands hooks user guide](https://strandsagents.com/docs/user-guide/concepts/agents/hooks/)
- Institutional learnings cited inline above from `docs/solutions/` and project memory

---

## Deferred / Open Questions

### From 2026-04-27 review

These items surfaced during ce-doc-review but are not blocking. They're recorded here so /ce-work can pick them up at implementation time, or so a follow-up reviewer / planner sees them.

**P2 — surfaced in plan body (above), tracked here for visibility:**
- **Equivalence test for in-body usage push** — see U6 test scenarios (added). Pins that retain×N + reflect×M turns produce the same `_usage_log` entries the prior monkey-patch would have, guarding against drift between in-body push and patched-push timing.
- **Per-turn cost analysis at enterprise scale** — see Risks & Dependencies (added). Per-turn full-thread reprocess cost; CloudWatch metrics + daily spend dashboard before Phase 2 prod deploy.
- **Per-tenant cost attribution loss** — see Risks & Dependencies (added). Named follow-up plan with explicit trigger conditions.
- **Deviation note: Strands hook → custom @tool wrapper** — see Key Technical Decisions (added). Origin R4 reshape based on planning research.

**FYI (anchor 50) — non-blocking observations:**
- **Cost-events shape is stated twice** (Scope Boundaries `Cost-events sink schema and chat-agent-invoke consumer — frozen` + High-Level Technical Design `Cost-events shape (frozen): [{phase, model, input_tokens, output_tokens}]`). Minor consolidation opportunity; both are correct, no functional issue.
- **Runtime engine-agnosticism nuance** — R2 says the runtime ships transcript that the Lambda will use; U1 makes the Lambda always re-fetch from DB and merge. The runtime-supplied tail is the merge fallback for the messages-table commit race (per the updated R3), not vestigial — but worth noting the asymmetry between R2's claim and U1's behavior. If a future reader is confused, point them at MERGE1.
- **PII / data-classification statement for Hindsight** — full conversation transcripts are now sent to Hindsight on every turn. Confirm this is authorized under existing data-processing agreements with Vectorize/Hindsight; document Hindsight's `forget` API or bank-deletion as the retention/deletion mechanism. Likely already covered by the existing Hindsight integration's terms; just not stated in this plan.
- **Loop-fix interaction with `client.aretain_batch`** — verify during U4 implementation whether `aretain_batch` traverses any of the call sites `install_loop_fix()` patches (`hindsight_client._run_async`). If yes, custom retain inherits the fix correctly. If no (clean async path), there's no regression but document the cleaner path so a future reader doesn't think the loop fix is load-bearing for the wrapper.
- **Verify "no other callers" before deletion** — before U2 deletes `retain_turn_pair` and `retain_conversation`, run `rg "retain_turn_pair|retain_conversation" packages/agentcore-strands/ -t py` and confirm zero hits outside test files. Quick verification step in U2's implementation.
