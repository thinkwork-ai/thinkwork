---
title: Rename Artifact Version Pin to Snapshot - Plan
type: refactor
date: 2026-07-05
topic: rename-artifact-pin-to-snapshot
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Rename Artifact Version Pin to Snapshot - Plan

## Goal Capsule

- **Objective:** Rename the Living Canvas version-capture concept to "Snapshot" across user-facing copy, the GraphQL API, and internal vocabulary, and swap its icon to Tabler `IconCameraSpark` — freeing the word "pin" for artifact nav pinning.
- **Product authority:** THINK-178 (Eric, direct request). Related shipped work: THINK-145 (Living Artifacts core), THINK-164 (Artifacts Wave 1).
- **Open blockers:** none.

## Product Contract

### Summary

Rename the artifact version-pin concept ("Pin version", `pinArtifact`, "pinned versions") to "Snapshot" everywhere it appears, and replace its icon with Tabler `IconCameraSpark`. The favorite-style artifact pin (`PinToggleButton` / sidebar "Pinned" section) and thread pinning keep the word "pin" — that nav-pinning sense is exactly what this rename frees the term for.

### Problem Frame

The Living Canvas feature (THINK-145 R11) lets a user capture the current canvas head as a content-addressed, write-once version. The shipped name for that action is "Pin version" (`pinArtifact` mutation, "pinned versions" history copy). But "pin" already carries a different, spatial meaning in the product — pinning an artifact so it stays visible in the nav sidebar (the `favoritedAt` toggle already renders a "Pinned" section there), and pinning threads in the chat sidebar. Two unrelated actions on the same artifact detail header can both present a pin icon meaning different things. The version-capture action is semantically a snapshot — its own empty-state copy already says "Pinning a version snapshots the current canvas" — so it is the one misusing the term.

### Key Decisions

- **The rename target is the version-capture concept, not the favorite pin.** The camera icon and the word "Snapshot" describe capturing state; they cannot describe favoriting. `PinToggleButton` (`favoritedAt`) and the sidebar "Pinned" section are the nav-pin concept the word is being reserved for and are untouched.
- **Rename all the way through the GraphQL API, not just UI copy.** The API is internal (web/mobile/CLI deploy with it), no external consumers exist, and a UI-only rename would leave `pinArtifact` as a permanent vocabulary trap for future agents and contributors. The repo's concept-vocabulary doctrine (CONCEPTS.md) expects code and product terms to match.
- **No database migration.** No column or table in the version chain is named after "pin" (`artifact_versions` columns are version-centric); only comments and copy carry the old term.

### Requirements

**User-facing copy and icon (apps/web)**

- R1. The canvas header version-capture button is labeled "Snapshot" (title, aria-label) and renders Tabler `IconCameraSpark` instead of the current lucide `Pin` icon.
- R2. All version-capture toasts and copy use snapshot language: success reads like "Snapshot saved (v N)", failure like "Couldn't save snapshot"; the version-history empty state and description say "snapshots" instead of "pinned versions" (e.g. "No snapshots yet. A snapshot captures the current canvas as a read-only version.").
- R3. The version-history surface (`CanvasVersionHistory`) refers to entries as snapshots; the read-only viewing behavior is unchanged.
- R4. Test ids tied to the concept (`canvas-pin`) are renamed to snapshot equivalents, with the tests that reference them updated in the same change.

**API and schema vocabulary**

- R5. The `pinArtifact` GraphQL mutation is renamed `snapshotArtifact` (same signature and behavior), with the resolver file, resolver registration, client query documents, and generated codegen in every consumer that has a codegen script (`apps/web`, `apps/mobile`, `apps/cli`) regenerated; `packages/api` has no codegen script — its resolvers are hand-typed against the GraphQL source, so its rename surface is the resolver/lib/test files themselves.
- R6. Comments and doc strings describing the version chain (artifacts GraphQL types, `artifacts.ts` / `artifact-versions.ts` schema comments, `canvas-lifecycle.ts` including its check-in auto-pin language) say "snapshot" where they mean the version-capture concept.

**Vocabulary and scope hygiene**

