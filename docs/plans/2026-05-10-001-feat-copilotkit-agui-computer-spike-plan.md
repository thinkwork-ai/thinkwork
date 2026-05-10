---
title: "feat: CopilotKit / AG-UI Computer foundation spike"
type: feat
status: active
date: 2026-05-10
origin: docs/brainstorms/2026-05-10-copilotkit-agui-computer-spike-requirements.md
---

# feat: CopilotKit / AG-UI Computer foundation spike

## Summary

Run a bounded decision spike that tests AG-UI/CopilotKit as the interaction
contract for Computer's Thread + Canvas experience while the Vercel AI Elements
path continues in parallel. The spike ships an experimental `apps/computer`
route that consumes typed AG-UI-shaped events from the existing ThinkWork
GraphQL/AppSync thread stream, renders transcript + run/tool lifecycle +
registered Canvas output, and writes a verdict document comparing the result
against the AI Elements direction.

This plan deliberately avoids a production Thread rewrite. It creates a
parallel route, maps existing ThinkWork events into a protocol-shaped client
model, and uses one real Computer scenario as the comparison bar.

---

## Problem Frame

The origin document frames the decision: Vercel AI Elements is useful UI
vocabulary, but AG-UI may be the better foundation because Computer needs
typed agent run events, tool progress, HITL, Canvas updates, and frontend state
coordination, not only chat bubbles. The applet pipeline has already shipped a
same-origin generated-TSX artifact substrate, but the new spike should test
whether registered component/tool-result GenUI can cover the first Canvas
scenario with less risk.

Planning premise: prove the interaction contract first. If AG-UI/CopilotKit
wins, a later production plan can rewrite the Thread page around it.

---

## Requirements Traceability

All origin requirements R1-R11 carry forward.

- R1/R4: Use one real Computer scenario and preserve comparison with the AI
  Elements path.
- R2/R3: Keep the spike parallel and preserve ThinkWork ownership of durable
  backend responsibilities.
- R5/R8: Evaluate typed AG-UI event modeling and visible diagnostic failure
  modes.
- R6/R7: Test registered Canvas components before arbitrary generated TSX, and
  render Canvas from the same interaction stream as transcript.
- R9/R10/R11: Produce pivot/reject criteria and a planning-ready verdict.

Origin flows: F1 real scenario, F2 comparison, F3 Canvas without arbitrary TSX.
Origin acceptance examples AE1-AE5 are mirrored in the test scenarios below.

---

## Scope Boundaries

- No production replacement of `TaskThreadView` or the default `/threads/$id`
  route.
- No CopilotKit Enterprise persistence, observability, or hosted runtime.
- No Terraform or AgentCore Runtime deployment change in this spike. The first
  pass adapts the existing AppSync `ComputerThreadChunkEvent` stream and
  persisted `computer_events`/`computer_tasks` data.
- No mobile implementation. The plan records React Native implications in the
  verdict only.
- No arbitrary generated TSX in the Canvas proof. Use registered ThinkWork
  components with validated props.
- No broad redesign of applet storage, artifact persistence, memory, auth,
  audit, or tenant boundaries.

---

## Context & Research

### Local Context

- `docs/brainstorms/2026-05-09-computer-ai-elements-adoption-requirements.md`
  is the baseline direction to compare against. It proposes AI Elements,
  `useChat`, and `UIMessage` as the end-to-end LLM UI shape.
- `docs/specs/computer-applet-contract-v1.md` is the active applet contract.
  It stores applet source/metadata through ThinkWork GraphQL/S3 and mounts
  same-origin TSX inside `apps/computer`.
- `apps/computer/src/components/computer/ComputerThreadDetailRoute.tsx`
  currently composes the thread route from GraphQL queries, AppSync
  subscriptions, optimistic user messages, and `useComputerThreadChunks`.
- `apps/computer/src/components/computer/TaskThreadView.tsx` currently owns
  transcript rendering, scroll behavior, the composer, streaming buffer, and
  thread activity rows.
- `apps/computer/src/lib/use-computer-thread-chunks.ts` currently accepts
  `{text}` chunks only and discards all unknown chunk shape. This is the
  smallest existing seam for adding typed experimental chunks.
- `packages/api/src/graphql/notify.ts` already publishes arbitrary JSON through
  `publishComputerThreadChunk`; the GraphQL subscription contract carries
  `chunk: AWSJSON`.
- `packages/database-pg/graphql/types/subscriptions.graphql` exposes
  `ComputerThreadChunkEvent` with `threadId`, `chunk`, `seq`, and
  `publishedAt`. No schema change is required for a typed JSON experiment.
