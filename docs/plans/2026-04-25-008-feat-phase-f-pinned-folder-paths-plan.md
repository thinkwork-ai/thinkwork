---
title: "feat: Phase F pinned folder paths"
type: feat
status: active
date: 2026-04-25
origin: docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md
---

# feat: Phase F pinned folder paths

## Overview

Ship Phase F of Plan 008: make pinned guardrail-class files addressable by full folder path, then surface template-update badges and accept-update actions for those pinned files inside nested Fat-folder sub-agent workspaces.

This is the narrow continuation after the Phase E agent-builder shell. Phase E does not need to finish drag-to-organize or destructive template swap before this work lands; `U24` only needs recursive overlay composition, and `U25` needs the builder shell route that landed in PR #596.

---

## Problem Frame

Pinned versions currently work well for root-level `GUARDRAILS.md`, `PLATFORM.md`, and `CAPABILITIES.md`. Fat-folder sub-agents introduce the same files at paths like `expenses/GUARDRAILS.md`, but several root-era assumptions remain: GraphQL pin status enumerates only `PINNED_FILES`, accept-template-update accepts only bare filenames, generated admin GraphQL types lack a folder path, and the Agent Builder keys update badges by `filename`.

Without Phase F, operators can see and edit nested pinned files through the builder, but they cannot reliably tell when a nested template file changed or accept that update at the specific sub-agent path. That breaks Plan 008 requirement R14 and makes nested guardrail inheritance harder to reason about.

---

## Requirements Trace

- R1. Pinned-version keys support folder-qualified paths such as `expenses/GUARDRAILS.md` while preserving existing root keys. (Plan 008 R14 / U24.)
- R2. Composer resolution for pinned-class files uses the requested folder path first, then ancestor/root pin keys during the compatibility window. (Plan 008 U24.)
- R3. Accept-template-update can advance a pin and remove an override for a nested pinned path, not only root filenames, without losing concurrent JSONB key updates. (Plan 008 U24/U25.)
- R4. `agentPinStatus` returns per-folder-path status so the Agent Builder can show `[template update available]` on nested files. (Plan 008 R14 / U25.)
- R5. The Agent Builder routes accept-update actions by full file path and refreshes the correct open file after accepting. (Plan 008 U25.)

**Origin actors:** A1 (template author), A2 (tenant operator), A4 (agent runtime), A5 (sub-agent).
**Origin flows:** F1 (template inheritance), F3 (sub-agent delegation).
**Origin acceptance examples:** AE3 (sub-agent override and pinned propagation), AE8 (builder tree visibility).

---

## Scope Boundaries

- No drag-to-organize behavior from Plan 008 `U19`.
- No destructive template swap or snapshot restore behavior from Plan 008 `U23`.
- No semantic change to the `agent_pinned_versions` column type; it remains JSONB.
- No removal of transition compatibility for existing flat root keys in this PR.
- No new local-skill authoring UI.

### Deferred to Follow-Up Work

- Cleanup PR after two deploy cycles to remove the explicit composer flat-key fallback and its telemetry.
- Broader template swap handling for nested pinned files, which belongs with Plan 008 `U23`.

---

## Context & Research

### Relevant Code and Patterns

- `packages/api/src/lib/workspace-overlay.ts` already classifies pinned files by basename at nested paths and currently reads `agentCtx.pinnedVersions[cleanPath]`.
- `packages/api/src/lib/pinned-versions.ts` initializes root pins, persists template versions, and reads template/defaults content by path.
- `packages/api/src/graphql/resolvers/agents/acceptTemplateUpdate.mutation.ts` advances a single pin and deletes the corresponding agent override, but its validation still expects bare `PINNED_FILES`.
- `packages/api/src/graphql/resolvers/agents/agentPinStatus.query.ts` enumerates only root `PINNED_FILES` and returns only `filename`.
- `packages/database-pg/graphql/types/agent-templates.graphql` defines `PinStatusFile` and `acceptTemplateUpdate`.
- `apps/admin/src/components/agent-builder/AgentBuilderShell.tsx` queries `agentPinStatus`, keys entries by filename, and opens `AcceptTemplateUpdateDialog`.
- `apps/admin/src/components/AcceptTemplateUpdateDialog.tsx` sends `filename` to the mutation and renders the diff.

