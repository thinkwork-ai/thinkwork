---
date: 2026-05-09
topic: computer-applets-reframe
---

# Computer Applets Reframe — v1 agent-generated applets

## Summary

Agent-generated applets land in `apps/computer` v1 as real TSX programs the Computer's agent writes against a constrained import surface (shadcn + a curated `computer-stdlib` of layout primitives + a same-origin host API hook). Source lives on the user's per-Computer EFS, never S3, never public. When the user opens an applet, a lightweight transform runs and the result executes same-origin in the existing split-view shell route. This replaces the CRM-locked manifest schema and `CrmPipelineRiskApp` orchestrator inside plan 014's M3 — it is a swap, not a new milestone.

---

## Problem Frame

The first cut of the consolidated plan 014 produced a hard-coded CRM dashboard renderer (`apps/computer/src/components/dashboard-artifacts/CrmPipelineRiskApp.tsx`) and a manifest schema literally const-locked to `dashboardKind: "pipeline_risk"`. The product intent — Computer prompts like "Build a CRM pipeline risk dashboard for LastMile opportunities..." produce a generic, dynamically-generated applet — was not realized. Eight CRM-specific React components were committed to the repo with a fixed orchestrator layout, and the "Apps" framing in the UI is doing work the implementation cannot back.

The pain surfaces the moment you imagine the second applet. A meeting-prep brief with a fillable agenda has nothing to do with `dashboardKind: "pipeline_risk"`, has user-state (writes), and depends on a different data shape (calendar event + email context, not CRM opportunities). Under the current shape, every new applet would be another committed renderer plus another const-locked schema — the architecture cannot scale to "Apps".

---

## Actors

- A1. End user — prompts the Computer for an applet, opens it in `apps/computer`, fills/uses it.
- A2. ThinkWork Computer agent — generates the applet's TSX source against the constrained import surface, writes it to EFS, exposes a `refresh()` function inside any data-driven applet.
- A3. apps/computer shell — fetches applet source through the API, runs the lightweight transform, mounts the compiled chunk in the existing split-view shell route.
- A4. Operator — pre-provisions the user (existing flow from plan 014, unchanged).
- A5. computer-stdlib — curated layout-primitive library that the agent is constrained to import from; rebranded from the seven viable CRM components plus what's needed for the second applet.

---

## Key Flows

- F1. Agent generates a new applet
  - **Trigger:** End user prompts the Computer (e.g., "Build a CRM pipeline risk dashboard for LastMile opportunities").
  - **Actors:** A1, A2.
  - **Steps:** Agent decides on applet shape → drafts 1–3 TSX files plus an applet metadata file → calls a `save-app` tool → tool validates the import surface → tool writes files to the user's per-Computer EFS → applet appears in apps/computer's apps gallery.
  - **Outcome:** A new applet exists on EFS with stable identifier and provenance (thread, prompt, timestamp).
  - **Covered by:** R1, R3, R4.

- F2. End user opens an applet
  - **Trigger:** A1 clicks an applet card in the apps gallery or a deep-link in transcript provenance.
  - **Actors:** A1, A3.
  - **Steps:** apps/computer requests the applet through the API → API reads the source from EFS → if a cached compile exists next to source, serve it; otherwise run the lightweight transform → apps/computer dynamically imports the chunk into the shell route → transcript/provenance pane stays on the left, applet canvas on the right.
  - **Outcome:** Applet is mounted same-origin in the canvas, fully interactive.
  - **Covered by:** R5, R6, R7, R8.

- F3. End user fills and saves applet user-state
  - **Trigger:** A1 types into the meeting-prep brief's agenda items.
  - **Actors:** A1, A3.
  - **Steps:** Applet holds transient state in React → debounced changes flow through the host API hook → host API persists user-state through the existing thread/artifact path → reopening the applet later restores the input.
  - **Outcome:** Applet user-state persists separately from applet code.
  - **Covered by:** R9, R10.

- F4. End user clicks Refresh on a generated applet
  - **Trigger:** A1 clicks the Refresh control on a data-driven applet.
  - **Actors:** A1, A2 (indirect — agent already wrote the refresh function), A3.
  - **Steps:** apps/computer calls the applet's exported `refresh()` function → the function re-fetches from MCP sources the agent originally chose → rendered data updates → no agent re-prompt fires → UI signals "refreshed", distinct from "Ask Computer" reinterpretation.
  - **Outcome:** Deterministic data refresh against the same recipe; no surprise re-interpretation.
  - **Covered by:** R11, R12.

---