- `packages/api/src/lib/computers/runtime-api.ts` records Computer task events
  and thread-turn completion. Existing `computer_events` rows are enough to
  render run/tool lifecycle in the experimental route.
- `packages/computer-stdlib` and `apps/computer/src/applets/*` already provide
  reusable primitives and an applet mounting substrate. The spike should reuse
  primitives, not create a second chart/table library.

### Institutional Learnings

- `docs/solutions/architecture-patterns/inert-first-seam-swap-multi-pr-pattern-2026-05-08.md`
  argues for observable inert states and body-swap tests when a feature spans
  substrate and consumer layers. This spike is intentionally kept below that
  threshold: no new AWS substrate until the protocol proves itself.
- `docs/solutions/design-patterns/audit-existing-ui-and-data-model-before-parallel-build-2026-04-28.md`
  applies directly. The spike creates a parallel route for comparison, but it
  reuses existing thread/task/event/artifact data rather than inventing a new
  persistence model.
- `docs/solutions/best-practices/inline-helpers-vs-shared-package-for-cross-surface-code-2026-04-21.md`
  supports keeping spike adapters local until multiple surfaces prove they need
  a shared package.

### External References

- AWS Bedrock AgentCore documents an AG-UI runtime path with session isolation,
  auth, scaling, and AG-UI event streaming:
  `https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-agui.html`
- AWS documents the AG-UI protocol contract for AgentCore:
  `https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-agui-protocol-contract.html`
- CopilotKit documents AWS Strands integration:
  `https://docs.copilotkit.ai/aws-strands`
- AG-UI event docs describe protocol events such as run lifecycle, text
  message deltas, tool calls/results, state snapshots/deltas, and custom
  events: `https://docs.ag-ui.com/sdk/js/core/events`

---

## Key Technical Decisions

- **Use an experimental sibling route.** Add a route such as
  `/threads/$threadId/agui` or `/agui/threads/$threadId` in `apps/computer`
  rather than changing the default Thread route. This satisfies origin R2 and
  keeps Vercel AI Elements work comparable.
- **Start with ThinkWork-owned event mapping, not direct AgentCore AG-UI.**
  The first spike maps existing AppSync chunks, `computer_tasks`, and
  `computer_events` into an AG-UI-shaped client model. Direct AgentCore AG-UI
  server work is a follow-up if the client model wins.
- **Keep CopilotKit optional in U1, integrate only after event mapping is
  proven.** The plan first creates a local protocol model and route. Then it
  tests whether OSS CopilotKit primitives add leverage. If they pull in
  Enterprise persistence assumptions, the spike can still produce an AG-UI
  verdict without adopting CopilotKit UI.
- **Represent Canvas as registered components with validated props.** The
  selected Canvas proof is a LastMile pipeline-risk summary component backed by
  `@thinkwork/computer-stdlib` primitives or existing applet preview data. It
  does not execute agent-authored TSX.
- **Use the existing chunk JSON as the typed-event carrier.** No GraphQL schema
  change is needed for the spike because `chunk` is already `AWSJSON`. Add
  parsing/validation on the client and helper emission tests on the server.
- **Write the verdict as a repo artifact.** The spike is only successful if it
  produces a decision doc under `docs/solutions/architecture-patterns/` or
  `docs/plans/` follow-up notes that says pivot, continue, or reject.

---

## Output Structure

New files are intentionally local to `apps/computer` unless noted:

```text
apps/computer/src/agui/
  events.ts
  event-mapping.ts
  event-mapping.test.ts
  component-registry.tsx
  component-registry.test.tsx
  use-agui-thread-stream.ts
  use-agui-thread-stream.test.tsx

apps/computer/src/components/computer-agui/
  AguiThreadCanvasRoute.tsx
  AguiThreadCanvasRoute.test.tsx
  AguiTranscript.tsx
  AguiCanvas.tsx
  AguiDiagnosticsPanel.tsx
  LastMileRiskCanvas.tsx
  LastMileRiskCanvas.test.tsx

apps/computer/src/routes/_authed/_shell/
  threads.$threadId.agui.tsx

packages/api/src/graphql/
  agui-event.ts
  agui-event.test.ts

docs/solutions/architecture-patterns/
  copilotkit-agui-computer-spike-verdict-2026-05-10.md
```

If TanStack Router naming requires a different path, keep the route
experimental and document the final URL in the verdict.

---

## Implementation Units

### U1 — Local AG-UI event model and existing-stream adapter

**Goal:** Define the spike's typed event model and adapt existing ThinkWork
chunk/task/event data into it without changing the production GraphQL schema.