### Institutional Learnings

- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` warns that hand-rolled SQL needs strict header markers and dev application discipline. This plan avoids adding a no-op SQL migration because the JSONB column shape does not change; semantic key-shape changes should be enforced by code and tests instead.
- `docs/residual-review-findings/phase-e-agent-builder-shell.md` notes that Phase E builder tests are thin. This plan keeps UI changes small and adds targeted coverage for the new path-keyed badge behavior rather than broadening the full builder test harness.

### External References

- External research skipped. This work follows established local GraphQL, S3 composer, and admin builder patterns; no new framework or third-party contract is introduced.

---

## Key Technical Decisions

- **Use full file path as the pin identity:** `filename` remains the GraphQL argument name for compatibility, but it may contain `expenses/GUARDRAILS.md`. Server validation checks basename membership in `PINNED_FILES` after path normalization, not exact bare filename membership.
- **No schema migration for JSONB semantics:** The database column already stores arbitrary string keys. Adding a hand-rolled SQL file that creates no object would add migration drift risk without improving runtime safety.
- **Enumerate status from composed workspace paths:** `agentPinStatus` should inspect the composed file list or equivalent union of workspace paths, then filter pinned-class basenames. That makes sub-agent template files visible without requiring a separate registry of folders.
- **Preserve root response shape while adding `folderPath`:** Add `path` and `folderPath` to `PinStatusFile`, but keep `filename` as basename-compatible output so older consumers remain readable during codegen transition.
- **Accept update at the exact path:** The mutation should persist the template version, update `agent_pinned_versions[path]`, delete the agent override at that same path, and invalidate composer cache for the agent.
- **Pin writes must be atomic per key:** Updating one nested pin must not overwrite another concurrent pin update. Use a row-lock transaction, `jsonb_set`, or compare-and-retry strategy rather than read-copy-write of the entire JSONB object.

---

## Open Questions

### Resolved During Planning

- **Does Phase E need to fully land first?** No. Phase F depends on recursive overlay and the builder shell, not on deferred drag-to-organize or template swap units.
- **Should this add `00XX_fat_folder_pinned_versions.sql` from the master plan?** No. The column shape does not change, and local migration learnings argue against no-op hand-rolled SQL. The semantic change belongs in code, tests, and generated GraphQL types.
- **Should accept-template-update rename `filename` to `path` immediately?** No. Keep `filename` for compatibility and add path-aware semantics. If a future API cleanup wants a clearer argument, that can be a breaking-schema cleanup.

### Deferred to Implementation

- **Exact enumeration helper for pin-status paths:** Implementation can either reuse `composeList` metadata or introduce a small S3/template path enumerator if using `composeList` creates circular resolver costs. The observable contract is the same: every composed pinned path gets a status row.
- **Generated code shape after GraphQL codegen:** Let codegen update the exact generated files; do not hand-maintain generated GraphQL artifacts beyond the repo's standard codegen output. Current generated client files live in `apps/cli`, `apps/admin`, and `apps/mobile`; if implementation finds a package-level API codegen script, include its outputs too.

---

## Implementation Units

- U1. **Path-aware pin helpers**

**Goal:** Centralize path normalization and pinned-class validation so composer, status, and accept-update use the same rules for root and nested paths.

**Requirements:** R1, R2, R3.

**Dependencies:** None.

**Files:**

- Modify: `packages/api/src/lib/pinned-versions.ts`
- Modify: `packages/api/src/lib/workspace-overlay.ts`
- Modify: `packages/api/workspace-files.ts`
- Modify: `packages/api/src/graphql/resolvers/agents/acceptTemplateUpdate.mutation.ts`
- Test: `packages/api/src/__tests__/pinned-versions.test.ts`
- Test: `packages/api/src/__tests__/workspace-overlay.test.ts`
- Test: `packages/api/src/__tests__/workspace-files-handler.test.ts`
- Test: `packages/api/src/__tests__/accept-template-update.test.ts`

**Approach:**

- Add helpers that normalize a workspace file path, reject traversal/empty segments, expose `basename`, `folderPath`, and `path`, and classify by pinned basename.
- Keep root paths exactly as today: `GUARDRAILS.md` remains `GUARDRAILS.md`.
- Update `isPinnedFile` / validation call sites to accept `expenses/GUARDRAILS.md` and reject `expenses/CONTEXT.md`, `memory/GUARDRAILS.md` only if existing path rules already reject that segment, path traversal, and absolute paths.
- Update `workspace-overlay.ts` to resolve pinned files by requested path first, then ancestor/root pin keys during the compatibility window, before falling through to live template/defaults.
- Update `workspace-files.ts` so `PUT expenses/GUARDRAILS.md` hits the same pinned-file write guard as root `GUARDRAILS.md`.
- Add temporary telemetry for any ancestor/root fallback pin used to resolve a non-root path; this is the evidence needed before the cleanup PR removes fallback behavior.

**Patterns to follow:**

- `packages/api/src/lib/workspace-overlay.ts` path-cleaning and basename classification.
- `packages/api/src/lib/reserved-folder-names.ts` for consistency with Fat-folder path semantics.

**Test scenarios:**

- Happy path: `GUARDRAILS.md` and `expenses/GUARDRAILS.md` both validate as pinned paths with stable `path` values.
- Edge case: `expenses/escalation/PLATFORM.md` returns folder path `expenses/escalation`.
- Error path: `../GUARDRAILS.md`, `/GUARDRAILS.md`, `expenses/CONTEXT.md`, and empty path are rejected before any S3 or DB write.
- Integration: existing root `acceptTemplateUpdate` tests still pass without changing caller behavior.
- Integration: composer resolves `expenses/GUARDRAILS.md` from its own path-qualified pin when present, and falls back to root `GUARDRAILS.md` pin only when no path-qualified pin exists.
- Integration: `PUT expenses/GUARDRAILS.md` returns 403 without `acceptTemplateUpdate` and succeeds with the reviewed accept flag.

**Verification:**

- All pin helper tests pass and no caller has a divergent pinned-path allowlist.

---

- U2. **Nested accept-template-update**

**Goal:** Advance pins and delete overrides for nested pinned paths using the same content-addressable version store semantics as root files.

**Requirements:** R1, R3.

**Dependencies:** U1.

**Files:**

- Modify: `packages/api/src/graphql/resolvers/agents/acceptTemplateUpdate.mutation.ts`
- Test: `packages/api/src/__tests__/accept-template-update.test.ts`

**Approach:**

- Treat the GraphQL `filename` argument as a workspace-relative path.
- Pass the normalized path through `readTemplateBaseWithFallback`, `persistTemplateVersion`, the `agent_pinned_versions` update, and the S3 delete key.
- Keep `acceptTemplateUpdateBulk` root-only and out of Phase F nested-path scope; it has no builder-selected nested-path consumer. Only touch it if shared helper refactoring creates a compile error, preserving its existing root-file contract.
- Apply the pin key update atomically so two accepts for different paths cannot overwrite each other's JSONB keys.
- Always attempt override deletion and cache invalidation even when the pin already equals the latest hash; this makes retry safe after a previous DB update succeeded but S3 delete failed.
- Invalidate the composer cache once per agent after pin advance, unchanged from current behavior.

**Patterns to follow:**

- Existing `applyPinAdvance` factoring in `acceptTemplateUpdate.mutation.ts`.
- Existing S3 delete and idempotency behavior in root accept-update tests.

**Test scenarios:**

- Happy path: accepting `expenses/GUARDRAILS.md` writes `agent_pinned_versions["expenses/GUARDRAILS.md"]`, persists `workspace-versions/expenses/GUARDRAILS.md@sha256:<hash>`, and deletes `workspace/expenses/GUARDRAILS.md`.
- Happy path: accepting an already-current nested pin still ensures the version store exists, attempts override deletion, and invalidates the composer cache.
- Edge case: concurrent accepts for `GUARDRAILS.md` and `expenses/GUARDRAILS.md` from the same starting pin object preserve both keys.
- Error path: accepting `expenses/CONTEXT.md` returns `BAD_USER_INPUT`.
- Regression: accepting root `GUARDRAILS.md` still updates the existing root key and deletes the root override.
- Regression: bulk accept-update remains root-only and still rejects unsupported nested path input if that path reaches the bulk resolver.

**Verification:**

- Nested accept-update behavior is covered at resolver-helper level and root behavior remains unchanged.

---

- U3. **Per-path pin-status GraphQL contract**

**Goal:** Return pin-status rows for every pinned-class file visible in the composed workspace tree, including sub-agent folders.

**Requirements:** R2, R4.

**Dependencies:** U1.

**Files:**

- Modify: `packages/api/src/graphql/resolvers/agents/agentPinStatus.query.ts`
- Modify: `packages/database-pg/graphql/types/agent-templates.graphql`
- Modify: `apps/cli/src/gql/graphql.ts`
- Modify: `apps/cli/src/gql/gql.ts`
- Modify: `apps/admin/src/gql/graphql.ts`
- Modify: `apps/admin/src/gql/gql.ts`
- Modify: `apps/mobile/lib/gql/graphql.ts`
- Modify: `apps/mobile/lib/gql/gql.ts`
- Test: `packages/api/src/__tests__/agent-pin-status.test.ts`

**Approach:**

- Add `path: String!` and `folderPath: String` to `PinStatusFile`; keep `filename` as the basename for compatibility.
- Enumerate candidate paths from composed workspace metadata or a shared path-union helper, then filter by pinned basename.
- For each path, compute latest template/defaults hash at that path, look up `pins[path]`, and read the matching version-store object.
- Split fallback semantics explicitly: no recorded pin returns latest content with `updateAvailable: false`; recorded pin with missing version object falls back to latest content only when the recorded hash equals the latest hash; recorded old hash with missing version object returns `pinnedContent: null` while preserving `updateAvailable: true`.
- Return stable sorted rows by `path` so the builder can key by full path.
- Run schema/codegen for every consumer with a codegen script after schema change: `apps/cli`, `apps/admin`, and `apps/mobile`; include `packages/api` only if implementation finds a codegen script in the current checkout.

**Patterns to follow:**

- Existing `agentPinStatus.query.ts` tenant isolation and version-store fallback.
- Existing codegen outputs in `apps/admin/src/gql/`.

**Test scenarios:**

- Happy path: root `GUARDRAILS.md` and `expenses/GUARDRAILS.md` both appear, with `filename: "GUARDRAILS.md"` and distinct `path` values.
- Happy path: nested path pinned at old hash and template current at new hash returns `updateAvailable: true` for only that nested path.
- Edge case: nested pinned file with no recorded pin returns latest content and `updateAvailable: false`, matching transition-period semantics.
- Edge case: nested pinned file with a recorded old hash but missing version-store content returns `pinnedContent: null`, latest content populated, and `updateAvailable: true`.
- Error path: cross-tenant agent lookup still returns `NOT_FOUND`.

**Verification:**

- GraphQL schema and generated types for CLI, admin, and mobile consumers include path-aware fields and existing pin-status query consumers compile. API-local generated outputs are included if the package exposes a codegen script in the current checkout.

---

- U4. **Builder badges and accept dialog by path**

**Goal:** Make the Agent Builder show and accept template updates for nested pinned files at the exact file path selected in the tree.

**Requirements:** R4, R5.

**Dependencies:** U2, U3.

**Files:**

- Modify: `apps/admin/src/components/agent-builder/AgentBuilderShell.tsx`
- Modify: `apps/admin/src/components/AcceptTemplateUpdateDialog.tsx`
- Modify: `apps/admin/src/components/agent-builder/InheritanceIndicator.tsx`
- Test: `apps/admin/src/components/agent-builder/__tests__/FolderTree.test.tsx`
- Test: `apps/admin/src/components/__tests__/AcceptTemplateUpdateDialog.test.tsx`

**Approach:**

- Query `path`, `folderPath`, and `filename` from `agentPinStatus`.
- Key `pinStatus` by `entry.path`; tree badge lookup uses the full file path.
- Pass the selected path into `AcceptTemplateUpdateDialog`; display basename plus folder context in the title so nested updates are understandable.
- After accept, refresh pin status and reload the open file when `openFileRef.current === acceptedPath`.
- Keep `InheritanceIndicator` API unchanged if possible; the shell should supply the path-keyed `updateAvailable` boolean.

**Patterns to follow:**

- Current `AgentBuilderShell` pin-status lookup and accept-dialog flow.
- Existing `WorkspaceFileBadge` update-available state.

**Test scenarios:**

- Happy path: `expenses/GUARDRAILS.md` with update status renders a template-update badge on that tree row.
- Happy path: clicking accept on `expenses/GUARDRAILS.md` calls the mutation with `filename: "expenses/GUARDRAILS.md"`.
- Edge case: root `GUARDRAILS.md` and nested `expenses/GUARDRAILS.md` both have independent status rows; opening one does not show the other's diff content.
- Regression: inherited non-pinned files do not show update-available badges.

**Verification:**

- Builder behavior is path-specific for nested pinned files, and root-file behavior remains unchanged.

---

## System-Wide Impact

- **Interaction graph:** Agent Builder tree rows consume `agentPinStatus`; accept dialog calls `acceptTemplateUpdate`; accept mutation updates `agent_pinned_versions`, persists version-store content, deletes an override, and invalidates composer cache.
- **Error propagation:** Bad paths fail as GraphQL `BAD_USER_INPUT`; missing template content fails as `NOT_FOUND`; cross-tenant reads preserve existing `NOT_FOUND` behavior.
- **State lifecycle risks:** Partial version-store / DB writes remain ordered so the version object is persisted before the pin moves. Override deletion happens after the DB update, matching existing root behavior.
- **API surface parity:** The GraphQL schema gains additive fields. Existing `filename` callers still work for root paths and now also accept nested path values.
- **Integration coverage:** Resolver tests cover DB/S3 ordering and generated admin types compile against the new schema.
- **Unchanged invariants:** The database column remains JSONB, root pin keys remain bare filenames, composer cache invalidation remains agent-scoped, and pinned-class file membership remains the three guardrail-class basenames from `@thinkwork/workspace-defaults`.

---

## Risks & Dependencies

| Risk                                                     | Mitigation                                                                                                                                               |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pin-status enumeration misses template-only nested files | Enumerate from the same composed workspace path universe the builder already displays, then filter by pinned basename.                                   |
| Root and nested `GUARDRAILS.md` collide in the admin map | Key all UI state by full `path`, not `filename`.                                                                                                         |
| No-op SQL migration creates manual drift noise           | Do not add SQL for a semantic JSONB key-shape change; rely on code and tests.                                                                            |
| Generated GraphQL files fall out of sync                 | Run repo codegen for CLI, admin, and mobile consumers touched by `PinStatusFile`; verify whether `packages/api` has a codegen script before skipping it. |
| Accept-update deletes the wrong override                 | Normalize once and use the same exact path for pin key, version-store path, and agent override S3 key.                                                   |
| Concurrent accept-update calls lose keys                 | Use an atomic JSONB key update or row-lock transaction and cover the two-path race in tests.                                                             |

---

## Documentation / Operational Notes

- No operator database migration is required.
- PR description should explicitly call out that `agent_pinned_versions` values remain JSONB and that nested keys are additive.
- If post-deploy logs show flat-key fallback for non-root paths, capture that as a cleanup blocker before removing compatibility behavior.

---

## Sources & References

- **Origin plan:** `docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md`
- **Phase E shell plan:** `docs/plans/2026-04-25-006-feat-phase-e-agent-builder-shell-plan.md`
- **Manual migration learning:** `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`
- **Phase E residual findings:** `docs/residual-review-findings/phase-e-agent-builder-shell.md`