## Requirements

**Generation & storage**

- R1. The Computer agent emits 1–3 TSX files plus a metadata file per applet via a constrained tool surface (`save-app` or equivalent), not via raw filesystem write access.
- R2. Applet sources live on the user's per-Computer EFS volume, scoped per user; sources are never written to S3 and never accessible via a public URL.
- R3. The agent's permitted imports inside applet TSX are limited to: shadcn/ui primitives, `computer-stdlib` primitives, and a single same-origin host API hook. Arbitrary npm imports are rejected at validation time before the applet is written to EFS.
- R4. Each applet's metadata file records a stable applet identifier and provenance (originating thread, originating prompt, generation timestamp, agent version) so apps/computer can attribute and re-find applets.

**Loading & runtime**

- R5. When the user opens an applet, apps/computer fetches the applet source through an API endpoint (apps/computer cannot mount EFS); compiled output is cached next to source on EFS so subsequent opens skip the transform.
- R6. The transform is "lightweight": a sucrase / esbuild-wasm transform of the agent-emitted TSX against pre-bundled shadcn + react + tailwind + computer-stdlib externals. It is not a full vite/webpack project build, and does not run a containerised builder.
- R7. The compiled chunk runs same-origin in the existing apps/computer shell route via dynamic import; the split-view transcript/provenance pane is unchanged.
- R8. Applet load failures (transform error, disallowed import that slipped through, runtime error during mount) render a recoverable error surface in the canvas pane with a "Regenerate with Computer" CTA. The apps/computer shell continues to function and other applets continue to load.

**State & persistence**

- R9. Applets carry their own React state for transient UX. Persistent user-state (the filled agenda, saved filters, ad-hoc inputs) flows through the host API hook to existing thread/artifact persistence — not to EFS.
- R10. Applet user-state is scoped per applet instance (one filled agenda per meeting-brief applet), not global to the user.

**Refresh**

- R11. Any applet that pulls live data exports a `refresh()` function the agent writes into the TSX. apps/computer's Refresh button calls it, and the function re-fetches from the MCP sources the agent originally chose; no agent re-prompt fires.
- R12. The UI distinguishes "deterministic refresh" from "Ask Computer reinterpretation". The user always knows whether they are getting fresh data against the same recipe or a new agent regeneration.

**Migration of plan 014's dashboard pieces**

- R13. Plan 009's `dashboardArtifact` GraphQL query, S3-backed dashboard storage, and CRM-locked manifest schema are replaced outright, not extended with a generic-app discriminant.
- R14. The seven viable CRM components are rebranded into `computer-stdlib` as generic primitives (KpiStrip, DataTable, EvidenceDrawer, ChartCard, SourceCoverage, RefreshBar, plus what the second applet drives). The orchestrator file `CrmPipelineRiskApp.tsx` is deleted. The CRM pipeline-risk fixture continues to render, but via the new applet pipeline so M5's smoke can pin it as one scenario.
- R15. The reframe slots into plan 014's M3 as a swap, not a new milestone. M1 fixtures, M2 streaming, M4 memory, and M5 smoke retain their slots; the M1 contract-freeze gate is extended to also lock the applet-package shape (file layout on EFS, metadata schema, allowed import surface) before parallel M2/M3/M4 work begins.

---

## Acceptance Examples

- AE1. **Covers R1, R3, R5, R7.** Given the Computer agent has finished a generation turn for "Build a CRM pipeline risk dashboard for LastMile opportunities", when the user clicks the resulting applet card in the apps gallery, then the host fetches the applet source from EFS, runs the lightweight transform, mounts the compiled chunk in the split-view canvas, and the user sees the rendered dashboard within ~2 seconds on a warm cache.
- AE2. **Covers R3.** Given the agent emits TSX containing `import lodash from "lodash"`, when the agent's save-app tool validates, then the save is rejected with an error naming the disallowed import; no file is written to EFS.
- AE3. **Covers R9, R10.** Given a meeting-prep brief applet with a fillable agenda, when the user types into the agenda items and idles for ~1 second, then the agenda persists through the host API to the thread's structured artifact; reopening the applet later restores the user's input.
- AE4. **Covers R11, R12.** Given a generated dashboard applet exports a `refresh()` function, when the user clicks Refresh, then the function runs (re-fetching from MCP sources), the rendered data updates, the agent is not re-prompted, and the UI distinguishes this from an "Ask Computer" regeneration.
- AE5. **Covers R8.** Given an applet whose TSX has a runtime error during mount, when the user opens it, then the canvas shows a recoverable error message with a "Regenerate with Computer" CTA; the apps/computer shell continues to function and other applets continue to load.
- AE6. **Covers R14, R15.** Given the M5 smoke gate, when it runs the "CRM pipeline risk" scenario, then the smoke pins that the applet is generated → written to EFS → fetched through the API → transformed → mounted, and that the rendered output uses the renamed stdlib primitives — not the deleted `CrmPipelineRiskApp.tsx` orchestrator path.

