---
title: "feat: Company Brain first-party context tool"
type: feat
status: active
date: 2026-06-14
origin: Linear THNK-23 requirements and plan documents
linear: THNK-23
---

# feat: Company Brain first-party context tool

## Overview

Expose Company Brain to first-party Pi agents as a dedicated `query_brain_context` tool registered by the existing Context Engine extension. The tool remains a Context Engine forwarder: Pi does not connect to raw Cognee, Neptune, S3, ontology admin APIs, or a separate Brain MCP server.

The implementation also keeps the progressive Brain result shape planned for THNK-23: initial Brain calls return an indexed shortlist with concise descriptions and stable ids/indexes; follow-up calls use the same tool with selected `detailIds` or `detailIndexes` plus the original query/filter arguments.

---

## Problem Frame

The API MCP facade already exposes `query_brain_context`, and THNK-20 delivered active/default Company Brain reads behind Context Engine. First-party Pi agents still expose only `query_context`, `query_memory_context`, and `query_wiki_context`, so models do not get a clear Brain-specific runtime affordance for tenant-shared business/domain context.

This work closes that runtime access gap without reopening Company Brain substrate, migration, operations UI, or external Brain MCP scope. Company Brain remains the customer-facing product, Context Engine remains the runtime policy facade, and raw backends remain internal.

---

## Requirements Trace

- R1. Register `query_brain_context` in the Pi Context Engine extension when Context Engine is enabled.
- R2. Include `query_brain_context` in AgentCore Pi runtime extension tool visibility and allowlist tests.
- R3. Preserve existing `query_context`, `query_memory_context`, and `query_wiki_context` behavior.
- R4. Forward `query_brain_context` to `/mcp/context-engine` with JSON-RPC method `tools/call` and params name `query_brain_context`.
- R5. Accept standard Context Engine fields: `query`, `mode`, `scope`, `depth`, and `limit`.
- R6. Expose Brain-scoped options accepted by the API facade where appropriate: `sourceKind`, `sourceType`, `datasetId`, `nodeSetIds`, `onlyContext`, `topK`, `detailIds`, and `detailIndexes`.
- R7. Make initial Brain results progressive: indexed shortlist, concise descriptions, provenance/status hints, and stable follow-up identifiers rather than full snippet dumps.
- R8. Support follow-up detail expansion through the same `query_brain_context` tool using selected identifiers or indexes.
- R9. Describe the tool as tenant-shared Company Brain/domain context, distinct from raw Hindsight Memory and compiled Wiki lookup.
- R10. Treat Company Brain plugin install as provider eligibility behind Context Engine, not raw runtime transport.
- R11. Preserve existing disabled/missing-config failure posture.
- R12. Cover registration, JSON-RPC forwarding, progressive shortlist, follow-up detail behavior, disabled/missing-config behavior, and runtime exposure in tests.
- R13. Update docs to mention first-party access through `query_brain_context` and preserve the internal-backend boundary.

**Origin actors:** A1 first-party Pi agent, A2 Pi Context Engine extension, A3 AgentCore Pi runtime, A4 Context Engine API MCP facade, A5 Company Brain plugin install, A6 implementing agent.

**Origin flows:** F1 Brain-specific runtime lookup, F2 plugin-enabled Brain provider eligibility, F3 Context Engine disabled or misconfigured.

**Origin acceptance examples:** AE1 runtime tool visibility, AE2 JSON-RPC forwarding with Brain filters, AE3 progressive shortlist and same-tool detail expansion, AE4 disabled/missing-config behavior, AE5 tool description routing, AE6 plugin install remains provider eligibility.

---

## Scope Boundaries

- Do not expose raw Cognee, Neptune, S3, ontology admin, Brain storage, or Brain write-back tools to first-party agents.
- Do not require a new first-party Brain MCP server registration for THNK-23.
- Do not make a bundled skill or workspace guidance file the access-control mechanism for Brain context.
- Do not change generic `query_context` provider defaults or existing Memory/Wiki split tool behavior.
- Do not reopen THNK-6 substrate, migration, operations UI, external Brain MCP, or production storage scope.
- Do not require deployed AWS smoke for this focused runtime exposure change.

