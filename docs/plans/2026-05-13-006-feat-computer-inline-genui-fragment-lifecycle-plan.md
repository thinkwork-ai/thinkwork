---
title: "feat: Computer inline GenUI fragment lifecycle"
type: feat
status: active
date: 2026-05-13
origin: docs/brainstorms/2026-05-13-computer-inline-genui-fragment-lifecycle-requirements.md
supersedes: docs/plans/2026-05-13-001-feat-fast-tsx-artifact-preview-plan.md
---

# feat: Computer inline GenUI fragment lifecycle

## Summary

Add an `inline-fragment` `data-*` `UIMessage` part type that extends the existing Strands publisher (`ui_message_publisher.py`) + TS parser/merge/render-switch substrate. Fragments stream into chat bubbles via `JSXPreview` with a shadcn-only `components` allowlist, are addressable by stable runtime-assigned IDs for in-place mutation across turns, are ephemeral by default in the `messages.parts` jsonb column, and promote to persistent artifacts through the existing `saveApplet` mutation on an explicit user gesture. Eight implementation units land across an inert vocabulary phase and a live emit/render/save phase following the repo's inert-first seam-swap pattern.

> **R16 caveat.** The original brainstorm asserts iframe-isolation for inline fragments; research found `JSXPreview` runs in-DOM today. Whether v1 ships with in-DOM + validator-as-boundary or routes inline fragments through the iframe substrate is **under brainstorm re-litigation** — see `## Deferred / Open Questions` at the end of this plan. The rest of this plan documents the in-DOM direction as the working assumption; the cascade of dependent open questions there marks what changes if the iframe direction is restored.

---

## Problem Frame

Today the Computer agent's prompt mandates a `save_app` call for any visual output, so every chart, table, or applet — including throwaways — lands as a persisted artifact opened in the canvas panel. The brainstorm `docs/brainstorms/2026-05-13-computer-inline-genui-fragment-lifecycle-requirements.md` retires that default by introducing an inline-in-chat lifecycle with explicit save-on-gesture; this plan operationalizes that lifecycle on top of the 2026-05-09 AI Elements + `useChat` + `UIMessage` substrate and the 2026-05-12 shadcn-only authoring vocabulary.

Phase 1 research surfaced two facts that shape implementation more than the brainstorm could anticipate:

1. **`JSXPreview` runs in the host page DOM, not an iframe.** The brainstorm's R16 (iframe-isolation invariant) is technically false against today's code — `react-jsx-parser` with `componentsOnly` + attribute/tag blacklists, plus the source-validator import allowlist and forbidden-pattern list in `packages/api/src/lib/applets/validation.ts`, IS the safety boundary today. The actual iframe sandbox (`apps/computer/src/applets/mount.tsx`) is reserved for already-saved applets surfaced via `InlineAppletEmbed`. This plan accepts in-DOM execution for ephemeral inline fragments and treats the source validator as the load-bearing security boundary, with R16 rewritten in Key Technical Decisions.
2. **The AppSync wire needs zero changes.** `ComputerThreadChunkEvent.chunk` is `AWSJSON` — opaque — and the existing typed publisher already validates a `data-*` extension prefix. A new part type is one new entry in two parallel allowlists (Python `_validate_chunk`, TS `parseChunkPayload`) plus a renderer case, not a schema migration.

The brainstorm's Outstanding-Question list also gets meaningful resolution from research: persistence uses the existing `messages.parts` jsonb column (no migration); fragment ID assignment is runtime-side (Strands wraps the emit); in-place mutation reuses the per-part-id cursor already shipped in `ui-message-merge.ts` for `text-delta`.

---

## System-Wide Impact

- **Strands runtime (Python):** `packages/agentcore-strands/agent-container/container-sources/ui_message_publisher.py` gains an `inline-fragment` validator branch + emit helpers; `server.py` gains a new agent-callable tool and a system prompt update. Toggle `ui_message_emit=True` continues to gate Computer-only emission.
- **AppSync wire:** no GraphQL schema change. The new part type rides the existing `AWSJSON` envelope.
- **Computer client (TS):** mirrors the Python wire allowlist in `apps/computer/src/lib/ui-message-chunk-parser.ts`; extends `apps/computer/src/lib/ui-message-merge.ts` for fragment-id-addressable replacement; adds a new switch case in `apps/computer/src/components/computer/render-typed-part.tsx` mounting `JSXPreview` with a shadcn-only `components` map; extends `normalizePersistedParts` in `apps/computer/src/components/computer/TaskThreadView.tsx` to rehydrate from `messages.parts`.
- **Computer system prompt:** retires the "always call `save_app` for visual outputs" instruction; reserves `save_app` for explicit save requests or canvas-sized outputs that the user names.
- **Validator path:** unchanged on save. `packages/api/src/lib/applets/validation.ts` continues to govern promoted artifacts; the validator-feedback retry loop runs at emit-time inside the Strands tool wrapper, not at the AppSync resolver.
- **Persistence:** `messages.parts` (jsonb) accepts the new part type without schema change. Mutation history is not retained server-side (R8).
- **Contract spec:** `docs/specs/computer-ai-elements-contract-v1.md` extends to include `inline-fragment`.
- **Test surfaces:** Python publisher tests, TS chunk-parser tests, merge tests, render-switch tests, AppSync publish tests, and Strands server-tool tests all get matching coverage.

---

## Key Technical Decisions

