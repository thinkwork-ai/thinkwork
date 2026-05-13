---
date: 2026-05-13
topic: computer-inline-genui-fragment-lifecycle
---

# Computer Inline GenUI — fragment lifecycle (streaming, identity, ephemeral-by-default)

## Summary

Add an inline-streaming GenUI lifecycle to the Computer chat. The Computer agent emits identity-bearing fragments that stream into the message stream itself, can be refined by subsequent user prompts and mutate in place against their original chat bubble, and persist only when the user explicitly promotes them to a saved artifact. The experience ships on the existing AI Elements + `JSXPreview` iframe-sandbox substrate; the AG-UI vs `UIMessage` wire-protocol decision is deferred to a bounded second wave once real usage evidence exists.

---

## Problem Frame

Today every artifact the Computer agent produces is persisted through `save_app` as a side effect of the agent turn. The user sees the result only after the artifact panel opens in the side canvas, after persistence completes, and only as a fully-saved entity. Two compounding pains follow:

- **Noise from save-everything.** Threads accumulate one persisted artifact per agent turn that produces visual output — including throwaway charts, draft tables, refinements-of-refinements. The artifact library becomes a junk drawer rather than a curated collection.
- **No in-place refinement.** When the user types "make the chart bigger" or "show the same metric for last month," the agent re-produces a new artifact rather than updating the existing one in the thread. The mental model is "every refinement is a new thing," which contradicts the conversational model a chat surface is supposed to embody.

In parallel, a desirable experience pattern has shown up in external demos: GenUI components stream **inline** in the message stream and update **in place** as the conversation continues. CopilotKit popularized the pattern through its Generative UI framework and the AG-UI wire protocol it promotes. The pull from the user is for that experience, not the runtime — they are willing to roll homegrown on the existing substrate provided streaming and in-place mutation work reliably.

The 2026-05-12 brainstorm already committed to a constrained shadcn-only authoring vocabulary inside TSX artifacts; the 2026-05-09 brainstorm already committed to AI Elements + `useChat` + `UIMessage` end-to-end and `JSXPreview` as the iframe-sandboxed fragment renderer. Both commitments are intact. What is missing is the *lifecycle* layered on top: fragments living in chat, addressed by identity, mutated in place, and persisted only on user gesture.

---

## Actors

- A1. **End user** — converses with the Computer agent in `apps/computer`; sees GenUI fragments stream into the message stream; refines them by typing follow-ups; explicitly saves the ones worth keeping.
- A2. **Computer agent (Strands runtime)** — produces GenUI fragments as part of its response stream; addresses existing fragments by identity to update them on refinement turns; remains the sole authoring surface for TSX (shadcn-only vocabulary unchanged from 2026-05-12).
- A3. **`apps/computer` shell** — renders fragments inline in chat via `JSXPreview` + iframe sandbox; preserves fragment identity across stream updates; surfaces the "Save to artifacts" gesture per fragment.
- A4. **Save-artifact path** — promotes an ephemeral inline fragment to a persistent artifact at user request, capturing the fragment's TSX as it exists at save-time.
- A5. **AppSync subscription transport** — carries the new `inline-fragment` part type alongside existing `UIMessage` parts; no protocol replacement.

---

## Key Flows

- F1. Agent emits a new inline fragment
  - **Trigger:** Agent decides a result is best expressed as inline GenUI rather than text or a canvas artifact.
  - **Actors:** A2, A5, A3, A1.
  - **Steps:** Agent emits a `UIMessage` part of kind `inline-fragment` carrying TSX and a freshly-assigned fragment ID → AppSync streams the chunks → client mounts `JSXPreview` inside the message bubble keyed on fragment ID → fragment renders progressively as the TSX streams.
  - **Outcome:** Fragment is visible inline in the thread, ephemeral, not persisted, identifiable for future mutation.
  - **Covered by:** R1, R2, R3, R4, R7.

- F2. User refines an existing inline fragment
  - **Trigger:** User types a follow-up that references an inline fragment ("make the chart wider," "show last month").
  - **Actors:** A1, A2, A3.
  - **Steps:** User sends turn → agent resolves the natural-language reference to the relevant fragment ID → agent emits an `inline-fragment` part addressed to that ID with updated TSX → client identifies the existing fragment bubble by ID and replaces its TSX content in place without unmounting the bubble or creating a new one.
  - **Outcome:** The original chat bubble updates with the refined fragment; thread history shows one bubble, not two.
  - **Covered by:** R5, R6, R7, R8.

