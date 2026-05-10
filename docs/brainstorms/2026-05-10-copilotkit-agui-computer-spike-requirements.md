---
date: 2026-05-10
topic: copilotkit-agui-computer-spike
---

# CopilotKit / AG-UI Computer Foundation Spike

## Problem Frame

The current Computer thread direction is based on Vercel AI Elements and an
AI-SDK-shaped message model. That may be useful for visual polish, but it may
not be the right foundation for Computer's Thread + Canvas experience, where
the hard product surface is not only chat rendering. Computer needs typed
agent run events, tool progress, HITL moments, artifact/canvas updates,
frontend state synchronization, and clear ownership boundaries with the
ThinkWork backend.

CopilotKit plus AG-UI is a strong candidate because AG-UI is explicitly the
agent-to-user interaction protocol, CopilotKit provides React client primitives
on top of it, and AWS Bedrock AgentCore now supports AG-UI servers for Strands
runtime paths. The spike should prove whether this is a better foundation than
continuing the Vercel AI Elements path, without replacing ThinkWork's
persistence, auth, tenant scoping, memory, observability, or audit planes.

This is a decision spike, not a production migration.

---

## Actors

- A1. End user: Works inside the Computer Thread + Canvas experience.
- A2. Computer agent: Runs through ThinkWork's Strands/AgentCore-backed runtime
  and emits conversational, tool, and artifact activity.
- A3. Computer client: The React app in `apps/computer` that renders the
  experimental Thread + Canvas route.
- A4. ThinkWork platform: Owns auth, tenant boundaries, thread persistence,
  artifacts, memory, audit, and observability.
- A5. Product/engineering reviewer: Compares the spike against the existing
  Vercel AI Elements direction and decides whether to pivot, continue, or
  reject AG-UI/CopilotKit.

---

## Key Flows

- F1. Run a real Computer scenario through the spike
  - **Trigger:** A user sends the same Computer prompt used to evaluate the
    current Vercel AI Elements / applet direction, such as a LastMile CRM
    pipeline-risk dashboard or similarly real artifact-building task.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** The user sends the prompt in the experimental route. The agent
    response streams as typed interaction events. The client renders text,
    run lifecycle, tool activity, and one Canvas update from the same event
    stream. Persisted thread/artifact state remains in ThinkWork-owned storage.
  - **Outcome:** The team can inspect whether AG-UI is carrying the right
    interaction contract for Computer, not merely whether a chat demo works.
  - **Covered by:** R1, R2, R3, R4, R7

- F2. Compare AG-UI/CopilotKit against the Vercel AI Elements path
  - **Trigger:** The spike can complete the selected real Computer scenario.
  - **Actors:** A5
  - **Steps:** A reviewer compares the resulting route against the existing
    Vercel AI Elements requirements and implementation direction, using the
    pivot and rejection criteria below.
  - **Outcome:** The team has an explicit recommendation: continue AI Elements,
    pivot to AG-UI/CopilotKit, or reject both as foundations and keep a
    ThinkWork-native protocol.
  - **Covered by:** R5, R8, R9, R10

- F3. Exercise Canvas without arbitrary generated TSX
  - **Trigger:** The agent produces structured work that belongs in Canvas.
  - **Actors:** A2, A3, A4
  - **Steps:** The agent emits a registered component/tool-result event rather
    than arbitrary executable TSX. The client maps the event to a known React
    component with validated props. Any durable output links back to ThinkWork
    artifacts.
  - **Outcome:** The spike tests whether registered GenUI can cover the
    smallest useful Canvas experience more safely than same-origin generated
    TSX.
  - **Covered by:** R6, R7, R11

---

## Requirements

**Spike Shape**

- R1. The spike must run against one real Computer scenario, not a toy chat
  demo. The scenario should involve at least text response, tool/run activity,
  and one Canvas-worthy structured output.
- R2. The spike must run in parallel with the Vercel AI Elements work through a
  separate branch/worktree and an experimental route or feature flag. It must
  not rewrite the primary Thread page as part of the spike.
- R3. The spike must treat CopilotKit OSS/AG-UI as an interaction/runtime
  protocol layer only. ThinkWork remains the system of record for threads,
  messages, artifacts, auth, tenants, memory, audit, and observability.
- R4. The spike must preserve the ability to compare the same prompt and user
  flow against the current Vercel AI Elements direction.

**Interaction Contract**

- R5. The spike must evaluate whether AG-UI gives Computer a better native
  event model than `UIMessage` / AI SDK for run lifecycle, text deltas, tool
  calls/results, HITL, state updates, and Canvas updates.
- R6. The spike must test registered React components or tool-result-driven
  GenUI before expanding arbitrary agent-authored TSX. The point is to learn
  whether a safer component registry can cover the first useful Canvas surface.
- R7. The smallest useful Canvas experience must render as part of the same
  agent interaction stream as the transcript, rather than as a disconnected
  artifact page.
- R8. The spike must make failure modes visible: unsupported event type,
  malformed component props, runtime connection failure, and persistence
  mismatch should produce inspectable errors rather than silent fallback to
  plain text.

**Decision Criteria**

- R9. Pivot criteria must be explicit. The spike supports pivoting away from
  Vercel AI Elements if AG-UI/CopilotKit more naturally models typed agent
  events, Canvas state, and frontend/agent coordination with less adapter
  complexity.
- R10. Rejection criteria must be explicit. The spike should reject
  AG-UI/CopilotKit as the foundation if it requires fighting ThinkWork's
  persistence/auth model, cannot cleanly run with Strands/AgentCore, makes
  mobile parity implausible, or adds more framework coupling than protocol
  leverage.
