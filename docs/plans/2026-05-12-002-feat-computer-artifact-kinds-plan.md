---
title: "feat: Computer artifact kinds (HTML + components) with applet→app rename"
type: feat
status: active
date: 2026-05-12
origin: docs/brainstorms/2026-05-12-computer-html-artifact-substrate-requirements.md
---

# feat: Computer artifact kinds (HTML + components) with applet→app rename

## Summary

Add three new artifact kinds (HTML page, plus host-component artifacts for Map, Table, Chart) alongside the existing app/TSX substrate, which stays untouched as a GenUI hedge. Runbooks declare their preferred kind upfront; agents follow. As part of this effort, every "applet" identifier in live code, schema, GraphQL, S3 layout, runbooks, docs, and project instruction files is renamed to "app" — finishing a transition the codebase is already mid-way through. No deletion, no migration of behavior, no forced convergence.

---

## Problem Frame

Today's `apps/computer` artifact substrate is a single shape: agent-authored TSX rendered in a cross-origin sandboxed iframe via runtime sucrase transform + vendored React/shadcn/recharts/leaflet + a host-applet RPC protocol. The empirical observation from the originating brainstorm is that most artifacts shipping are read-only displays where the JS runtime is dead weight, and HTML is closer to the agent's native skill than TSX. At the same time the codebase has been mid-way through an `applet → app` terminology rename for weeks: directory `apps/computer/src/components/apps/`, file `apps/computer/src/lib/app-artifacts.ts`, Strands tool name `save_app`, the partly-renamed `App.tsx` source convention. The half-finished rename is now itself a source of friction.

The plan does not commit to retiring the TSX substrate. Reasoning: the team's GenUI direction is still uncertain, and the prior decision in `docs/solutions/architecture-patterns/ai-elements-iframe-canvas-foundation-decision-2026-05-10.md` is two days old and explicitly chose the iframe+TSX shape for flexibility reasons. Adding simpler kinds in parallel preserves optionality: if HTML and component artifacts converge to cover everything the App kind does today, retirement becomes a future-call; if not, both surfaces coexist long-term.

(see origin: `docs/brainstorms/2026-05-12-computer-html-artifact-substrate-requirements.md`)

---

## Requirements

**Carried from origin requirements doc:**
- R1. Each artifact has exactly one of three payload kinds in v1: `app` (existing TSX, untouched), `html` (new — static HTML), `component` (new — name + structured data).
- R2. Artifact list, chrome (title, version, favorite, refresh, share, delete), provenance metadata, and per-user storage location are identical across kinds.
- R3. Renderer dispatch is by kind at open time; agents don't influence renderer code paths beyond choosing the kind they produce.
- R4. HTML payloads reference one canonical host-served stylesheet; agents emit semantic classes from a host-defined vocabulary.
- R5. HTML payloads cannot contain `<script>`, inline `on*` handlers, external script `<link>` or `<style>` blocks; validation rejects at save time with a structured error.
- R6. Component payloads = `{ name, data, state? }` where `name` is in the registry and `data` matches the component's Ajv schema.
- R7. Registry is host-owned TypeScript, pre-compiled into the app bundle; adding a component is a host PR.
- R7a. v1 registry contains exactly three components: Map, Table, Chart.
- R8. Save-time validation rejects unknown component names and schema-invalid data with structured errors.
- R9. HTML artifacts render in a sandboxed iframe that disallows scripts and same-origin privileges; forms are permitted.
- R10. Form actions and methods are host-owned (injection layer rewrites them); agent-emitted form actions are ignored.
- R10a. On every reopen of an HTML artifact, the host transparently pre-populates each form field with the last persisted value for the same artifact + field name; immediately editable; submissions overwrite.
- R11. Component artifacts render in the host React tree without an iframe.
- R12. Component state persists through a single host hook keyed by artifact id.
- R13. Refresh chrome invokes the recorded recipe; for HTML artifacts re-renders the iframe; for component artifacts swaps the `data` prop.
- R14. Host injects the canonical stylesheet link into every HTML payload at render time; agent-emitted alternative stylesheets are rejected.
- R15. Render failures surface a recoverable error pane with a "Regenerate with Computer" CTA without breaking the artifact list.
- R16. Components used inline in chat previews are the same registry entries used in the artifact pane (one entry, two contexts).
- R17. Exactly one canonical stylesheet at a stable URL.
- R18. v1 semantic class vocabulary is enumerated in this plan (U4 deliverable); utility-class CSS and `<style>` blocks are validator-rejected.
- R19. Vocabulary expansion is host PR work.
- R20. Provenance records carry `payload_kind` discriminator (lives in `artifacts.metadata.kind`).
- R21. Existing TSX-based apps continue to coexist with the new substrate at runtime; the App path stays operational.
- R22. The TSX/sucrase/iframe-RPC pipeline is NOT deleted in v1; retirement is an explicit future-call.

**Added in this plan (plan-time):**
- R23. Runbook schema gains a `preferred_artifact_kind: "app" | "html" | "component"` field. Runbooks without this field default to `"app"` for backward safety.
- R24. Every `applet` identifier in live code (apps/, packages/), DB schema, GraphQL types, S3 layout, runbooks, workspace defaults, and project instruction files (CLAUDE.md, AGENTS.md, docs/src/content/docs/) is renamed to `app`. Historical brainstorms, plans, and `docs/solutions/` entries are preserved unchanged.
- R25. The rename ships before any new-kind code so that new-kind work is authored against post-rename names from day one.
- R26. User-confirmation flow when a runbook permits multiple kinds is OUT of v1 (deferred to v1.x).

**Origin actors:** A1 (End user), A2 (Computer agent), A3 (apps/computer shell), A4 (Host component registry), A5 (Operator).

**Origin flows:** F1 (agent authors static HTML), F2 (agent authors component-ref), F3 (user opens HTML), F4 (user opens component), F5 (user refreshes), F6 (user fills HTML form), F7 (user changes component state).

**Origin acceptance examples:** AE1 (covers R5 — script tag rejection), AE2 (R5 — onclick rejection), AE3 (R8 — unknown component name), AE4 (R10, R15 — form action rewriting), AE5 (R13, R14 — HTML refresh + stylesheet retained), AE6 (R13 — component refresh + state preserved), AE7 (R15 — removed component recoverable error), AE8 (R18 — utility class rejection).

---

## Scope Boundaries