### Deferred to Follow-Up Work

- Bundled Company Brain skill/workspace guidance if tool descriptions and docs do not prove sufficient to route models toward `query_brain_context`.
- Generalizing progressive shortlist/detail behavior to non-Brain Context Engine tools after the Brain contract has been validated.
- Live deployed dogfood smoke in a safe stage with real Brain data and credentials.

---

## Context & Research

### Relevant Code and Patterns

- `packages/api/src/handlers/mcp-context-engine.ts` already defines API-side `query_brain_context`, Brain provider option normalization, and the shared Context Engine MCP response formatter.
- `packages/api/src/lib/context-engine/types.ts` defines `ContextEngineResponse`, `ContextHit`, provider statuses, and Brain provider options.
- `packages/pi-extensions/src/context-engine.ts` owns Pi Context Engine split tool registration and JSON-RPC forwarding.
- `packages/pi-extensions/test/capabilities.test.ts` covers extension registration, forwarding body shape, desktop thread-turn auth, and disabled behavior.
- `packages/agentcore-pi/agent-container/src/server.ts` adds the Context Engine extension when `context_engine_enabled` is true.
- `packages/agentcore-pi/agent-container/tests/server.test.ts` asserts extension tool names seen by `runAgentLoop` and `buildInvocationResources`.
- `docs/src/content/docs/api/context-engine.mdx` documents the Context Engine API/runtime contract and Brain provider boundary.

### Institutional Learnings

- `docs/plans/2026-06-14-002-feat-context-engine-brain-reads-plan.md` keeps raw backend access out of first-party agent paths.
- `docs/plans/2026-06-14-004-feat-company-brain-remaining-substrate-plan.md` keeps migration-aware reads and operations UI in THNK-6 follow-up scope.
- `docs/solutions/best-practices/context-engine-adapters-operator-verification-2026-04-29.md` says provider-routed context should expose provider-local statuses without turning raw providers into normal peer tools.
- `docs/solutions/best-practices/defer-integration-tests-until-shared-harness-exists-2026-04-21.md` supports focused contract/unit coverage while leaving live deployed smoke optional.

### External References

- None. Local code and approved Linear requirements are sufficient.

---

## Key Technical Decisions

- Use the same tool for detail expansion. A follow-up `query_brain_context` call with `detailIds` or `detailIndexes` expands selected results without adding another model-visible tool.
- Keep progressive formatting at the API MCP facade. Pi forwards normalized arguments and renders API results; it does not reimplement Brain provider semantics.
- Expose Brain filters directly in the Pi schema so `sourceKind`, `sourceType`, `datasetId`, `nodeSetIds`, `onlyContext`, `topK`, `detailIds`, and `detailIndexes` are discoverable.
- Do not auto-enable Context Engine from Company Brain plugin install. Tool registration remains controlled by `context_engine_enabled`.
- Add no bundled skill in this slice. Start with a strong tool description and docs.

---

## Implementation Units

- U1. **Add progressive Brain MCP contract**

**Goal:** Make API-side `query_brain_context` return a progressive shortlist by default and expanded selected details when `detailIds` or `detailIndexes` are present.

**Requirements:** R4, R5, R6, R7, R8, R10, R12; covers F1, F2, AE2, AE3.

**Dependencies:** THNK-20 completed on main.

**Files:**

- Modify: `packages/api/src/handlers/mcp-context-engine.ts`
- Modify: `packages/api/src/lib/context-engine/types.ts`
- Test: `packages/api/src/handlers/mcp-context-engine.brain-progressive.test.ts`