- R7. CONCEPTS.md entries that define the concept ("Living Head / Pinned Version", "Check-out / Check-in") are updated to snapshot vocabulary in the same change that ships the rename.
- R8. Every other sense of "pin" is left untouched: artifact favorite pin (`PinToggleButton`, `favoritedAt`, sidebar "Pinned" section), thread pinning, and infra pinning (eval dataset/judge pins, plugin catalog version pins, skill force-pin, guardrail hash pins, release pinning).

### Acceptance Examples

- AE1. **Covers R1, R2.** Given a saved canvas artifact, when the user clicks the camera-spark header button, then a new read-only version is created and the toast says "Snapshot saved (v N)" — identical behavior to today's "Pin version", new words and icon only.
- AE2. **Covers R8.** Given any artifact detail page, when the user toggles the Tabler `IconPin` favorite button, then the label, toasts, and sidebar "Pinned" section behave exactly as before the rename.
- AE3. **Covers R5.** Given the merged rename, when `grep -ri "pinArtifact"` runs over `apps/` and `packages/` source, then it returns no hits — including the regenerated codegen files, which ship in the same PR.

### Scope Boundaries

- No behavior change anywhere: same mutation semantics, same version chain, same S3 layout, same auto-snapshot-on-check-in behavior.
- Building "pin artifact to the nav menu" beyond what `favoritedAt` already does is out of scope — this rename only frees the vocabulary for it.
- Historical documents (`docs/plans/`, `docs/brainstorms/`, `docs/solutions/`) keep their original "pin" wording; they are point-in-time records.
- The word "snapshot" in other domains (eval flag snapshots, profile snapshots, compatibility snapshots) is unrelated and untouched; within the artifact/canvas domain "Snapshot" now means exactly the version-capture concept.
- Mobile has no version-capture surface today; its only obligation is regenerated codegen (R5).

### Deferred to Follow-Up Work

- **Document-domain "pin" vocabulary.** The dual-body document emission path reuses the same version-capture mechanism under document-flavored names and copy: `pinDocumentHead` in `packages/api/src/lib/artifacts/document-emission.ts`, the agent-visible "pinned version N" tool-result text in `packages/pi-extensions/src/document-composer.ts` (and its test), and the document-composer SKILL.md copy in `packages/workspace-defaults` (`files/skills/document-composer/SKILL.md` plus the byte-for-byte inline constant in `src/index.ts`, guarded by a parity test). None of these are named by R1–R8, and touching the SKILL.md pulls in the skill re-publish/re-trust pipeline and Pi-runtime copy. Defer to a small follow-up cleanup; it does not block freeing "pin" for nav pinning. (Mechanical exception: `document-emission.ts` imports `pinHeadToVersion`, so its import line updates when that helper is renamed in U1 — the deferral covers its own names and copy, not this import.)

### Dependencies / Assumptions

- `IconCameraSpark` is available in the installed `@tabler/icons-react` (verified present in v3.41.1; `apps/web` pins `^3.40.0`; re-verified at plan time in the installed store).
- The GraphQL API has no consumers outside this repo, so renaming the mutation without a deprecation window is safe. Verified at plan time: only `apps/web` has a client operation document using `pinArtifact` (`PinArtifactMutation` in `apps/web/src/lib/graphql-queries.ts`); mobile and CLI carry only generated schema types.

---

## Planning Contract

**Product Contract preservation:** changed: R5, AE3 — factual corrections only, no scope change. R5's original text listed `packages/api` among consumers with regenerated codegen; plan-time verification found it has no codegen script (hand-typed resolvers), so R5 now names the three consumers that do. AE3's "excluding generated files pending regeneration" hedge was replaced with the single-PR reality that regenerated codegen ships with the rename. Planning also added the "Deferred to Follow-Up Work" subsection (document-domain pin vocabulary discovered during research) and verified-at-plan-time notes under Dependencies.

### Key Technical Decisions