- F3. User saves an inline fragment as a persistent artifact
  - **Trigger:** User clicks the per-fragment "Save to artifacts" affordance on the bubble.
  - **Actors:** A1, A3, A4.
  - **Steps:** Client captures the fragment's current TSX → routes through the save-artifact path → existing shadcn-only validator runs unchanged → artifact persists through the standard storage path → the inline fragment in the thread continues to exist and can continue to mutate; the saved artifact is a snapshot at save-time.
  - **Outcome:** A persistent artifact exists in the user's artifact library at the captured state; the in-thread fragment is unchanged.
  - **Covered by:** R9, R10, R11.

- F4. User reopens a thread containing inline fragments
  - **Trigger:** User reopens an existing thread.
  - **Actors:** A1, A3.
  - **Steps:** Client fetches thread history → each inline fragment renders via `JSXPreview` keyed on its original fragment ID → fragments render at the final state from their last mutation in that thread session.
  - **Outcome:** Reopened threads show fragments in the form they had at the end of the original session.
  - **Covered by:** R12.

- F5. Existing canvas artifacts continue to render
  - **Trigger:** User opens an already-promoted artifact via the artifact panel.
  - **Actors:** A1, A3.
  - **Steps:** Unchanged from today's `AppArtifactSplitShell` path.
  - **Outcome:** Canvas artifacts render identically to before this brainstorm; the new lifecycle adds a path without retiring the existing canvas-panel render path.
  - **Covered by:** R13.

---

## Requirements

**Inline fragment lifecycle**
- R1. The Computer agent may emit GenUI fragments as inline parts of a thread message. Inline is the default render surface for GenUI; canvas (`AppArtifactSplitShell`) is used only for explicitly-promoted artifacts.
- R2. Each inline fragment carries a stable fragment ID, assigned by the agent or runtime at emit time, that uniquely identifies it within the thread.
- R3. Inline fragments are ephemeral by default. No `save_app` or equivalent persistence runs automatically on emit.

**Streaming**
- R4. Fragment TSX streams into the bubble progressively, compiling and rendering as chunks arrive through `JSXPreview`. Partial render is acceptable until the full TSX module is received and the final compile completes.

**Identity and in-place mutation**
- R5. Subsequent agent emissions addressed to an existing fragment ID replace that fragment's TSX content in place. The chat bubble hosting the fragment is not unmounted, duplicated, or moved.
- R6. The Computer agent is the authority for resolving a user's natural-language reference (e.g., "make the chart bigger") to a specific fragment ID. The client does not infer the target.
- R7. Bidirectional refinement is single-fragment-scoped per agent turn. A user prompt that names changes to multiple fragments at once is decomposed by the agent into multiple addressed updates or surfaced as a clarifying question.
- R8. When a fragment is replaced in place, the prior TSX is not retained in thread history. Thread history reflects the latest state of each fragment, not its mutation log.

**Save-to-artifact gesture**
- R9. Each inline fragment surfaces a "Save to artifacts" affordance scoped to that fragment. The affordance is a single user action.
- R10. Saving captures the fragment's TSX as it exists at the moment of save. Subsequent in-thread mutations of the still-ephemeral original do not retroactively change the saved artifact.
- R11. Saving routes the captured TSX through the existing shadcn-only validator (2026-05-12 brainstorm) and the existing artifact persistence path. No new validator, vocabulary, or storage path is introduced.

**Thread reopen behavior**
- R12. When a user reopens a thread containing inline fragments, each fragment renders at the final state it held at the end of the prior session. Mutation history within the thread is not replayed.

**Coexistence with existing artifact path**
- R13. The existing canvas-panel artifact path (`AppArtifactSplitShell`, the dashboard-artifact components, `save_app` for explicit canvas authoring) continues to render already-promoted artifacts. The new inline lifecycle adds a path; it does not retire one.

**Wire format**
- R14. The new `inline-fragment` `UIMessage` part type is additive to the 2026-05-09 wire format. Strands continues to emit `UIMessage` parts; the client continues to consume them via `useChat` and the AppSync transport adapter. No replacement of the wire protocol is in scope for this wave.