**Approach:** Extend the API MCP input schema and request typing with `topK`, `detailIds`, and `detailIndexes`. For Brain-only initial calls, return text and structured content that prioritize index/id/title/summary/provenance/status hints over full snippets. For detail calls, replay the query and filter returned Brain hits by ids first, then 1-based indexes, reporting missing selectors explicitly.

**Patterns to follow:**

- Existing `brainProviderOptionsArg`, `formatContextResponse`, and Context Engine service query flow in `packages/api/src/handlers/mcp-context-engine.ts`.
- Source-data policy metadata from the Company Brain provider.

**Test scenarios:**

- Happy path: Brain-only call with multiple hits returns numbered shortlist entries and structured entries with ids but without full snippets.
- Happy path: `detailIds` returns expanded context only for selected hits.
- Happy path: `detailIndexes` returns expanded context for selected 1-based indexes.
- Edge case: both selector types are present; ids take precedence.
- Edge case: selected id/index is not found; response reports missing selectors without substituting another result.
- Regression: non-Brain `query_context`, `query_memory_context`, and `query_wiki_context` retain existing formatting.

**Verification:** Initial Brain calls are concise and indexable; detail calls expand only selected Brain results; Context Engine remains the only backend access path.

- U2. **Register Brain tool in Pi extension**

**Goal:** Add `query_brain_context` to the Pi Context Engine extension tool set with Brain-specific parameters, description, validation, normalization, and JSON-RPC forwarding.

**Requirements:** R1, R3, R4, R5, R6, R8, R9, R11, R12; covers F1, F3, AE1, AE2, AE4, AE5.

**Dependencies:** U1.

**Files:**

- Modify: `packages/pi-extensions/src/context-engine.ts`
- Test: `packages/pi-extensions/test/capabilities.test.ts`

**Approach:** Add the tool to `TOOL_NAMES` only when Context Engine is enabled. Share standard query params and add Brain-specific params. Forward to `jsonRpc("query_brain_context", ...)` with top-level Brain options matching the API facade. Preserve existing disabled and missing identity/config behavior.

**Patterns to follow:**

- Existing `query_memory_context` and `query_wiki_context` definitions.
- Existing JSON-RPC body assertions in `packages/pi-extensions/test/capabilities.test.ts`.

**Test scenarios:**

- Covers AE1: Context Engine enabled registers all four query tools.
- Covers AE2: Brain call with standard fields, Brain filters, `topK`, `onlyContext`, and detail selectors forwards `params.name = "query_brain_context"` and normalized arguments.
- Covers AE4: Context Engine disabled registers no Context Engine tools.
- Error path: empty Brain query returns `query_brain_context requires a non-empty query.` without calling fetch.
- Regression: existing split tool forwarding assertions still pass.

**Verification:** Pi exposes Brain only through the existing Context Engine capability and does not create raw Brain transport.

- U3. **Expose Brain tool through AgentCore Pi runtime**

**Goal:** Ensure AgentCore Pi runtime allowlists and resource-building tests make `query_brain_context` visible wherever Context Engine split tools are expected.

**Requirements:** R2, R3, R10, R11, R12; covers A3, F1, F3, AE1, AE4, AE6.

**Dependencies:** U2.

**Files:**

- Modify: `packages/agentcore-pi/agent-container/src/server.ts`
- Test: `packages/agentcore-pi/agent-container/tests/server.test.ts`

**Approach:** Update the Context Engine comment and runtime test expectations. The implementation should need no new runtime registration mechanics because `buildInvocationResources` already folds extension tool names into `extensionToolNames`.

**Patterns to follow:**

- Runtime extension allowlist tests in `packages/agentcore-pi/agent-container/tests/server.test.ts`.

**Test scenarios:**

- Covers AE1: `handleInvocation` with `context_engine_enabled: true` passes `query_brain_context` to `runAgentLoop`.
- Covers AE1: `buildInvocationResources` includes `query_brain_context` in extension tool names and not direct tools.
- Covers AE4: eval mode or disabled Context Engine excludes `query_brain_context` with the other Context Engine tools.

