---
date: 2026-05-09
topic: computer-ai-elements-adoption
---

# Computer LLM-UI: Vercel AI SDK Adoption

## Summary

Computer's LLM UI commits to the Vercel AI SDK ecosystem end-to-end — AI Elements components for visual vocabulary, `useChat` for chat-state lifecycle, and `UIMessage` shape as the wire format from Strands → AppSync → client. Plan-001's Applets reframe generalizes into a unified LLM-authored React-fragment substrate that powers both inline thread fragments and full-canvas artifacts. Plan-008 is superseded.

---

## Problem Frame

The computer app today renders thread content as raw text (`apps/computer/src/components/TaskThreadView.tsx:125`, `apps/computer/src/components/StreamingMessageBuffer.tsx:14`) — no markdown, no thinking blocks, no tool-call UI, no inline fragments. Streaming chunks carry `{text}` only with no type discriminator, so the client cannot distinguish reasoning from tool output from prose, and any new agent capability requires custom client-side handling.

Several in-flight efforts each address a slice of the gap. Plan-008 (just committed) chose `react-markdown` + fenced `chart-spec`/`map-spec` blocks for inline visualizations. Plan-001 (Applets reframe, in flight) builds a TSX runtime for full-canvas artifacts. Eight bespoke dashboard-artifact components live in `apps/computer/src/components/dashboard-artifacts/`. Recent commits added streaming chunk delivery to AppSync, but the chunk envelope is still untyped. The result is a piecemeal rendering vocabulary, two parallel UI substrates that don't share a contract, and ongoing inline-rendering pain.

The recent landing of `streamdown` as a transitive dependency (raising the Node floor to 22) signals that pieces of the AI SDK are already creeping in incidentally. Without an explicit adoption decision, the codebase will accumulate inconsistent partial uses of AI SDK primitives instead of converging on a coherent stack.

---

## Actors

- A1. **End user** — author and recipient of thread messages; sees agent-authored React fragments rendered inline and as full-canvas artifacts.
- A2. **Agent runtime (Strands)** — Python runtime in `packages/agentcore-strands/agent-container`; emits messages and message parts in `UIMessage` shape; produces JSX/TSX fragments for inline + canvas rendering.
- A3. **Computer client** — React app at `apps/computer`; renders messages via AI Elements + `useChat`; compiles + executes LLM-authored React fragments client-side.

---

## Key Flows

- F1. **Streaming a multi-part assistant message**
  - **Trigger:** User sends a turn; agent responds.
  - **Actors:** A2, A3
  - **Steps:** Strands emits a stream of `UIMessage.part` chunks (text / reasoning / tool / fragment / source). AppSync subscription delivers chunks to the client. The custom `useChat` transport adapter merges chunks into `useChat`'s message buffer. AI Elements components render each part type (`<Response>` for text, `<Reasoning>` for reasoning, `<Tool>` for tool calls, `<JSXPreview>` for inline fragments) as the parts arrive.
  - **Outcome:** Thread renders the assistant's full message with each part in its appropriate visual primitive, streaming progressively.
  - **Covered by:** R3, R7, R8, R9.

- F2. **Agent emits a full-canvas artifact**
  - **Trigger:** Agent decides to produce a structured artifact (chart, dashboard, applet, web preview, sandbox).
  - **Actors:** A2, A3
  - **Steps:** Agent emits a `UIMessage` part of kind `artifact` carrying JSX/TSX source. Client receives via `useChat`. The artifact panel shell mounts via `<Artifact>`; `<JSXPreview>` (or `<WebPreview>` / `<Sandbox>`) compiles + executes the source client-side, constrained to the AI Elements + shadcn import surface.
  - **Outcome:** Right-hand panel renders the LLM-authored React artifact within the constrained component vocabulary.
  - **Covered by:** R4, R6, R11, R12, R13.

- F3. **Inline fragment in a thread message**
  - **Trigger:** Agent response includes an inline visualization (chart, map, table, mini-applet) within the thread, not the canvas.
  - **Actors:** A2, A3
  - **Steps:** Strands emits a `fragment`-kind part inside the message. The thread surface mounts the fragment via `<JSXPreview>` inline within `<Response>` content, reusing the same client-side compilation substrate as full-canvas artifacts.
  - **Outcome:** Inline visualization renders in-flow with surrounding markdown text. No fenced-spec dialect involved.
  - **Covered by:** R3, R6, R11, R12, R14.

---

## Requirements

**Component vocabulary**

