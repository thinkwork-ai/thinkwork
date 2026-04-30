---
title: "feat: Scout-style Company Brain source agent runtime"
type: feat
status: active
date: 2026-04-30
origin:
  - docs/brainstorms/2026-04-29-company-brain-v0-requirements.md
  - docs/plans/2026-04-29-004-feat-company-brain-v0-plan.md
  - docs/plans/2026-04-30-002-feat-company-brain-hybrid-retrieval-plan.md
---

# feat: Scout-style Company Brain source agent runtime

## Overview

Build the first real Scout-style Company Brain source agent runtime: a bounded
model/tool loop that uses a source-specific prompt, an explicit allowed tool
surface, iterative tool calls, trace output, and cited normalized hits.

The current Company Brain source-agent substrate is useful but not agentic. The
compiled wiki Page Agent plans deterministic query paths and runs fast retrieval.
That should remain available as a reliable fallback, but the product needs at
least one source agent that actually behaves like the Scout pattern the user
called out: a provider exposes a simple source-specific query surface, while the
source agent behind it owns the source's quirks, navigation, follow-up, and
citation logic.

This plan focuses on the compiled Company Brain page source first. Operational
source agents for ERP, CRM, support, and catalog remain planned until their
connectors and read tools exist.

## Problem Frame

Company Brain currently says "source agent" in places where the runtime is still
deterministic retrieval. That creates two problems:

- Operators cannot tell whether they are seeing a true model/tool agent loop or
  a fast retrieval helper.
- The product does not yet demonstrate the Scout-style idea: source-specific
  agents running behind simple context-provider tools, hiding source quirks from
  the main agent.

Scout's public README frames the pattern as "navigation over search" and says a
single agent has multiple context providers, each exposing natural-language
`query_<source>` / `update_<source>` tools while a sub-agent behind each provider
owns source quirks such as pagination, thread lookup, or writes. This plan adapts
that pattern to ThinkWork's existing AWS-native Context Engine rather than
copying Scout's stack.

## Requirements Trace

- R1. The Company Brain Page Agent can run in a real model-backed mode that calls
  allowed source tools iteratively before producing results.
- R2. The model-backed mode uses a source-specific system prompt that describes
  the compiled wiki resource, retrieval strategy, citation requirements, and
  completion criteria.
- R3. The runtime exposes a narrow allowlist of typed tools, initially
  `company-brain.pages.search` and `company-brain.pages.read`.
- R4. Each tool call is validated against the allowlist and recorded in an
  execution trace with tool name, input summary, output summary, status, and
  duration.
- R5. The runtime enforces a depth/pass cap so source agents cannot loop
  indefinitely or fan out unbounded work.
- R6. The source agent returns cited normalized `ContextHit` objects through the
  existing Context Engine router.
- R7. If the model output is malformed, empty, uncited, or fails to call tools
  usefully, the provider degrades safely and may fall back to deterministic
  retrieval with trace metadata explaining the fallback.
- R8. The operator test surface shows enough metadata to distinguish
  deterministic retrieval from a true model-backed source-agent run.
- R9. E2E tests prove that the model-backed adapter calls tools, iterates, emits
  trace, and returns cited results.
- R10. Existing direct wiki search, Hindsight bridge, workspace search, and
  deterministic Page Agent behavior do not regress.

## Scope Boundaries

### In Scope

- A model/tool source-agent runtime in `packages/api`.
- A live Company Brain Page Agent model-backed path using the compiled wiki.
- Source-agent trace metadata in API result metadata and admin full-result
  inspection.
- Unit/integration tests using injected fake model and fake tools.
- Browser verification on the Admin Company Brain Sources page.

### Out of Scope

- Making ERP, CRM, support, or catalog source agents live.
- Adding write-capable source agents.
- Replacing deterministic hybrid wiki retrieval.
- Running source agents inside AgentCore or the Strands/Pi VM for this slice.
- Adding a persistent trace table. Trace can be per-response metadata for this
  first implementation.
- Adding embeddings/vector search.

## Context and Research

### Relevant Code

- `packages/api/src/lib/context-engine/router.ts` already runs selected
  providers in parallel with per-provider timeouts and normalized statuses.