**Files:**

- Add `apps/computer/src/agui/events.ts`
- Add `apps/computer/src/agui/event-mapping.ts`
- Add `apps/computer/src/agui/event-mapping.test.ts`
- Add `apps/computer/src/agui/use-agui-thread-stream.ts`
- Add `apps/computer/src/agui/use-agui-thread-stream.test.tsx`
- Read from `apps/computer/src/lib/use-computer-thread-chunks.ts`
- Read from `apps/computer/src/components/computer/ComputerThreadDetailRoute.tsx`

**Plan:**

- Define a narrow `ThinkworkAguiEvent` union for the spike:
  `run_started`, `run_finished`, `text_delta`, `tool_call_started`,
  `tool_call_finished`, `canvas_component`, `diagnostic`.
- Add parsers that accept both future typed chunks and current `{text}` chunks.
  Current text chunks map to `text_delta`; unknown typed chunks map to
  `diagnostic` rather than disappearing.
- Add mapping from `computerEvents` rows to lifecycle/tool events using
  existing event types such as `thread_turn_enqueued`,
  `thread_turn_dispatched`, `thread_turn_claimed`, task errors, and applet
  save/link events.
- Keep the hook independent of CopilotKit so the protocol mapping can be
  judged on its own.

**Tests:**

- `apps/computer/src/agui/event-mapping.test.ts`
  - maps `{text: "hello"}` to `text_delta`
  - maps known typed `canvas_component` chunks to Canvas events
  - maps malformed/unknown chunks to `diagnostic`
  - maps Computer task events into lifecycle/tool events in timestamp order
- `apps/computer/src/agui/use-agui-thread-stream.test.tsx`
  - merges subscription chunks and persisted events without duplicate seq
    regressions
  - resets state when `threadId` changes

### U2 — Server helper for typed spike events

**Goal:** Make typed event publication explicit and testable while preserving
the existing AppSync `AWSJSON` carrier.

**Files:**

- Add `packages/api/src/graphql/agui-event.ts`
- Add `packages/api/src/graphql/agui-event.test.ts`
- Modify `packages/api/src/graphql/notify.ts` only if a wrapper export is
  needed
- Read `packages/api/src/__tests__/computer-thread-chunk-publish.test.ts`

**Plan:**

- Add a helper such as `publishComputerAguiEvent` that wraps
  `publishComputerThreadChunk` with a typed payload shape:
  `{ type, eventId, threadId, timestamp, payload }`.
- Keep this helper inert for production unless explicitly called by spike-only
  code or tests. Existing text chunks keep working.
- Do not add new GraphQL fields. The helper exists to keep event shape honest
  and compare AG-UI-style events without widening the schema.

**Tests:**

- `packages/api/src/graphql/agui-event.test.ts`
  - serializes typed events through `publishComputerThreadChunk`
  - preserves `threadId` and monotonic `seq`
  - rejects missing event `type` or invalid payload in helper-level validation
- Existing `packages/api/src/__tests__/computer-thread-chunk-publish.test.ts`
  should continue passing unchanged.

### U3 — Experimental Thread + Canvas route

**Goal:** Render the same Computer thread through the AG-UI-shaped model in a
parallel route.

**Files:**

- Add `apps/computer/src/components/computer-agui/AguiThreadCanvasRoute.tsx`
- Add `apps/computer/src/components/computer-agui/AguiThreadCanvasRoute.test.tsx`
- Add `apps/computer/src/components/computer-agui/AguiTranscript.tsx`
- Add `apps/computer/src/components/computer-agui/AguiCanvas.tsx`
- Add `apps/computer/src/components/computer-agui/AguiDiagnosticsPanel.tsx`
- Add `apps/computer/src/routes/_authed/_shell/threads.$threadId.agui.tsx`
- Reuse `ComputerThreadQuery`, `ComputerEventsQuery`,
  `ComputerThreadTasksQuery`, `ComputerThreadChunkSubscription`,
  `SendMessageMutation` from `apps/computer/src/lib/graphql-queries.ts`

**Plan:**

- Build a two-pane route: transcript/run stream on the left, Canvas on the
  right. Keep layout utilitarian and consistent with existing Computer routes.
- Reuse the existing send-message mutation and optimistic message behavior
  where possible, but do not refactor `ComputerThreadDetailRoute.tsx` yet.
- Render diagnostics visibly in the route so malformed events support origin
  AE4.
- Add a link or route helper only if low-risk. Otherwise document the direct
  experimental URL in the plan/verdict and avoid sidebar churn.

**Tests:**