**Authoring vocabulary**
- R15. TSX inside inline fragments obeys the same shadcn-only authoring vocabulary as canvas artifacts (per the 2026-05-12 brainstorm). The validator, allowlist, and shadcn MCP catalog apply identically to inline and canvas fragments. There is no separate vocabulary for inline content.

**Security**
- R16. Inline fragments execute inside the same iframe-isolated sandbox as canvas fragments. The 2026-05-09 security invariant (no same-origin execution of agent-emitted code; `fetch` and host-DOM access blocked at the iframe boundary) applies unchanged.

---

## Acceptance Examples

- AE1. **Covers R1, R3, R4.** Given the agent decides to express a monthly-revenue chart as an inline fragment, when the agent emits an `inline-fragment` part with TSX, the chat bubble streams the fragment progressively into the message, no `save_app` call is issued, and no entry appears in the user's persistent artifact library until and unless the user explicitly saves.

- AE2. **Covers R5, R8.** Given an inline revenue chart is rendered in the thread with fragment ID `f-abc123`, when the user says "make it a bar chart" on the next turn and the agent emits a new `inline-fragment` part addressed to `f-abc123`, then the existing chat bubble updates in place with the bar-chart TSX and no second bubble or duplicate fragment appears anywhere in the thread.

- AE3. **Covers R6, R7.** Given two inline fragments — a chart at `f-abc123` and a table at `f-def456` — and a user prompt "add a column to the table," when the agent emits an addressed update to `f-def456` only, then the chart bubble is unchanged and the table bubble updates in place.

- AE4. **Covers R9, R10.** Given an inline fragment in its third mutation state, when the user clicks "Save to artifacts" on the fragment, then a persistent artifact is created capturing the fragment's TSX as it exists at that moment, and a subsequent fourth in-thread mutation of the still-ephemeral original leaves the saved artifact untouched.

- AE5. **Covers R11, R15.** Given the agent attempts to emit an inline fragment importing `lucide-react`, when the validator runs on save or on a pre-save vocabulary check, the same shadcn-only rejection path fires that already applies to canvas artifacts — no separate inline-vs-canvas vocabulary divergence is introduced.

- AE6. **Covers R12.** Given a thread containing two inline fragments that were each mutated three times during the prior session, when the user reopens the thread the next day, then each fragment renders at its third-mutation state and no prior states are re-streamed or replayed.

- AE7. **Covers R13.** Given a previously-saved canvas artifact and a new inline fragment in the same thread, when the user opens both, then the canvas artifact renders through the existing `AppArtifactSplitShell` path and the inline fragment renders inline in the message stream; neither path interferes with the other.

- AE8. **Covers R16.** Given an inline fragment whose TSX contains `useEffect(() => fetch('/api/secrets'))`, when the fragment runs inside its iframe sandbox, the request is blocked at the runtime boundary identically to canvas fragments — there is no security concession for the inline render path.

---

## Visual Aid

| Lifecycle stage | Today (canvas-only) | After this brainstorm (inline + promote) |
|---|---|---|
| Agent emits GenUI | Always persisted via `save_app`; opens in canvas panel | Inline part streams into chat bubble; ephemeral; no persistence |
| User refines | "Refine" produces a new canvas artifact, separate from prior | Same bubble, same fragment ID, content replaced in place |
| Save lifecycle | Implicit (every artifact saved) | Explicit user gesture per fragment |
| Artifact library | Junk drawer (every refinement persisted) | Curated (only user-saved promotions) |
| Wire protocol | `UIMessage` parts (text, reasoning, tool, fragment) | `UIMessage` parts + new `inline-fragment` part type |
| Authoring vocabulary | shadcn-only (2026-05-12) | shadcn-only — unchanged, applied uniformly |
| Execution sandbox | iframe-isolated (2026-05-09) | iframe-isolated — unchanged |
| Protocol governance | `UIMessage` | `UIMessage` (AG-UI deferred to wave two) |

---

## Success Criteria

