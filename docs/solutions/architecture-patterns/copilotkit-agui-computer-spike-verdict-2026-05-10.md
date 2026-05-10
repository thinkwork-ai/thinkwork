---
title: "CopilotKit / AG-UI Computer spike verdict"
date: 2026-05-10
category: architecture-patterns
tags:
  - computer
  - ag-ui
  - copilotkit
  - canvas
  - spike
---

# CopilotKit / AG-UI Computer Spike Verdict

## 2026-05-10 Follow-Up Decision

This verdict is superseded by the AI Elements iframe Canvas decision:
[AI Elements iframe Canvas foundation decision](./ai-elements-iframe-canvas-foundation-decision-2026-05-10.md).

After comparing the spike against the raw AI Elements path, we decided to keep
the iframe/app artifact foundation because Computer needs to generate generic
dashboards and full embedded applications, not only registered Canvas
components. The AG-UI/CopilotKit work remains valuable reference material for
typed events, HITL, tool lifecycle, and future protocol thinking, but its
implementation should not stay active in `main`.

## Original Verdict (Superseded)

Pivot the Computer Thread + Canvas foundation work from Vercel AI Elements to a
ThinkWork-owned AG-UI protocol layer. Do not adopt CopilotKit React UI/runtime
packages in the first production slice.

The spike proved the important foundation question: Computer benefits from a
typed interaction stream that carries run lifecycle, text deltas, tool activity,
diagnostics, and registered Canvas components together. AI Elements can still
inform presentation, but `UIMessage` should not be the core Computer runtime
contract.

CopilotKit remains strategically relevant because its OSS framework and AG-UI
direction match the product shape: generative UI, frontend actions, app state
sync, observability hooks, and headless React client options. The package check
also showed that direct React package adoption would bring more runtime/client
surface than this spike needs. Keep CopilotKit as an integration candidate after
ThinkWork's AG-UI contract is promoted out of the experimental route.

## What The Spike Proved

- `apps/computer` can consume existing ThinkWork AppSync chunk events and
  persisted Computer events through a local AG-UI-shaped event model without a
  GraphQL schema change.
- `packages/api` can publish typed AG-UI spike events through the existing
  `ComputerThreadChunkEvent.chunk: AWSJSON` carrier.
- A sibling route at `/agui/threads/$id` can render transcript, run/tool
  lifecycle, Canvas, diagnostics, and follow-up sending without replacing the
  production `/threads/$id` route.
- Registered Canvas components with validated props are enough for the first
  useful Canvas proof. The `lastmile_risk_canvas` event renders KPIs, risk rows,
  and source status without executing arbitrary generated TSX.
- Failure states are visible. Malformed chunks, unsupported event types,
  unknown Canvas components, and invalid props become diagnostics instead of
  disappearing into plain text fallback.
- CopilotKit React packages are not required to prove the foundation. A local
  adapter can project ThinkWork AG-UI events into a CopilotKit-shaped snapshot
  while keeping ThinkWork events as the source of truth.

## Real Scenario

Scenario prompt:

```text
Build a CRM pipeline risk dashboard for LastMile opportunities, including stale activity, stage exposure, and the top risks to review.
```

Experimental route:

```text
/agui/threads/<thread-id>
```

Deterministic smoke route:

```text
/agui/threads/<thread-id>?aguiSmoke=lastmile
```

Observed result: the smoke route injects a typed `canvas_component` event for
`lastmile_risk_canvas`. The route renders the registered Canvas with risk KPIs,
stale opportunity rows, and CRM/email/calendar source status from the same
AG-UI-shaped stream as transcript and diagnostics.

## Comparison Against Vercel AI Elements

AI Elements is still useful as a UI vocabulary for chat affordances and message
polish. It is weaker as the Computer foundation because the Thread + Canvas
surface is centered on agent state, tool lifecycle, HITL, and structured Canvas
updates. Those concerns want a protocol contract before they want chat
components.

AG-UI better matches the product boundary. CopilotKit's AG-UI page frames AG-UI
as the user-facing app to agentic backend connection, and its framework page
emphasizes open-source MIT core, generative UI, frontend actions, realtime
context awareness, agent-app state sync, headless UI, and observability hooks.
Those are closer to ThinkWork Computer's foundation needs than a message-only
abstraction.

AWS AgentCore also now documents AG-UI server support for AgentCore Runtime,
including SSE/WebSocket streaming, session isolation, auth handling, and Strands
examples. That is a strong fit for ThinkWork's AWS-native Strands runtime path.

## Pivot Criteria

This spike meets the pivot bar from the requirements:

- Typed event fit: run lifecycle, text, tool activity, Canvas, and diagnostics
  were modeled without forcing everything through assistant message content.
- Canvas state fit: the route renders Canvas from the interaction stream, not a
  disconnected artifact page.
- Adapter complexity: the local AG-UI mapping is small and covered by tests.
  The production work is mostly promotion and runtime wiring, not conceptual
  rework.