- R11. The spike must produce a planning-ready recommendation that names the
  preferred foundation path, remaining unknowns, and the first production
  implementation slice if AG-UI/CopilotKit wins.

---

## Acceptance Examples

- AE1. **Covers R1, R4, R5.** Given the selected real Computer prompt, when the
  user runs it through the experimental route, then the route shows streamed
  text, run lifecycle, at least one tool event, and one Canvas event from the
  same interaction stream.
- AE2. **Covers R2, R3.** Given the spike branch is checked out, when the
  existing Vercel AI Elements route is opened, then that work still runs
  independently and no production Thread page behavior has been replaced by
  the spike.
- AE3. **Covers R6, R7.** Given the agent produces a structured dashboard or
  report result, when the client receives it, then the Canvas renders a
  registered ThinkWork component from validated props rather than executing
  arbitrary generated TSX.
- AE4. **Covers R8, R10.** Given the runtime emits an unsupported or malformed
  Canvas event, when the client receives it, then the spike surfaces a clear
  diagnostic state that helps decide whether the protocol/framework is viable.
- AE5. **Covers R9, R11.** Given the spike is complete, when a reviewer compares
  it to the AI Elements path, then the recommendation clearly says pivot,
  continue, or reject, with the reasons tied to the criteria in this document.

---

## Success Criteria

- The team can decide whether AG-UI/CopilotKit is a stronger foundation than
  Vercel AI Elements for Computer's Thread + Canvas experience.
- A downstream `ce-plan` can sequence a bounded spike without inventing product
  behavior, success criteria, or comparison rules.
- The spike demonstrates a real Computer scenario with typed run events and a
  Canvas update while keeping ThinkWork's durable backend responsibilities
  intact.
- The outcome is not merely "CopilotKit can render chat"; it answers whether
  AG-UI should become the interaction contract for Computer.

---

## Scope Boundaries

- No production migration of the current Thread page.
- No replacement of ThinkWork persistence, auth, tenant scoping, memory,
  observability, audit, GraphQL ownership, or artifact storage.
- No adoption of CopilotKit Enterprise persistence/hosted platform as part of
  the spike.
- No attempt to solve all mobile parity. Mobile implications should be
  assessed as a decision input, but the spike is web-first in `apps/computer`.
- No arbitrary agent-authored TSX as the first Canvas proof unless registered
  component/tool-result GenUI fails to cover the minimum scenario.
- No broad redesign of applets, artifacts, or Computer routing beyond the
  experimental route required for the spike.
- No requirement that the spike be production-polished; diagnostic clarity is
  more important than visual completeness.

---

## Key Decisions

- **Start with a focused spike before planning a migration.** The choice is
  strategic enough that planning a full rewrite before proving the interaction
  contract would lock in too much too early.
- **Run in parallel with Vercel AI Elements.** The AI Elements path is the
  current baseline and should remain comparable until the spike produces a
  decision.
- **Prefer protocol-first with a thin UI slice.** The main uncertainty is
  whether AG-UI is the right Computer interaction contract. The route should
  include enough UI to test Canvas, but visual polish is secondary.
- **Try registered GenUI before generated TSX.** A component registry with
  validated props is likely a better first Canvas proof than same-origin
  execution of agent-authored TSX. Generated TSX remains a fallback or later
  capability if the safer path is too limiting.
- **Treat CopilotKit as optional UI/client infrastructure, not the platform.**
  ThinkWork should own durable state and governance even if CopilotKit supplies
  useful OSS client/runtime primitives.

---

## Dependencies / Assumptions

- AWS Bedrock AgentCore supports AG-UI servers with SSE/WebSocket event streams,
  AgentCore-managed auth/session isolation/scaling, and AWS Strands examples.
- CopilotKit provides OSS React/AG-UI client primitives and framework
  integrations that can be evaluated without buying into CopilotKit Enterprise.
- The existing Computer architecture has enough separation to add an
  experimental route without blocking the current Thread page or Vercel AI
  Elements work.
- The applet and artifact work in
  `docs/specs/computer-applet-contract-v1.md` remains relevant, but this spike
  may challenge whether arbitrary generated TSX should stay the primary Canvas
  mechanism.
- External references to carry into planning:
  - `https://docs.copilotkit.ai/aws-strands`
  - `https://www.copilotkit.ai/ag-ui`
  - `https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-agui.html`
  - `https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-agui-protocol-contract.html`

---

## Outstanding Questions

### Resolve Before Planning

- None. Planning can proceed with explicit spike assumptions.

### Deferred to Planning

- [Affects R1][Technical] Which exact real Computer scenario should be the
  comparison prompt: LastMile CRM pipeline risk, meeting brief, or another
  scenario that exercises both tool events and Canvas?
- [Affects R2][Technical] Should the spike use a new route under
  `apps/computer`, a feature flag inside the existing thread route, or an
  isolated worktree-only route?
- [Affects R5][Needs research] Which AG-UI event types map directly to current
  ThinkWork thread, turn, tool, and artifact records, and which require adapter
  state?
- [Affects R6][Needs research] What is the minimum registered component
  registry needed to prove Canvas: KPI/table dashboard, report card, approval
  card, or artifact preview?
- [Affects R10][Needs research] How much custom React Native AG-UI client work
  would be required later for mobile parity?
- [Affects R10][Technical] Can the spike use OSS CopilotKit primitives without
  pulling in CopilotKit Enterprise assumptions about persistence, realtime sync,
  or observability?

---

## Next Steps

-> `/ce-plan docs/brainstorms/2026-05-10-copilotkit-agui-computer-spike-requirements.md`