- `packages/api/src/lib/context-engine/types.ts` defines `ContextHit`,
  `ContextProviderDescriptor`, provider statuses, and sub-agent descriptor
  metadata.
- `packages/api/src/lib/context-engine/providers/sub-agent-base.ts` owns the
  current sub-agent provider wrapper and has an unused `invokeSubAgent` helper
  that only makes a single model call and does not execute tools.
- `packages/api/src/lib/context-engine/providers/wiki-source-agent.ts` owns the
  current deterministic Company Brain Page Agent and should become the first
  source-agent runtime consumer.
- `packages/api/src/lib/wiki/search.ts` is the source-local retrieval primitive
  for compiled pages.
- `packages/api/src/lib/wiki/bedrock.ts` provides Bedrock Converse invocation,
  JSON parsing, retry helpers, and model usage metadata.
- `packages/api/src/lib/context-engine/__tests__/sub-agent-provider-e2e.test.ts`
  currently proves deterministic source-agent seam behavior and is the natural
  home for model/tool loop coverage.
- `apps/admin/src/routes/_authed/_tenant/knowledge/context-engine.tsx` renders
  the provider configuration dialog and should expose model-backed runtime
  details without overpromising.
- `apps/admin/src/lib/context-engine-api.ts` carries provider metadata into the
  admin client.

### Institutional Learnings

- `docs/solutions/best-practices/context-engine-adapters-operator-verification-2026-04-29.md`
  requires provider hit count, latency, skipped/degraded state, and target
  binding to be visible so no-hit results are inspectable.
- `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md`
  supports keeping planned adapters inert while swapping one bounded seam live.
- `docs/solutions/best-practices/activation-runtime-narrow-tool-surface-2026-04-26.md`
  requires exact tool allowlists and runtime refusal outside the approved surface.
- `docs/solutions/logic-errors/mobile-wiki-search-tsv-tokenization-2026-04-27.md`
  supports preserving the existing compiled wiki search helper instead of
  inventing a second retrieval implementation.

### External Reference

- `https://github.com/agno-agi/scout` describes the product pattern this plan
  follows: context providers expose simple source tools, while sub-agents behind
  them navigate source-specific quirks and return cited results. ThinkWork should
  adopt the pattern, not the implementation stack.

## Key Technical Decisions

1. **Model-backed source-agent runtime in `packages/api`, not AgentCore for this
   slice.** Context Engine is already a Lambda/API feature, and the Page Agent's
   source tools are Postgres-backed API helpers. Running the first loop in
   `packages/api` keeps tests deterministic and avoids a container deploy loop.
   AgentCore remains the future path for larger tool surfaces or longer-running
   operational adapters.

2. **Tools are source-local functions, not arbitrary MCP calls.** The first
   runtime registers typed tools for compiled pages only:
   `company-brain.pages.search` and `company-brain.pages.read`. The runtime
   refuses undeclared tools before execution and records that refusal in trace.

3. **Use a JSON action loop over Bedrock Converse.** Each model turn returns a
   JSON object with either `tool_calls` or `final`. The runtime parses with the
   existing Bedrock JSON helpers, executes allowed calls, appends tool
   observations, and loops until `final` or depth cap. This avoids relying on
   provider-specific tool-calling APIs while still giving us real iterative
   behavior.

4. **Final output is structured and cited.** The final JSON contains result
   objects with `page_id`, `title`, `summary`, `source_tool_call_ids`, and
   `confidence`. The adapter converts these into `ContextHit`s only when the page
   id was actually observed by a prior allowed tool call.

5. **Deterministic fallback remains explicit.** If the model path fails,
   times out, exceeds depth, returns uncited pages, or emits invalid JSON, the
   provider can fall back to deterministic retrieval. The provider status reason
   and hit metadata must say `fallback: deterministic-retrieval` so operators can
   distinguish this from a model-backed run.

6. **Trace is per-response metadata in v1.** Store trace under provider status
   metadata or hit metadata for the admin full-result dialog. A dedicated trace
   table is deferred until traces need retention, filtering, or cost accounting.