- `apps/computer/src/components/computer-agui/AguiThreadCanvasRoute.test.tsx`
  - renders legacy text chunks as transcript deltas
  - renders lifecycle/tool events from `computerEvents`
  - shows diagnostics for malformed typed events
  - sends a follow-up without affecting the default Thread route

### U4 — Registered Canvas component proof

**Goal:** Prove the first Canvas interaction through a registered component
with validated props instead of generated TSX.

**Files:**

- Add `apps/computer/src/agui/component-registry.tsx`
- Add `apps/computer/src/agui/component-registry.test.tsx`
- Add `apps/computer/src/components/computer-agui/LastMileRiskCanvas.tsx`
- Add `apps/computer/src/components/computer-agui/LastMileRiskCanvas.test.tsx`
- Reuse primitives from `@thinkwork/computer-stdlib` and `@thinkwork/ui`

**Plan:**

- Define a tiny registry keyed by component name, e.g.
  `lastmile_risk_canvas`.
- Validate props with `zod` or an existing local validation pattern before
  rendering. Invalid props render a diagnostic card, not a blank Canvas.
- Use the LastMile CRM pipeline-risk shape as the comparison scenario because
  it already appears in the active applet plan and smoke language. Minimum
  props: KPIs, risk rows, source statuses, and generated summary.
- Accept static fixture data for the component proof if live agent output is
  unavailable. The protocol proof is the goal; live data is covered in U5.

**Tests:**

- `apps/computer/src/agui/component-registry.test.tsx`
  - renders the registered component for a valid `canvas_component` event
  - rejects unknown component names with diagnostic output
  - rejects invalid props with diagnostic output
- `apps/computer/src/components/computer-agui/LastMileRiskCanvas.test.tsx`
  - renders KPIs, risk rows, and source status
  - handles empty or partial source data without layout collapse

### U5 — Real scenario smoke path

**Goal:** Exercise the route with the chosen real Computer prompt and capture
evidence for the verdict.

**Files:**

- Add or extend a smoke helper under `apps/computer` or `packages/api/src/__smoke__/`
  only if a suitable harness already exists
- Update `apps/computer/README.md` with a short manual spike verification
  command/URL
- Read `apps/computer/README.md`
- Read `packages/api/src/lib/computers/artifact-builder-defaults.test.ts`
- Read `packages/api/src/lib/computers/runtime-api.test.ts`

**Plan:**

- Use this prompt as the primary comparison scenario:
  "Build a CRM pipeline risk dashboard for LastMile opportunities, including
  stale activity, stage exposure, and the top risks to review."
- Run it against the existing dev-stage Computer flow when credentials and
  deployed stack are available.
- If the live agent again asks for source data instead of creating an applet,
  the spike still records whether the AG-UI route can present that failure
  clearly through lifecycle/tool/diagnostic events.
- Capture screenshots or written observations only; do not make the spike
  dependent on visual snapshot infrastructure unless already present.

**Tests / Verification:**

- Unit tests from U1-U4 are required.
- Manual verification should record:
  - default Thread route still works
  - experimental AG-UI route renders same thread
  - text, lifecycle/tool events, and Canvas/diagnostic area appear
  - the same prompt can be compared against the AI Elements path

### U6 — Optional OSS CopilotKit integration check

**Goal:** Determine whether CopilotKit OSS primitives add enough leverage over
the local AG-UI model to justify adopting them.

**Files:**

- Modify `apps/computer/package.json` only if the package footprint is
  acceptable after checking current CopilotKit package docs
- Add an isolated adapter under `apps/computer/src/agui/copilotkit-adapter.ts`
  if needed
- Add `apps/computer/src/agui/copilotkit-adapter.test.ts` if an adapter lands

**Plan:**

- Treat this as optional and reversible. If CopilotKit OSS expects hosted
  persistence/realtime assumptions that fight ThinkWork, stop at the AG-UI
  model and record rejection for CopilotKit UI while preserving AG-UI as a
  possible protocol.
- If the package fits, wire the smallest headless/client primitive to consume
  the local event stream. Do not replace the route's durable state.
- Keep all CopilotKit-specific code behind one adapter file so a later PR can
  delete it cleanly.

**Tests:**

- Adapter test proves ThinkWork event state remains the source of truth.
- Package-lock diff is reviewed for unexpected heavy/runtime dependencies.

### U7 — Verdict document and follow-up recommendation

**Goal:** Convert spike results into a durable decision.

**Files:**

- Add `docs/solutions/architecture-patterns/copilotkit-agui-computer-spike-verdict-2026-05-10.md`
- Optionally add a follow-up production plan if the verdict is "pivot"

