---
date: 2026-04-27
topic: hindsight-retain-lifecycle-and-integration
---

# Hindsight Retain Lifecycle and Strands Integration Cleanup

## Problem Frame

The Strands AgentCore runtime currently retains memory in a way that fights both the Hindsight API's intended usage and the Strands SDK's extension model. Two distinct problems compound:

1. **Per-turn fragmentation.** After every agent turn, `_execute_agent_turn` async-invokes the `memory-retain` Lambda with one user/assistant pair. The Lambda's Hindsight adapter POSTs that pair to `/memories` with no `document_id`, so each turn becomes its own document. Hindsight's docs are explicit on this: *"A full conversation should be retained as a single item."* The current behavior creates N documents per thread, charges N retain-LLM extractions, and prevents Hindsight from using cross-turn context during fact extraction. This will compound badly as we scale to 4 enterprises × 100+ agents.

2. **Vendored monkey-patches.** `hindsight_usage_capture.py` patches `Hindsight.retain_batch / reflect / aretain_batch / areflect` at module scope to capture token usage for Bedrock cost attribution, and also patches `hindsight_client._run_async` to work around an upstream stale-loop bug. The first patch is doing tracing work that Strands' built-in hook system (`AfterToolInvocationEvent`) is purpose-built for — at least for agent-driven retain calls. The second patch is a vendor SDK bug workaround that's separate from the integration pattern.

The desired end state: one Hindsight document per ThinkWork thread (idempotent upserts as the thread grows), zero monkey-patches in our integration with Hindsight's normal SDK surface, and clean instrumentation for the runtime-driven retain path.

The vendor `hindsight-strands` SDK exposes `create_hindsight_tools()` returning callable Python tools — there is no separate "lifecycle hook" the SDK gives us; the integration model is just tool registration. The Strands SDK itself provides the hook system. So "use the built-in hooks" means *Strands hooks*, not Hindsight hooks.

---

## Actors

- A1. **Strands runtime (root)**: `_execute_agent_turn` in `server.py`. Owns the user-facing thread, currently fires `retain_turn_pair` per turn.
- A2. **Strands runtime (sub-agent)**: spawned via `delegate_to_workspace_tool` or `mode:agent` skills. Runs its own Strands agent loop *inside* a root invocation; never owns a user-facing thread.
- A3. **Agent model**: the LLM running inside A1 or A2. Can call the `retain` tool when it decides a fact is worth explicit promotion.
- A4. **`memory-retain` Lambda**: engine-agnostic dispatch layer in `packages/api`. Selects the active engine adapter (Hindsight or AgentCore managed) and invokes `adapter.retainTurn()` / `adapter.retainConversation()`.
- A5. **Hindsight service**: ECS-hosted vendor service. Extracts facts, builds the entity graph, owns memory storage.

---

## Key Flows