7. **Admin labels must stay honest.** The Page Agent configuration dialog should
   show either `Deterministic retrieval seam` or `Bedrock Converse source-agent
   loop`, depending on provider configuration/result metadata.

## Implementation Units

### Unit 1: Source-agent runtime primitives

**Goal:** Introduce a reusable bounded model/tool loop for source agents.

**Files**

- Modify: `packages/api/src/lib/context-engine/types.ts`
- Modify: `packages/api/src/lib/context-engine/providers/sub-agent-base.ts`
- Add: `packages/api/src/lib/context-engine/providers/source-agent-runtime.ts`
- Add: `packages/api/src/lib/context-engine/providers/source-agent-runtime.test.ts`

**Approach**

- Define `SourceAgentTool`, `SourceAgentToolCall`, `SourceAgentTraceStep`, and
  `SourceAgentFinalResult` types.
- Implement `runSourceAgentLoop({request, config, prompt, tools, model, depthCap})`.
- The model dependency is injectable for tests and defaults to Bedrock Converse.
- Parse model responses as JSON actions:
  - `{"tool_calls":[{"id":"call-1","tool":"company-brain.pages.search","input":{...}}]}`
  - `{"final":{"answer":"...","results":[...]}}`
- Validate tool names against `config.toolAllowlist`.
- Execute tool calls sequentially per model turn; keep the router-level provider
  parallelism unchanged.
- Enforce depth cap and timeout budget.
- Return `{hits, trace, state, reason, fallbackRequested}` to providers.

**Test Scenarios**

- A fake model calls `company-brain.pages.search`, then
  `company-brain.pages.read`, then returns a cited final result.
- A fake model attempts an unallowed tool and the runtime refuses it without
  executing anything.
- Invalid JSON returns an error/fallback result without throwing past the
  provider boundary.
- Depth cap stops a model that keeps requesting tools.
- Trace records model turns, tool calls, durations, and final status.

### Unit 2: Company Brain page source tools

**Goal:** Give the Page Agent real source-local tools over compiled wiki pages.

**Files**

- Modify: `packages/api/src/lib/context-engine/providers/wiki-source-agent.ts`
- Add: `packages/api/src/lib/context-engine/providers/wiki-source-agent-tools.ts`
- Modify: `packages/api/src/lib/wiki/search.ts` if a page read helper is missing
- Add or modify: `packages/api/src/lib/context-engine/__tests__/sub-agent-provider-e2e.test.ts`

**Approach**

- Implement `company-brain.pages.search` as a typed wrapper over
  `searchWikiForUser`.
- Implement `company-brain.pages.read` as a typed page reader that can only read
  page ids returned by prior search observations in the same runtime execution.
- Return compact observations to the model: page id, title, summary, aliases,
  section headings, cited source refs, and score.
- Keep full page bodies out of the prompt unless the model explicitly reads a
  page.
- Preserve tenant/user scope on every tool call.

**Test Scenarios**

- Search tool returns scoped page observations for a typo query.
- Read tool returns details only for a page observed in the current execution.
- Read tool refuses unseen page ids.
- Tool observations include enough source metadata to produce cited final hits.

### Unit 3: Model-backed Company Brain Page Agent provider

**Goal:** Replace the current "agent-shaped deterministic seam" with a real
model-backed runtime option while preserving deterministic fallback.

**Files**

- Modify: `packages/api/src/lib/context-engine/providers/wiki-source-agent.ts`
- Modify: `packages/api/src/lib/context-engine/providers/index.ts`
- Modify: `packages/api/src/lib/context-engine/__tests__/sub-agent-provider-e2e.test.ts`

**Approach**

- Add an option such as `runtimeMode: "model" | "deterministic" | "auto"` to the
  Page Agent provider factory.
- Default to model-backed mode for explicit Page Agent selection if required
  Bedrock/model configuration is available; otherwise use deterministic fallback
  with a clear status reason.
- Build a source-specific system prompt from the existing prompt/resources/skills
  metadata plus strict JSON action format.
- Convert final cited page ids into `ContextHit`s with:
  - `providerId: "wiki-source-agent"`
  - `family: "wiki"`
  - `metadata.sourceAgent.processModel = "lambda-bedrock-converse"`
  - `metadata.sourceAgent.trace`
  - cited tool call ids and observed page ids