**Plan:**

- The verdict must choose one:
  - Pivot from Vercel AI Elements foundation work to AG-UI/CopilotKit
  - Continue Vercel AI Elements and reject AG-UI/CopilotKit for now
  - Keep AG-UI protocol ideas but reject CopilotKit UI/client adoption
  - Reject both and define a ThinkWork-native interaction protocol
- Tie the recommendation to origin R9/R10:
  typed event fit, Canvas state fit, adapter complexity, ThinkWork backend
  ownership, Strands/AgentCore fit, mobile parity risk, and framework coupling.
- Name the first production slice if pivoting.

**Tests / Verification:**

- No automated tests required for the doc, but the verdict must cite the exact
  route, scenario, test commands, and observed result.

---

## Test Matrix

- `pnpm --filter @thinkwork/computer test -- apps/computer/src/agui/event-mapping.test.ts`
- `pnpm --filter @thinkwork/computer test -- apps/computer/src/agui/use-agui-thread-stream.test.tsx`
- `pnpm --filter @thinkwork/computer test -- apps/computer/src/components/computer-agui/AguiThreadCanvasRoute.test.tsx`
- `pnpm --filter @thinkwork/computer test -- apps/computer/src/agui/component-registry.test.tsx`
- `pnpm --filter @thinkwork/computer test -- apps/computer/src/components/computer-agui/LastMileRiskCanvas.test.tsx`
- `pnpm --filter @thinkwork/api test -- packages/api/src/graphql/agui-event.test.ts`
- `pnpm --filter @thinkwork/computer typecheck`
- `pnpm --filter @thinkwork/api typecheck`

If the package scripts cannot target individual files exactly as written,
use the package-local `npx vitest run <path>` pattern from `AGENTS.md`.

---

## Manual Verification

1. Copy `apps/computer/.env` from the main checkout if working in a worktree.
2. Start Computer locally with `pnpm --filter @thinkwork/computer dev`.
3. Open an existing Computer thread in the default route and confirm baseline
   behavior still works.
4. Open the same thread in the experimental AG-UI route.
5. Send or inspect the LastMile CRM pipeline-risk scenario.
6. Confirm transcript deltas, lifecycle/tool events, Canvas output or Canvas
   diagnostics, and malformed-event diagnostics all render.
7. Record observations in the verdict document.

---

## Risk Register

- **Risk: CopilotKit adds platform coupling.** Mitigation: keep U6 optional and
  isolated; AG-UI event mapping can stand without CopilotKit UI adoption.
- **Risk: experimental route duplicates too much Thread logic.** Mitigation:
  duplication is acceptable for the spike; extract only after the verdict.
- **Risk: typed events drift from the AG-UI spec.** Mitigation: keep event names
  and shapes close to documented AG-UI concepts, and list deviations in the
  verdict.
- **Risk: registered Canvas proof is too narrow.** Mitigation: choose the
  LastMile dashboard because it exercises KPIs, tables, source status, and
  summary content. If it cannot represent that, the registered-component path
  is not yet enough.
- **Risk: live Computer scenario fails before Canvas.** Mitigation: treat a
  source-data or applet-save failure as useful signal if the route renders the
  failure through typed lifecycle/diagnostic events.

---

## Open Questions

### Resolved During Planning

- **Comparison scenario:** Use the LastMile CRM pipeline-risk prompt as the
  primary scenario because it is already the active applet blocker and forces
  artifact/Canvas behavior.
- **Route strategy:** Use an experimental sibling route rather than a feature
  flag in the default Thread page. This keeps the AI Elements work clean.
- **First Canvas mechanism:** Registered component + validated props, not
  arbitrary generated TSX.
- **First protocol integration:** Map existing ThinkWork stream/events before
  attempting direct AgentCore AG-UI deployment.

### Deferred to Implementation

- Exact route filename required by TanStack Router generation.
- Exact CopilotKit OSS package(s) to install, if any, after checking package
  size and runtime assumptions.
- Whether a live typed `canvas_component` event should be emitted from the API
  during the spike or seeded from a fixture in the route.
- Whether the verdict should live under `docs/solutions/architecture-patterns/`
  or become a superseding plan/requirements update if the outcome is a pivot.

---

## Completion Criteria

- Experimental AG-UI route exists and does not change default Thread behavior.
- Existing text chunks and Computer events render through the typed event model.
- A registered Canvas component renders validated LastMile-style output.
- Malformed and unsupported events produce visible diagnostics.
- Tests listed for U1-U4 pass.
- Manual verification is recorded.
- Verdict document recommends pivot, continue, partial adoption, or rejection.
