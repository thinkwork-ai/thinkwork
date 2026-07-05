---
title: Rename Artifact Version Pin to Snapshot - Plan
type: refactor
date: 2026-07-05
topic: rename-artifact-pin-to-snapshot
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Rename Artifact Version Pin to Snapshot - Plan

## Goal Capsule

- **Objective:** Rename the Living Canvas version-pin concept to "Snapshot" across user-facing copy, the GraphQL API, and internal vocabulary, and swap its icon to Tabler `IconCameraSpark` — freeing the word "pin" for artifact nav pinning.
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

- R5. The `pinArtifact` GraphQL mutation is renamed `snapshotArtifact` (same signature and behavior), with the resolver file, resolver registration, client query documents, and generated codegen in all consumers (`apps/web`, `apps/mobile`, `apps/cli`, `packages/api`) regenerated.
- R6. Comments and doc strings describing the version chain (artifacts GraphQL types, `artifacts.ts` / `artifact-versions.ts` schema comments, `canvas-lifecycle.ts` including its check-in auto-pin language) say "snapshot" where they mean the version-capture concept.

**Vocabulary and scope hygiene**

- R7. CONCEPTS.md entries that define the concept ("Living Head / Pinned Version", "Check-out / Check-in") are updated to snapshot vocabulary in the same change that ships the rename.
- R8. Every other sense of "pin" is left untouched: artifact favorite pin (`PinToggleButton`, `favoritedAt`, sidebar "Pinned" section), thread pinning, and infra pinning (eval dataset/judge pins, plugin catalog version pins, skill force-pin, guardrail hash pins, release pinning).

### Acceptance Examples

- AE1. **Covers R1, R2.** Given a saved canvas artifact, when the user clicks the camera-spark header button, then a new read-only version is created and the toast says "Snapshot saved (v N)" — identical behavior to today's "Pin version", new words and icon only.
- AE2. **Covers R8.** Given any artifact detail page, when the user toggles the Tabler `IconPin` favorite button, then the label, toasts, and sidebar "Pinned" section behave exactly as before the rename.
- AE3. **Covers R5.** Given the merged rename, when `grep -ri "pinArtifact"` runs over `apps/` and `packages/` source (excluding generated files pending regeneration), then it returns no hits.

### Scope Boundaries

- No behavior change anywhere: same mutation semantics, same version chain, same S3 layout, same auto-snapshot-on-check-in behavior.
- Building "pin artifact to the nav menu" beyond what `favoritedAt` already does is out of scope — this rename only frees the vocabulary for it.
- Historical documents (`docs/plans/`, `docs/brainstorms/`, `docs/solutions/`) keep their original "pin" wording; they are point-in-time records.
- The word "snapshot" in other domains (eval flag snapshots, profile snapshots, compatibility snapshots) is unrelated and untouched; within the artifact/canvas domain "Snapshot" now means exactly the version-capture concept.
- Mobile has no version-capture surface today; its only obligation is regenerated codegen (R5).

### Dependencies / Assumptions

- `IconCameraSpark` is available in the installed `@tabler/icons-react` (verified present in v3.41.1; `apps/web` pins `^3.40.0`).
- The GraphQL API has no consumers outside this repo, so renaming the mutation without a deprecation window is safe.