- Keep deterministic retrieval as fallback and as a test-injectable mode.

**Test Scenarios**

- Explicit `wiki-source-agent` query invokes fake model, calls tools, returns a
  cited page hit, and records `processModel: "lambda-bedrock-converse"`.
- Malformed model final output falls back to deterministic retrieval and reports
  the fallback reason.
- Missing `userId` still skips the provider.
- Router provider status shows hit count, duration, and model-backed reason.

### Unit 4: Admin trace and runtime visibility

**Goal:** Make the operator surface prove whether the Page Agent actually ran a
model/tool loop.

**Files**

- Modify: `apps/admin/src/lib/context-engine-api.ts`
- Modify: `apps/admin/src/routes/_authed/_tenant/knowledge/context-engine.tsx`
- Modify if needed: `apps/admin/src/components/ContextEngineSubAgentPanel.tsx`
- Modify if needed: `packages/api/src/handlers/mcp-context-engine.ts`

**Approach**

- Extend admin-side types for source-agent runtime metadata and trace.
- In provider cards/status, show model-backed vs deterministic mode using
  user-facing wording:
  - `Bedrock Converse source-agent loop`
  - `Deterministic retrieval seam`
- In the full-result dialog, show trace steps: model turn, tool call, tool
  result summary, final cited result.
- Avoid making trace a dense dashboard; it should answer "did it actually do
  anything?" during dogfood.

**Test Scenarios**

- Admin types compile with trace metadata present and absent.
- A model-backed result renders runtime process and trace steps.
- A deterministic fallback result renders fallback reason.
- Non-sub-agent providers still render normally.

### Unit 5: E2E and browser verification

**Goal:** Prove the Scout-style runtime end to end without depending on live
Bedrock behavior in unit tests.

**Files**

- Add or modify: `packages/api/test/integration/context-engine/company-brain-source-agent.e2e.test.ts`
- Modify: `packages/api/package.json` if a focused E2E script is missing
- Modify or add: `apps/admin/src/routes/_authed/_tenant/knowledge/context-engine.test.tsx` if a local render test harness exists

**Approach**

- Use fake model/tool tests for deterministic CI coverage.
- Add an environment-gated live test for deployed/dev Bedrock source-agent mode
  if the existing test setup already supports deployed API calls.
- Use Computer Use browser verification against
  `http://localhost:5174/knowledge/context-engine` after the dev server is
  running.

**Test Scenarios**

- Query `favorite restarant in paris` with Page Agent selected returns wiki hits.
- Full-result metadata shows a trace with at least one search tool call and one
  final cited result in fake-model E2E.
- Browser verification shows provider status text indicating a model-backed run
  or explicit deterministic fallback.

## Dependencies and Sequencing

1. Build source-agent runtime primitives first with fake model/tool tests.
2. Add compiled wiki source tools and page-read restrictions.
3. Wire the Page Agent provider to the runtime with deterministic fallback.
4. Expose trace/runtime metadata in admin.
5. Run API tests, admin build, browser verification, then PR.

## Risks and Mitigations

- **Model loops are slow or flaky.** Keep depth low, use small observations, and
  preserve deterministic fallback.
- **Model invents uncited pages.** Only convert final results whose `page_id`
  was observed through an allowed tool call.
- **Prompt/tool surface grows too broad.** Enforce allowlist validation in the
  runtime and keep operational adapters inert.
- **Trace leaks too much content.** Store summaries and ids in trace, not full
  source payloads or secrets.
- **Admin overpromises again.** Render the actual process model from result
  metadata, with fallback reason when applicable.

## Acceptance Checklist

- A source-agent runtime performs at least two model turns in tests: tool call
  then final.
- The Page Agent can return cited `ContextHit`s produced from observed tool
  output.
- Runtime trace is visible in API metadata and admin full-result inspection.
- Unsupported tools, invalid model output, and depth exhaustion are covered by
  tests.
- Deterministic fallback remains available and labeled honestly.
- Existing Company Brain retrieval tests still pass.
- Local admin dev server is available for user validation.