- The Computer agent reliably emits inline fragments that stream into the chat message stream and render progressively via `JSXPreview` + iframe sandbox.
- A user can refine an inline fragment by typing a natural-language follow-up and see the existing chat bubble update in place, without a duplicate bubble appearing in the thread.
- The user's artifact library contains only artifacts they explicitly saved. The "save everything" default is retired and the library is materially less noisy in a side-by-side comparison with today.
- The 2026-05-12 shadcn-only validator and the 2026-05-09 iframe-sandbox security invariant remain governing for inline fragments without modification.
- The today-plan `docs/plans/2026-05-13-001-feat-fast-tsx-artifact-preview-plan.md` is marked superseded by this brainstorm in its header, and `ce-plan` is run fresh against this document.
- A reader of this doc plus one follow-on planning doc can implement v1 without re-litigating the framework choice (CopilotKit, AG-UI, AI Elements) or the wire-protocol shape.
- Wave two (AG-UI vs `UIMessage` protocol decision) can be evaluated against real usage evidence — fragment counts per thread, mutation rates, save rates — collected from the v1 lifecycle.

---

## Scope Boundaries

### Deferred for later

- Cross-fragment refinement in a single user turn (one prompt mutating multiple fragments simultaneously). Multi-fragment edits are decomposed by the agent or surfaced as clarifying questions in v1.
- Backfilling existing in-thread artifacts to the new lifecycle. Existing threads continue to render through their current path; only newly-emitted fragments use the new lifecycle.
- Adopting AG-UI as the wire protocol. Decision deferred to wave two after 2–3 weeks of v1 usage; the explicit purpose of wave two is to evaluate AG-UI against accumulated evidence.
- Storing fragment mutation history. Each fragment carries only its current TSX in v1; prior states are not retained server-side for replay or audit.
- Visual chrome changes for already-promoted canvas artifacts. The `AppArtifactSplitShell` path is unchanged.
- Mobile (`apps/mobile`). Separate evolution track per the 2026-05-09 brainstorm.

### Outside this product's identity

- Adopting CopilotKit's runtime (`@copilotkit/runtime`). The pull is the experience pattern, not the orchestrator. Running it alongside Strands creates a second LLM ↔ tool orchestrator with overlapping responsibilities; replacing Strands outright contradicts the AWS-native posture and undoes a commitment less than a week old. The value the user named is reachable without either.
- Adopting CopilotKit's React component library wholesale. `JSXPreview` is on disk, wired into the iframe-sandbox substrate, and governed by the shadcn-only authoring vocabulary. A second component vocabulary alongside it produces drift, not capability.
- A v0 / Replit / bolt.diy substrate swap. The substrate is unchanged; the lifecycle is what changes.
- Re-litigating the 2026-05-12 shadcn-only validator decision. Authoring vocabulary is unchanged.
- Re-litigating the 2026-05-09 iframe-sandbox security invariant. Security model is unchanged.
- Replacing the Strands → AppSync → `useChat` → AI Elements pipeline. The new part type sits on top of it.
- Multi-user collaborative editing on a shared inline fragment. Single-user thread semantics only.

---

## Key Decisions

- **Approach C (sequence) over A (homegrown forever) or B (AG-UI from day one).** The load-bearing bet is the experience pattern (inline streaming + identity + ephemeral-by-default save). The wire-protocol question (AG-UI vs `UIMessage`) is downstream of that bet and bounded in cost. Sequencing lets the experience prove itself on the existing substrate, lifts the protocol decision out of theory and into evidence, and contains the cost of a later swap to a Strands emitter + one client adapter rather than a substrate rewrite.

- **No CopilotKit runtime adoption.** The user's pull was for the experience pattern, not the orchestrator. Adopting `@copilotkit/runtime` would either run a second LLM ↔ tool orchestrator alongside Strands (with overlapping responsibilities) or replace Strands outright (contradicting the AWS-native posture and undoing a chunk of the 2026-05-09 commitment). Neither is justified by the stated value.

- **No CopilotKit component library adoption.** `JSXPreview` is already on disk, already wired into the iframe-sandbox substrate, and already governed by the shadcn-only authoring vocabulary. Swapping it for CopilotKit components introduces a second component vocabulary with no offsetting capability win.

- **AG-UI deferred, not rejected.** AG-UI is a forming protocol with real interop upside if it lands as a standard, but adoption today would partially undo the 2026-05-09 `UIMessage` commitment without usage evidence justifying the swap. Deferral retains AG-UI as a live option whose cost is sized and whose decision criteria are clear (usage data from v1).

- **`inline-fragment` is an additive `UIMessage` part type, not a replacement.** The existing pipeline already carries multiple part types (text, reasoning, tool, fragment). Adding one more is a small extension; replacing the pipeline shape would be a substantial change to a commitment less than a week old.