- **KTD1 — Single-PR atomic rename.** The GraphQL source rename, the three codegen consumers' regenerated output, the web UI copy/icon/testid changes, comment updates, and CONCEPTS.md ship in one PR. Splitting would create a window where generated types and the schema disagree across workspaces (codegen drift), for zero risk reduction — every change is mechanical and behavior-preserving.
- **KTD2 — Rename internal identifiers within the concept, not just the public surface.** The shared helper `pinHeadToVersion` (`packages/api/src/lib/artifacts/canvas-lifecycle.ts`) is the concept's internal name, used by both the mutation and the check-in rule; leaving it as "pin" would re-create the vocabulary trap one layer down. Rename it (suggested: `snapshotHeadToVersion`) along with the resolver file, local handler/variable names in the web component (`handlePin` → `handleSnapshot`, `pinning` → `snapshotting`), and server error strings ("pinArtifact artifactId is required" → snapshot wording, "retry the pin" → "retry the snapshot"). Exact final identifier names are the implementer's call; the boundary is: canvas-domain version-capture names change, everything in R8's keep-list and the deferred document-domain list does not.
- **KTD3 — GraphQL operation rename is client-visible but single-deploy safe.** Web is the only operation consumer; the merge pipeline deploys Lambda and web assets in the same run. The only exposure is a user holding a stale pre-deploy web bundle clicking Snapshot/Pin against the new Lambda (mutation not found until reload). Accepted: transient, niche action, self-heals on refresh. No deprecation alias (`pinArtifact` kept as a shim) — an alias would defeat the vocabulary cleanup and AE3's grep gate.
- **KTD4 — `terraform/schema.graphql` is regenerated but expected to be a no-op.** `pnpm schema:build` derives the AppSync subscription-only schema from the same GraphQL source; `pinArtifact` is not a notification mutation, so no diff is expected — running it is a cheap drift guard, and any unexpected diff gets committed with the PR.

### Affected-Surface Inventory (from plan-time grep)

Canvas-domain occurrences to rename (authoritative list for the implementer; regenerate rather than hand-edit anything under `gql/`):

| Area | Files |
|---|---|
| GraphQL source | `packages/database-pg/graphql/types/artifacts.graphql` (mutation + `saveCanvas` auto-pin comment) |
| API resolvers | `packages/api/src/graphql/resolvers/artifacts/pinArtifact.mutation.ts` (rename file + export + error strings), `index.ts` (registration), `saveCanvas.mutation.ts` (comments + helper import), `types.ts` (comments), `canvas-lifecycle.mutation.test.ts`, `checkout-roundtrip.test.ts`, `types.test.ts` (test names/comments) |
| API lib | `packages/api/src/lib/artifacts/canvas-lifecycle.ts` (`pinHeadToVersion` + comments + "retry the pin" error), `packages/api/src/lib/artifacts/document-emission.ts` (import of the renamed helper only — see Deferred) |
| DB schema comments | `packages/database-pg/src/schema/artifact-versions.ts` and `artifacts.ts` (comments only — `artifacts.ts` carries one "Pinning and check-in" comment on the `head_version` column) |
| Web | `apps/web/src/components/artifacts/canvas/CanvasHeaderActions.tsx` (icon, title/aria, testid `canvas-pin`, toasts, handler names), `CanvasVersionHistory.tsx` + `CanvasVersionHistory.test.tsx` (copy + assertions), `canvas-content.ts` (comment), `apps/web/src/lib/graphql-queries.ts` (`PinArtifactMutation` → `SnapshotArtifactMutation`, operation name, comments) |
| Codegen (regenerate) | `apps/web/src/gql/graphql.ts`, `apps/mobile/lib/gql/graphql.ts`, `apps/cli/src/gql/graphql.ts` (`packages/api` has no codegen script — its surface is the hand-typed resolver/lib/test files above) |
| Pi runtime comments | `packages/pi-runtime-core/src/canvas-provider.ts` (two comments describing the version chain — comment-only, no identifier or behavior change, no Pi image concern beyond the normal deploy) |
| Vocabulary | `CONCEPTS.md` ("Living Head / Pinned Version" → snapshot vocabulary, "Check-out / Check-in" entry) |