**Verification:** First-party Pi runtime visibly exposes `query_brain_context` when Context Engine is enabled.

- U4. **Document first-party Brain access**

**Goal:** Update docs so implementers and operators understand first-party Pi agents use `query_brain_context` through Context Engine, with progressive shortlist/detail behavior and no raw backend access.

**Requirements:** R9, R13; covers AE5, AE6.

**Dependencies:** U1, U2.

**Files:**

- Modify: `docs/src/content/docs/api/context-engine.mdx`
- Test expectation: none -- documentation-only behavior, verified by review and docs build if available.

**Approach:** Add runtime-facing text that Pi exposes `query_brain_context` when Context Engine is enabled. Document the progressive contract and preserve the raw backend boundary.

**Patterns to follow:**

- Existing Brain Provider and Runtime Tools sections in `docs/src/content/docs/api/context-engine.mdx`.

**Test scenarios:**

- Test expectation: none -- documentation-only behavior. Review should confirm docs mention first-party Pi access, progressive detail expansion, and internal backend boundary.

**Verification:** Docs clearly distinguish Brain, Memory, and Wiki split tools without implying raw backend access.

---

## System-Wide Impact

- **Interaction graph:** Pi model -> Context Engine extension -> `/mcp/context-engine` -> Context Engine service -> Company Brain provider -> progressive MCP response.
- **Error propagation:** empty query and invalid selectors fail at the tool/API boundary; provider availability stays provider-local; missing runtime config uses existing Context Engine failure posture.
- **State lifecycle risks:** no writes and no detail cache. Detail calls replay queries and may report missing selections if the underlying result set changed.
- **API surface parity:** API-side `query_brain_context` gains progressive fields that Pi consumes; generic `query_context`, `query_memory_context`, and `query_wiki_context` remain unchanged.
- **Unchanged invariants:** Context Engine remains the policy boundary; Company Brain plugin install does not create raw runtime transport; no raw Cognee/Neptune/S3/admin APIs are exposed.

---

## Risks & Dependencies

| Risk                                                                        | Mitigation                                                                                                                          |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Initial response still leaks full Brain snippets through structured content | Test text and structured shortlist shape; reserve full snippets for detail responses.                                               |
| Same-tool detail replay selects a different result after data changes       | Prefer stable hit ids and return explicit missing-detail statuses.                                                                  |
| New Brain tool changes existing split-tool behavior                         | Add regression assertions for existing tool names, forwarding, and disabled behavior.                                               |
| Model confuses Brain with raw Memory or Wiki                                | Use a strong tool description and docs that distinguish tenant-shared Brain/domain context from Hindsight Memory and compiled Wiki. |
| Scope expands into plugin install policy or raw Brain MCP                   | Keep registration gated only by `context_engine_enabled`.                                                                           |

---

## Documentation / Operational Notes

- No migration, deploy-time mutation, or manual Lambda update is required.
- Roll out through the normal PR-to-main deployment path.
- Safe-stage smoke can call `query_brain_context` once for a shortlist and once for detail expansion after merge if credentials and Brain data are available.

---

## Sources & References

- Linear issue: THNK-23.
- Linear document: `Requirements: Company Brain first-party agent context tool`.
- Linear document: `Plan: Company Brain first-party context tool`.
- Related Linear issues: THNK-6, THNK-20.
- Related plan: `docs/plans/2026-06-14-002-feat-context-engine-brain-reads-plan.md`.
- Related plan: `docs/plans/2026-06-14-004-feat-company-brain-remaining-substrate-plan.md`.
- Relevant code: `packages/api/src/handlers/mcp-context-engine.ts`.
- Relevant code: `packages/pi-extensions/src/context-engine.ts`.
- Relevant code: `packages/agentcore-pi/agent-container/src/server.ts`.
- Relevant docs: `docs/src/content/docs/api/context-engine.mdx`.