---

## Visual reference

```mermaid
sequenceDiagram
  participant Agent as Computer agent (Strands ECS)
  participant EFS as Per-user EFS
  participant API as apps/computer API
  participant App as apps/computer shell
  participant Browser as Browser canvas

  Note over Agent: User prompt: "Build a meeting-prep brief..."
  Agent->>Agent: Draft TSX (constrained imports)
  Agent->>API: save-app(appId, files, metadata)
  API->>API: Validate import surface
  API->>EFS: Write source files
  Note over App: User clicks the applet card
  App->>API: openApp(appId)
  API->>EFS: Read source
  alt Cached compile exists
    EFS-->>API: Cached chunk
  else No cache
    API->>API: Lightweight transform (sucrase/esbuild-wasm)
    API->>EFS: Write compiled chunk
  end
  API-->>App: Compiled chunk + metadata
  App->>Browser: Dynamic import → mount in canvas
  Browser->>API: Host API hook → fetch initial data
  Browser->>Browser: User fills agenda; debounced save
  Browser->>API: saveAppletState(appId, state)
  API->>API: Persist as thread artifact
```

---

## Success Criteria

- A real human can prompt the Computer for two structurally different applets (the CRM pipeline-risk dashboard and a meeting-prep brief with fillable agenda) on the dev stage and use both end-to-end without the implementer hand-coding either applet's renderer.
- Adding a third structurally different applet (e.g., a deal-stage simulator with sliders) requires zero changes to apps/computer, the API, the agent runtime, or the stdlib for primitives the stdlib already covers — only a new prompt.
- M5's smoke gate pins the applet pipeline (generate → store on EFS → fetch through API → transform → mount → user-state save → refresh) end-to-end on a deployed URL.
- The seven CRM-specific components in `apps/computer/src/components/dashboard-artifacts/` are no longer imported by any orchestrator file; their visual work survives in `computer-stdlib` under generic names.
- A downstream `ce-plan` agent can sequence implementation units against this doc without inventing the applet-package shape, the import surface, the EFS access pattern, or the supersede semantics for plan 009's manifest schema.

---

## Scope Boundaries

- Public or shareable applet URLs; anonymous applet links.
- Cross-user applet sharing — per-user EFS isolation makes this a v2 concern.
- An applet marketplace, gallery, or template browser beyond the user's own apps.
- Sandboxed-iframe isolation for applets (Approach A from brainstorm dialogue) — accept same-origin trust for v1; the migration to A is documented as a future option but not built.
- Arbitrary npm imports inside an applet — the import surface is closed to shadcn + computer-stdlib + the host API hook.
- Agent-driven mutations of external systems from inside an applet — read-only data sources only; applet-local writes go to thread/artifact persistence, not to CRM/email/calendar.
- A dedicated build-worker Lambda or Fargate service — "lightweight" rules this out.
- Forward-compat with the existing CRM manifest schema — replaced, not migrated.
- In-applet code editing by the user — the agent regenerates; the user does not hand-edit TSX.
- Multi-applet composition — one applet at a time per split-view canvas in v1.
- Applet versioning beyond "newest writes win" — historical bundles are not preserved on EFS in v1.
- Streaming partial applet output during generation — M2's streaming covers chat tokens, not applet-source streaming.
- Mobile-native applet rendering — apps/computer (web) is the only host surface in v1; mobile push deep-links to apps/computer per plan 014 D1.

---

## Key Decisions