Explicitly untouched (R8 keep-list, confirmed present in the same grep): plugin catalog version pins (`packages/api/src/lib/plugins/*`, `plugins.graphql`, `plugins.ts` schema), workspace overlay/guardrail pinned versions (`workspace-bootstrap.ts`, `migrate-existing-agents-to-overlay.ts`, `packages/workspace-defaults`), skill pins (`SettingsSkillDetail.tsx`, `plugin-state.ts`), favorite pin (`PinToggleButton`, `FavoritesSection.tsx`), thread pinning.

---

## Implementation Units

### U1. Rename version-capture "Pin" to "Snapshot" end to end

**Goal:** One atomic PR that renames the canvas version-capture concept to Snapshot across GraphQL source, resolvers, regenerated codegen in all four consumers, web copy/icon/testids, version-chain comments, and CONCEPTS.md.

**Requirements:** R1–R8, AE1–AE3.

**Dependencies:** none.

**Files:** the full Affected-Surface Inventory above. Test files updated in the same change: `packages/api/src/graphql/resolvers/artifacts/canvas-lifecycle.mutation.test.ts`, `checkout-roundtrip.test.ts`, `types.test.ts`, `apps/web/src/components/artifacts/canvas/CanvasVersionHistory.test.tsx`.

**Approach:**

1. Rename the mutation in `artifacts.graphql` (`pinArtifact` → `snapshotArtifact`, comment now reads "Snapshot the current canvas head as a write-once, content-addressed version (R11)"); update the `saveCanvas` comment's auto-pin language to auto-snapshot.
2. API: rename `pinArtifact.mutation.ts` → `snapshotArtifact.mutation.ts` (export `snapshotArtifact`), update registration in `resolvers/artifacts/index.ts`, rename `pinHeadToVersion` → `snapshotHeadToVersion` in `canvas-lifecycle.ts` and both callers (`saveCanvas.mutation.ts`, the renamed resolver) plus the mechanical import in `document-emission.ts`; move error strings and comments to snapshot wording.
3. Web: in `graphql-queries.ts` rename the operation (`mutation SnapshotArtifact` / `SnapshotArtifactMutation`); in `CanvasHeaderActions.tsx` swap `import { Pin } from "lucide-react"` for `IconCameraSpark` from `@tabler/icons-react` (keep `RefreshCw` from lucide), retitle to "Snapshot", rename testid to `canvas-snapshot`, set toasts to "Snapshot saved (v N)" / "Couldn't save snapshot: …", rename local handler/state; update `CanvasVersionHistory.tsx` copy ("No snapshots yet. A snapshot captures the current canvas as a read-only version.") and its test assertions.
4. Regenerate codegen in the three consumers that have a codegen script (`pnpm --filter @thinkwork/<web|mobile|cli> codegen`) and run `pnpm schema:build` (expected no-op per KTD4). Per repo convention, prettier only the regenerated `graphql.ts` outputs.
5. Update `CONCEPTS.md`: retitle "Living Head / Pinned Version" to snapshot vocabulary and rewrite its body and the "Check-out / Check-in" entry so check-in re-saves append a snapshot.
6. Comment-only sweeps: `artifact-versions.ts`, `artifacts.ts` (the `head_version` "Pinning and check-in" comment), `types.ts`, `canvas-content.ts`, `canvas-provider.ts`.