- **Fragment identity is agent-assigned and opaque to users.** Putting identity in the user's mental model ("address fragment #3") leaks an internal contract into the product surface and prevents the agent from doing natural-language reference resolution well. Keeping IDs internal lets users speak conversationally and the agent translate.

- **Promote-to-artifact captures a snapshot.** The alternative (saved artifact is a live mirror of the in-thread fragment) creates spooky-action behavior — a saved artifact silently changes because a thread mutation occurred later. Snapshot semantics match the user's mental model of "save" as a deliberate capture.

- **Today-plan `docs/plans/2026-05-13-001-feat-fast-tsx-artifact-preview-plan.md` is superseded.** Its central goal ("fast unsaved preview") is subsumed into the broader inline + identity + ephemeral-by-default lifecycle. Leaving it active would create two parallel plans solving overlapping problems.

---

## Dependencies / Assumptions

- The existing AI Elements + `useChat` + `UIMessage` end-to-end pipeline (2026-05-09 brainstorm) continues to operate as the chat substrate. This brainstorm extends it; it does not replace it.
- The existing shadcn-only validator and shadcn MCP catalog (2026-05-12 brainstorm) continue to govern TSX authoring. They apply to inline fragments without modification.
- The existing iframe-sandbox execution model (2026-05-09 brainstorm) continues to host all agent-emitted TSX, inline and canvas alike.
- `apps/computer/src/components/ai-elements/jsx-preview.tsx` is reachable from chat-bubble render code, accepts streaming TSX input, and can mount inside a thread message container without architectural change. Renderer suitability for in-place mutation is to be validated during planning.
- `useChat`'s message-parts model supports addition of a new typed part (`inline-fragment`) without rewriting message-handling internals. Verification deferred to planning.
- Strands can emit a `UIMessage` part type carrying both TSX content and a fragment ID; the existing `UIMessage` emitter is the right hook to extend.
- AppSync's `ComputerThreadChunkEvent` envelope can carry the new part type without schema change beyond adding the part-kind value.
- Thread reopen semantics (R12, AE6) rely on existing thread-history persistence carrying the `inline-fragment` part type for new messages. Backfill of pre-existing threads is not required.
- Wave two (AG-UI vs `UIMessage` decision) is a separate brainstorm or plan; its trigger is "v1 has been in production for 2–3 weeks and we have fragment-count, mutation-rate, and save-rate data."

---

## Outstanding Questions

### Resolve Before Planning

*None. Brainstorm is closed.*

### Deferred to Planning

- [Affects R2, R5][Technical] **Fragment ID assignment authority.** Agent-assigned (Strands emits the ID alongside the TSX) vs. runtime-assigned (a Strands runtime wrapper assigns and threads IDs into emissions). Affects how the agent prompt or skill code references existing fragments on refinement turns.
- [Affects R5, R8][Technical] **In-place mutation mechanism in the React tree.** Key the `JSXPreview` element on fragment ID and let React reconcile the content swap, or push the new TSX into the existing `JSXPreview` instance through an imperative handle. Affects perceived smoothness and iframe lifecycle.
- [Affects R6][Technical] **Agent-side natural-language → fragment-ID resolution.** Skill prompt convention, dedicated tool call, or runtime-side resolver. Affects the agent's ability to disambiguate when multiple fragments could match.
- [Affects R9][Design] **Per-fragment "Save to artifacts" affordance placement and copy.** Hover affordance, kebab menu, fixed corner. Defer to design pass during planning.
- [Affects R12][Technical] **Inline-fragment persistence shape in thread history.** Same persistence path as other `UIMessage` parts, or a dedicated table for fragment-typed parts. Affects schema migration.
- [Affects R4][Technical] **`JSXPreview` streaming-compile behavior.** Does the existing compile pipeline handle progressive TSX input gracefully, or is buffered-then-compile the realistic v1 behavior? Affects perceived streaming smoothness.
- [Affects R10][Technical] **Save snapshot capture point.** Capture from the in-memory `JSXPreview` source, or fetch the latest emitted TSX from the message store. Affects race-condition behavior if save is clicked mid-stream.
- [Affects R8, R12][Needs research] **Empirical fragment count and mutation rate.** What density of inline fragments per thread is realistic, and how often will users refine? Drives wave-two protocol-decision criteria.
- [Affects R14][Needs research] **AG-UI evidence collection plan.** What metrics or events should v1 emit so wave-two can evaluate AG-UI adoption against real data rather than theory? Outline during planning.