- R1. Adopt Vercel AI Elements as the consistent component vocabulary across the LLM UI in `apps/computer`. Components are installed via the shadcn-style copy-paste flow (e.g. `npx ai-elements add <component>`) into the app's source tree, not as a runtime dependency.
- R2. Component coverage at v1 includes at minimum: `<Conversation>`, `<Message>`, `<Response>`, `<Reasoning>`, `<Tool>`, `<CodeBlock>`, `<Artifact>`, `<WebPreview>`, `<JSXPreview>`, `<Sandbox>`, `<PromptInput>`. Additional AI Elements components are added as `UIMessage` parts light them up.
- R3. The thread surface (`TaskThreadView`, `StreamingMessageBuffer`) renders messages via AI Elements primitives. No raw-text rendering remains in the LLM-UI surfaces.
- R4. The artifact panel (`AppArtifactSplitShell`, `GeneratedArtifactCard`, the eight dashboard-artifact components) is wrapped in `<Artifact>` and renders content via `<JSXPreview>` / `<WebPreview>` / `<Sandbox>` as appropriate to the artifact kind.
- R5. The composer migrates to `<PromptInput>` (with `<Suggestions>` and `<Actions>` where useful).
- R6. Agent-authored UI (full-canvas artifacts and inline fragments) is constrained to the AI Elements + shadcn primitive vocabulary. The model is instructed and prompted to emit only that vocabulary; the runtime additionally enforces it via the import surface (R13).

**Chat-state and wire format**

- R7. The thread surface uses the AI SDK `useChat` hook for chat-state lifecycle: streaming status, error / retry handling, branch and regenerate, tool-call streaming.
- R8. A custom `useChat` transport adapter bridges the existing AppSync subscription chunk stream to the AI SDK message protocol. The AppSync streaming wire is preserved; HTTP SSE replacement is rejected.
- R9. Messages flow through the system in `UIMessage` shape end-to-end. The Strands runtime emits `UIMessage.part` shapes (text / reasoning / tool / file / source / fragment). AppSync `ComputerThreadChunkEvent` carries part-shaped chunks. The client consumes them directly through AI Elements components.
- R10. Persisted message storage adopts `UIMessage` shape for new messages. Historical persisted messages keep their legacy text representation and render through a backwards-compatible path; no backfill is required.

**Fragment substrate**