- **In-DOM execution for inline fragments; source-validator is the load-bearing safety boundary** (rewrites origin R16). `JSXPreview` runs `react-jsx-parser` with `componentsOnly` + blacklists in the host DOM. The source validator (no `fetch`, no `XMLHttpRequest`, no `eval`, no `Function`, no `localStorage`, no inline `on*` handlers) governs what TSX is ever emitted; the shadcn-only `components` map governs what JSX can resolve at render time. This plan accepts plan-001's R17 explicit-acceptance posture: routing inline fragments through the iframe sandbox is deferred until evidence warrants the cost (per-fragment iframe boot, theme-token RPC plumbing, streaming compile complexity). (see origin: brainstorm R16; user pick A in planning Q1)
- **Runtime-assigned fragment IDs; agent addresses by natural language.** Strands wraps the emit and threads UUIDs into the published chunk. The agent prompt convention is to address fragments by referent ("the chart", "the table") rather than by raw ID; the runtime resolves the natural-language reference to a fragment ID at tool-call time. Agent prompts never see UUIDs. (see origin: brainstorm Outstanding-Q on ID assignment authority and NL→ID resolution)
- **Persistence in existing `messages.parts` jsonb column.** No schema migration; existing serializer at `normalizePersistedParts` extends to parse `inline-fragment` parts. Avoids hand-rolled SQL and the drizzle-drift gate (see `feedback_handrolled_migrations_apply_to_dev`). (see origin: brainstorm Outstanding-Q on persistence shape)
- **In-place mutation reuses the per-part-id cursor already in `ui-message-merge`.** The `text-delta` case in `applyProtocolChunk` already locates an existing part by id and appends; `inline-fragment-replace` is a strict subset of that pattern (locate by id, replace TSX content). No new merge concept introduced.
- **Validator-feedback retry loop with 3-attempt cap at emit time.** When the Strands tool wrapper rejects emitted TSX against the source validator, it returns a structured rejection to the agent (offense + suggested shadcn equivalent, mirroring the 2026-05-12 brainstorm's R9). The agent retries up to 3 times within the same turn. On exhaustion, a user-facing diagnostic fragment surfaces in place of the failed render. Pattern adapted from `docs/solutions/architecture-patterns/recipe-catalog-llm-dsl-validator-feedback-loop-2026-05-01.md`.
- **Inert-first seam-swap as the multi-PR shape.** Units U1–U4 ship inert (Strands publisher accepts the new part type; client parses, merges, persists, and routes through a render switch that mounts a diagnostic-only placeholder). U5–U8 ship live in dependency order (save UI, Strands emit, render activation, system prompt). Body-swap forcing-function tests assert AppSync publish and JSXPreview render actually fire at the cutover. Pattern from `docs/solutions/architecture-patterns/inert-first-seam-swap-multi-pr-pattern-2026-05-08.md`.
- **Env snapshot at coroutine entry for Strands emit.** The new emit helper snapshots `THINKWORK_API_URL`, `API_AUTH_SECRET`, and any AppSync mutation auth header at agent-coroutine entry. No mid-turn re-reads of `os.environ`. (see `feedback_completion_callback_snapshot_pattern`)
- **Save promotes to the existing canvas-artifact path unchanged.** `saveApplet` mutation, S3 + artifacts table storage, `validateAppletSource` enforcement — all run identically to today. The plan adds no new persistence shape, no new validator, no new storage path. The "Save to artifacts" gesture is a UI affordance on the bubble that submits the fragment's current TSX through `saveApplet`. (origin R11, R13)
- **Empirical wire-format verification before the parser ships.** Before writing the TS parser branch, run a `curl` or harness sample through the live `publishComputerThreadChunk` mutation and log the raw chunk shape; don't trust the contract spec alone. (see `feedback_verify_wire_format_empirically`)
- **Validator-rule sharing via a shared spec under `docs/specs/`.** The emit-time Python validator and the save-time TS `validateAppletSource` derive from a single source of truth (a YAML or JSON spec under `docs/specs/`) loaded by both implementations at startup. Avoids the drift risk of porting rules into Python independently AND the round-trip cost of an internal HTTP endpoint. U6 is gated on the spec landing before its emit-time validator can ship; a U6 parity test asserts that identical invalid TSX is rejected by both Python and TS impls. (resolves Outstanding-Q from prior round; addresses load-bearing safety claim that the validator "runs at both emit-time and save-time")
- **Per-thread turn serialization assumed; verified empirically in U6.** The plan assumes the Strands runtime processes one agent turn at a time per thread — a follow-up user message queues until the prior agent response completes. This matches standard chat-agent harness behavior and means F2 (concurrent `emit_inline_fragment` calls against the same referent) does not produce a race. U6 includes an empirical verification step against the live Strands runtime; if the assumption is wrong, the decision flips to defining monotonic chunk ordering and U4 adds an interleaved-deltas test scenario.
- **Plan-001 (`docs/plans/2026-05-13-001-feat-fast-tsx-artifact-preview-plan.md`) is superseded by this plan.** Its `status` flips to `superseded` and a `superseded_by:` frontmatter entry points at this plan. (origin Success Criteria)

---

## High-Level Technical Design

Wire flow for emit, mutation, and save. This sketch is directional guidance for review, not implementation specification — the implementing agent should treat it as context, not code to reproduce.

```mermaid
sequenceDiagram
  participant Agent as Computer Agent (Strands)
  participant Tool as emit_inline_fragment tool
  participant Validator as Source validator (Python)
  participant Publisher as ui_message_publisher.py
  participant AppSync as AppSync subscription
  participant Merge as ui-message-merge.ts
  participant Render as render-typed-part.tsx
  participant JSXP as JSXPreview (shadcn allowlist)
  participant Save as saveApplet mutation

  Agent->>Tool: emit_inline_fragment(tsx, target_referent="the chart")
  Tool->>Tool: snapshot env at entry
  Tool->>Validator: validate TSX (shadcn-only + forbidden patterns)
  alt Validator passes
    Tool->>Tool: resolve referent -> fragment_id (new or existing)
    Tool->>Publisher: data-inline-fragment chunk {id, tsx, op: append|replace}
    Publisher->>AppSync: publishComputerThreadChunk
    AppSync->>Merge: chunk arrives
    Merge->>Merge: locate part by id, append or replace TSX
    Merge->>Render: AccumulatedPart updated
    Render->>JSXP: mount/update with new TSX + components allowlist
  else Validator fails (attempt < 3)
    Validator-->>Tool: structured rejection (offense + suggested fix)
    Tool-->>Agent: retry hint
    Agent->>Tool: emit_inline_fragment(corrected_tsx, ...)
  else Validator fails (attempt == 3)
    Tool->>Publisher: data-inline-fragment-diagnostic chunk {id, error}
    Publisher->>AppSync: publish
    Render->>Render: render diagnostic placeholder
  end

  Note over Render,Save: User clicks "Save to artifacts" on bubble
  Render->>Save: saveApplet(tsx_snapshot_at_click)
  Save->>Save: validateAppletSource (existing path, unchanged)
  Save-->>Render: artifact persisted; bubble continues to mutate independently
```

---

## Implementation Units

Eight units. Inert phase (U1–U4) lands the vocabulary, parser, merge, and render scaffold with no live emit and a diagnostic placeholder renderer. Live phase (U5–U8) wires the save UI, the Strands emit path, the render activation cutover, and the system prompt change.

### U1. Wire vocabulary (inert)

**Goal:** Add `data-inline-fragment` as a recognized part type in both the Python publisher and the TS parser, with structural validation. No emit, no render impact yet.

**Requirements:** R2, R14 (additive part type, no protocol replacement). Lays groundwork for R1, R5.

**Dependencies:** none.

**Files:**
- `packages/agentcore-strands/agent-container/container-sources/ui_message_publisher.py` — extend `_validate_chunk` to require `id` and a `data.tsx` field on `data-inline-fragment` chunks. Vocabulary collapses to a **single chunk type** (`data-inline-fragment`) — re-emitting the same `id` with new `data.tsx` triggers replacement via the existing data-* merge default branch. Add a `data-inline-fragment-diagnostic` shape requiring `id` and `data.error`. The `data-*` prefix already passes the generic guard at lines 372–405; this unit adds the specific schemas. Also add the public emit builders `inline_fragment_start(id, tsx)`, `inline_fragment_replace(id, tsx)`, and `inline_fragment_diagnostic(id, error)` alongside the existing mappers at ~lines 447–497 — they ship inert (no caller yet); U6 wires them.
- `apps/computer/src/lib/ui-message-chunk-parser.ts` — mirror the two sub-kinds (start/replace collapsed, diagnostic separate) in the TS parser. Maintain parity between Python and TS as the spec requires.
- `apps/computer/src/lib/ui-message-types.ts` — add `InlineFragmentPart` to the `AccumulatedPart` discriminated union **conforming to the canonical data-* envelope**: `{ type: 'data-inline-fragment', id: string, data: { tsx: string, status: 'streaming' | 'complete' | 'diagnostic', diagnostic?: string } }`. The discriminator stays `type`; payload lives under `data` to match every other data-* part.
- `docs/specs/computer-ai-elements-contract-v1.md` — extend with the `data-inline-fragment` family (shapes, semantics, in-place replace contract — re-emit with same id replaces).
- `docs/specs/inline-fragment-validator-rules.{yaml,json}` — **new shared spec** defining the forbidden-pattern list, shadcn-import allowlist, and any component-name restrictions. Both the U6 Python emit-time tool and the TS `validateAppletSource` will load this spec at startup.
- Python test: `packages/agentcore-strands/agent-container/test_ui_message_publisher.py`
- TS test: `apps/computer/src/lib/ui-message-chunk-parser.test.ts`
- TS test: `apps/computer/src/lib/ui-message-merge.test.ts` (assert parts are produced; no merge behavior change yet — merge wiring lands in U4)

**Approach:** Follow the existing pattern for `data-runbook-confirmation` etc. — schema validation lives in the publisher and parser in parallel, types in the canonical union. Maintain the rule that unknown `data-*` falls through to debug strip; explicit recognition tightens validation. The collapsed single-chunk-type vocabulary means the existing `findDataByTypeAndId` locate path in `ui-message-merge.ts` works without special-casing — re-emit with same id triggers replacement via the existing default data-* branch.

**Patterns to follow:** `data-runbook-queue` and `data-task-queue` in both Python and TS files give the prop-shape and parity pattern. Note that publisher-side per-data-subtype validation is a **new pattern** in this codebase — the existing data-* types are not validated beyond the generic `data-*` prefix guard; U1 introduces per-data-subtype required-field validation as a new shape, not a continuation of an existing one.

**Test scenarios:**
- Python: valid `data-inline-fragment` with `id` + `data.tsx` passes `_validate_chunk`.
- Python: missing `id` on `data-inline-fragment` rejected with a structured error naming the missing field.
- Python: missing `data.tsx` on `data-inline-fragment` rejected with a structured error.
- Python: `data-inline-fragment-diagnostic` with `id` + `data.error` passes; missing `data.error` rejected.
- Python: emit builders (`inline_fragment_start`, `inline_fragment_replace`, `inline_fragment_diagnostic`) produce chunks that round-trip through `_validate_chunk` without rejection.
- TS: parser produces `InlineFragmentPart` shape (with payload under `data`) from a valid chunk; rejects malformed chunks identically to Python (parity assertion).
- TS: chunk type unknown to the parser produces the existing debug fallback (forward-compat unchanged).

**Verification:** All new tests pass; the contract spec PR + the validator-rules spec PR are approved and merged before downstream units; running the existing publisher tests confirms no regression in pre-existing part types.

---

### U2. Persistence rehydrate (inert)

**Goal:** Extend `normalizePersistedParts` so reopened threads can rehydrate stored `inline-fragment` parts from `messages.parts` jsonb into the new `AccumulatedPart` union. No live writes yet — the persistence path is exercised only by hand-fabricated jsonb fixtures.

**Requirements:** R12 (thread reopen renders fragments at final state). Lays groundwork for R8 (no mutation log).

**Dependencies:** U1 (needs the `InlineFragmentPart` type).

**Files:**
- `apps/computer/src/components/computer/TaskThreadView.tsx` — extend `normalizePersistedParts` (~line 547) to handle `type: 'data-inline-fragment'`. Parse the canonical `{ type, id, data: { tsx, status, diagnostic? } }` envelope — no top-level `tsx`/`status` invented, payload lives under `data` consistent with every other data-* part.
- Test: `apps/computer/src/components/computer/TaskThreadView.test.tsx` (or sibling test for `normalizePersistedParts` if extracted; if not, extract and test in this PR).

**Approach:** Preserve the "current TSX only, no mutation log" semantic (R8) by storing only the latest `data.tsx` field per fragment. `data.status` defaults to `'complete'` on rehydrate — streaming-status is a runtime concept, not persisted. Diagnostic state IS persisted (`data.status: 'diagnostic'` + `data.diagnostic` field) so reopened threads show the same failure that was visible at the end of the prior session.

**Patterns to follow:** Existing `text` and `reasoning` handling in `normalizePersistedParts`. Keep the function pure — input jsonb, output `AccumulatedPart[]`.

**Test scenarios:**
- **Covers AE6.** A persisted `messages.parts` with two `inline-fragment` entries rehydrates to two `InlineFragmentPart`s with the stored TSX and `status: 'complete'`.
- A persisted diagnostic fragment rehydrates with `status: 'diagnostic'` and the stored `diagnostic` field.
- A persisted fragment with missing `tsx` field is dropped or rendered as a structural-error placeholder (not silently coerced).
- Coexistence: a persisted `messages.parts` array containing both `text` and `inline-fragment` parts rehydrates both in order.

**Verification:** Hand-fabricated jsonb fixtures rehydrate as expected in tests; existing thread-reopen tests show no regression for non-fragment threads.

---

### U3. Render switch case + placeholder (inert)

**Goal:** Add an `inline-fragment` case to `render-typed-part.tsx` that mounts a diagnostic-only placeholder. Wires the routing path but does NOT yet activate `JSXPreview` — activation lands in U7. This keeps inert-phase visual surfaces explicit ("received but renderer not wired") while production traffic still goes through `save_app`.

**Requirements:** R1 (inline render path exists). Lays groundwork for R4 (streaming render).

**Dependencies:** U1, U2.

**Files:**
- `apps/computer/src/components/computer/render-typed-part.tsx` — extend the switch (currently at line 54) with a `data-inline-fragment` case. The case mounts a `<InlineFragmentDiagnosticPlaceholder fragmentId={part.id} tsx={part.data.tsx} status={part.data.status} diagnostic={part.data.diagnostic} />` component that displays "Inline fragment received (renderer not wired — U7 pending)" plus the fragment id and a truncated TSX preview. The placeholder throws (not silently no-ops) when receiving a fragment whose id isn't present in props — surfacing routing bugs loudly per the seam-swap pattern.
- `apps/computer/src/components/computer/InlineFragmentDiagnosticPlaceholder.tsx` — new component, ~30 lines, diagnostic only. **XSS-safe rendering invariant:** `diagnostic` field and any TSX preview render strictly as React text children (string interpolation into JSX). NEVER via `dangerouslySetInnerHTML` and never through any HTML-capable path. The TSX preview is truncated before passing as a prop.
- Test: `apps/computer/src/components/computer/render-typed-part.test.tsx`
- Test: `apps/computer/src/components/computer/InlineFragmentDiagnosticPlaceholder.test.tsx`

**Approach:** Follow the inert-stub pattern from `docs/solutions/architecture-patterns/inert-first-seam-swap-multi-pr-pattern-2026-05-08.md` — the stub is structurally complete (real component, real props, real test surface) but the live behavior (mount `JSXPreview` with shadcn-only components) lands in U7. Keying on `fragment.id` in the React tree is set up here so U4's in-place mutation merge has a stable key target.

**Patterns to follow:** Existing `data-runbook-confirmation` and `data-task-queue` cases in `render-typed-part.tsx` — they show the prop-shape pattern, key strategy, and test fixture style.

**Test scenarios:**
- An `InlineFragmentPart` with `data.status: 'streaming'` and partial TSX renders the diagnostic placeholder displaying the fragment id and "(streaming)".
- An `InlineFragmentPart` with `data.status: 'complete'` renders the placeholder displaying the fragment id and "(complete)".
- An `InlineFragmentPart` with `data.status: 'diagnostic'` renders the placeholder displaying the diagnostic message.
- Two `InlineFragmentPart`s with different ids in the same message render two distinct placeholders (no key collision).
- React reconciliation: same fragment id with updated TSX preserves the placeholder's React identity (DOM node not remounted) — sets up U4's in-place mutation.
- **XSS-safe rendering.** A `diagnostic` field containing `<script>alert(1)</script>` renders as escaped text, not as DOM nodes — assert against the rendered DOM that no `<script>` tag is created.
- **XSS-safe TSX preview.** A `data.tsx` field containing HTML/script markup renders as escaped text in the preview, not as parsed markup.

**Verification:** Tests pass; manual smoke in dev confirms the placeholder appears when a fake `inline-fragment` part is injected into a thread fixture; existing render-typed-part tests show no regression.

---

### U4. In-place mutation merge (inert path, live mechanics)

**Goal:** Ensure `applyProtocolChunk` in `ui-message-merge.ts` correctly handles repeated `data-inline-fragment` chunks for the same id — first emission creates the part, subsequent re-emits replace `data.tsx` in place (no remount, no duplicate). The merge mechanics are live; the live visual effect arrives in U7 when the placeholder is swapped for `JSXPreview`.

**Requirements:** R5 (in-place replacement), R6 (agent is the authority for resolution — runtime in this plan), R8 (no mutation log).

**Dependencies:** U1.

**Files:**
- `apps/computer/src/lib/ui-message-merge.ts` — the existing default `data-*` branch (~line 332) already locates parts by `(type, id)` and updates the `data` payload; the **collapsed single-chunk-type vocabulary** from U1 means re-emit with the same id falls through this existing branch without a new switch case. Verify the default branch handles the replacement semantics correctly; add an explicit case if `Object.assign`-style payload merging causes prior `data.status` or `data.diagnostic` fields to leak through on re-emit (they shouldn't — replacement is whole-payload).
- `apps/computer/src/lib/ui-message-merge.ts` — add a special case for `data-inline-fragment-diagnostic` chunks addressed to an existing `data-inline-fragment` id: transition the existing part's `data.status` to `'diagnostic'` and set `data.diagnostic`; preserve `data.tsx` for forensics on reopen. (This IS a cross-type address — diagnostic must locate by id only, not by (type, id). Special-case required only for this case.)
- `apps/computer/src/lib/ui-message-merge.test.ts`

**Approach:** Merge keeps the latest `data.tsx` only — no append-history, no version count, consistent with R8. The collapsed vocabulary (single `data-inline-fragment` type for create+replace) means the existing locate-by-(type,id) branch in the default data-* handler does the work. The diagnostic cross-type address is the one new code path. A diagnostic chunk addressed to a nonexistent id throws (loud failure, surfacing routing bugs per the seam-swap pattern's "stubs throw" rule).

**Patterns to follow:** The existing `text-delta` merge in `applyProtocolChunk`. Same locate-by-id, same `Object.assign`-or-spread mutation discipline, same return-new-state semantics.

**Test scenarios:**
- **Covers AE2.** Two `data-inline-fragment` chunks for id `f-1` (the second carrying replacement TSX) result in a single `InlineFragmentPart` whose `data.tsx` is the replacement. No duplicate part is produced.
- **Covers AE3.** A `data-inline-fragment` for id `f-1`, then `data-inline-fragment` for id `f-2`, then another `data-inline-fragment` for id `f-2` only — `f-1`'s part is untouched, `f-2`'s `data.tsx` is replaced.
- **Covers AE2, R8.** Three sequential re-emits of `f-1` leave only the third `data.tsx` in state — no mutation log, no array of prior TSX strings retained.
- `data-inline-fragment-diagnostic` addressed to nonexistent id `f-bogus` throws with a descriptive error.
- `data-inline-fragment-diagnostic` for existing id `f-1` transitions `data.status` to `'diagnostic'`, sets `data.diagnostic`, preserves prior `data.tsx` for forensics.
- Coexistence: `text-delta` and `data-inline-fragment` chunks interleaved through `applyProtocolChunk` produce a correctly-ordered, correctly-typed `AccumulatedPart` sequence.

**Verification:** Tests pass; manual smoke with hand-injected chunk fixtures confirms the placeholder updates in place without remount; existing merge tests show no regression.

---

### U5. Save-to-artifacts gesture (live UI, no source emits yet)

**Goal:** Render a per-bubble "Save to artifacts" affordance on `InlineFragmentDiagnosticPlaceholder` (and post-U7, on the live `JSXPreview` bubble) that submits the current `tsx` through the existing `saveApplet` GraphQL mutation. UI lands live in this unit because it's independently testable against hand-fabricated parts; agent-driven emits arrive in U6.

**Requirements:** R9 (per-fragment Save affordance), R10 (snapshot at save-time), R11 (routes through existing validator + storage), R13 (existing canvas path unchanged).

**Dependencies:** U3 (the placeholder/component the affordance attaches to).

**Files:**
- `apps/computer/src/components/computer/InlineFragmentDiagnosticPlaceholder.tsx` — add a "Save to artifacts" button. Placement: hover affordance in the bubble's top-right corner (consistent with existing `<MessageContent>` action affordances). Copy: "Save to artifacts" (open Outstanding Question for design pass).
- New hook: `apps/computer/src/hooks/use-promote-fragment.ts` — wraps the existing `SaveAppletMutation` GraphQL operation, accepts `{ tsx, suggestedTitle? }`, returns `{ promote, status, artifactId, error }`. Calls into `packages/api`'s `saveApplet` resolver unchanged.
- Test: `apps/computer/src/hooks/use-promote-fragment.test.ts`
- Test: `apps/computer/src/components/computer/InlineFragmentDiagnosticPlaceholder.test.tsx` (extended)

**Approach:** Reads the fragment's current `tsx` field from the part state (in-memory snapshot per R10), then calls the existing `saveApplet` GraphQL mutation. The mutation runs `validateAppletSource` server-side as it does today; this plan does NOT introduce a separate inline-vs-canvas vocabulary divergence (R15). On success, the bubble continues to exist as ephemeral inline fragment AND a persistent artifact appears in the user's library — they are decoupled (R10). On validator rejection at save time, the error surfaces in the bubble (toast or inline notice) so the user can ask the agent to fix the fragment before retrying. The R10 race-condition question on mid-stream save is handled by snapshotting `tsx` at button-click and forwarding that snapshot to the mutation, not by reading at mutation-resolution time.

**Patterns to follow:** Existing `GeneratedArtifactCard.tsx` save flows for the canvas path; `useSaveAppletMutation` if present, otherwise direct Apollo mutation call.

**Test scenarios:**
- **Covers AE4.** Given a fragment with `tsx: '<Bar />'`, when the user clicks Save, then `saveApplet` is called with that exact TSX snapshot; subsequent in-state mutations of the fragment leave the saved artifact id's content untouched.
- **Covers AE4.** Two consecutive saves of the same fragment at different mutation states produce two distinct artifacts.
- **Covers AE5, R11, R15.** Given an `inline-fragment` whose TSX imports `lucide-react`, when the user clicks Save, the server-side `validateAppletSource` rejects the import; the error message surfaces in the bubble; no artifact row is created.
- Hook-level: `use-promote-fragment` exposes loading state during the round-trip and error state on rejection.
- Component-level: button is keyboard-accessible; copy is rendered as plain text (no rich HTML that could conflict with JSXPreview's allowlist).
- A "fragment in `'diagnostic'` status" hides the Save button — diagnostic fragments are not saveable (no TSX worth saving).
- A fragment in `'streaming'` status disables (or hides) the Save button — incomplete TSX cannot be safely promoted as a snapshot until streaming completes. Mirrors the diagnostic-status rule above.
- **Covers streaming-snapshot race.** Streaming fragments (`status: 'streaming'`) render the Save button as disabled; clicking is a no-op. Save becomes available when `status` transitions to `'complete'`.

**Verification:** Tests pass; manual smoke against dev confirms that a hand-injected fragment can be promoted and appears in the user's artifact library; the saved artifact opens correctly through the existing canvas path (R13).

---

### U6. Strands emit path (live)

**Goal:** Add an `emit_inline_fragment` agent-callable tool in the Strands runtime that validates TSX, resolves the natural-language target to a fragment id, and publishes through `ui_message_publisher`. The validator-feedback retry loop with 3-attempt cap lives here. Agent prompts can now reach the live wire; the placeholder still renders client-side until U7.

**Requirements:** R2 (runtime-assigned ID), R6 (NL→ID resolution), R7 (single-fragment-scoped per turn). Implements the emit half of R1, R5.

**Dependencies:** U1 (publisher recognizes the part type).

**Execution note:** Test-first. The body-swap forcing-function test (call-count assertion on the publisher's `_live_emit`) is the load-bearing safety net for this transition — write it before the implementation.

**Files:**
- `packages/agentcore-strands/agent-container/container-sources/inline_fragment_tool.py` — new module. Exposes `make_emit_inline_fragment_fn(publisher, validator, fragment_registry, seam_fn=_emit_inline_fragment_live)` per the seam-swap pattern. Function signature exposed to the agent: `emit_inline_fragment(tsx: str, target_referent: str | None = None, intent: 'new' | 'replace' = 'new')`. Tool registration is **feature-flagged** (env var `THINKWORK_INLINE_FRAGMENT_EMIT_ENABLED` or runtime config) — registration is skipped until U7's renderer activation lands, preventing the "renderer not wired" production-visible state if U7 is delayed.
- `packages/agentcore-strands/agent-container/container-sources/fragment_registry.py` — new module. Per-thread registry mapping `fragment_id` ↔ short natural-language descriptor ("the chart", "the table"). **Persistence: registry rebuilds from `messages.parts` jsonb on agent-coroutine entry** — the same data U2 rehydrates client-side is the source. Avoids worker-recycle resetting referent resolution and silently breaking F2's user-visible promise (per-thread registry state is reconstructed, not cached across restarts).
- `packages/agentcore-strands/agent-container/container-sources/server.py` — register the new tool in the Strands tool list (~lines 1059–1069 alongside `make_save_app_from_env` etc.), behind the feature flag. The system prompt update is deferred to U8; this unit only makes the tool available, not preferred.
- (Publisher emit builders moved to U1 — see U1 Files.)
- Python tests: `packages/agentcore-strands/agent-container/test_inline_fragment_tool.py`, `test_fragment_registry.py`.
- Body-swap test: `test_inline_fragment_tool_live_wired.py` — instantiate the tool WITHOUT injecting a test seam and assert the live publisher is called when emit succeeds.

**Approach:**
1. **Env snapshot at coroutine entry.** The factory `make_emit_inline_fragment_fn` accepts pre-snapshotted env (`thinkwork_api_url`, `auth_secret`) — does not re-read `os.environ` mid-turn.
2. **Source validator at emit time, loaded from shared spec.** The Python tool loads the validator rule list from `docs/specs/inline-fragment-validator-rules.{yaml,json}` (the same spec the TS `validateAppletSource` loads) and applies forbidden-pattern + shadcn-vocabulary checks. Returning structured rejections to the agent on failure. The shared-spec approach (committed in Key Technical Decisions) eliminates the drift risk of independent Python/TS rule lists.
3. **Validator-feedback retry loop with progress-detection.** On rejection, the tool returns the structured error to the agent. The agent retries up to 3 times within the same turn (cap enforced via per-thread fragment registry attempt counter). **Progress-detection short-circuit:** if the same violation class is hit twice in a row, exit the loop at attempt 2 — further retries on the same violation pattern are unlikely to make progress and only burn tokens. On exhaustion (or short-circuit), the tool emits a `data-inline-fragment-diagnostic` chunk and returns "rendered as diagnostic" to the agent.
4. **NL→ID resolution with tight ambiguity rule.** When `target_referent` is `None`, the tool creates a new fragment with a fresh UUID. When `target_referent` is supplied AND `intent='replace'`, the registry resolves the referent against rebuilt-from-jsonb descriptors. **Ambiguity rule:** if more than one fragment matches the descriptor token, that IS ambiguous regardless of recency — return a clarifying error ("multiple fragments match 'chart' — be specific") rather than silently picking the most-recent match. Recency is the tie-break for singleton matches only, never auto-disambiguates plural matches.
5. **Tool description.** Docstring instructs the agent on when to use this vs. `save_app`: inline visual outputs use `emit_inline_fragment`; explicit-save requests AND canvas-sized full-app outputs use `save_app`. System prompt reinforces this in U8.
6. **Validator parity verification.** Add a test scenario asserting that identical invalid TSX (e.g., `import { Calendar } from 'lucide-react'`) is rejected with structurally-identical errors by both the Python emit-time tool and the TS `validateAppletSource`. Catches drift if the shared spec is not actually shared.
7. **Turn-serialization verification.** Add an empirical test against the live Strands runtime asserting per-thread turn serialization (a follow-up user message queues until the prior turn completes). If the assumption fails, U4 needs to add interleaved-deltas tests and the merge layer needs to define monotonic chunk ordering — escalate as a blocker before U6 ships.

**Patterns to follow:**
- `applet_tool.py` `make_save_app_fn` for the factory pattern + tool registration shape.
- `inert-to-live-seam-swap-pattern-2026-04-25.md` for the seam-swap and body-swap forcing-function test.
- `recipe-catalog-llm-dsl-validator-feedback-loop-2026-05-01.md` for the 3-retry validator-feedback loop and diagnostic-on-exhaustion fallback.
- `feedback_completion_callback_snapshot_pattern` for env snapshot discipline.

**Test scenarios:**
- **Covers AE1, R3.** Happy path: agent calls `emit_inline_fragment(tsx='<Card>...</Card>')`; tool validates OK against the shared spec; publisher receives a `data-inline-fragment` chunk with a fresh UUID; tool returns `{ok: true, fragment_id: '<uuid>'}` to the agent; no `save_app` is called.
- **Covers AE2, R5.** Agent calls `emit_inline_fragment(tsx, target_referent='chart', intent='replace')` after a prior chart fragment exists in the registry; tool resolves referent to the prior fragment id; publisher receives a `data-inline-fragment` chunk addressed to that id (collapsed-vocabulary replacement).
- **Covers AE5, R11.** Agent emits TSX importing `lucide-react`; validator rejects with the lucide-react allowlist error; tool returns structured rejection; agent retries with corrected TSX; second attempt validates OK and publishes.
- 3-cap exhaustion: agent retries 3 times with new-and-different violations each time; tool publishes a `data-inline-fragment-diagnostic` chunk; agent receives "rendered as diagnostic" and stops retrying.
- **Progress-detection short-circuit:** agent emits TSX with a forbidden-pattern violation; first retry's TSX also fails with the same violation class; tool exits the loop at attempt 2 without waiting for attempt 3, publishing the diagnostic.
- **Oscillation case (A→B→A):** agent's three attempts toggle between two different violations (e.g., fix the import, then re-introduce it on next refinement); tool exits via progress-detection or 3-cap, surfaces diagnostic; assert no infinite loop and the diagnostic is observable in the agent's tool result.
- **Ambiguity (tight rule):** agent calls `target_referent='chart'` with two prior chart fragments in the registry; tool returns ambiguity error rather than silently picking the most recent. Verify the error names both candidate fragments.
- **Singleton recency tie-break:** agent calls `target_referent='card'` with two prior fragments where only one has the 'card' descriptor; tool picks the matching one (recency irrelevant since only one matches).
- **Registry persistence after worker recycle:** simulate a worker recycle (registry reset); call `emit_inline_fragment(target_referent='chart')`; tool rebuilds registry from `messages.parts` jsonb on coroutine entry and resolves the referent against the rehydrated state.
- **Validator parity:** the same invalid TSX (`import { Calendar } from 'lucide-react'`) produces structurally-equivalent rejection errors from the Python emit-time tool and from `validateAppletSource` server-side. Catches shared-spec drift.
- **Env snapshot:** with `THINKWORK_API_URL` cleared from `os.environ` after coroutine entry, the tool still publishes using the snapshotted value.
- **Body-swap:** tool instantiated without test seam triggers the real `_live_emit` path; call-count assertion on `publishComputerThreadChunk` mutation confirms wire actually fires.
- **Feature-flag gating:** with `THINKWORK_INLINE_FRAGMENT_EMIT_ENABLED=false`, `emit_inline_fragment` is not registered on the Strands tool surface; assert the agent's tool list does not include it.
- **Per-thread turn serialization (empirical):** spawn two user messages against the same thread in rapid succession; assert the second is queued, not concurrent with the first agent turn. If this assertion fails, U6 cannot ship without merge-layer ordering work.

**Verification:** Tests pass; in dev with the feature flag on and `ui_message_emit=True`, a hand-crafted prompt instructing the agent to call `emit_inline_fragment` results in a chunk visible in the AppSync stream and an `InlineFragmentPart` produced client-side that renders through the U3 placeholder.

---

### U7. Render activation cutover (live)

**Goal:** Swap `InlineFragmentDiagnosticPlaceholder` for the live `JSXPreview`-based renderer mounted with a shadcn-only `components` allowlist. After this unit, agent-emitted fragments render as real interactive UI in the chat bubble.

**Requirements:** R4 (streaming render), R5 (in-place mutation visible), R15 (shadcn vocabulary), R16 (rewritten security model — see Key Technical Decisions).

**Dependencies:** U3, U4, U6.

**Execution note:** Body-swap forcing-function test required at cutover. Call-count assertion that `JSXPreview` actually mounts and that a streaming TSX prop produces a re-render is the safety net.

**Files:**
- `apps/computer/src/components/computer/InlineFragmentRenderer.tsx` — new component. Replaces the placeholder. Mounts `JSXPreview` with `jsx={part.tsx}`, `isStreaming={part.status === 'streaming'}`, `components={SHADCN_INLINE_COMPONENTS}`, `onError={surfaceDiagnosticInPlace}`.
- `apps/computer/src/lib/shadcn-inline-components.ts` — the shadcn-only components allowlist for inline fragments. Mirrors the canvas allowlist's primitive set; future expansion is a host PR (R4 of the 2026-05-12 brainstorm).
- `apps/computer/src/components/computer/render-typed-part.tsx` — swap the placeholder mount for `InlineFragmentRenderer`.
- Test: `apps/computer/src/components/computer/InlineFragmentRenderer.test.tsx`
- Body-swap test: `apps/computer/src/components/computer/render-typed-part.live-wiring.test.tsx`

**Approach:**
- The `components` map is the load-bearing render-time constraint (paired with the source validator's import-time constraint). Components not in the map cause `JSXPreview` to fail-render with a structured error that surfaces as a per-bubble diagnostic, not as silent text-fallback (per `copilotkit-agui-computer-spike-verdict-2026-05-10` discipline).
- Streaming smoothness: `JSXPreview`'s existing `completeStreamingJsx()` auto-closes partial TSX during streaming. Re-renders fire on each `tsx` prop change. React reconciliation handles in-place replacement automatically because the React key is stable on `fragment.id` (set up in U3).
- The placeholder is deleted entirely in this unit — there is no feature flag toggling the live path on, because the body-swap test is the safety net.
- R16 (origin) rewritten in Key Technical Decisions above; this unit's verification asserts the same forbidden-pattern guarantees hold at render: `fetch` in TSX is blocked by the source validator (U6); `dangerouslySetInnerHTML` is blocked by `react-jsx-parser`'s `componentsOnly` setting; inline `on*` handlers are blocked by the attribute blacklist in `JSXPreview`.

**Patterns to follow:**
- Existing `JSXPreview` integration patterns in canvas usage (search `apps/computer/src/components/apps/` for prior consumers).
- `inert-first-seam-swap-multi-pr-pattern-2026-05-08.md` body-swap forcing-function tests.

**Test scenarios:**
- **Covers R4, AE1.** Streaming TSX prop changes produce multiple JSXPreview re-renders; final render matches the complete TSX.
- **Covers R5, AE2.** Same `InlineFragmentRenderer` instance receives an updated `tsx` prop addressed to the same fragment id; React reconciles in place (no unmount); the rendered DOM updates but the React tree position is preserved.
- **Covers R15, AE5.** A component not in `SHADCN_INLINE_COMPONENTS` (e.g., `<Calendar />` from `lucide-react`) triggers a render-time error and surfaces a per-bubble diagnostic; no silent text-fallback occurs.
- **Covers R16.** TSX containing `dangerouslySetInnerHTML` does not execute the inner HTML; `react-jsx-parser` strips the attribute (assert against rendered DOM).
- Body-swap: rendering an `InlineFragmentPart` through `render-typed-part` without test mocks mounts the real `JSXPreview`; spy on a known shadcn component's render method confirms the live path executes.
- Coexistence: a thread containing both a live `InlineFragmentRenderer` and a saved canvas artifact rendered via `InlineAppletEmbed` shows both without DOM conflict (AE7).

**Verification:** All tests pass; manual smoke confirms an agent-driven `emit_inline_fragment` call results in real UI streaming into the bubble; the placeholder file is fully removed; existing canvas-artifact paths unaffected.

---

### U8. System prompt + auto-save retirement (live)

**Goal:** Update the Computer agent's system prompt to prefer `emit_inline_fragment` for visual outputs and reserve `save_app` for explicit user save requests or canvas-sized full-app outputs. Document the agent's new responsibility for NL→referent fragment addressing.

**Requirements:** R3 (ephemeral default). Operationalizes R1 (inline as default surface) and R9 (save as explicit gesture).

**Dependencies:** U6, U7.

**Files:**
- `packages/agentcore-strands/agent-container/container-sources/server.py` — update the Computer system prompt (~lines 2740–2772). The current "use the artifact-builder skill ... save_app ... persisted=true" instruction is rewritten:
  - Inline-default: any visual output (chart, table, metric, card, small dashboard) emits via `emit_inline_fragment`.
  - Save-on-gesture: `save_app` is called only when (a) the user explicitly asks to save, OR (b) the output is canvas-sized AND the user has signaled they want it preserved.
  - Refinement convention: when the user refers to a prior fragment ("make the chart bigger"), call `emit_inline_fragment` with `intent='replace'` and `target_referent` set to the user's natural-language reference.
  - 3-retry cap: on validator rejection, attempt up to 3 fixes within the turn before falling back to a diagnostic.
- `packages/agentcore-strands/agent-container/container-sources/applet_tool.py` — soften the `save_app` docstring (~lines 222–233): no longer mandates calling `save_app` for every visual output; clarifies that `save_app` is for explicit user saves or canvas-sized outputs.
- Eval-driven smoke: add or extend an existing Bedrock AgentCore Evaluations test case that prompts the Computer agent for a visual output and asserts the response uses `emit_inline_fragment` (not `save_app`).

**Approach:** The system prompt is the only mechanism in the runtime that drives auto-save today (research confirmed; the runtime does not hard-wire `save_app`). Rewriting the prompt to make `emit_inline_fragment` the default is the load-bearing change for R3. The eval-driven smoke test is the regression guard — automated CI cannot fully test prompt behavior, but a representative eval gives a signal when model drift undoes the change.

**Patterns to follow:**
- The 2026-05-12 brainstorm's validator-feedback retry pattern surfaces in this prompt as the "3-attempt" instruction.
- Existing system-prompt structure for tool-routing guidance.

**Test scenarios:**
- Eval: "Show me last month's revenue" → agent calls `emit_inline_fragment` (not `save_app`).
- Eval: "Save this dashboard" → agent calls `save_app` (or `use-promote-fragment` from the UI side, depending on context).
- Eval: "Make the chart bigger" after a prior inline fragment → agent calls `emit_inline_fragment(intent='replace', target_referent='chart')`.
- Eval: agent emits invalid TSX once, sees validator rejection, retries with corrected TSX — success on attempt 2.
- Eval: 3-cap exhaustion produces a user-facing diagnostic, no infinite retry.

**Test expectation:** eval-driven only; unit tests of system prompts are not useful and not required. The body-swap forcing-function tests in U6 + U7 cover the runtime path; this unit covers the agent-behavior side, which is best measured through evals.

**Verification:** Evals pass against a representative prompt suite; manual smoke in dev confirms no `save_app` call is fired for typical inline visual prompts; the artifact library no longer accumulates throwaway entries in a 10-turn smoke session.

---

## Scope Boundaries

### Deferred for later

- Cross-fragment refinement in a single user turn (one prompt mutating multiple fragments simultaneously). Multi-fragment edits are decomposed by the agent or surfaced as clarifying questions in v1. (origin)
- Backfilling existing in-thread artifacts to the new lifecycle. Existing threads continue to render through their current path; only newly-emitted fragments use the new lifecycle. (origin)
- Adopting AG-UI as the wire protocol. Decision deferred to wave two after 2–3 weeks of v1 usage; the explicit purpose of wave two is to evaluate AG-UI against accumulated evidence. (origin)
- Storing fragment mutation history. Each fragment carries only its current TSX in v1; prior states are not retained server-side for replay or audit. (origin)
- Visual chrome changes for already-promoted canvas artifacts. The `AppArtifactSplitShell` path is unchanged. (origin)
- Mobile (`apps/mobile`). Separate evolution track per the 2026-05-09 brainstorm. (origin)

### Outside this product's identity

- Adopting CopilotKit's runtime (`@copilotkit/runtime`). (origin)
- Adopting CopilotKit's React component library wholesale. (origin)
- A v0 / Replit / bolt.diy substrate swap. (origin)
- Re-litigating the 2026-05-12 shadcn-only validator decision. (origin)
- Re-litigating the 2026-05-09 iframe-sandbox security invariant (NB: this plan rewrites R16 of the origin to acknowledge JSXPreview's in-DOM execution — see Key Technical Decisions). (origin)
- Replacing the Strands → AppSync → `useChat` → AI Elements pipeline. (origin)
- Multi-user collaborative editing on a shared inline fragment. (origin)

### Deferred to Follow-Up Work

- Routing inline fragments through a per-bubble inline iframe sandbox. Plan-001's R17 explicit-acceptance posture is operative; revisit if security review or threat-model change warrants it.
- Indexed querying over historical inline fragments. Today: jsonb scan; if product needs surface (e.g., "find all fragments mentioning X" search), a typed-part child table or jsonb GIN index is the follow-up.
- Inline-fragment thumbnails in artifact library promotion previews. The existing `saveApplet` path produces standard artifacts; preview generation is a separate concern.
- Telemetry-driven wave-two AG-UI evaluation criteria. Wave one ships the experience; wave two's evaluation needs an explicit metrics doc (fragment count per thread, mutation rate, save rate, validator rejection rate, retry exhaustion rate).
- Plan-001 supersession header update — done as a one-line frontmatter edit in U1's commit since the contract spec change ships in the same PR.

---

## Risk Analysis & Mitigation

- **Security: in-DOM execution of agent-emitted TSX.** Risk: validator gap permits an unsafe construct to reach `JSXPreview`. Mitigation: the source validator is the load-bearing boundary; its forbidden-pattern list (`fetch`, `XMLHttpRequest`, `WebSocket`, `globalThis`, `Reflect`, `Function(`, `import(`, `localStorage`, `sessionStorage`, `document.cookie`, `eval`) plus the shadcn-only import allowlist plus `react-jsx-parser`'s built-in sanitization layer together provide defense-in-depth. The validator runs at both emit-time (Strands tool wrapper, U6) and save-time (existing `validateAppletSource`, unchanged). If a gap is identified post-launch, the iframe routing (Deferred to Follow-Up Work) is the escalation path.
- **Streaming compile correctness in `JSXPreview`.** Risk: partial TSX during stream produces misleading intermediate renders or causes `JSXPreview` to throw. Mitigation: the existing `completeStreamingJsx()` auto-closes partial tags; `isStreaming` prop gates render strictness. Tests in U7 assert streaming-prop behavior. If observed in production, fall back to "buffered-then-render" by delaying mount until `status === 'complete'`.
- **Env shadowing in Strands turn coroutine** (PR #552/#563 lesson). Risk: emit fires after `os.environ` is mutated, AppSync publish fails silently. Mitigation: snapshot pattern at coroutine entry; tests in U6 assert with cleared env. No mid-turn re-reads of env.
- **Validator-feedback retry cap (3) is too short or too long.** Risk: under-fixing (agent gives up before correcting) or over-fixing (agent burns tokens looping). Mitigation: 3 is the established cap from `recipe-catalog-llm-dsl-validator-feedback-loop-2026-05-01.md` and matches observed agent fix-rate in similar domains. Add telemetry counter on exhaustion rate; tune from data.
- **In-place mutation surprises end users.** Risk: a fragment silently changes under the user's cursor, scroll position, or focus. Mitigation: React reconciliation preserves DOM identity by key; tests assert no unmount. If observed in production (e.g., focus loss in a streaming chart), an explicit animation or "updated" highlight can be added.
- **The agent NL→referent resolution fails on natural prompts.** Risk: registry's substring + recency match cannot disambiguate; user prompts get misrouted. Mitigation: R7's clarifying-question path (registry returns ambiguity error; agent asks user). Telemetry: track ambiguity-error rate; if high, tighten registry semantics or add a dedicated "list fragments" tool.
- **Save-time validator divergence from emit-time validator.** Risk: a fragment that passes the emit-time Python check fails the save-time TS check (or vice versa), creating a confusing "I saw it, why can't I save it" state. Mitigation: derive validator rules from a single source where feasible (shared spec under `docs/specs/`, or share the Python validator with the TS one via a thin HTTP endpoint) — see Outstanding Implementation Questions. Worst case: emit-time validator is stricter than save-time, surfacing failures earlier.
- **Plan-001 supersession misses an artifact.** Risk: plan-001 had real content (e.g., `WebPreview` chrome integration, R17 explicit-acceptance language) that this plan should inherit. Mitigation: plan-001's R16 (`WebPreview` as in-thread preview chrome), R5 (preview validation and save validation share one source policy), and R17 (JSXPreview security caveat) are all preserved in this plan's Key Technical Decisions and U7's approach. Plan-001's `status` flips to `superseded` with `superseded_by:` pointing here in U1's PR.

---

## Documentation Plan

- `docs/specs/computer-ai-elements-contract-v1.md` — extend with the `data-inline-fragment` family in U1.
- `docs/plans/2026-05-13-001-feat-fast-tsx-artifact-preview-plan.md` — frontmatter update: `status: superseded`, `superseded_by: docs/plans/2026-05-13-006-feat-computer-inline-genui-fragment-lifecycle-plan.md` in U1's PR.
- `docs/brainstorms/2026-05-13-computer-inline-genui-fragment-lifecycle-requirements.md` — add a one-line `## Errata` section (or a note in R16) acknowledging that R16's iframe-isolation assertion was reframed in the plan to in-DOM execution with validator-as-boundary. Origin doc stays authoritative on intent; plan documents the implementation reality.
- New solution doc post-launch (in `docs/solutions/architecture-patterns/`) documenting the inline-fragment lifecycle for future reference, especially the runtime-assigned-ID + NL-referent-resolution pattern, which is novel in this repo.
- Computer agent skill catalog: if the Computer agent's workspace skills (`packages/skill-catalog/`) include guidance on `save_app`, update to reflect the new inline-default pattern.

---

## Outstanding Implementation Questions

*Several prior open questions were resolved in the doc-review round and promoted into Key Technical Decisions or the relevant Implementation Unit: validator-rule sharing (now shared spec under `docs/specs/`), fragment registry persistence (now rebuild-from-jsonb in U6), NL→referent algorithm ambiguity rule (now tightened in U6). Brainstorm-level open questions live in `## Deferred / Open Questions` at the end of this plan.*

- [Affects U6] **Body-swap forcing-function test for AppSync publish.** The test asserts `publishComputerThreadChunk` is called with the right chunk shape when the live path runs without a test seam. Decide whether to mock at the GraphQL client layer or to assert at the AppSync resolver test layer (`packages/api/src/__tests__/computer-thread-chunk-publish.test.ts`). Both are reasonable; pick the lower-friction option during U6.
- [Affects U7] **`JSXPreview` streaming smoothness in practice.** The existing `completeStreamingJsx()` auto-closes partial tags but has not been exercised on bulk TSX streams with many props. Spot-check perceived smoothness in dev before committing to "stream into the bubble" UX; if intermediate states are jarring, gate render on `data.status === 'complete'` with a streaming skeleton.
- [Affects U6] **Validator-rejection error format passed back to the agent.** Compatible with how the agent already parses tool errors; mirrors the 2026-05-12 brainstorm's R9 structured-error shape (component name, line, suggested shadcn equivalent). Final shape pins during U6.
- [Affects U8] **Eval criteria for the system-prompt change.** Define the representative prompt suite + expected tool-call distribution before merging U8 so regression catches future prompt drift.

---

## Dependencies / Prerequisites

- The 2026-05-09 AI Elements + `useChat` + `UIMessage` substrate is in place (it is — see `apps/computer/src/components/ai-elements/`, `ui_message_publisher.py`, `ui-message-chunk-parser.ts`).
- The 2026-05-12 shadcn-only validator direction is committed but not fully shipped. This plan does NOT block on the validator tightening — U6's emit-time validator runs the existing forbidden-pattern checks; the shadcn-only-import-allowlist tightening can land in parallel and benefits both inline and canvas paths uniformly.
- `JSXPreview` (`apps/computer/src/components/ai-elements/jsx-preview.tsx`) exists with the streaming-compile primitives this plan relies on. Confirmed in research.
- `ComputerThreadChunkEvent.chunk: AWSJSON` is the wire envelope. Confirmed in research; no GraphQL change.
- Strands runtime supports adding new tools via the existing factory pattern (`make_*_fn` → `server.py` registration). Confirmed.
- `saveApplet` GraphQL mutation + `validateAppletSource` server-side path is the existing save path. Confirmed in research.

---

## Deferred / Open Questions

### From 2026-05-13 review

Items below were surfaced in doc-review and deferred — they require brainstorm-level re-litigation, design judgment, or sub-decisions whose right defaults aren't obvious from planning alone. Resolve before the affected unit ships; cascade-deferred items dissolve or reshape depending on how the root resolves.

**F1 [ROOT — security model] Iframe-default vs. validator-default for inline fragments.**
The origin brainstorm's R16 commits to iframe-isolated execution; the plan rewrites that to in-DOM with the source-validator as the load-bearing safety boundary. Product-lens, scope-guardian, and coherence reviewers flagged this as a brainstorm-level decision, not a plan-level correction. Strategic weight: enterprise trust positioning, SOC2 Type 2 horizon, AE8's user-visible "fetch blocked at boundary" promise. Re-litigate in `ce-brainstorm` against the origin doc before the plan's Key Technical Decisions on this point is treated as committed. Working assumption in this plan stays in-DOM; the cascade entries below describe what changes if iframe-default is restored.

**F5 [cascade from F1] JSXPreview `bindings` prop is an uncontrolled JavaScript injection vector.**
`bindings` falls through from React context if not explicitly cleared. Under in-DOM execution this is load-bearing; under iframe-default the iframe boundary contains the impact. If in-DOM holds: U7's `InlineFragmentRenderer` must explicitly pass `bindings={undefined}` and add a test for context isolation.

**F6 [cascade from F1] Forbidden-pattern regex list has known bypass vectors.**
`window['fetch']`, `globalThis['eval']`, `window.location`, `window.postMessage`, `process.env`, `__proto__`, computed-property access — none caught by `\bfetch\b`-style regex. Under in-DOM this means the validator needs expanding to an AST-based check (using sucrase's transform output) or a substantially wider pattern list before U6/U7 ship. Under iframe-default the validator stays defense-in-depth and the gap is less urgent.

**F19 [cascade from F1] Emit-time vs save-time import allowlist parity.**
Today's `ALLOWED_IMPORTS` includes `@thinkwork/ui` and `@thinkwork/computer-stdlib`; the plan describes a "shadcn-only" intent. If in-DOM holds, gate the 2026-05-12 shadcn-only tightening before U7; otherwise document the asymmetry as an accepted gap.

**F20 [cascade from F1] Origin AE8 mapping.**
AE8 commits to "fetch blocked at iframe boundary" — not implementable under in-DOM. If in-DOM holds, add a Scope Boundaries note that AE8 is replaced by the equivalent "validator rejects fetch in TSX" assertion, OR add a U6 test for the in-DOM equivalent. If iframe-default is restored, AE8 stands as written and U7 needs to validate against it.

**F23 [cascade from F1] Empirical adversarial-TSX falsification battery.**
The R16 rewrite asserts that source-validator + react-jsx-parser sanitization is sufficient defense-in-depth, but this hasn't been empirically tested. Under in-DOM, add a curated adversarial-TSX battery (sample list in `docs/specs/`) as a U7 precondition, paralleling the empirical wire-format-verification discipline already in Key Technical Decisions. Under iframe-default this becomes optional defense-in-depth verification.

**F4 [client-side `saveApplet` design cluster] Three sub-questions to resolve before U5 ships.**
No client-side caller of `saveApplet` exists today; the mutation is invoked only from the Strands `save_app` tool, server-side. U5 builds a brand-new client write path that needs concrete answers:
- **(a) Name source for `SaveAppletInput.name: String!`.** Agent-suggested at emit time and threaded into the part payload, autogen from first agent prompt, or user-supplied at save time with a small modal?
- **(b) TSX-to-`files: AWSJSON!` packaging.** `{ "App.tsx": tsx }`, or a wider files envelope if the plan ever supports multi-file fragments (it doesn't today)?
- **(c) Validator-failure error surface.** Toast, inline notice in the bubble, modal, or banner? Resolution depends on R10's "user can ask the agent to fix the fragment" intent — needs UX direction.

**F11 [Save affordance design cluster] Four sub-questions to resolve before U5 ships.**
- **(a) Placement.** Hover-revealed top-right button (current default), kebab menu, fixed corner, or always-visible? Hover-revealed conflicts with the explicit keyboard-accessibility hard requirement unless paired with `:focus-within`.
- **(b) Success state.** Copy changes to "Saved" and button disables, "Saved — view artifact" with link, button disappears, or button remains for repeat saves?
- **(c) Error state.** Toast, inline notice in the bubble, or modal? What copy explains the validator rejection?
- **(d) Keyboard accessibility implementation.** Tab order through fragment bubbles, announced label for screen readers ("Save revenue chart fragment to artifacts"), `:focus-within` if hover-revealed.

**F12 What visible signal accompanies an in-place fragment update?**
R5 commits to same-bubble-update; the plan currently leaves the user with no signal that an update occurred. Options: subtle highlight on update, "Updated" badge, skeleton during streaming compile, or no signal. Defer is honest — the right answer depends on UX intent the plan can't establish unilaterally. Risk: if "no signal" is chosen by default, the chart silently morphing under the user's cursor is confusing UX.

**F13 What does the user see when the validator-feedback retry exhausts (3-cap or progress-detection short-circuit)?**
The plan emits a `data-inline-fragment-diagnostic` chunk but never specifies the user-facing surface for it. Copy text, retry CTA, "ask the agent to try again" affordance, or just an inline notice naming the issue? UX design question; needs design pass before U6 emits the diagnostic in production.

---

### FYI observations (carried into review, no action required)

- **Auto-save retirement is a product-identity shift.** Users who relied on browsable agent history will lose discoverability of unsaved past work. Adoption dynamics for this shift are unexamined; the eval test in U8 measures tool-call distribution, not user perception of "what does Computer remember?"
- **3-attempt retry public failure UX.** Three visible "agent tried, failed" cycles may erode user trust on a public-facing surface; consider whether retries should be invisible with only the final outcome streamed.
- **`messages.parts` jsonb scale at enterprise tier.** At 20–50 inline fragments × multi-KB TSX per thread, a single `messages` row could hit 100KB–1MB. AE6's "2 fragments × 3 mutations" fixture is 6× smaller than realistic enterprise usage. Add max-fragments-per-thread assumption + p99 load-time stress test to wave-two telemetry doc.
- **U1/U4 merge-test seam ambiguity.** Forward-compat coverage of unknown delta chunks for the new type wasn't explicitly assigned to U1 or U4 — could fall in a gap. Worth a one-line clarification in either unit.