- **TSX source generation, not manifest config.** Rationale: "Apps" framing requires arbitrary applet shapes (forms, calculators, dashboards). A manifest registry cannot reach there without becoming its own engine. Code generation over a constrained import surface is the smallest path that supports the second applet (meeting-prep brief) without re-architecting.
- **Approach B (same-origin shell + chunk) over Approach A (sandboxed iframe + S3+CloudFront).** Rationale: single-tenant private threat model — only one user's agent writes code that only that user runs — makes same-origin trust acceptable. A is the documented migration path when sharing/publishing becomes a real requirement.
- **EFS over S3 for applet source.** Rationale: per-user Computer already has an EFS volume; storing applets there makes "the Computer hosts its own apps" literal and avoids cross-user S3 prefix gymnastics. Side benefit: applets are never accidentally world-readable.
- **Lightweight transform (sucrase / esbuild-wasm against pre-bundled externals) over a real project build.** Rationale: pre-bundled externals + agent-constrained imports mean each applet is one or two source files; full vite/webpack project bundling is overkill and adds a containerised builder dependency.
- **Replace plan 009's manifest outright, don't extend.** Rationale: extending with a `dashboardKind: "generic_app"` discriminant would fork every renderer down the line and leave dead branches. A clean swap is cheaper than two parallel shapes.
- **Harvest CRM components into `computer-stdlib` rather than delete.** Rationale: visual + interaction work is reusable; only the orchestrator (`CrmPipelineRiskApp.tsx`) and the CRM-locked schema are dead.
- **Slot into plan 014's M3 as a swap, not a new M6.** Rationale: preserves M1/M2/M4/M5 work and the contract-freeze gate. The new contract is the applet-package shape, frozen at M1 alongside the streaming and memory contracts.

---

## Dependencies / Assumptions

- The user's per-Computer ECS task already has an EFS volume mounted at a stable path; if not, the EFS mount is a v1 dependency to lock in at planning.
- Plan 014's M1 split-view shell, apps gallery, transcript pane, and route surface are accepted as inherited and unchanged.
- shadcn primitives and tailwind are already available in apps/computer's existing build (verify in planning before locking the import surface).
- The lightweight transform can run either in apps/computer (Web Worker, esbuild-wasm) or behind the API on the Computer ECS task; either satisfies "lightweight". The seam stays the same.
- Plan 014's contract-freeze gate at end of M1 expands to lock the applet-package shape (file layout on EFS, metadata schema, allowed import surface) before parallel M2/M3/M4 work begins.
- The agent's tool surface for `save-app` lands on the Strands runtime side as part of M3; this brainstorm assumes the existing Strands tool-registration pattern (already used by other Computer tools) without re-litigating it.

---

## Outstanding Questions

### Resolve Before Planning

- None — the synthesis was confirmed.

### Deferred to Planning

- [Affects R1, R5][Technical] Where exactly the lightweight transform runs — Web Worker inside apps/computer (no server roundtrip on rebuild, but esbuild-wasm payload is ~10MB) versus a small endpoint on the Computer ECS task (server roundtrip, but centralized validation and shared compile cache). Either satisfies "lightweight"; pick at implementation against perceived first-load time and validation needs.
- [Affects R5][Technical] EFS access pattern from apps/computer — direct API endpoint reading from the user's Computer ECS, or a small Lambda with EFS mount in the user's VPC. Settled at planning against existing API + VPC topology.
- [Affects R3][Needs research] `computer-stdlib`'s exact primitive surface — start by harvesting the seven viable CRM components, then expand based on the second concrete applet (meeting-prep brief) and any third applet identified during planning. Final surface frozen at the M1 contract-freeze gate.
- [Affects R9][Technical] Where applet user-state persists — existing thread message? New `applet_state` artifact type? Reuse of `Message.durableArtifact` link? Settled in planning against the existing GraphQL surface.
- [Affects R11][Technical] `refresh()` signature and lifecycle — `refresh(): Promise<void>` that mutates internal state via the host API hook, versus `refresh(): Promise<DataDelta>` returned to the shell. Settled at implementation.
- [Affects R8][Technical] Applet error boundary mechanism — React Error Boundary in the shell route, or load-time try/catch on the dynamic import, or both. Settled at implementation.
- [Affects R3, R14][Technical] `computer-stdlib` packaging — new `packages/computer-stdlib` workspace package versus inline in apps/computer. Settled at planning against monorepo conventions.
- [Affects R6][Needs research] Tailwind class set for agent-authored applets — does the agent need the full tailwind compiler available at transform time, or is the apps/computer pre-built CSS sufficient? If the former, transform-time tailwind JIT becomes a v1 dependency; if the latter, the agent's allowed class vocabulary is whatever apps/computer already ships.
- [Affects R14, R15][Technical] Sequencing of plan 009 manifest deletion versus stdlib creation — likely a multi-PR ladder (ship stdlib inert → wire new applet pipeline → swap CRM fixture → delete old manifest path) following the inert-first seam-swap pattern from `docs/solutions/architecture-patterns/inert-first-seam-swap-multi-pr-pattern-2026-05-08.md`. Sequencing settled at planning.