- R11. Plan-001 (Applets reframe) generalizes from "full-canvas artifact runtime" to a unified LLM-authored React-fragment substrate. Each fragment renders inside its own iframe-isolated execution context — inline fragments mounted via `<JSXPreview>` inside `<Response>` and full-canvas fragments mounted via `<JSXPreview>` inside `<Artifact>` share one iframe substrate.
- R12. Compilation of LLM-authored React fragments happens inside the client (within the iframe runtime), not on the server. The agent may use AgentCore code-interpreter tooling to compute or analyze data feeding a fragment, but the compile step itself runs in the browser and fragments are not pre-bundled before delivery.
- R13. Fragments execute against a constrained surface at two layers: (a) **import-time** — only AI Elements + shadcn primitives + a small whitelisted utility set are resolvable; arbitrary npm imports are rejected at compile time with a clear error the agent can self-correct from; (b) **runtime** — the iframe sandbox + CSP block agent-emitted side-effects (`fetch`, `localStorage`, parent-DOM access) from reaching the host origin. Same-origin execution of agent-authored fragments is rejected for blast-radius reasons.
- R17. Parent app ↔ fragment iframe communication uses an explicit message-passing protocol carrying theme tokens (so shadcn primitives inherit the app's visual style), layout signals (height / focus), and declared event callbacks. Fragments cannot reach the parent through shared globals, the DOM, or untyped channels — the protocol is the only contract.

**Migration and supersession**

- R14. Plan-008 (`docs/plans/2026-05-09-008-feat-computer-thread-inline-visualizations-plan.md`) and its requirements doc (`docs/brainstorms/2026-05-09-computer-thread-inline-visualizations-requirements.md`) are marked superseded by this brainstorm. The fenced `chart-spec` / `map-spec` markdown dialect is dropped. Inline charts and maps are produced as agent-authored React fragments instead.
- R15. Plan-001 (Applets reframe) is updated to reflect its expanded role as the unified fragment substrate before implementation begins. If the rewrite is large, plan-001 is superseded by a new plan that captures the unified scope.
- R16. The full sweep is sequenced surface-first per Approach A in this order: **Phase 0** install AI Elements + theme tokens + transport-adapter scaffold; **Phase 1** Strands `UIMessage` part emission + thread surface adopts `useChat` and `<Message>`/`<Response>`; **Phase 2** fragment substrate generalizes plan-001; **Phase 3** artifact panel + composer migrate; **Phase 4** typed parts (`<Reasoning>`, `<Tool>`, `<CodeBlock>`, etc.) light up as Strands emits them.

---

## Acceptance Examples

- AE1. **Covers R6, R13.** Given an agent emits a fragment containing `import { Foo } from 'lodash'`, when the substrate compiles the fragment, the import resolver rejects the unknown module and surfaces a clear error indicating only AI Elements + shadcn primitives + whitelisted utilities are available — the agent can self-correct on the next turn.
- AE2. **Covers R10, R14.** Given a user opens an existing thread persisted before this migration, when the thread renders, legacy messages display via a backwards-compatible text-rendering path — no backfill is required and no message is dropped.
- AE3. **Covers R8, R9.** Given Strands streams a sequence of mixed-type parts (`text → tool → reasoning → text → fragment`), when chunks arrive at the client, the `useChat` transport adapter delivers them in arrival order and AI Elements components render each part with its correct primitive — no chunk is misclassified or rendered as plain text.
- AE4. **Covers R1, R3.** Given a developer searches `apps/computer/src/components/` for raw `<span>{text}</span>` or `react-markdown` after the sweep is complete, when the search runs, no LLM-UI rendering surface uses either pattern — every assistant-message render path goes through AI Elements primitives.
- AE5. **Covers R13, R17.** Given an agent emits a fragment containing `useEffect(() => fetch('/api/secrets'))`, when the fragment runs inside its iframe sandbox, the request is blocked at the runtime boundary — even if the import-map check would have passed, the iframe CSP prevents exfiltration to the host origin. The error is visible to the parent for telemetry but never executes against host-origin resources.

---

## Wire-shape diagram

```
Strands runtime (Python)
  │  emits UIMessage.part chunks
  │  text / reasoning / tool / file / source / fragment
  ▼
AppSync subscription (ComputerThreadChunkEvent carries part-shaped chunks)
  │
  ▼
useChat transport adapter (client)
  │  bridges AppSync subscription ↔ AI SDK message protocol
  ▼
useChat hook (state, tool lifecycle, retry, branch, regenerate)
  │
  ▼
AI Elements components in TaskThreadView:
  • <Message> + <Response>           ← text parts (markdown via streamdown)
  • <Reasoning>                      ← reasoning parts
  • <Tool>                           ← tool parts
  • <JSXPreview>  inline             ← fragment parts within <Response>
  • <Artifact> + <JSXPreview>        ← full-canvas artifacts in side panel
  • <WebPreview> / <Sandbox>         ← specialized artifact kinds
```

---

## Success Criteria

- Thread, artifact panel, and composer in `apps/computer` use AI Elements components consistently — no raw-text or custom message-bubble rendering remains in the LLM-UI surfaces, and the eight bespoke dashboard-artifact components are reachable through `<Artifact>` rather than ad-hoc shells.
- Strands emits `UIMessage`-shaped chunks; the client consumes them via `useChat` with the AppSync transport adapter; any new agent capability that introduces a new `UIMessage.part` type can light up its corresponding AI Elements component without rewriting the client message-handling layer.
- LLM-authored React fragments render reliably inline AND in the artifact panel through one substrate. Plan-001's runtime is the engine; the fenced chart-spec / map-spec dialect from plan-008 no longer exists in the codebase.
- Downstream planning (`/ce-plan`) has enough detail to begin sequencing PRs without re-litigating the AI SDK adoption decision, the wire-shape decision, or the fragment-substrate unification.

---

## Scope Boundaries

- Mobile (`apps/mobile`) — React Native + NativeWind, separate evolution track. AI Elements is web-only.
- Admin SPA (`apps/admin`) — operator surface, not LLM-facing chat.
- Replacing AppSync with HTTP SSE for chat streaming. AppSync stays; the transport adapter handles the impedance mismatch.
- Server-side React compilation or pre-bundled fragment delivery. Compilation is client-side only for v1.
- Adopting AI SDK's full server runtime (`createDataStreamResponse`, the `ai` package's server helpers). Only the components, the `useChat` hook, and the `UIMessage` shape are adopted.
- Visual theme overhaul beyond what shadcn defaults give for free.
- Backfilling historical persisted threads to `UIMessage` shape — old threads keep the legacy text-rendering path indefinitely.
- Plan-009 onwards (skills/workflows/customize-workspace plans listed in the unstaged docs/plans/) — those are separate workstreams with their own brainstorms.
- Same-origin execution of LLM-authored fragments — rejected for security reasons. All fragments run in iframe-isolated sandboxes regardless of size or surface (inline vs canvas).

---

## Key Decisions