**Patterns to follow:** existing mixed lucide/Tabler icon usage in `apps/web` (Tabler already used in `FavoritesSection.tsx` and settings surfaces); web codegen conventions memory (prettier only `graphql.ts`; don't hand-edit generated files).

**Test scenarios:**

- Covers AE1. `snapshotArtifact` resolver: given a saved GenUI canvas, calling the mutation appends a content-addressed version and returns the artifact with incremented `headVersion` (rename of the existing `pinArtifact` describe block; same behavior assertions).
- Error path: `snapshotArtifact` with missing `artifactId` and with a non-GenUI artifact throws the same error codes as before, with snapshot-worded messages.
- Check-in unchanged: re-saving a saved canvas still auto-appends a version via the renamed helper (existing `canvas-lifecycle.mutation.test.ts` AE3-mechanism test and `checkout-roundtrip.test.ts` scenarios pass under new names).
- Web `CanvasVersionHistory.test.tsx`: empty state asserts "No snapshots yet"; the read-only view-on-click test passes unchanged in behavior.
- Web header: the snapshot button renders with testid `canvas-snapshot`, title/aria "Snapshot" (extend or rename existing header test coverage if present; otherwise the version-history tests plus browser verification cover it).
- Grep gate (AE3): `grep -ri "pinArtifact" apps packages` (excluding `node_modules`) returns zero hits after codegen regeneration.

**Verification:** see Verification Contract — this unit is the whole plan, so the contract below is U1's completion bar.

**Checkpoint PR boundary:** exactly one PR to `main` containing all of U1. No child Linear issues — THINK-178 itself is the unit.

---

## Verification Contract

Verification runs in a real browser against **deployed dev** after the U1 PR merges and the `main` deploy pipeline completes. Local gates run before the PR.

**Pre-merge gates (implementer, local):**

1. `pnpm -r --if-present typecheck`, `pnpm --filter @thinkwork/api test`, `pnpm --filter @thinkwork/web test`, `pnpm format:check` — all green (full package suites, not just touched tests).
2. Grep gate: `grep -ri "pinArtifact" apps packages` → 0 hits; manual review of a broad `pin` grep against the R8 keep-list to confirm no over-rename.
3. Codegen freshness: re-running codegen in the three codegen consumers (web, mobile, cli) produces no diff.

**Post-deploy browser flows (verification phase, deployed dev web app):**

1. **Snapshot capture (AE1 — proves R1, R2, R5 end to end):** sign in to dev → open a space with a saved GenUI canvas artifact (create one via chat if none exists) → the canvas header shows a camera-spark icon button with title/aria "Snapshot" (no lucide pin) → click it → success toast "Snapshot saved (v N)" appears → the version history panel lists the new snapshot entry → clicking the entry opens the version read-only. This flow exercises the renamed mutation against the deployed Lambda, so it also proves the schema + codegen rename shipped coherently.
2. **Snapshot empty state (R2, R3):** open a freshly saved canvas with no versions → version history shows the "No snapshots yet…" snapshot-worded empty state.
3. **Favorite pin untouched (AE2 — proves R8):** on the same artifact's detail page, toggle the favorite `IconPin` button → label/behavior unchanged, artifact appears/disappears in the sidebar "Pinned" section exactly as before; spot-check a pinned thread in the chat sidebar still behaves normally.
4. **Check-in auto-snapshot unchanged (R6 behavior guard):** check out the saved canvas into a thread, edit via chat, re-save → a new version appears in history (behavior identical; only vocabulary changed).

**Evidence:** screenshots of all four flows (header button, toast, history list, empty state, sidebar Pinned section, post-check-in version history) recorded in the Linear Progress document.

---

## Rollout Notes

- No DB migration, no Terraform change, no env vars, no flags. Ships entirely via the normal merge-to-main deploy (`graphql-http` Lambda + web assets in one pipeline run).
- Transient stale-bundle window per KTD3: a pre-deploy web bundle calling `pinArtifact` post-deploy gets a GraphQL error until reload. No mitigation needed.
- Mobile/CLI: codegen-only changes; no release action required (no operation documents reference the mutation).
- Watch the post-merge Deploy run on `main` to completion before starting browser verification.

## Risks

- **Over-rename into a kept "pin" sense (R8).** Mitigation: the Affected-Surface Inventory is the allow-list; the keep-list is explicit; full-suite tests + the broad-grep review gate.
- **Missed occurrence leaves mixed vocabulary.** Mitigation: AE3 grep gate for the identifier; the inventory came from plan-time repo-wide greps of `pinArtifact`, `pin version`, `pinned version`, `canvas-pin`, and `auto-pin`.
- **Codegen drift across consumers.** Mitigation: single PR (KTD1) + codegen-freshness gate.

## Definition of Done

- U1 PR squash-merged to `main` with all checks green; post-merge Deploy run completed.
- All four post-deploy browser flows pass on deployed dev with evidence captured.
- CONCEPTS.md and the requirements' R1–R8 all satisfied; AE1–AE3 demonstrated.
- THINK-178 Progress document updated with plan/PR/merge/verification evidence.