- ThinkWork backend ownership: persistence, auth, tenant scoping, memory,
  observability, and audit remain ThinkWork-owned.
- Strands/AgentCore fit: AWS documents a direct AG-UI runtime path that aligns
  with the existing Strands container direction.
- Framework coupling: CopilotKit package adoption can be deferred while the
  protocol layer moves forward.

## Rejection Criteria

Do not adopt CopilotKit React UI/runtime packages as the first production
foundation.

Reasons:

- `@copilotkit/react-core@1.57.1` brings CopilotKit runtime GraphQL client
  packages, A2UI renderer, web inspector, markdown/KaTeX/Streamdown, RxJS,
  Radix, TanStack virtual, and other UI/runtime helpers.
- `@copilotkit/react-ui@1.57.1` adds another UI layer on top of React Core.
- The spike does not need CopilotKit-owned durable thread state, realtime sync,
  or observability. Those are ThinkWork platform responsibilities.
- The first production slice needs protocol confidence and AgentCore wiring
  more than prebuilt CopilotKit UI.

Reject AG-UI entirely only if the production slice proves that AgentCore's
AG-UI event contract cannot preserve ThinkWork tenant/auth/audit boundaries, or
if mobile parity requires a second incompatible protocol. The spike did not
surface either blocker.

## First Production Slice

Create a production plan for a ThinkWork AG-UI Thread runtime slice:

- Promote `ThinkworkAguiEvent` from spike-local naming into the Computer
  interaction contract.
- Replace the ad hoc text-only chunk path with typed chunk parsing for live
  thread output while keeping existing persisted thread/message state.
- Add server helpers for `run_started`, `run_finished`, `text_delta`,
  `tool_call_started`, `tool_call_finished`, `canvas_component`, and
  `diagnostic` emissions from the Strands/AgentCore runtime.
- Wire one real LastMile pipeline-risk task to emit a registered
  `lastmile_risk_canvas` component event from live runtime output.
- Keep `/agui/threads/$id` as the comparison route until parity is good enough
  to plan the production Thread rewrite.
- Keep arbitrary generated TSX behind the existing applet/artifact substrate;
  use registered Canvas components for the Thread surface until a later plan
  explicitly expands that boundary.

## Follow-Up Questions

- Should the runtime stream reach the client through the existing AppSync
  subscription path first, or through a direct AgentCore AG-UI SSE/WebSocket
  path behind ThinkWork auth?
- Which event names should be canonical: the current lowercase spike names or
  upstream AG-UI names such as `RUN_STARTED`, `TEXT_MESSAGE_CONTENT`, and
  `TOOL_CALL_RESULT`?
- What is the minimum mobile AG-UI reader: render transcript and diagnostics
  only, or also render registered Canvas components?
- Where should HITL fit first: approval cards in Canvas, interrupt/resume on
  the runtime stream, or existing approval queue integration?
- When the protocol is stable, should `@ag-ui/client` be installed before any
  CopilotKit React package?

## Verification

Implemented and merged units:

- U1 PR #1102: local AG-UI event model and existing-stream adapter.
- U2 PR #1103: server helper for typed spike events.
- U3 PR #1104: experimental Thread + Canvas route.
- U4 PR #1105: registered LastMile Canvas component.
- U5 PR #1106: deterministic LastMile smoke path.
- U6 PR #1107: CopilotKit OSS integration check and local adapter.

Local verification run during the spike:

- `pnpm --filter @thinkwork/computer test -- src/agui/event-mapping.test.ts src/agui/use-agui-thread-stream.test.tsx`
- `pnpm --filter @thinkwork/api test -- src/graphql/agui-event.test.ts src/__tests__/computer-thread-chunk-publish.test.ts`
- `pnpm --filter @thinkwork/computer test -- src/components/computer-agui/AguiThreadCanvasRoute.test.tsx`
- `pnpm --filter @thinkwork/computer test -- src/agui/component-registry.test.tsx src/components/computer-agui/LastMileRiskCanvas.test.tsx src/components/computer-agui/AguiThreadCanvasRoute.test.tsx`
- `pnpm --filter @thinkwork/computer test -- src/agui/copilotkit-adapter.test.ts`
- `pnpm --filter @thinkwork/computer test`
- `pnpm --filter @thinkwork/computer typecheck`
- `pnpm --filter @thinkwork/api test`
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm dlx prettier --check <touched files>`

All PR CI checks passed before merge: `cla`, `lint`, `test`, `typecheck`, and
`verify`.

## References

- [CopilotKit Framework](https://www.copilotkit.ai/product/framework)
- [CopilotKit AG-UI Protocol](https://www.copilotkit.ai/ag-ui)
- [CopilotKit AWS Strands](https://docs.copilotkit.ai/aws-strands)
- [AWS AgentCore AG-UI runtime](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-agui.html)
- [AWS AgentCore AG-UI protocol contract](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-agui-protocol-contract.html)
- [CopilotKit OSS package check](./copilotkit-oss-package-check-2026-05-10.md)