- No deletion or deprecation of the existing TSX/app substrate (`apps/computer/src/iframe-shell/`, `apps/computer/src/applets/`, `vite.iframe-shell.config.ts`, sucrase, `computer-stdlib`, the `save_app` Strands tool, the `sandbox.thinkwork.ai` Terraform infra).
- No reversal of the 2026-05-10 AI-Elements iframe-canvas-foundation decision; plan extends it, doesn't contradict it.
- No convergence path between App and the new kinds. If convergence makes sense later, it's a future plan.
- No user-confirmation flow when a runbook is ambiguous; v1 requires runbooks to commit to a single kind.
- No migration of the in-flight CRM pipeline-risk runbook to a new kind; it stays App.
- No promotion of `LastMileRiskCanvas` (PR #1105) from chat-Canvas to the artifact-component registry.
- No backward-compatibility shim for the legacy GraphQL `Applet*` type names after rename; consumers regenerate codegen and ship at PR merge.
- No rewriting of historical brainstorms, plans, or `docs/solutions/` entries that reference "applet."
- No real-time data streaming into artifacts; refresh remains the only data-update loop.
- No compound artifacts (HTML doc with embedded interactive components).
- No migration of admin / mobile surfaces to consume the new artifact kinds; they keep their existing views.
- No new host components beyond Map / Table / Chart in v1.

### Deferred to Follow-Up Work

- User-confirmation flow for multi-kind runbooks: separate v1.x PR after the new kinds prove out.
- Workspace-skill catalog update to teach agents the canonical CSS vocabulary in operational detail: `packages/workspace-defaults/files/skills/artifact-builder/SKILL.md` and `references/*.md` rewrite, separate PR after U4 lands.
- AI-Elements message-component reuse: the in-chat preview path for new component-kind artifacts can reuse the same registry, but the chat-side preview wiring is a follow-up PR (not blocking artifact-pane rendering).

---

## Context & Research

### Relevant Code and Patterns

- `packages/api/src/lib/routines/recipe-catalog.ts` — canonical pattern for catalog-as-TypeScript-module with name → `{ data schema, contract }`; mirror for the new host-component registry per the recipe-catalog learning below.
- `packages/api/src/lib/applets/validation.ts` (119 lines) — current TSX validator with sucrase syntax check + import allowlist + runtime-pattern blocklist. Stays operational; new HTML/component validators ship alongside it.
- `packages/api/src/lib/applets/metadata.ts` — Ajv-validated `AppletMetadataV1` shape. Extend with new valid `kind` values; rename file to `apps/metadata.ts`.
- `packages/api/src/graphql/resolvers/applets/applet.shared.ts` (847 lines) — `saveApplet`, `loadApplet`, `regenerateApplet` resolvers. Both rename and new save tools sit here.
- `packages/api/src/lib/artifacts/payload-storage.ts` — generic artifact-payload S3 layout; reuse `appletState` S3 path (`tenants/{tenantId}/applets/{appId}/state/{sha256(instanceId)}/{sha256(stateKey)}.json` → `apps/`) for HTML form-state and component state.
- `packages/api/src/handlers/artifact-deliver.ts` — existing artifact delivery Lambda; candidate to extend or sister-handler for form-post receipts.
- `apps/computer/src/routes/_authed/_shell/artifacts.$id.tsx` (197 lines) — the single renderer-dispatch point on the client; branch on `metadata.kind` here.
- `apps/computer/src/components/apps/AppArtifactSplitShell.tsx` + `AppCanvasPanel.tsx` + `GeneratedAppArtifactShell.tsx` — chrome wrappers, stay unchanged across kinds.
- `apps/computer/src/components/apps/AppRefreshControl.tsx` (135 lines) — existing refresh chrome, currently not wired in production. Wire into the new dispatch as part of U13.
- `apps/computer/src/components/computer/GeneratedArtifactCard.tsx` — inline chat-message mount of artifacts; same dispatch needed.
- `apps/computer/src/components/ai-elements/artifact.tsx` — vendored AI Elements artifact chrome (`Artifact`, `ArtifactHeader`, `ArtifactTitle`, `ArtifactLabel`, `ArtifactDescription`, `ArtifactContent`, `ArtifactActions`); reuse for all kinds.
- `packages/ui/src/theme.css` + `apps/computer/src/index.css` — the existing 32-token theme set; canonical stylesheet for HTML kind builds on these tokens.
- `packages/ui/src/components/ui/*` — 40 shadcn primitives in the host React tree; reuse for host component renderers (Card, Table, Badge, Button, Callout, Form patterns).
- `packages/agentcore-strands/agent-container/container-sources/applet_tool.py` (463 lines) — Strands tool registration for `save_app`/`load_app`/`list_apps`; rename file to `app_tool.py` and add `save_html_artifact` + `save_component_artifact` alongside.
- `packages/database-pg/src/schema/artifacts.ts` — `artifacts.type` enum (`DATA_VIEW | APPLET | APPLET_STATE | NOTE | REPORT | PLAN | DRAFT | DIGEST`); rename `APPLET`/`APPLET_STATE` → `APP`/`APP_STATE`.
- `packages/database-pg/graphql/types/artifacts.graphql` — canonical GraphQL source; all `Applet*` types rename here; consumers regenerate via `pnpm --filter @thinkwork/<name> codegen` per CLAUDE.md.
- `apps/computer/src/components/ai-elements/web-preview.tsx` — only existing `<iframe sandbox=...>` precedent (cross-site previews, `allow-scripts allow-same-origin`); useful negative reference, NOT the right pattern for HTML kind.
- `apps/computer/src/test/fixtures/crm-pipeline-risk-applet/` — fixture dir for the CRM dashboard App; rename to `crm-pipeline-risk-app/`.

### Institutional Learnings

- `docs/solutions/architecture-patterns/recipe-catalog-llm-dsl-validator-feedback-loop-2026-05-01.md` — five load-bearing patterns to copy verbatim: (1) catalog-as-TypeScript-module co-located with renderers, (2) prompt names English vocabulary but defers schema to injected registry, (3) registry injected at session start, (4) synchronous validator at save-time, (5) validator errors fed back to the agent as a system message with retry cap + operator-friendly fallback. Apply throughout U5 + U7 + U8.
- `docs/solutions/architecture-patterns/inert-first-seam-swap-multi-pr-pattern-2026-05-08.md` — substrate-first inert→live multi-PR pattern. Apply throughout: Phase B (foundation) ships inert (validators reject everything, registry has no consumers), Phase C wires new tools, Phase D flips dispatch. Each PR independently mergeable and revertible. Stubs throw, never silently no-op.
- `docs/solutions/architecture-patterns/ai-elements-iframe-canvas-foundation-decision-2026-05-10.md` — explicitly cited; this plan extends, does not reverse. The App kind preserves the iframe+TSX substrate the 2026-05-10 decision committed to.
- `docs/solutions/architecture-patterns/copilotkit-agui-computer-spike-verdict-2026-05-10.md` — prior art for component-with-validated-props pattern (`LastMileRiskCanvas`). Failure-mode prescription: unknown component name and invalid props surface as visible diagnostics, never silent fallback. Apply in U7 + U11 + U14.
- `docs/solutions/workflow-issues/survey-before-applying-parent-plan-destructive-work-2026-04-24.md` — although this plan deletes nothing in v1, the rename arc has the same blast-radius shape; run a fresh `rg "Applet|applet"` consumer survey before U3 lands, hitting `packages/api/src/`, `apps/admin/`, `apps/mobile/`, `packages/skill-catalog/`, `packages/agentcore-strands/`, `packages/database-pg/`, `terraform/`.
- `docs/solutions/best-practices/injected-built-in-tools-are-not-workspace-skills-2026-04-28.md` — registry is platform code, not a workspace skill. The host-component registry lives in `apps/computer/src/components/artifact-components/`, not in tenant workspace files.
- `docs/solutions/design-patterns/audit-existing-ui-and-data-model-before-parallel-build-2026-04-28.md` — reuse the existing `artifacts` table + chrome rather than parallel storage; the brainstorm's "identical to today's storage shape" line is the right instinct.
- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` + memory `handrolled_migrations_apply_to_dev` — U1's hand-rolled `.sql` files with `APP`/`APP_STATE` enum updates need `-- creates:` markers and must be `psql -f`'d to dev before the deploy gate fires; PRs #833 / #835 are the cautionary tale.

### External References

External research skipped; the codebase has strong local patterns (recipe-catalog, inert-seam-swap, prior validator) and the substrate replacement is a known internal shape. HTML sanitization library choice (`parse5` vs `linkedom` vs `isomorphic-dompurify`) is finalized at plan execution time, not here.

---

## Key Technical Decisions

- **Hedge over commit on substrate consolidation.** App stays operational alongside the new kinds. Rationale: GenUI direction is uncertain; the 2026-05-10 iframe-canvas decision is two days old; deletion can happen in a future plan if the new kinds prove out. Original brainstorm's "no escalation tier" line is explicitly inverted here per user reframe.
- **Discriminator lives in `artifacts.metadata.kind` field**, not a new column. Today's value `"computer_applet"` migrates to `"computer_app"` as part of the rename; new valid values `"html"` and `"component"` added. No Drizzle ALTER TABLE for a discriminator column.
- **HTML iframe uses `srcdoc` + `sandbox="allow-forms"`** (no `allow-scripts`, no `allow-same-origin`). Does NOT touch the cross-origin `sandbox.thinkwork.ai` infrastructure — that stays serving App-kind artifacts.
- **Host-component registry mirrors the recipe-catalog pattern**: TypeScript module `apps/computer/src/components/artifact-components/registry.ts` exports a single map `name → { component, schema, refreshContract }`. Registry is injected to agent tool surface at session start.
- **Two new Strands tools**, not one with a payload-kind argument: `save_html_artifact` and `save_component_artifact`. Coexist with existing `save_app`. Clearer contracts for the agent + cleaner validator-feedback loop per recipe-catalog learning.
- **Runbook schema gains `preferred_artifact_kind` field** (one of `"app"`, `"html"`, `"component"`). Routes the agent's tool surface at runbook-load time; existing runbooks default to `"app"`.
- **HTML validator is parser-based**, not regex. Library choice (`parse5` vs `linkedom` vs `isomorphic-dompurify`) deferred to plan execution; structural requirement is a real DOM-walk that rejects scripts, inline handlers, non-canonical `<link>`/`<style>`, and utility-class names.
- **Rename arc lands before new-kind work** (Phase A before B). Reasoning: codegen ripples and GraphQL type churn are far easier to absorb in a clean rename PR sequence than mixed into substrate-add PRs.
- **Rename is structured as three PRs** in sequence: (U1) DB enum + Drizzle migration + hand-rolled SQL with `-- creates:` markers; (U2) GraphQL types + AppSync schema rebuild + codegen across consumers + S3 path code; (U3) frontend + backend + Python file + remaining identifier sweep. Each independently mergeable and revertible.
- **No `@deprecated` arc on GraphQL `Applet*` types**. Hard rename. Consumers regenerate codegen at PR merge; the type rename is not a breaking-change boundary because all consumers live in the monorepo and ship together.
- **S3 path rename includes a backfill copy**: U2 ships a one-shot script that `aws s3 cp --recursive`-copies `tenants/<t>/applets/<a>/...` → `tenants/<t>/apps/<a>/...` in dev. Prod is pre-launch; verified at execution time via `aws s3 ls`. Old paths get a 30-day deletion grace period.
- **Refresh chrome is host-side recorded recipes, NOT applet-exported functions**, for HTML + component kinds. App kind keeps its existing in-source `refresh()` export (no behavior change for App). Recipe storage is a sibling JSON file in the artifact's S3 directory.
- **`LastMileRiskCanvas` stays a one-off chat-Canvas component**, not promoted to the artifact registry. v1 component registry is built net-new with clean schemas.
- **Class vocabulary is enumerated in U4 as a deliverable**, not deferred. The unit's output is a real `apps/computer/src/styles/artifact-vocabulary.md` doc + the canonical CSS file at the stable URL.

---

## Open Questions

### Resolved During Planning

- Discriminator strategy (new column vs reuse field): **resolved** — reuse `artifacts.metadata.kind`, no DB ALTER for the discriminator.
- Iframe pattern (cross-origin sandbox vs srcdoc): **resolved** — srcdoc for new HTML kind; cross-origin stays for App kind.
- Tool surface (one tool with arg vs two tools): **resolved** — two tools (`save_html_artifact`, `save_component_artifact`).
- Rename ordering relative to new-kind work: **resolved** — rename first.
- Backward-compatibility arc on GraphQL `Applet*` types: **resolved** — hard rename, no deprecation grace.
- Registry location (platform code vs workspace skill): **resolved** — platform code (per `injected-built-in-tools-are-not-workspace-skills-2026-04-28.md`).
- v1 class vocabulary: **resolved** as U4 deliverable (audit `computer-stdlib` + shadcn primitive surface + in-flight applet shapes; produce smallest semantic set).

### Deferred to Implementation

- HTML sanitization library choice: `parse5` vs `linkedom` vs `isomorphic-dompurify`. Pick during U7 based on (a) bundle size for the host-side validator's Lambda packaging, (b) DOM-walk ergonomics, (c) maintenance posture. None of these are scope-shaping; the structural requirement (parser-based, reject scripts/handlers/style/utility) is fixed.
- Exact `preferred_artifact_kind` runbook-schema field name and YAML position. Resolve when touching `packages/runbooks/runbooks/*/runbook.yaml` schema; pick the form that parses cleanest with the existing runbook loader.
- Form-action injection mechanics: rewrite at `srcdoc` injection time vs require agent to omit `action` attribute and host injects on its own. Pick during U10 based on parser ergonomics.
- Component-state schema versioning: how host migrates persisted state when a component's schema changes. Address when adding the second component-schema-version after Map/Table/Chart ship; v1 punts to "state cleared on schema mismatch."
- AppSync subscription schema regeneration cadence within the rename PR: whether `terraform/schema.graphql` regenerates in the same commit as the GraphQL source or in a follow-up commit. Address when authoring U2's PR.
- S3 backfill rollback path: whether failed `aws s3 cp` aborts the script or continues with a manifest of failures for retry. Address during U2.

---

## Output Structure

```
apps/computer/src/
  components/
    artifact-components/                    # NEW — host component registry + renderers
      registry.ts                           # name → { component, schema, refreshContract }
      __tests__/registry.test.ts
      MapArtifact.tsx                       # one of three v1 components
      MapArtifact.test.tsx
      TableArtifact.tsx
      TableArtifact.test.tsx
      ChartArtifact.tsx
      ChartArtifact.test.tsx
    artifact-renderers/                     # NEW — kind-specific renderers + dispatch
      HtmlArtifactIframe.tsx                # srcdoc + sandbox="allow-forms"
      HtmlArtifactIframe.test.tsx
      HostComponentRenderer.tsx             # looks up registry, mounts component
      HostComponentRenderer.test.tsx
      ArtifactRendererDispatch.tsx          # branch on metadata.kind
      ArtifactRendererDispatch.test.tsx
    apps/                                   # EXISTING (renamed from Applet* file names)
      AppMount.tsx                          # renamed from AppletMount.tsx (existing)
      InlineAppEmbed.tsx                    # renamed from InlineAppletEmbed.tsx
  styles/
    artifact-vocabulary.md                  # NEW — canonical class vocabulary doc
    artifact-canonical.css                  # NEW — stylesheet served at known URL
  lib/
    app-artifacts.ts                        # EXISTING (already named "app")
    artifact-form-state-client.ts           # NEW — host-side form persistence client

packages/api/src/
  lib/
    apps/                                   # NEW DIR (renamed from applets/)
      validation.ts                         # existing TSX validator, untouched behavior
      validation-html.ts                    # NEW — parser-based HTML validator
      validation-component.ts               # NEW — Ajv + registry-lookup validator
      metadata.ts                           # extended kind enum
      storage.ts                            # S3 paths use "apps/" segment
      access.ts                             # unchanged behavior
      refresh-recipes.ts                    # NEW — host-side data-recipe storage
  graphql/
    resolvers/
      apps/                                 # NEW DIR (renamed from applets/)
        app.shared.ts                       # renamed from applet.shared.ts
        save-html-artifact.ts               # NEW
        save-component-artifact.ts          # NEW
  handlers/
    artifact-deliver.ts                     # extended for new kinds
    artifact-form-post.ts                   # NEW — Lambda for HTML form submissions

packages/agentcore-strands/agent-container/container-sources/
  app_tool.py                               # renamed from applet_tool.py
  html_artifact_tool.py                     # NEW — save_html_artifact tool
  component_artifact_tool.py                # NEW — save_component_artifact tool

packages/database-pg/
  src/schema/artifacts.ts                   # enum APPLET/APPLET_STATE → APP/APP_STATE
  graphql/types/artifacts.graphql           # all Applet* types renamed to App*
  drizzle/NNNN_app_enum_rename.sql          # NEW — hand-rolled migration

packages/runbooks/runbooks/
  crm-dashboard/runbook.yaml                # gains preferred_artifact_kind: "app"
  <future-runbook>/runbook.yaml             # may declare "html" or "component"
```

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Dispatch shape (post-cutover):**

```
agent emits via Strands tool surface
  ├── save_app(files, metadata) ────────────────►  apps/validation.ts (TSX)        → metadata.kind = "computer_app"
  ├── save_html_artifact(html, metadata) ──────►  apps/validation-html.ts (DOM)   → metadata.kind = "html"
  └── save_component_artifact(name, data) ─────►  apps/validation-component.ts    → metadata.kind = "component"
                                                  (Ajv + registry lookup)

apps/computer/src/routes/_authed/_shell/artifacts.$id.tsx
  └─ ArtifactRendererDispatch(metadata.kind)
       ├── "computer_app"     →  AppMount (existing, cross-origin iframe, sandbox.thinkwork.ai)
       ├── "html"             →  HtmlArtifactIframe (srcdoc + sandbox="allow-forms" + canonical CSS)
       └── "component"        →  HostComponentRenderer (registry lookup → React component, trusted)
```

**Save-flow with validator feedback (recipe-catalog pattern):**

```
agent ── tool call ──► resolver ── validate ──┬── PASS → S3 write + artifacts row upsert → SaveArtifactPayload { ok: true }
                                              └── FAIL → SaveArtifactPayload { ok: false, errors: [...] }
                                                          │
                                                          └─► agent receives errors as system message
                                                                │
                                                                └─► retry-cap N (≤ 2); after exhaustion, "Regenerate with Computer" CTA surfaces
```

**Inert→live rollout cadence (3 phases of 4–5 PRs each):**

```
PHASE A (rename)          PHASE B (foundation)    PHASE C (tools/runbook)   PHASE D (renderers + dispatch)
   ┌────┐                    ┌────────────────┐      ┌──────────────┐         ┌─────────────────────────────┐
   │ U1 │ DB enum            │ U4 CSS + vocab │      │ U8 new tools │         │ U10 HtmlArtifactIframe       │
   │ U2 │ GraphQL + S3 paths │ U5 registry    │      │ U9 runbook   │         │ U11 host components          │
   │ U3 │ code sweep         │ U6 metadata    │      │   schema     │         │ U12 form-post + state        │
   └────┘                    │ U7 validators  │      └──────────────┘         │ U13 refresh chrome wiring    │
                             └────────────────┘                                │ U14 dispatch live in routes  │
                                                                               └─────────────────────────────┘
                                                                                                ▼
                                                                                             PHASE E
                                                                                            ┌─────┐
                                                                                            │ U15 │ docs sweep
                                                                                            └─────┘
```

---

## Implementation Units

### U1. DB enum rename + Drizzle migration

**Goal:** Rename `artifacts.type` enum values `APPLET`/`APPLET_STATE` → `APP`/`APP_STATE`. Backfill existing rows. Update `metadata.kind` values from `"computer_applet"` to `"computer_app"` for existing applet artifacts (no new-kind values added yet).

**Requirements:** R24, R25

**Dependencies:** None (first unit in the rename arc)

**Files:**
- Modify: `packages/database-pg/src/schema/artifacts.ts`
- Create: `packages/database-pg/drizzle/NNNN_app_enum_rename.sql` (hand-rolled, with `-- creates:` markers)
- Test: `packages/database-pg/src/__tests__/artifacts-app-enum.test.ts`

**Approach:**
- The `artifacts.type` is text-not-enum at the DB level (per `packages/database-pg/src/schema/artifacts.ts`); rename means UPDATE rows + update application-side allowed-values constants. If a CHECK constraint exists, drop and recreate with new values.
- `metadata` is jsonb; backfill via SQL `UPDATE artifacts SET metadata = jsonb_set(metadata, '{kind}', '"computer_app"') WHERE metadata->>'kind' = 'computer_applet'` plus a parallel `UPDATE artifacts SET metadata = jsonb_set(metadata, '{kind}', '"computer_app_state"') WHERE metadata->>'kind' = 'computer_applet_state'` — the codebase writes both `computer_applet` (applet sources) and `computer_applet_state` (per-user state rows), and missing the second value would leave state rows un-migrated and break U6's `parseAppMetadataV1` after the schema extension lands.
- File requires `-- creates: public.artifacts.type:APP -- creates: public.artifacts.type:APP_STATE` markers so the deploy-time drift reporter recognizes the change (memory: `handrolled_migrations_apply_to_dev`).
- Author must `psql "$DATABASE_URL" -f packages/database-pg/drizzle/NNNN_app_enum_rename.sql` to dev BEFORE the deploy gate fires — costs of forgetting documented at PRs #833 + #835.
- Drizzle `db:generate` cannot author this; the migration is a hand-rolled `.sql` registered through marker comments only.

**Patterns to follow:**
- `packages/database-pg/drizzle/*.sql` hand-rolled migrations with `-- creates:` markers and `meta/_journal.json` exemption (per CLAUDE.md "Database / GraphQL schema").
- `packages/database-pg/src/__tests__/*` Drizzle test pattern.

**Test scenarios:**
- Happy path: existing applet row with `type = 'APPLET'` and `metadata.kind = 'computer_applet'` → after migration → `type = 'APP'`, `metadata.kind = 'computer_app'`.
- Happy path: existing applet-state row with `type = 'APPLET_STATE'` → after migration → `type = 'APP_STATE'`.
- Edge case: row with no `metadata.kind` field → metadata untouched, `type` updated.
- Edge case: row with `metadata.kind = 'note'` (non-applet kind) → both fields untouched.
- Integration: drift reporter (`pnpm db:migrate-manual`) flags this migration as registered when `-- creates:` markers are present; flags it missing when run against an un-applied DB.

**Verification:**
- `SELECT DISTINCT type FROM artifacts` returns `APP`, `APP_STATE`, `NOTE`, `REPORT`, `PLAN`, `DRAFT`, `DIGEST`, `DATA_VIEW` (no `APPLET*` values).
- `SELECT DISTINCT metadata->>'kind' FROM artifacts` returns neither `'computer_applet'` nor `'computer_applet_state'`.
- `pnpm db:migrate-manual` reports `creates: public.artifacts.type:APP` and `creates: public.artifacts.type:APP_STATE` as present in target DB.

---

### U2. GraphQL types rename + AppSync schema + codegen + S3 path code

**Goal:** Rename all `Applet*` GraphQL types and operations to `App*`. Rebuild AppSync subscription schema. Regenerate codegen across all four consumers. Update S3 path constants from `applets/` → `apps/`. Ship a one-shot backfill script that copies existing dev S3 data.

**Requirements:** R24, R25

**Dependencies:** U1

**Files:**
- Modify: `packages/database-pg/graphql/types/artifacts.graphql` — all `type Applet*`, `input SaveApplet*`, `query applet(...)`, `mutation saveApplet/regenerateApplet/saveAppletState` rename
- Modify: `terraform/schema.graphql` — regenerated via `pnpm schema:build`
- Modify: `packages/api/src/lib/applets/storage.ts` — S3 prefix from `applets/` → `apps/`
- Modify: `packages/api/src/lib/artifacts/payload-storage.ts` — `appletStatePayloadKey` path segments
- Create: `scripts/migrations/2026-05-12-applet-to-app-s3-backfill.sh`
- Test: regenerated codegen output type-checks in `apps/cli`, `apps/admin`, `apps/mobile`, `packages/api`

**Approach:**
- Rename map: `Applet` → `App`, `AppletPayload` → `AppPayload`, `AppletState` → `AppState`, `SaveAppletInput` → `SaveAppInput`, `SaveAppletPayload` → `SaveAppPayload`, `applet(appId)` → `app(appId)`, `saveApplet` → `saveApp`, `regenerateApplet` → `regenerateApp`, `saveAppletState` → `saveAppState`, `appletState` → `appState`.
- Run `pnpm schema:build` to regenerate `terraform/schema.graphql` from the updated source.
- Run `pnpm --filter @thinkwork/{cli,admin,mobile,api} codegen` to regenerate downstream operation types. Codegen runs as part of this PR; consumers don't ship separately.
- S3 backfill script: `aws s3 cp --recursive s3://<bucket>/tenants/<tenant>/applets/ s3://<bucket>/tenants/<tenant>/apps/ --metadata-directive REPLACE` per tenant in dev. Old paths retained for 30 days; deletion happens in a separate cleanup script after stability window.
- Storage code reads from new paths only after this PR; old data is moved before the code change ships (or the backfill script is run as part of the PR's deploy step).
- GraphQL Lambda deploys via PR per memory `graphql_deploy_via_pr` — do NOT `aws lambda update-function-code` directly.

**Patterns to follow:**
- `pnpm schema:build` + per-package codegen sequence (CLAUDE.md "Database / GraphQL schema" section).
- `scripts/migrations/*` directory for one-shot scripts.

**Test scenarios:**
- Happy path: after codegen, all four consumers (`cli`, `admin`, `mobile`, `api`) compile cleanly with no `Applet*` symbols remaining.
- Happy path: S3 backfill script run against a dev tenant copies all `applets/` keys to `apps/` with identical content (`aws s3 ls --recursive` diff is empty after copy).
- Edge case: dev tenant with zero applet data → backfill script exits cleanly with `0 objects copied`.
- Error path: S3 backfill script encounters a missing bucket → exits non-zero with a clear error message; does not partially-copy.
- Integration: `applet(appId)` query against the updated GraphQL endpoint returns a "field not found" error; `app(appId)` succeeds.

**Verification:**
- `rg "Applet" packages/database-pg/graphql/ apps/ packages/api/ packages/lambda/` returns zero matches.
- `terraform/schema.graphql` references `App*` types only.
- Codegen-output `.ts` files contain no `Applet*` types.

---

### U3. Frontend + backend + Python + remaining identifier sweep

**Goal:** Finish the rename — every `Applet`/`applet` identifier in live code becomes `App`/`app`. Includes frontend code (component names, hooks, types, route file content), backend lib (file/dir renames, function renames), the Python Strands tool file rename, project instruction file mentions (CLAUDE.md, AGENTS.md), workspace defaults (skill catalog), runbook YAML keys if any, and test fixture directory rename. Historical docs preserved unchanged.

**Requirements:** R24, R25

**Dependencies:** U1, U2

**Files:**
- Rename dir: `packages/api/src/lib/applets/` → `packages/api/src/lib/apps/`
- Rename dir: `packages/api/src/graphql/resolvers/applets/` → `packages/api/src/graphql/resolvers/apps/`
- Rename file: `packages/api/src/graphql/resolvers/applets/applet.shared.ts` → `packages/api/src/graphql/resolvers/apps/app.shared.ts`
- Rename file: `packages/agentcore-strands/agent-container/container-sources/applet_tool.py` → `app_tool.py`
- Rename file: `packages/agentcore-strands/agent-container/test_applet_tool.py` → `test_app_tool.py`
- Rename file: `apps/computer/src/components/apps/AppletErrorBoundary.tsx` → `AppErrorBoundary.tsx`
- Rename file: `apps/computer/src/components/apps/InlineAppletEmbed.tsx` → `InlineAppEmbed.tsx`
- Rename file: `apps/computer/src/applets/mount.tsx` → keeps location (this dir is the *legacy iframe-RPC* dir and stays untouched per Scope Boundaries); but `AppletMount` symbol becomes `AppMount` inside it (no functional change)
- Rename test fixture: `apps/computer/src/test/fixtures/crm-pipeline-risk-applet/` → `crm-pipeline-risk-app/`
- Modify: `CLAUDE.md` — all "applet" mentions become "app"
- Modify: `packages/api/AGENTS.md`, `apps/computer/AGENTS.md`, other AGENTS.md files (if they mention applet)
- Modify: `packages/workspace-defaults/files/skills/artifact-builder/SKILL.md`, `references/*.md` — applet → app
- Modify: `packages/runbooks/runbooks/crm-dashboard/runbook.yaml`, `phases/*.md` — applet → app
- Modify: `docs/src/content/docs/` — doc site references
- Sweep: `rg "Applet|applet" --type ts --type tsx --type py apps/ packages/` and rename every match outside the legacy `apps/computer/src/applets/` and `apps/computer/src/iframe-shell/` directories (those keep their dir names — they're the legacy substrate and are out of scope; symbols inside them rename for clarity but file names stay)

**Approach:**
- Before opening the PR, run the consumer survey from `survey-before-applying-parent-plan-destructive-work-2026-04-24.md`: `rg "Applet|applet" --type ts --type tsx --type py apps/ packages/ terraform/ docs/src/` and review every match. Anything in `docs/brainstorms/`, `docs/plans/`, `docs/solutions/` is historical and preserved.
- The legacy iframe-RPC code in `apps/computer/src/applets/` and `apps/computer/src/iframe-shell/` keeps its directory names. Rationale: those directories are scope-locked as untouched by R21/R22, and renaming them implies retirement which we explicitly defer. Symbol-level renames inside them (`AppletMount` → `AppMount`) are fine for consistency and don't reach the substrate boundary.
- Python file: `applet_tool.py` → `app_tool.py` is a real rename; the Strands tool *registration names* (`save_app`, `load_app`, `list_apps`) are already "app" and untouched.
- Project instruction files (CLAUDE.md, AGENTS.md): mass-replace "applet" with "app" except where the historical context requires preservation (e.g., a paragraph explaining the legacy applet substrate naming history).
- Workspace defaults + runbook YAMLs + skill catalog markdown: same mass-replace.

**Patterns to follow:**
- Atomic rename PR pattern (single PR touches every live surface) — keeps codegen and tests aligned.
- AGENTS.md / CLAUDE.md hierarchy preserved (project root + per-package files).

**Test scenarios:**
- Happy path: `rg "Applet" apps/ packages/ --type ts --type tsx --type py` returns no matches outside `apps/computer/src/applets/` and `apps/computer/src/iframe-shell/` (the legacy substrate dirs, untouched by name).
- Happy path: `rg "applet" CLAUDE.md AGENTS.md packages/*/AGENTS.md` returns no matches.
- Happy path: `apps/cli`, `apps/admin`, `apps/mobile`, `packages/api`, `packages/lambda` all `pnpm typecheck` clean.
- Happy path: `uv run pytest packages/agentcore-strands/agent-container/test_app_tool.py` passes (test file renamed alongside source file).
- Edge case: AGENTS.md sections describing legacy substrate history may keep "applet" as a historical reference — verify by spot-check, not regex.
- Integration: `pnpm -r --if-present test` passes across the monorepo.

**Verification:**
- Atomic PR merges cleanly; CI green on all four consumers.
- Manual grep of live surfaces returns zero `Applet`/`applet` outside legacy-substrate directory names.

---

### U4. Canonical artifact CSS stylesheet + class vocabulary catalog

**Goal:** Author the v1 canonical stylesheet + the documented semantic class vocabulary. Class vocabulary is the deliverable of this unit (R18 satisfied here, not deferred). Stylesheet served at a stable URL for HTML iframe `<link>` injection.

**Requirements:** R4, R14, R17, R18, R19

**Dependencies:** U3 (the rename arc must be complete so this lands against post-rename names)

**Files:**
- Create: `apps/computer/src/styles/artifact-canonical.css`
- Create: `apps/computer/src/styles/artifact-vocabulary.md` (documentation)
- Create: `apps/computer/src/styles/__tests__/vocabulary.test.ts`
- Modify: `apps/computer/src/index.css` — `@source`-include the new file so Tailwind tooling sees its classes
- Modify: `apps/computer/vite.config.ts` (if needed) — serve the stylesheet at a stable URL

**Approach:**
- Audit input surface: enumerate every visual primitive used in (a) `packages/computer-stdlib/src/` (existing applet primitives), (b) `packages/ui/src/components/ui/` (shadcn surface in current chat UI), (c) shipped in-flight applet fixtures (`apps/computer/src/test/fixtures/crm-pipeline-risk-app/`). Cross-reference to find the smallest semantic set that covers known shapes.
- Expected vocabulary: ~12–20 classes including `.artifact`, `.artifact-header`, `.artifact-title`, `.artifact-section`, `.artifact-callout` (with `.callout-info` / `.callout-warn` / `.callout-destructive` variants via `--color-*` tokens), `.artifact-table` + `.artifact-table-row` + `.artifact-table-cell`, `.artifact-form-row` + `.artifact-label` + `.artifact-input`, `.artifact-badge` (with token-driven variants), `.artifact-kv` (key-value rows), `.artifact-list` + `.artifact-list-item`, `.artifact-meta` (small/de-emphasized text). Final set finalized during U4 authoring.
- CSS uses `--color-*`, `--radius-*`, `--font-*` tokens from `packages/ui/src/theme.css` so artifact styling tracks the rest of the app on theme changes.
- Stylesheet served at `/artifact-canonical.css` (route-served, not bundled into iframe — so cache control + versioning are host-side concerns).
- Vocabulary doc is the source of truth for the agent prompt — U8 reads from this doc when injecting the class vocabulary into the agent context.
- Inert at this stage: no agent emits HTML yet, no iframe renders this CSS yet, but the file exists and is served.

**Patterns to follow:**
- `packages/ui/src/theme.css` for the `@theme inline` token-export pattern.
- `apps/computer/src/index.css` for the `@source`-include of CSS files Tailwind needs to scan.

**Test scenarios:**
- Happy path: stylesheet fetched at `/artifact-canonical.css` returns 200 with `Content-Type: text/css`.
- Happy path: vocabulary doc enumerates every class present in the stylesheet (no orphaned classes); the test parses both files and asserts set equality.
- Edge case: stylesheet contains no `<script>` injection vector (purely declarative CSS, no `expression()`, no `behavior:` IE-era constructs).
- Integration: a static HTML snippet referencing `<link rel="stylesheet" href="/artifact-canonical.css">` + class names from the vocabulary renders with the expected token-resolved colors in a JSDOM test.

**Verification:**
- Stylesheet + vocabulary doc both committed. Vocabulary class list is stable enough that U7's validator (next unit) can hard-reference it.

---

### U5. Host-component registry module (Map / Table / Chart stubs + schemas)

**Goal:** Author the host-component registry as a TypeScript module mirroring the recipe-catalog pattern. Three v1 entries (Map, Table, Chart) ship as stubs with their Ajv data schemas and refresh contracts defined; React component bodies are minimal placeholders that render a "stub" badge — full implementations are deferred to U11.

**Requirements:** R6, R7, R7a, R16

**Dependencies:** U3

**Files:**
- Create: `apps/computer/src/components/artifact-components/registry.ts`
- Create: `apps/computer/src/components/artifact-components/schemas/MapSchema.ts`
- Create: `apps/computer/src/components/artifact-components/schemas/TableSchema.ts`
- Create: `apps/computer/src/components/artifact-components/schemas/ChartSchema.ts`
- Create: `apps/computer/src/components/artifact-components/MapArtifact.tsx` (stub)
- Create: `apps/computer/src/components/artifact-components/TableArtifact.tsx` (stub)
- Create: `apps/computer/src/components/artifact-components/ChartArtifact.tsx` (stub)
- Create: `apps/computer/src/components/artifact-components/__tests__/registry.test.ts`
- Create: `apps/computer/src/components/artifact-components/__tests__/MapArtifact.test.tsx` (stub-level)
- Create: `apps/computer/src/components/artifact-components/__tests__/TableArtifact.test.tsx` (stub-level)
- Create: `apps/computer/src/components/artifact-components/__tests__/ChartArtifact.test.tsx` (stub-level)

**Approach:**
- Registry shape: `Record<string, { component: React.ComponentType<{ data, state, onStateChange }>, dataSchema: JSONSchema, refreshContract: { dataSource: string, params: JSONSchema } | null }>`.
- Each entry's data schema is an Ajv-compatible JSON Schema describing the structured input the agent emits (e.g., Map's schema specifies `{ points: Array<{ lat, lng, label?, popup? }>, bounds?, initialZoom? }`).
- Each entry's refresh contract specifies which named MCP/GraphQL fetcher the host invokes on Refresh and what params it accepts. Concrete fetcher implementations live in U11/U13; v1 contracts are declarative.
- Stub components render `<div className="artifact artifact-stub" data-component-name={name}>Stub: {name}</div>` so dispatch-test fixtures can assert mount without depending on full component behavior.
- Registry inlined as a frozen object literal; no runtime mutation; consumers `import { ARTIFACT_COMPONENT_REGISTRY } from "..."`.

**Patterns to follow:**
- `packages/api/src/lib/routines/recipe-catalog.ts` — catalog-as-typescript-module pattern; co-locate the data schema with the renderer.
- `docs/solutions/architecture-patterns/copilotkit-agui-computer-spike-verdict-2026-05-10.md` — `LastMileRiskCanvas` validated-props pattern.

**Test scenarios:**
- Happy path: `ARTIFACT_COMPONENT_REGISTRY` exports exactly `["map", "table", "chart"]` (Object.keys assertion).
- Happy path: each entry has all required fields (`component`, `dataSchema`, `refreshContract`); the test enforces shape via TS + runtime assertion.
- Happy path: each Ajv schema compiles via `new Ajv()` without throwing; sample valid data validates clean; sample invalid data fails with specific paths.
- Edge case: registry lookup with an unknown key returns `undefined` (registry is the source of truth; no fallback).
- Integration: stub component renders with `data-component-name` attribute when mounted with valid props; `getByTestId('artifact-stub')` finds it.

**Verification:**
- Registry compiles. Stub components render. Schemas are Ajv-valid. No agent or renderer wires this in yet — pure foundation.

---

### U6. Artifact metadata.kind discriminator extension

**Goal:** Extend the `AppMetadataV1` Ajv schema (renamed in U3 from `AppletMetadataV1`) to accept new `kind` values: `"html"`, `"component"`. Existing value `"computer_app"` (renamed in U1 from `"computer_applet"`) stays valid. Add corresponding GraphQL `enum ArtifactKind { COMPUTER_APP, HTML, COMPONENT }` discriminator field on `App` type.

**Requirements:** R1, R20

**Dependencies:** U3, U5 (registry must exist so U7's component validator can reference it)

**Files:**
- Modify: `packages/api/src/lib/apps/metadata.ts` — Ajv schema extension
- Modify: `packages/database-pg/graphql/types/artifacts.graphql` — `kind` field type narrows from `String` to `ArtifactKind` enum
- Modify: `packages/api/src/lib/apps/__tests__/metadata.test.ts`
- Run: `pnpm schema:build` + per-consumer codegen as part of this PR

**Approach:**
- Ajv schema is the source of truth; GraphQL enum mirrors it.
- Backward-compatible read: existing rows with `metadata.kind = "computer_app"` continue to parse.
- New `kind` field is required at save time but optional at read time (defaulting to `"computer_app"` for any row predating this PR — but U1's backfill already populated every row with a kind value, so the default is theoretically unreachable).
- For `kind = "component"`, the metadata gains additional required fields: `componentName` (string, must be a key in `ARTIFACT_COMPONENT_REGISTRY`) and `componentDataSchemaVersion` (integer ≥ 1). The Ajv schema enforces these via conditional `if/then`.
- For `kind = "html"`, the metadata gains optional fields: `refreshRecipeId` (string, present iff the agent recorded a refresh recipe at save).
- The valid `kind` enum at this layer is exactly: `"computer_app"`, `"computer_app_state"`, `"html"`, `"component"`. The `"computer_app_state"` value is preserved from the post-U1 backfill of legacy per-user state rows.
- This unit ships inert: no save path emits the new kinds yet (U8 wires that).

**Patterns to follow:**
- `packages/api/src/lib/apps/metadata.ts` (existing) — Ajv schema versioned + `parseAppMetadataV1` API.

**Test scenarios:**
- Happy path: `parseAppMetadataV1({ kind: "computer_app", appId, version, ... })` returns valid metadata (existing behavior preserved).
- Happy path: `parseAppMetadataV1({ kind: "html", appId, version, ... })` returns valid metadata.
- Happy path: `parseAppMetadataV1({ kind: "component", componentName: "map", componentDataSchemaVersion: 1, ... })` returns valid metadata.
- Error path: `parseAppMetadataV1({ kind: "component" })` without `componentName` fails with Ajv error pointing at `/componentName`.
- Error path: `parseAppMetadataV1({ kind: "component", componentName: "interactive-globe" })` (name not in registry) — Ajv schema accepts any string here; registry-membership check is U7's validator job, not Ajv's. Confirm Ajv-pass + flag the cross-reference responsibility in the test docstring.
- Error path: `parseAppMetadataV1({ kind: "snowman" })` (unknown kind) fails with Ajv enum-error.
- Integration: GraphQL codegen-output type for `App.kind` is `ArtifactKind` enum (not raw string).

**Verification:**
- Ajv schema accepts all three kinds. GraphQL codegen regenerates with the enum. No save resolver yet calls `parseAppMetadataV1` with the new kinds (those wire in U8).

---

### U7. HTML payload validator + component payload validator

**Goal:** Author two new validators alongside the existing TSX `validateAppSource`: `validateHtmlPayload` (parser-based DOM walk that rejects scripts/handlers/styles/utility classes) and `validateComponentPayload` (Ajv-validates against the registry entry's data schema + asserts component name is registered). Both throw structured errors agents can re-prompt on.

**Requirements:** R5, R8, R10, R14, R15, R18

**Dependencies:** U4, U5, U6

**Files:**
- Create: `packages/api/src/lib/apps/validation-html.ts`
- Create: `packages/api/src/lib/apps/validation-component.ts`
- Create: `packages/api/src/lib/apps/__tests__/validation-html.test.ts`
- Create: `packages/api/src/lib/apps/__tests__/validation-component.test.ts`
- Modify: `packages/api/package.json` — add `parse5` (or chosen alternative) dependency

**Execution note:** Start with failing test fixtures derived directly from the origin acceptance examples (AE1, AE2, AE3, AE4, AE8) — these validators are the primary defense of R5, R8, R14, R18 and the AEs translate cleanly into unit tests. Author validators to pass each AE-derived test in turn.

**Approach:**
- HTML validator: parse the agent-emitted HTML via `parse5` (or finalized library), walk the DOM tree. Reject node types: `<script>` (any), elements with `on*` attributes (case-insensitive), elements with `style` attribute, `<style>` blocks, `<link>` to non-canonical stylesheet URLs (anything other than `/artifact-canonical.css`), any element with `class` containing a utility-pattern class name (regex matching Tailwind-like patterns: `^(text|bg|border|p|m|w|h|flex|grid|gap)-` etc.) or a class name not in the vocabulary set imported from U4's vocabulary doc.
- HTML validator also: rewrite `<form action="">` attributes to the host-controlled post endpoint (R10) — or reject any form with a non-empty agent-emitted `action`. Pick during implementation; both satisfy R10.
- Component validator: assert `payload.name` is a key in `ARTIFACT_COMPONENT_REGISTRY` (R8 first half); compile `Ajv` against the registry entry's `dataSchema`; validate `payload.data` (R8 second half); collect Ajv errors as structured `{ path, message, expected }` for agent feedback.
- Both validators return a discriminated union: `{ ok: true } | { ok: false, errors: ValidationError[] }`. Errors are surfaced to the agent as a system message with retry cap N=2 (per recipe-catalog learning).
- Inert at this stage: validators exist but nothing calls them yet.

**Patterns to follow:**
- `packages/api/src/lib/apps/validation.ts` (existing TSX validator) — error-result discriminated-union pattern.
- `docs/solutions/architecture-patterns/recipe-catalog-llm-dsl-validator-feedback-loop-2026-05-01.md` — validator feedback-loop with retry-cap.

**Test scenarios:**
- Happy path (HTML): valid HTML using only vocabulary classes + `<link>` to canonical stylesheet → `{ ok: true }`.
- Happy path (HTML): HTML with native `<form>` having no `action` attribute → `{ ok: true }`.
- Covers AE1. Error path (HTML): payload contains `<script>alert(1)</script>` → `{ ok: false, errors: [{ path, message: "<script> not permitted", ... }] }`.
- Covers AE2. Error path (HTML): payload contains `<button onclick="x()">` → fails with specific path + `on*` handler reason.
- Covers AE8. Error path (HTML): payload contains `<style>...</style>` or class `bg-red-500` → fails with utility-class or `<style>` rejection reason.
- Error path (HTML): payload contains `<link rel="stylesheet" href="https://example.com/evil.css">` → fails with non-canonical-stylesheet rejection.
- Covers AE4. Error path (HTML): payload contains `<form action="https://example.com/steal">` → fails OR rewrites to host endpoint, per chosen approach.
- Happy path (component): `{ name: "map", data: { points: [{ lat: 40, lng: -73 }] } }` → `{ ok: true }`.
- Covers AE3. Error path (component): `{ name: "interactive-globe", data: {} }` → fails with specific "unknown component" error naming the available registry keys.
- Error path (component): `{ name: "map", data: { points: "not an array" } }` → fails with Ajv error pointing at `/data/points`.
- Edge case (HTML): empty payload `""` → fails with "non-empty HTML required."
- Edge case (component): missing `data` field → fails with Ajv missing-required error.
- Integration: validator errors round-trip through the future save mutation as structured `errors` in `SaveAppPayload` (verified in U8's integration test).

**Verification:**
- Both validators export a `validate*` function that returns the discriminated-union result. Tests pass. Validators are not yet wired into any resolver.

---

### U8. New Strands tools (save_html_artifact + save_component_artifact)

**Goal:** Add two new Strands tools alongside existing `save_app`. Each tool: (a) calls a new GraphQL mutation; (b) catches validator errors and re-prompts the agent with a structured error message; (c) caps retries at N=2. Existing `save_app` tool is unchanged.

**Requirements:** R1, R3, R6, R7, R7a, R23, R26

**Dependencies:** U7 (validators exist), U6 (metadata schema accepts new kinds)

**Files:**
- Create: `packages/agentcore-strands/agent-container/container-sources/html_artifact_tool.py`
- Create: `packages/agentcore-strands/agent-container/container-sources/component_artifact_tool.py`
- Create: `packages/agentcore-strands/agent-container/test_html_artifact_tool.py`
- Create: `packages/agentcore-strands/agent-container/test_component_artifact_tool.py`
- Modify: `packages/agentcore-strands/agent-container/container-sources/server.py` — register new tools alongside `save_app`/`load_app`/`list_apps` (handlers in lines ~729, 1024–1034, 2091–2094, 2722–2725)
- Create: `packages/api/src/graphql/resolvers/apps/save-html-artifact.ts`
- Create: `packages/api/src/graphql/resolvers/apps/save-component-artifact.ts`
- Modify: `packages/database-pg/graphql/types/artifacts.graphql` — add `saveHtmlArtifact(input: SaveHtmlArtifactInput!)` and `saveComponentArtifact(input: SaveComponentArtifactInput!)` mutations + their input/payload types
- Modify: `apps/computer/src/lib/app-artifacts.ts` — type for the new payload-kind metadata
- Run: `pnpm schema:build` + codegen

**Approach:**
- `save_html_artifact(name, html, metadata)`: agent supplies the full HTML string; tool calls `saveHtmlArtifact` GraphQL mutation; resolver pipes through `validateHtmlPayload` → S3 write at `tenants/<t>/apps/<id>/payload.html` → upsert `artifacts` row with `metadata.kind = "html"`.
- `save_component_artifact(name, component_name, data, metadata)`: agent supplies the structured data; tool calls `saveComponentArtifact` GraphQL mutation; resolver pipes through `validateComponentPayload` → S3 write at `tenants/<t>/apps/<id>/payload.json` → upsert `artifacts` row with `metadata.kind = "component"`, `metadata.componentName = component_name`.
- On `ok: false` from validator, the tool returns the structured errors to the agent as a system message; agent retries up to 2 times; after exhaustion the tool returns `ok: false, errors: [...], retries_exhausted: true` and the user sees a "Regenerate with Computer" CTA in the artifact pane.
- Registry contents injected to agent prompt at session start (per `injected-built-in-tools-are-not-workspace-skills-2026-04-28.md` — registry is platform code, injected as runtime tool context).
- v1 vocabulary (from U4) injected into the agent prompt when `save_html_artifact` is on the tool surface.
- Inert at this stage: agents have access to the tools but no runbook has been wired to route to them yet (U9 does that).

**Patterns to follow:**
- `packages/agentcore-strands/agent-container/container-sources/applet_tool.py` (renamed to `app_tool.py` in U3) — Strands tool registration shape, GraphQL client usage.
- `packages/api/src/graphql/resolvers/apps/app.shared.ts` (renamed in U3) — resolver flow: caller-auth → validate → S3 write → DB upsert → return payload.

**Test scenarios:**
- Happy path (html): tool called with valid HTML → resolver validates → S3 receives `payload.html` → artifacts row inserted with `metadata.kind = "html"` → tool returns `ok: true, artifactId`.
- Happy path (component): tool called with `name: "map"` and valid data → resolver validates → S3 receives `payload.json` → row inserted with `metadata.kind = "component"`, `metadata.componentName = "map"`.
- Covers AE1, AE2 (round-trip). Error path (html): tool called with HTML containing `<script>` → validator rejects → tool returns structured errors → tool re-prompts agent (test mocks the retry interface).
- Covers AE3 (round-trip). Error path (component): tool called with `name: "interactive-globe"` → validator rejects → structured errors include "unknown component" and list of available names.
- Edge case: retry cap exhausted → tool returns `retries_exhausted: true` and the artifact is NOT persisted.
- Integration: the existing `save_app` tool still works post-this-PR; the three tools coexist without interfering.
- Integration: `pnpm --filter @thinkwork/api typecheck` clean; Python `uv run pytest test_html_artifact_tool.py test_component_artifact_tool.py` passes.

**Verification:**
- Three Strands tools (`save_app`, `save_html_artifact`, `save_component_artifact`) registered. New tools persist to DB + S3 successfully with valid inputs and reject invalid inputs with structured errors. Renderer dispatch (U14) not yet flipped, so artifacts created by new tools are saved but not yet viewable.

---

### U9. Runbook schema: preferred_artifact_kind field + agent tool-surface routing

**Goal:** Add `preferred_artifact_kind` field to the runbook YAML schema (`packages/runbooks/runbooks/*/runbook.yaml`). When a runbook loads, the agent's exposed tool surface narrows to the matching save tool (one of `save_app` / `save_html_artifact` / `save_component_artifact`). Runbooks without the field default to `"app"`.

**Requirements:** R23

**Dependencies:** U8

**Files:**
- Modify: `packages/runbooks/src/schema.ts` (or wherever the runbook YAML schema is enforced) — add `preferred_artifact_kind` optional field, default `"app"`
- Modify: `packages/runbooks/runbooks/crm-dashboard/runbook.yaml` — add `preferred_artifact_kind: "app"` (explicit, no behavior change)
- Modify: `packages/agentcore-strands/agent-container/container-sources/server.py` — at agent-session startup, read the active runbook's `preferred_artifact_kind` and narrow the tool surface accordingly
- Modify: `packages/api/src/lib/runbooks/` (or wherever runbook loading lives) — surface the field to the agent runtime
- Test: `packages/runbooks/src/__tests__/runbook-schema.test.ts`
- Test: `packages/agentcore-strands/agent-container/test_tool_surface_narrowing.py`

**Approach:**
- Schema field: `preferred_artifact_kind: "app" | "html" | "component"`. Optional. Default `"app"`.
- Tool surface narrowing: if `preferred_artifact_kind == "app"`, expose only `save_app`/`load_app`/`list_apps`. If `"html"`, expose only `save_html_artifact`/`load_app`/`list_apps`. If `"component"`, expose only `save_component_artifact`/`load_app`/`list_apps`. (Note: `load_app` + `list_apps` stay across all kinds — agents read from a unified artifact list regardless of kind.)
- This unit is the routing gate that makes the new tools meaningful in production.
- A runbook author chooses their kind once. No runtime override in v1 (per R26).

**Patterns to follow:**
- Existing runbook schema validation in `packages/runbooks/src/` (e.g., the recent `2026-05-12-001-refactor-computer-runbooks-as-agent-skills-plan.md` plan likely defines the schema entry point).

**Test scenarios:**
- Happy path: runbook with `preferred_artifact_kind: "html"` loads → agent's tool surface has `save_html_artifact` and not `save_app` or `save_component_artifact`.
- Happy path: runbook without the field loads → tool surface has `save_app`.
- Edge case: runbook with `preferred_artifact_kind: "invalid"` → schema validation rejects at runbook load time with a clear error.
- Edge case: `preferred_artifact_kind: "component"` on a runbook → tool surface has `save_component_artifact` plus the injected registry context (so the agent knows which `name` values are valid).
- Integration: CRM-dashboard runbook still produces an App artifact (no behavior change; backward-compat confirmation).

**Verification:**
- Tool surface narrowing works in agent harness tests. CRM runbook regression-tests pass unchanged.

---

### U10. HtmlArtifactIframe component (srcdoc render + form-action injection)

**Goal:** Author the React component that renders an HTML-kind artifact: fetches the payload from the artifact-deliver endpoint, injects the canonical stylesheet link + host-rewritten form actions, renders into a `<iframe srcdoc=... sandbox="allow-forms">`. No scripts run, no same-origin privileges, forms post to a host-controlled endpoint.

**Requirements:** R9, R10, R14

**Dependencies:** U4 (canonical stylesheet served), U7 (validator), U8 (save flow)

**Files:**
- Create: `apps/computer/src/components/artifact-renderers/HtmlArtifactIframe.tsx`
- Create: `apps/computer/src/components/artifact-renderers/HtmlArtifactIframe.test.tsx`
- Create: `apps/computer/src/lib/html-artifact-injection.ts` — pure function: HTML + form-state → injected HTML
- Create: `apps/computer/src/lib/__tests__/html-artifact-injection.test.ts`

**Approach:**
- Component fetches payload (HTML string) from `loadApp(appId)` (renamed from `loadApplet` in U3).
- Pre-injection step: parse HTML server-side OR client-side via DOMParser; insert `<link rel="stylesheet" href="/artifact-canonical.css">` into `<head>`; rewrite all `<form action=...>` → `action="/api/artifacts/{appId}/form-post"` with `method="POST"`; injected meta tag carries `artifactId` for the host endpoint to associate submissions.
- Form-state restore: at fetch time, host also fetches the last persisted form-state (`AppState` rows for this artifact); injection step seeds each `<input>`/`<textarea>` with its persisted value via `value="..."` or `defaultValue` attribute injection.
- Render in `<iframe srcdoc={injectedHtml} sandbox="allow-forms" />`. NOT `allow-scripts`. NOT `allow-same-origin`. NOT `allow-top-navigation`.
- Pass through artifact chrome from `AppArtifactSplitShell` / `GeneratedAppArtifactShell` — title, version, favorite, delete actions all live above the iframe, not in it.
- The cross-origin `sandbox.thinkwork.ai` infra is NOT used for HTML kind. It stays serving App kind only.

**Patterns to follow:**
- `apps/computer/src/components/ai-elements/web-preview.tsx` — known iframe-sandbox usage (negative reference; that one ALLOWS scripts/same-origin for cross-site previews — opposite of what we want here).
- `apps/computer/src/applets/iframe-controller.ts` (legacy) — for reference on what we are NOT doing (no postMessage protocol, no module loading, no RPC).

**Test scenarios:**
- Happy path: component mounted with valid HTML payload renders an `<iframe>` whose `srcdoc` attribute contains the original payload + injected stylesheet `<link>`.
- Happy path: iframe `sandbox` attribute exactly equals `"allow-forms"` (no other tokens).
- Happy path: form with `action="https://example.com/x"` in payload renders with `action="/api/artifacts/.../form-post"` in the iframe DOM (verified via JSDOM iframe inspection).
- Happy path: persisted form-state for fields `agenda1`, `agenda2` populates the iframe form inputs with those values.
- Edge case: HTML payload with no `<head>` tag → injection inserts a synthetic `<head>` with the stylesheet link.
- Error path: load-app fetch fails → component renders `<ArtifactErrorPane>` with "Regenerate with Computer" CTA (R15).
- Integration: `<script>` injection attempt in payload (which should never get past U7's validator, but defense-in-depth) — iframe sandbox blocks execution; verified via spy on `window.parent` and absence of console errors.

**Verification:**
- Component renders. Iframe `sandbox` attribute is exactly `allow-forms`. Form actions rewrite. Stylesheet injects. Form-state restores. Render failures show recoverable error pane.

---

### U11. HostComponentRenderer + full Map / Table / Chart component bodies

**Goal:** Author the React component that renders a component-kind artifact: looks up the component in the registry, mounts it in the host tree (no iframe), passes `data` + `state` + an `onStateChange` callback. Replace U5's stubs with full Map, Table, and Chart implementations.

**Requirements:** R6, R7, R7a, R11, R15, R16

**Dependencies:** U5 (registry + stubs), U7 (validator), U8 (save flow)

**Files:**
- Create: `apps/computer/src/components/artifact-renderers/HostComponentRenderer.tsx`
- Create: `apps/computer/src/components/artifact-renderers/HostComponentRenderer.test.tsx`
- Modify (un-stub): `apps/computer/src/components/artifact-components/MapArtifact.tsx`
- Modify (un-stub): `apps/computer/src/components/artifact-components/TableArtifact.tsx`
- Modify (un-stub): `apps/computer/src/components/artifact-components/ChartArtifact.tsx`
- Modify: `apps/computer/src/components/artifact-components/__tests__/*` (extend existing stub-level tests)
- Add: dependency on `react-leaflet` + `leaflet` (already in monorepo — but `leaflet` was vendored into the iframe-shell, not exposed to host code; verify the import works in host tree at U11 time)

**Approach:**
- `HostComponentRenderer` fetches the artifact metadata + data, looks up `metadata.componentName` in `ARTIFACT_COMPONENT_REGISTRY`, mounts `<Entry.component data={...} state={...} onStateChange={...} />`.
- Each concrete component:
  - **MapArtifact**: react-leaflet, OpenStreetMap or Mapbox tile layer, points from data, popups, zoom-fit-to-bounds. State: `{ zoom, center, bounds }` persisted on pan/zoom (debounced).
  - **TableArtifact**: shadcn DataTable, client-side sort + filter, columns + rows from data. State: `{ sortColumn, sortDir, filterText, pagination? }`.
  - **ChartArtifact**: recharts or a simpler SVG renderer, configured for line/bar/area by data shape. State: `{ hoveredSeries?, visibleSeries? }` for toggle interactions.
- Each component uses shadcn primitives from `packages/ui/src/components/ui/` for chrome (selects, buttons, badges). Tokens from `packages/ui/src/theme.css`.
- State changes flow through `onStateChange` → host hook → debounced persist to `appState` (R12).

**Patterns to follow:**
- `packages/ui/src/components/ui/data-table.tsx` — existing DataTable primitive.
- `packages/computer-stdlib/src/components/MapView.tsx` (legacy applet primitive) — visual / behavior reference for Map; do NOT import from it (computer-stdlib is the legacy iframe-injected library; host components are fresh).
- `docs/solutions/architecture-patterns/copilotkit-agui-computer-spike-verdict-2026-05-10.md` — `LastMileRiskCanvas` validated-props pattern.

**Test scenarios:**
- Happy path (renderer): metadata with `componentName: "map"` and valid data → registry lookup → MapArtifact mounts with data prop.
- Covers AE7. Error path (renderer): metadata with `componentName: "removed-component"` → renderer shows `<ArtifactErrorPane>` with "Regenerate with Computer" CTA; the rest of the app continues to function (other artifacts in the list still load).
- Happy path (Map): three points → MapArtifact renders three markers, zoom fits to bounds.
- Happy path (Table): 100 rows + 5 columns → renders header + virtualized body + sort indicators.
- Happy path (Chart): time-series data → renders a line chart with axes.
- Happy path (state persistence): user pans Map → `onStateChange({zoom, center})` fires → host hook receives the change (test verifies the callback is called, not the persistence itself which is U12).
- Edge case (empty data): Map with `points: []` → renders empty-state placeholder; does not throw.
- Integration: component artifact renders in the host React tree without spawning an iframe (DOM inspection: no `<iframe>` element).

**Verification:**
- All three components render with valid data. State changes fire callbacks. Unknown component names render the recoverable error pane.

---

### U12. Form-post host endpoint + state persistence for HTML and component kinds

**Goal:** Build the host endpoint that receives form submissions from HTML artifacts. Wire the host hook that components in U11 call via `onStateChange`. Both routes persist into the existing `appState` S3 layout (renamed in U2 from `appletState`).

**Requirements:** R10, R10a, R12

**Dependencies:** U10, U11

**Files:**
- Create: `packages/api/src/handlers/artifact-form-post.ts` — Lambda handler for HTML form submissions
- Modify: `packages/api/src/graphql/resolvers/apps/app.shared.ts` — extend `saveAppState` to accept HTML-form payloads and component-state payloads (same underlying storage layout)
- Modify: `terraform/modules/.../api/handlers.tf` — register the new Lambda handler
- Modify: `scripts/build-lambdas.sh` — add the new handler entry (memory: `lambda_zip_build_entry_required`)
- Create: `apps/computer/src/lib/use-host-component-state.ts` — React hook used by component artifacts via `onStateChange`
- Create: `packages/api/src/handlers/__tests__/artifact-form-post.test.ts`
- Create: `apps/computer/src/lib/__tests__/use-host-component-state.test.ts`

**Approach:**
- Form-post Lambda accepts `POST /api/artifacts/:appId/form-post` with `application/x-www-form-urlencoded` body. Auth via the existing app cookie / header. Persists each field as a row in the `appState` S3 layout keyed by `(appId, instanceId="form", stateKey=fieldName)`.
- HTML artifact restore: U10's injection step queries `appState(appId, instanceId="form")` at render time and seeds `value` attributes (R10a).
- Component state path: `use-host-component-state` hook calls `saveAppState({ appId, instanceId="state", stateKey="root", value: serializedState })` debounced at 500ms. On mount, hook reads the same state and restores to component.
- Reuse the existing `payload-storage.ts` S3 layout (already renamed `apps/` in U2); no new bucket, no new IAM.
- The form-post endpoint must use `RequestResponse` invocation pattern, not async (per memory `avoid_fire_and_forget_lambda_invokes` — surfaces error to user).

**Patterns to follow:**
- `packages/api/src/handlers/artifact-deliver.ts` — existing artifact Lambda handler shape, auth, error wrapping.
- `packages/api/src/lib/artifacts/payload-storage.ts` — `appStatePayloadKey` (post-U2) S3 layout.
- `apps/computer/src/lib/*` debounce + React Query / urql hook patterns.

**Test scenarios:**
- Covers F6 (round-trip), AE5 (HTML refresh + form-state). Happy path (form-post): POST with `agenda1=Discuss%20Q3&agenda2=Plan%20Q4` → 200 response → `appState` rows persisted with the two key-value pairs.
- Happy path (HTML restore): reopening the same artifact reads `appState` rows back and seeds the injected `value` attributes.
- Covers F7. Happy path (component state): component fires `onStateChange({ zoom: 8 })` → hook debounces → 500ms later `saveAppState` invoked once with serialized state.
- Edge case (deep links / new device): user opens artifact on a fresh device → host fetches `appState` → form populates / component restores transparently (R10a verification).
- Error path: form POST without auth → 401; no state persisted.
- Error path: component `onStateChange` throws → hook catches; UI continues to function; logged error surfaces in dev tools.
- Edge case (concurrent saves): rapid state changes → only the latest debounced save persists; intermediate states are dropped.
- Integration: U13's refresh chrome (next unit) confirms that AE5 (HTML refresh preserves form-state) holds end-to-end — refresh re-fetches HTML and re-applies the same persisted form-state.

**Verification:**
- Form-post endpoint round-trips. Component state debounces and persists. Reopen restores both kinds transparently.

---

### U13. Refresh chrome wiring for new kinds (host-side recorded recipes)

**Goal:** Wire `AppRefreshControl` into the production artifact route for HTML and component kinds. Add a host-side data-recipe storage path; `save_html_artifact` and `save_component_artifact` may attach a recipe at save time; Refresh re-invokes it. App kind is unchanged (keeps existing in-source `refresh()` export path).

**Requirements:** R13

**Dependencies:** U10, U11, U12

**Files:**
- Create: `packages/api/src/lib/apps/refresh-recipes.ts` — recipe storage (S3 path: `tenants/<t>/apps/<id>/refresh-recipe.json`)
- Create: `packages/api/src/lib/apps/__tests__/refresh-recipes.test.ts`
- Modify: `packages/api/src/graphql/resolvers/apps/save-html-artifact.ts` and `save-component-artifact.ts` — accept optional `refresh_recipe` input; persist alongside payload
- Modify: `packages/database-pg/graphql/types/artifacts.graphql` — add `refreshRecipe: AWSJSON` field on `App` type
- Modify: `apps/computer/src/components/apps/AppRefreshControl.tsx` — accept a `kind`-aware refresh handler; for HTML/component kinds, invoke the host-side recipe rather than the applet-exported function
- Modify: `apps/computer/src/routes/_authed/_shell/artifacts.$id.tsx` — mount `AppRefreshControl` in the chrome (currently it's not wired in production; see Context section)
- Modify: `apps/computer/src/components/computer/GeneratedArtifactCard.tsx` — same chrome in the inline embed path
- Create: `apps/computer/src/lib/refresh-recipe-runner.ts` — host-side recipe interpreter
- Test: `apps/computer/src/components/apps/__tests__/AppRefreshControl-new-kinds.test.tsx`
- Test: `apps/computer/src/lib/__tests__/refresh-recipe-runner.test.ts`

**Approach:**
- Refresh recipe schema: `{ dataSource: string, params: Record<string, JSONValue> }`. `dataSource` is a name in a small host-side fetcher registry (e.g., `"mcp.crm.opportunities"`, `"graphql.timeline.events"`). `params` is interpolated into the fetcher.
- Recipe storage: agent emits the recipe at save time as an optional argument to the save tool. Recipe sidecar JSON at `tenants/<t>/apps/<id>/refresh-recipe.json`.
- HTML refresh: AppRefreshControl invokes `refresh-recipe-runner.run(recipe)` → fetches new data → calls the agent to re-render the HTML against the new data (via a non-conversational re-render endpoint). The re-rendered HTML replaces the current `srcdoc`. Form-state preserved (re-fetched from `appState` on the new srcdoc injection).
- Component refresh: `refresh-recipe-runner.run(recipe)` → fetches new data → host swaps `data` prop on the mounted component. Component state preserved (still in `appState`, not re-fetched).
- App refresh stays unchanged — invokes the in-source `refresh()` function via the existing `host-applet-api.ts` path (post-rename, `host-app-api.ts`).
- AppRefreshControl currently exists but isn't mounted in production; this unit wires it.

**Patterns to follow:**
- `apps/computer/src/applets/host-applet-api.ts` (legacy) — for understanding the existing refresh-handler registration model (which the new kinds do NOT use).
- `apps/computer/src/components/apps/AppRefreshControl.tsx` — existing UI state machine (Refresh available / Refreshing / Refreshed / Partial / Failed).

**Test scenarios:**
- Covers AE5 (refresh + stylesheet retained). Happy path (HTML refresh): artifact has recipe `{ dataSource: "graphql.x", params: {} }` → user clicks Refresh → recipe runner fetches new data → host triggers a re-render → iframe `srcdoc` updates → form-state restores into new srcdoc → canonical stylesheet link still present in the re-rendered HTML.
- Covers AE6 (component refresh + state preserved). Happy path (component refresh): MapArtifact mounted with state `{ zoom: 8, center: [40, -73] }` → user clicks Refresh → recipe fetches new points → `data` prop updates → component state `{ zoom, center }` preserved across the re-render.
- Happy path (App): refresh on existing App artifact still invokes the in-source `refresh()` function unchanged.
- Edge case: artifact with no recipe → Refresh button is hidden or disabled.
- Error path: recipe runner fetcher fails → AppRefreshControl shows "Failed" state with a retry option; current data remains visible.
- Edge case: recipe `dataSource` unknown (e.g., agent emitted a typo) → fail at recipe-execution time with a clear error in the UI.
- Integration: AppRefreshControl renders in the production `artifacts.$id.tsx` route for all three kinds; the legacy "newer version available" banner does NOT interfere with the new refresh chrome (decide whether to keep both or retire the banner here).

**Verification:**
- Refresh chrome works end-to-end for HTML, component, and App kinds. State preservation behavior matches AE5 and AE6.

---

### U14. Renderer dispatch flips live (artifacts.$id.tsx + InlineAppEmbed)

**Goal:** Replace the unconditional `AppMount` (renamed from `AppletMount`) in the production artifact route with `ArtifactRendererDispatch`, branching on `metadata.kind`. App kind continues to route to `AppMount`; new kinds route to `HtmlArtifactIframe` or `HostComponentRenderer`. Same dispatch happens in `InlineAppEmbed` (chat-inline).

**Requirements:** R1, R2, R3, R15, R21

**Dependencies:** U10, U11, U12, U13

**Execution note:** Write the dispatcher test first (failing) to enforce the body-swap invariant per `inert-first-seam-swap-multi-pr-pattern-2026-05-08.md` — the dispatch call-count by kind is what locks the contract.

**Files:**
- Create: `apps/computer/src/components/artifact-renderers/ArtifactRendererDispatch.tsx`
- Create: `apps/computer/src/components/artifact-renderers/ArtifactRendererDispatch.test.tsx`
- Modify: `apps/computer/src/routes/_authed/_shell/artifacts.$id.tsx` — replace `AppMount` with `ArtifactRendererDispatch`
- Modify: `apps/computer/src/components/computer/GeneratedArtifactCard.tsx` — same dispatch in the chat-inline path
- Modify: `apps/computer/src/components/apps/InlineAppEmbed.tsx` (renamed in U3) — same dispatch
- Modify: any tests touching the artifacts route or InlineAppEmbed

**Approach:**
- `ArtifactRendererDispatch` reads `metadata.kind` from the loaded artifact, branches:
  - `"computer_app"` → `<AppMount appId={...} />` (existing behavior)
  - `"html"` → `<HtmlArtifactIframe appId={...} />`
  - `"component"` → `<HostComponentRenderer appId={...} />`
  - default / unknown → `<ArtifactErrorPane>` with "Regenerate with Computer" CTA (R15)
- The dispatcher mounts ONE renderer; never both. The chrome (`AppArtifactSplitShell` + `GeneratedAppArtifactShell` + new refresh chrome from U13) wraps whichever renderer was chosen.
- Default branch is App for safety: any unrecognized kind value or missing field renders as App-via-error-pane, not silently broken.
- Inline embed in chat thread uses the same dispatcher with a smaller-frame variant prop (e.g., `<ArtifactRendererDispatch variant="inline" />`).

**Patterns to follow:**
- `inert-first-seam-swap-multi-pr-pattern-2026-05-08.md` — body-swap forcing function: the dispatch call-count assertion in the test must be updated when this PR flips dispatch, making the change visible in code review.

**Test scenarios:**
- Covers F3 (round-trip via dispatch). Happy path: artifact with `metadata.kind = "html"` → dispatcher mounts HtmlArtifactIframe (single instance).
- Covers F4. Happy path: artifact with `metadata.kind = "component", componentName = "map"` → dispatcher mounts HostComponentRenderer (single instance).
- Happy path: artifact with `metadata.kind = "computer_app"` → dispatcher mounts AppMount (existing behavior).
- Covers AE7. Error path: artifact with `metadata.kind = "unknown_future_kind"` → dispatcher mounts ArtifactErrorPane; other artifacts in the list still load (verified by mounting two artifacts side-by-side, one valid one unknown).
- Edge case: artifact with missing `metadata.kind` field (legacy data) → defaults to AppMount.
- Integration: dispatcher works in both the full artifact route AND the chat-inline embed; visual/snapshot tests assert the right chrome wraps each.
- Integration: existing App-kind artifacts continue to render exactly as before this PR (regression test on `crm-pipeline-risk-app` fixture).

**Verification:**
- Dispatcher branches correctly for all three kinds + unknown + missing. Existing App artifacts unaffected. New kinds render through the appropriate renderer end-to-end. No iframe spawns for component kind. The legacy `apps/computer/src/applets/` and `apps/computer/src/iframe-shell/` substrate is still loaded for App kind only.

---

### U15. Documentation sweep (CLAUDE.md, AGENTS.md, docs site, workspace defaults, runbook authoring guide)

**Goal:** Update all live documentation to reflect the new three-kind artifact substrate and the post-rename naming. Workspace-defaults artifact-builder skill rewrites to enumerate the canonical CSS vocabulary and the host-component registry contract. Runbook authoring guide gains a "choosing your artifact kind" section.

**Requirements:** R23, R24, R26 (doc parity), R7a (registry surface known to authors)

**Dependencies:** U14 (the live substrate the docs describe)

**Files:**
- Modify: `CLAUDE.md` (project root) — substrate section reflects three kinds; rename complete
- Modify: `apps/computer/AGENTS.md` (if present) — same
- Modify: `packages/api/AGENTS.md` (if present) — save-artifact tool surface section
- Modify: `packages/workspace-defaults/files/skills/artifact-builder/SKILL.md` — fully rewritten for three-kind authoring
- Modify: `packages/workspace-defaults/files/skills/artifact-builder/references/*.md` — vocabulary reference + registry reference + CRM example (post-rename)
- Modify: `docs/src/content/docs/` (Astro Starlight site) — render the new substrate model
- Create: `packages/runbooks/runbooks/AUTHORING.md` (or update existing authoring guide) — "choosing your artifact kind" section
- Test: lightweight Starlight content lint (existing CI step)

**Approach:**
- Three audiences: (1) human contributors to the codebase (CLAUDE.md / AGENTS.md), (2) the agent (workspace-defaults skill catalog), (3) runbook authors (AUTHORING.md). Each gets the relevant slice of detail.
- Workspace artifact-builder skill enumerates: (a) when to pick which kind, (b) the canonical CSS class vocabulary for HTML kind, (c) the component registry data schemas for component kind, (d) the existing TSX contract for App kind.
- Runbook authoring guide includes a decision tree: "Is this a read-only display? → HTML. Is it a geographic/tabular/charted interactive view? → Component. Does it have novel interactivity not covered by registered components? → App."
- Historical brainstorms and plans in `docs/brainstorms/` and `docs/plans/` are NOT modified (scope boundary).

**Patterns to follow:**
- Existing CLAUDE.md / AGENTS.md hierarchy structure.
- Existing `docs/src/content/docs/` Starlight content shape.

**Test scenarios:**
- Test expectation: none -- documentation prose; CI link-lint and Starlight build are the relevant gates.

**Verification:**
- CI passes (link check, Starlight build). `rg "applet" CLAUDE.md AGENTS.md docs/src/ packages/workspace-defaults/` returns zero matches. Workspace artifact-builder skill enumerates all three kinds with concrete examples.

---

## System-Wide Impact

- **Interaction graph:** Renderer dispatch (`artifacts.$id.tsx`) is the single client-side branch point — every artifact-rendering surface (full route, chat-inline embed, future preview surfaces) routes through it. On the save side, `save_app` / `save_html_artifact` / `save_component_artifact` are the three entry points; each pipes through its own validator. Runbook load is the upstream switch that exposes the right save tool to the agent.
- **Error propagation:** Validators return discriminated-union errors → tools surface them as structured agent system messages → retry cap N=2 → if exhausted, persisted as `SaveAppPayload { ok: false, errors }` → user sees "Regenerate with Computer" CTA. Renderer-side failures (unknown component name, payload fetch failure) surface `<ArtifactErrorPane>` without breaking the artifact list.
- **State lifecycle risks:** Form-state and component-state both persist to the renamed `appState` S3 layout. Concurrent submissions on the same artifact + field could race; debounce + last-write-wins is the v1 model. Refresh chrome explicitly preserves state across data refreshes (AE5, AE6).
- **API surface parity:** GraphQL types change identifiers across the rename. AppSync subscription schema regenerates. CLI, admin, mobile, api all regenerate codegen in the same PR (U2). Strands tool surface gains two new tools without retiring any. Runbook schema gains one optional field.
- **Integration coverage:** The body-swap test in U14 is the load-bearing dispatch invariant. End-to-end refresh tests (U13) prove the host-recipe pattern for HTML and component kinds. Form-state persistence round-trip (U12) covers F6 + AE5.
- **Unchanged invariants:** App-kind artifacts behave identically pre- and post-this-plan. `sandbox.thinkwork.ai` Terraform infra, the iframe-shell + applets legacy directories, sucrase, the vendored React/shadcn/recharts/leaflet bundle, the host-applet RPC protocol, the App-kind in-source `refresh()` contract — all unchanged. CRM pipeline-risk runbook produces an App artifact at every stage of the rollout.

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Drizzle hand-rolled migration not applied to dev before deploy (memory `handrolled_migrations_apply_to_dev`) | Med | High | U1's `.sql` file ships with `-- creates:` markers; PR description includes the `psql -f` command; deploy-time drift reporter (`pnpm db:migrate-manual`) gates the deploy. |
| Codegen drift after GraphQL rename (consumer in admin/mobile/cli fails to regenerate) | Med | High | All four codegen targets ship in the same PR (U2); CI runs `pnpm -r typecheck` across the monorepo. |
| AppSync schema not regenerated after GraphQL source change | Low | Med | `pnpm schema:build` runs as part of U2; the regenerated `terraform/schema.graphql` ships in the same commit. |
| `aws lambda update-function-code` shortcut bypassing PR pipeline (memory `graphql_deploy_via_pr`) | Low | High | Codified in PR description checklist; reviewer-enforced. |
| S3 backfill leaves dev tenant in mixed-path state | Med | Med | Backfill script runs as part of U2's deploy step, not separately; `aws s3 ls` diff in PR description; old paths retained 30 days. |
| HTML validator misses an attack vector (e.g., obscure DOM clobbering) | Med | High | Parser-based DOM walk, not regex; CSP `frame-ancestors` self only; iframe sandbox eliminates `allow-scripts` and `allow-same-origin`; multi-layer defense. Add new test fixtures whenever a new attack class is reported. |
| Two-substrate carrying cost compounds (every new feature touches both App and HTML/component paths) | Med | Med | Plan explicitly accepts this as a hedge cost. Track via `metadata.kind` histogram; revisit retirement of App when HTML+component cover ≥ 90% of new artifacts for two consecutive months. |
| Form-action injection breaks an agent-emitted form that POSTs to its own anchor | Low | Med | Validator rejects agent-emitted `action` attribute; agent prompt explicitly documents that forms have no action; explicit AE in U7 tests. |
| User-confirmation flow proves needed sooner than v1.x | Low | Med | v1 requires runbook-time commit; if a use case surfaces, escalate to a follow-up brainstorm before forcing it in. |
| `apps/computer/src/applets/` legacy directory references slip into new code | Med | Low | New code lands in `artifact-components/` and `artifact-renderers/`; reviewer-enforced; consumer survey at U3 catches strays. |
| Map component's react-leaflet hits the same CDN issues the legacy applet did (`leaflet-cdn-compat.ts` exists for that reason) | Med | Med | Host-tree leaflet is loaded by Vite-bundled normal imports, not CDN — the original CDN-compat shim was an iframe-isolation workaround. Verify at U11 implementation time. |
| GraphQL `Applet*` consumers exist outside the monorepo (e.g., partner tools, third-party SDK) | Low | High | Consumer survey at U3 — if any external consumers found, escalate; hard-rename assumption breaks. |

---

## Phased Delivery

**Phase A — Rename arc (3 PRs)**
- U1 → U2 → U3 in sequence. Each PR independently mergeable. CI gates each. Drizzle migration runs against dev between U1 and U2.

**Phase B — Inert foundation (4 PRs, can partially parallelize)**
- U4 (CSS + vocabulary) — standalone.
- U5 (registry stubs) — depends on rename; no other dependencies.
- U6 (metadata kind extension) — depends on U5.
- U7 (validators) — depends on U4 + U5 + U6.

**Phase C — Agent tool surface (2 PRs)**
- U8 (new Strands tools).
- U9 (runbook schema + tool-surface narrowing).

**Phase D — Renderers + dispatch live (5 PRs)**
- U10 → U11 → U12 → U13 → U14 in sequence (each builds on the previous).

**Phase E — Docs sweep (1 PR)**
- U15 lands after U14.

**Total: ~15 PRs over an estimated 2–3 weeks at the current shipping cadence. Each PR independently revertible. The cutover boundary is U14; any rollback after U14 reverts dispatch and the new kinds become saved-but-unreachable until the revert is fixed.**

---

## Documentation Plan

- `CLAUDE.md` substrate section: replace single-kind description with three-kind dispatch model. Sized to a few paragraphs.
- `apps/computer/AGENTS.md` + `packages/api/AGENTS.md`: per-package tool/dispatch notes.
- `packages/workspace-defaults/files/skills/artifact-builder/SKILL.md` + `references/`: full agent-facing rewrite. Vocabulary doc from U4 included by reference.
- `docs/src/content/docs/` (Starlight): public-facing substrate explainer.
- `packages/runbooks/runbooks/AUTHORING.md`: kind-choice decision tree + examples.
- All updates land in U15 after dispatch is live.

---

## Operational / Rollout Notes

- **Drizzle migration cadence:** U1's hand-rolled SQL must be `psql -f`'d to dev before the deploy gate runs (memory `handrolled_migrations_apply_to_dev`). PR description includes the explicit command.
- **S3 backfill window:** U2 runs the backfill script as part of its deploy. Old `applets/` paths retained 30 days for emergency rollback.
- **Codegen sequence:** `pnpm schema:build` → `pnpm --filter @thinkwork/{cli,admin,mobile,api} codegen` runs in U2 and U8. Verify with `git diff --stat` in PR review.
- **Consumer survey before U3:** `rg "Applet|applet" --type ts --type tsx --type py apps/ packages/ terraform/ docs/src/` — every match reviewed; historical docs preserved.
- **Sandbox infra untouched:** `terraform/modules/.../computer_sandbox_site` (S3 + CloudFront + ACM + DNS + CSP frame-ancestors) is NOT modified. App kind continues to use it. New HTML kind uses `srcdoc` independently.
- **Refresh recipe registry boundary:** the host-side fetcher registry (U13) must be allowlisted at deploy time; agents cannot inject arbitrary fetcher names.
- **Feature flag:** none required. Renderer dispatch defaults to App for unknown kinds; the cutover at U14 is silent for App users (no behavior change).

---

## Alternative Approaches Considered

- **Hard cut: delete the TSX substrate, single new substrate.** Rejected per user direction — this plan is the hedge alternative. Retirement remains a future-call option.
- **Two payload kinds only (HTML + component); no App preservation.** Rejected for the same reason.
- **Defer the applet→app rename to a separate plan.** Rejected — the rename is already partially done in the codebase; finishing it in the same arc avoids two passes of codegen + GraphQL churn.
- **Workspace-skill-based component registry (registry as tenant-editable config).** Rejected per `docs/solutions/best-practices/injected-built-in-tools-are-not-workspace-skills-2026-04-28.md` — registry is platform code, not workspace data.
- **Repurpose `artifacts.type` enum (`APP_HTML`/`APP_COMPONENT`) instead of using `metadata.kind`.** Rejected — the `type` column is already type-of-artifact (NOTE vs APP vs REPORT); overloading it with payload-format confuses the model and forces a CHECK constraint refactor on every new kind. `metadata.kind` already exists for exactly this purpose.
- **Soft-deprecation of GraphQL `Applet*` types with `@deprecated` + 30-day grace.** Rejected — all consumers are monorepo-internal; hard rename + same-PR codegen is simpler than coordinating a deprecation window.

---

## Success Metrics

- 100% of `Applet`/`applet` identifiers gone from live code surfaces (post-U3 `rg` check).
- All three artifact kinds produce-able from agents (post-U8) and renderable in the artifact pane (post-U14).
- v1 component registry has Map / Table / Chart implementations rendering against valid fixtures (post-U11).
- AE1, AE2, AE3, AE4, AE5, AE6, AE7, AE8 all have passing test scenarios (U7 + U11 + U12 + U13 + U14).
- Existing CRM pipeline-risk App artifact renders identically pre- and post-rollout (regression assertion at every milestone).
- Refresh chrome works end-to-end for HTML and component kinds (post-U13).
- Two-substrate cost is measured: a `kind` histogram on the artifacts table, reviewed monthly. Convergence revisit when one substrate falls below 10% of new artifacts.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-12-computer-html-artifact-substrate-requirements.md](../brainstorms/2026-05-12-computer-html-artifact-substrate-requirements.md)
- Related institutional learnings:
  - `docs/solutions/architecture-patterns/recipe-catalog-llm-dsl-validator-feedback-loop-2026-05-01.md`
  - `docs/solutions/architecture-patterns/inert-first-seam-swap-multi-pr-pattern-2026-05-08.md`
  - `docs/solutions/architecture-patterns/ai-elements-iframe-canvas-foundation-decision-2026-05-10.md`
  - `docs/solutions/architecture-patterns/copilotkit-agui-computer-spike-verdict-2026-05-10.md`
  - `docs/solutions/workflow-issues/survey-before-applying-parent-plan-destructive-work-2026-04-24.md`
  - `docs/solutions/best-practices/injected-built-in-tools-are-not-workspace-skills-2026-04-28.md`
  - `docs/solutions/design-patterns/audit-existing-ui-and-data-model-before-parallel-build-2026-04-28.md`
  - `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`
- Related prior plans:
  - `docs/plans/2026-05-09-001-feat-computer-applets-reframe-plan.md` (most recent applet plan)
  - `docs/plans/2026-05-09-012-feat-computer-ai-elements-adoption-plan.md`
  - `docs/plans/2026-05-09-009-refactor-artifacts-datatable-plan.md`
  - `docs/plans/2026-05-12-001-refactor-computer-runbooks-as-agent-skills-plan.md` (same-day; defines runbook schema entry point this plan extends)
- Related PRs (prior art):
  - PR #1105 — `LastMileRiskCanvas` registered Canvas component with validated props
  - PRs #833 + #835 — cautionary tale on hand-rolled Drizzle migration drift
  - PR #1137 — sandbox cert isolation (Terraform infra untouched by this plan)