- F1. **Per-turn upsert (replaces today's per-turn retain)**
  - **Trigger:** A1 finishes `_execute_agent_turn` successfully (non-error response).
  - **Actors:** A1, A4, A5.
  - **Steps:**
    1. A1 builds the full thread transcript (all prior user/assistant pairs plus the current turn).
    2. A1 invokes A4 with `{ threadId, transcript, tenantId, userId, documentId: threadId, updateMode: "replace" }`.
    3. A4 dispatches to the active engine adapter; for Hindsight, posts to `/memories` with `document_id=threadId`, `update_mode=replace`.
    4. A5 deletes the prior version of that document and re-extracts facts from the current full transcript.
  - **Outcome:** Exactly one Hindsight document per thread, always reflecting the latest state. Token usage is captured at the call site for cost attribution.
  - **Covered by:** R1, R2, R3, R7, R10.

- F2. **Agent-driven explicit retain (preserved)**
  - **Trigger:** A3 decides a fact is worth promoting and calls the `retain` tool.
  - **Actors:** A1 or A2, A3, A5.
  - **Steps:**
    1. A3 calls the vendor `retain` tool registered by `make_hindsight_tools` (auto-generated `document_id`).
    2. The tool returns; Strands fires `AfterToolInvocationEvent`.
    3. The runtime's hook handler reads the response, captures `usage.input_tokens` / `usage.output_tokens`, appends to the per-invoke `hindsight_usage` list.
  - **Outcome:** Promoted fact lands in Hindsight as a separate small document; cost attribution is captured via the Strands hook, not via monkey-patch.
  - **Covered by:** R4, R8.

- F3. **Sub-agent isolation**
  - **Trigger:** A1 invokes a sub-agent via `delegate_to_workspace_tool` or a `mode:agent` skill.
  - **Actors:** A1, A2.
  - **Steps:**
    1. A2 runs its own Strands agent loop with its own tool surface.
    2. A2 may call the `retain` tool (F2) to promote specific facts; those calls go through A2's hook handler.
    3. When A2 finishes, A1 receives the sub-agent's output as a tool result and continues its own loop.
    4. Only A1's `_execute_agent_turn` triggers F1 — sub-agent transcripts are never auto-retained as separate documents.
  - **Outcome:** One document per user-facing thread; sub-agent reasoning stays as execution detail.
  - **Covered by:** R5.

---

## Requirements

**Per-turn upsert lifecycle**
- R1. The runtime SHALL upsert the **full thread transcript** to Hindsight after every successful root agent turn, using `document_id = thread_id` and `update_mode = "replace"`. The current behavior of POSTing one user/assistant pair per turn with no `document_id` is removed.
- R2. The Hindsight engine adapter in the `memory-retain` Lambda MUST translate the runtime's `{ threadId, transcript, ... }` payload into a single `client.retain(...)` call with `document_id=threadId`, `update_mode="replace"`, and a serialized transcript (role-prefixed, timestamp-prefixed lines). The `retain_turn_pair` adapter path is removed.
- R3. The runtime SHALL pass the full conversation history it already receives in the invocation payload (`history` field — see `_call_strands_agent` payload) directly to the upsert call, without an extra fetch.
- R5. Sub-agent invocations (delegated workspaces, `mode:agent` skills) SHALL NOT trigger F1. Only the root `_execute_agent_turn` retains transcripts. Sub-agent reasoning remains accessible only via the agent-driven retain path (F2) when explicitly promoted.
- R6. Failure of the upsert MUST NOT block the agent response. Retain failures log a warning and move on, matching today's `retain_turn_pair` behavior.

**Strands hooks for usage capture**
- R4. Bedrock token usage from agent-driven retain/reflect tool calls (F2) SHALL be captured via a Strands `AfterToolInvocationEvent` hook registered alongside `make_hindsight_tools`, not via module-level monkey-patches on the `Hindsight` class.
- R7. Bedrock token usage from runtime-driven retain (F1) SHALL be captured at the call site by reading `response.usage` from the `client.retain(...)` return value, then appending to the per-invoke `hindsight_usage` list. No monkey-patch on `retain` / `retain_batch` / `aretain_batch`.
- R8. The shape of the `hindsight_usage` list returned in `_execute_agent_turn`'s `strands_usage` dict MUST remain unchanged: `[{phase, model, input_tokens, output_tokens}]`. Downstream `chat-agent-invoke` cost-event writes are untouched.
- R9. The `install()` monkey-patch in `hindsight_usage_capture.py` is removed once R4 and R7 are live. The `install_loop_fix()` patch is **kept as-is** — it's a vendor SDK bug workaround unrelated to the integration model. A separate dependency-upgrade follow-up may retire it.

**Operational behavior**
- R10. The Hindsight document referenced by a thread SHALL be observable from the operator side: given a `thread_id`, an operator can query Hindsight and find exactly zero or one matching document. Acceptance verified by manual inspection in dev.
- R11. The agent-callable `retain` tool registered by `make_hindsight_tools` is **kept**. It remains available to the agent model for explicit "remember that the user prefers X" promotions and is registered for both root and sub-agents.
- R12. The `recall` and `reflect` tool wrappers in `hindsight_tools.py` are **unchanged**. They already match the desired async + fresh-client + retry pattern and are out of scope for this brainstorm.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given a thread with 5 prior turns and a 6th turn just completed, when `_execute_agent_turn` returns successfully, the Hindsight `/memories` POST contains the **full 6-turn transcript** as `content`, `document_id` equals the thread's UUID, and `update_mode` equals `"replace"`. Hindsight's response indicates the prior version of that document was deleted before re-extraction.

- AE2. **Covers R5.** Given a root agent turn that delegates to a sub-agent which itself runs 4 internal turns, when the root turn completes, exactly **one** Hindsight document exists referencing this thread. The 4 sub-agent turns produced **zero** additional Hindsight documents (unless the sub-agent's model called the `retain` tool explicitly — see AE3).

- AE3. **Covers R4, R8, R11.** Given an agent that calls `retain("user prefers email over Slack")` mid-thread, when the tool returns, the per-invoke `hindsight_usage` list contains one entry with `phase="retain"`, non-zero `input_tokens`/`output_tokens`, and the model name from the Hindsight retain LLM env var. The entry is appended via the `AfterToolInvocationEvent` hook handler — `hindsight_usage_capture.install()` is not loaded.

- AE4. **Covers R6.** Given Hindsight is unreachable when `_execute_agent_turn` finishes, the agent response is still returned to the caller within the same SLA, the upsert failure is logged as a warning with the thread id, and `hindsight_usage` is an empty list for that invocation.

- AE5. **Covers R10.** Given two distinct threads each with several turns, when an operator queries Hindsight `/documents?bank_id=user_X` for the user's bank, the response contains exactly two documents whose `document_id` values match the two thread ids.

---

## Success Criteria

- A long-running thread (≥10 turns) produces exactly one Hindsight document; recall queries against that document return synthesized facts that span turns instead of fragmented per-turn snippets.
- `grep -r "monkey" packages/agentcore-strands/agent-container/container-sources/` returns zero matches in `hindsight_usage_capture.py`'s `install()` body. The `_run_async` loop fix may remain (R9) until a separate SDK upgrade lands.
- Cost attribution per Bedrock retain/reflect call is preserved end-to-end: `hindsight_usage` entries continue to flow from the runtime → `chat-agent-invoke` → `cost_events` rows, with no observable schema change at the cost-events sink.
- `ce-plan` can implement this without inventing product behavior: the trigger ("after every successful root turn"), the document key (`document_id = thread_id`), the update mode (`"replace"`), the sub-agent rule (root-only), and the agent-tool fate (kept) are all settled here.

---

## Scope Boundaries

- Daily-memory retain (`api_memory_client.retain_daily`) is **not** changed. That path is already document-id-keyed by date and is fine.
- The `_run_async` monkey-patch in `hindsight_usage_capture.py` stays in place. Replacing it requires an `hindsight-client` SDK upgrade and is a separate piece of work.
- The `recall` and `reflect` custom wrappers in `hindsight_tools.py` are out of scope.
- Migrating the AgentCore-managed memory engine adapter is **not** part of this brainstorm — only the Hindsight adapter path needs the per-turn-pair → full-transcript change. AgentCore's adapter already operates at event granularity and is a different shape.
- Pruning, archival, or retention-policy work on the Hindsight bank itself (e.g., aging out old threads' documents) is deferred.
- No changes to the existing `chat-agent-invoke` Lambda or `cost_events` schema. The contract is the `hindsight_usage` list shape, which R8 freezes.
- Changes to the Pi parallel-substrate runtime (per recent commitment in memory) are out of scope; this brainstorm is for the existing Strands runtime.

---

## Key Decisions

- **Per-turn upsert with `document_id=thread_id` (replace mode), not "end-of-thread retain on close signal".** ThinkWork threads can stay open indefinitely (mobile sessions, wakeup-driven agents); waiting for an explicit close risks never retaining long threads. The simpler, drop-in pattern wins.
- **Replace mode every turn, not append-mode or sampled checkpoints.** Memory stays current with edits/corrections; cost is accepted as the simplicity premium and can be revisited if dev metrics show real spend.
- **Root thread only — sub-agent transcripts are not auto-retained.** Sub-agent reasoning is execution detail; auto-retaining it would clutter the bank, fan out cost, and noisy-up recall. Sub-agents can still call the `retain` tool explicitly when they have a fact worth keeping.
- **Keep the agent-callable `retain` tool.** Even with auto-upsert, explicit promotion is a useful signal — the model can flag a fact with its own context label and tags, and Hindsight may extract more specifically from a focused snippet than from a full transcript.
- **Scope the hook replacement to the integration model, not the SDK bug.** The `_run_async` loop fix is a vendor SDK workaround; conflating it with the hooks cleanup would block this work on an SDK upgrade.

---

## Dependencies / Assumptions

- The `_execute_agent_turn` invocation payload contains the full prior thread history (the comment at `server.py:1827` describes the request shape as `(history, user_id, thread_id, trigger_channel)`). **Verified** in `server.py`. Implementation will confirm the field name during planning.
- The `memory-retain` Lambda's Hindsight engine adapter currently has both a `retainTurn` and a `retainConversation` entry point (mirroring `api_memory_client.retain_turn_pair` and `retain_conversation`). The latter exists but is unused. **Verified** in `packages/agentcore-strands/agent-container/container-sources/api_memory_client.py`; the Lambda-side adapter shape is **unverified** and is a planning-time check.
- Strands SDK exposes `AfterToolInvocationEvent` (or equivalent) via a hook registry attached to the `Agent` instance. **Unverified against this repo's pinned Strands version** — planning will confirm the exact event class and registration API. If the hook surface differs, R4 may need a substitute (e.g., wrapping the tool callable at registration time, which is still cleaner than module-level monkey-patching).
- Hindsight's `update_mode="replace"` semantics match the docs ("Hindsight will delete the previous version and reprocess from scratch") for the version of Hindsight currently deployed on ECS. **Unverified** for our pinned Hindsight image; planning to confirm.
- Cost concern: a long thread (e.g., 50 turns) will pay retain-LLM cost on a 50-turn document on every turn. Accepted as the simplicity premium per Key Decisions; if dev observability shows this to be a real cost issue, sampled-checkpoint or append-mode are pre-vetted alternatives that can be adopted without a re-brainstorm.

---

## Outstanding Questions

### Resolve Before Planning

(none)

### Deferred to Planning

- [Affects R3][Technical] What is the exact field name in the `_execute_agent_turn` payload that carries prior thread history, and is it the full transcript or only the recent N? Confirm in code, not just from the comment.
- [Affects R2][Technical] Does the existing Hindsight engine adapter in `memory-retain` already accept a `transcript` payload shape, or does it need a new entry point? Read `packages/api`'s memory-retain handler and adjust.
- [Affects R4][Needs research] Confirm the Strands SDK hook surface — exact event class name (`AfterToolInvocationEvent`?) and how a hook handler is registered against the `Agent` instance. If hooks are unavailable in the pinned version, fall back to wrapping the tool callable at registration in `make_hindsight_tools` (still cleaner than module-level monkey-patch).
- [Affects R7][Technical] Where in `_execute_agent_turn` does the runtime-driven retain call return a `RetainResponse` from which `usage` can be read? `api_memory_client.retain_turn_pair` currently uses `InvocationType="Event"` (fire-and-forget) — to capture token usage we need either `RequestResponse` invocation, or have the Lambda emit usage to a separate sink, or accept that runtime-driven retain usage isn't metered. Plan to evaluate the trade-off.
- [Affects R6][Technical] If R7 requires `RequestResponse` invocation for usage capture, ensure the upsert latency is bounded (Hindsight retain extraction can take seconds) so it doesn't extend the agent's user-visible response time. Options: separate background thread inside the runtime, or keep `Event` invocation and accept that runtime retain usage is captured by the Lambda itself rather than returned to the runtime.
- [Affects R9][Technical] Is the `hindsight_client` SDK upgrade that fixes the stale-loop bug feasible inside this PR's scope, or does it deserve its own dependency-upgrade PR? Plan to scope.

---

## Next Steps

-> /ce-plan for structured implementation planning