- **Approach A (surface-first sweep)**: chosen because it ships the visible vocabulary fastest and lets streaming-schema work follow rather than block the visual win. Schema-first (B) would spend weeks of plumbing before any user-visible change; plan-008-wedge (C) would slow the broader sweep.
- **Applets-on-AI-Elements**: chosen because two efforts (plan-001's TSX runtime + AI Elements artifact components) target the same surface; collapsing them avoids parallel substrates with their own mental models.
- **All-in on AI SDK ecosystem (components + `useChat` + `UIMessage` shape)**: chosen because halfway adoption forces reimplementation of whichever piece is skipped — especially the tool-call lifecycle in `useChat`. Per the _decisive-over-hybrid_ posture, the package deal is cleaner than picking three of four.
- **AppSync transport adapter, not HTTP SSE**: chosen to preserve the recent investment in AppSync chunk streaming, the AWS-native posture, and the existing GraphQL subscription topology. The adapter is real but bounded engineering.
- **Plan-008 superseded**: chosen because the fenced `chart-spec`/`map-spec` dialect becomes redundant once LLM-authored React fragments cover inline visualizations. The earlier Vercel-style-fragments rejection in plan-008's brainstorm was for adopting the substrate without a unifying strategy; that strategy now exists.
- **Vercel-style runtime fragments revisited**: chosen because plan-001 + plan-008 + AI Elements artifact components were converging toward this substrate anyway. One substrate beats three near-misses.
- **Fragment isolation: iframe-isolated**: chosen over plan-001's prior same-origin direction because the enterprise-scale context (4 enterprises × 100+ agents per `project_enterprise_onboarding_scale`) and the SOC2 Type 2 motion (per `project_soc2_type2_ai_strategic_horizon`) make agent-emitted-code blast-radius a real architectural concern. Same-origin execution leaves fetch-based exfiltration and DOM access reachable even with import-map enforcement; iframe isolation contains both. Per-fragment iframe overhead is acceptable on modern browsers for the expected fragment density (1-3 inline per message + occasional canvas).

---

## Dependencies / Assumptions

- AI Elements (web React + Tailwind 4 + Radix + React 19) is compatible with `apps/computer`'s stack. The `streamdown` dependency (used by `<Response>`) has already landed transitively, raising the Node floor to 22 — that floor is now in CLAUDE.md.
- AI SDK `UIMessage` shape is stable enough across minor versions to pin within the v1 implementation window without recurring breaking changes. Major-version breaks are accepted as future migration cost.
- Strands can emit `UIMessage`-shaped JSON chunks via a thin Python-side adapter at the runtime → AppSync boundary.
- The Bedrock model family in current use can be reliably constrained to emit AI Elements + shadcn JSX. Empirical compliance rate is unknown and surfaces under Outstanding Questions.
- `useChat`'s extension points support custom transports for non-HTTP protocols (or can be wrapped to do so). Verification deferred to planning.
- Plan-001 has not yet shipped its TSX runtime — generalizing it before implementation is cheaper than retrofitting after the fact.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R11, R17][Technical] **Iframe hosting mechanism.** `srcdoc` with the `sandbox` attribute (cheapest, no infrastructure), separate subdomain like `sandbox.thinkwork.ai` (true cross-origin, requires DNS/cert work), or path-based isolated document. Affects CSP scope, communication-protocol surface, and theme inheritance. Resolve during plan-001 update.
- [Affects R17][Technical] **Parent ↔ iframe message protocol shape.** Raw `postMessage` with a custom envelope, `MessageChannel` ports, or a Comlink-style RPC wrapper. Affects ergonomics of declaring fragment event callbacks and theme-token propagation. Resolve during planning.
- [Affects R11][Technical] **Fragment iframe lifecycle.** Are iframes pooled and reused across streaming chunks, or torn down + recreated per fragment? Affects perceived perf, streaming smoothness, and memory footprint when many inline fragments are present.
- [Affects R10][Technical] **`messages` schema migration shape.** Store `UIMessage` shape as a JSON column on the existing `messages` table, or decompose `UIMessage.parts` into typed part tables? JSON-column ships faster; typed-tables index/query better. Resolve when the schema migration is planned.
- [Affects R8][Technical] **`useChat` transport extension point.** Does `useChat` accept a custom transport interface directly, or does the adapter need to conform to an HTTP-shaped contract and emulate streaming responses? Verify against AI SDK docs/source during planning.
- [Affects R9][Needs research] **Strands Python-side `UIMessage` emitter.** Is there a reusable AI SDK Python emitter, or does the adapter need to be hand-rolled? Investigate before implementing the Strands adapter.
- [Affects R6][Needs research] **LLM compliance with constrained component vocabulary.** What is the empirical compliance rate from current Bedrock model families when prompted to emit only AI Elements + shadcn JSX? Test before wiring the import-map enforcement gate so failure-mode behavior is realistic.
- [Affects R13][Technical] **Import-map enforcement mechanism.** Does the existing plan-001 sucrase pipeline support an import allowlist, or does the substrate need a custom resolver? Resolve during the plan-001 update.
- [Affects R2][Needs research] **AI Elements installation footprint inside a pnpm workspace.** Does `npx ai-elements add` play cleanly with the monorepo (paths, `@thinkwork/ui` co-existence, Tailwind config)? Smoke-test before phase-0 install lands.
