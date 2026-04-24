---
title: Drop thread.description end-to-end (U3e)
type: refactor
status: active
date: 2026-04-24
origin: docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md
---

# Drop thread.description end-to-end (U3e)

## Overview

Remove the `thread.description` field across the full stack — GraphQL schema, server resolvers, admin SPA, mobile app, CLI, react-native-sdk, Python skill catalog, and orchestration layer. The DB column `threads.description` stays; U5's destructive migration drops it later. No deprecation window — user has confirmed a short deploy-window downtime is acceptable.

This is a sibling slice to U3a (comment mutations, #531), U3b (comments UI + timeline, #533), U3c (sub-tasks, #535), and U3d (priority + type, #539). It ships on the same branch as U3d (`feat/thread-cleanup-u3d-priority-type`) rather than stacking a new PR against an unmerged one.

---

## Problem Frame

The "Add a description..." inline editor on the Thread detail page surfaces an affordance that no v1 user flow requires. Threads in the new chat/agent UX get their intent from the first message, the title, or the webhook/schedule payload that created them — not from an operator-authored description field. Keeping the field:

- Adds a second input box users must decide whether to fill
- Leaks into `PromptTemplateContext` and agent system prompts with inconsistent content
- Creates a phantom "did the operator update this?" activity event
- Requires translation/copy updates if we later rename threads to something else

Removing it simplifies the detail UI, cuts one mutation path, and aligns the schema with the chat-first product shape.

---

## Requirements Trace

- R1. `Thread.description` field is removed from the canonical GraphQL schema.
- R2. `CreateThreadInput.description` and `UpdateThreadInput.description` are removed.
- R3. No server resolver writes or reads `threads.description` post-merge.
- R4. Admin SPA no longer renders the "Add a description..." editor on Thread detail, nor the Dashboard's description block, nor the CreateThreadDialog description textarea.
- R5. Mobile app no longer renders thread description, and its createThread call no longer sends description.
- R6. CLI `thread create` / `thread update` drop the `--body` flag.
- R7. `react-native-sdk` drops description from `Thread`, `CreateThreadInput`, `UpdateThreadInput` types.
- R8. Python skill catalog (`agent-thread-management/scripts/threads.py`) no longer sends description in any mutation and no longer selects it in any query.
- R9. Orchestration — `wakeup-processor.ts` no longer reads `threads.description` into the agent prompt prelude or `PromptTemplateContext`. `prompt-template.ts` drops `description` from the context type.
- R10. Acceptance: `pnpm -r --if-present typecheck` passes in packages/api, thinkwork-cli, react-native-sdk; packages/api full test suite passes; admin + mobile tsc error counts do not regress against `origin/main` baseline (30 / 114 respectively).

---

## Scope Boundaries

- **Not dropping the DB column.** `threads.description` stays with its current default until U5's destructive migration. This mirrors the U3d pattern — new rows get `NULL`, existing rows keep their values (inert but intact).
- **Not touching `ThreadLabel.description`, `Agent.description`, `Message.description`, or any non-`Thread` description field.** This is specifically about `threads.description` (the operator-authored column on the threads table).
- **Not updating prompt templates in the DB.** Operator-authored workflow configs that reference `{{thread.description}}` will render the literal placeholder after this ships (same fallback behavior U3d left for `{{thread.priority}}`). Pre-deploy audit of prompt_template columns is a residual risk, not a plan requirement.
- **Not touching `searchable_text` / `search_vector` columns.** If they currently include description, they keep doing so from the retained DB column until U5.

### Deferred to Follow-Up Work

- Destructive DB migration dropping `threads.description` — U5 of the parent thread-cleanup plan (`docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md`).
- Pre-deploy audit of `prompt_template` rows referencing `{{thread.description}}` — ops task ahead of dev stage deploy.

---

## Context & Research

### Relevant Code and Patterns

- **U3d commit (HEAD~1 of the current branch)** — the exact shape we're replicating: GraphQL schema drop → resolver writes drop → admin UI drop → mobile drop → CLI flag drop → SDK types drop → Python skill-catalog drop → PromptTemplateContext drop → codegen regen → AppSync schema rebuild.
- `packages/database-pg/graphql/types/threads.graphql:32, 122, 139` — the three canonical GraphQL sites for description.
- `packages/api/src/graphql/resolvers/threads/{createThread,updateThread}.mutation.ts` — the resolver write paths.
- `packages/api/src/handlers/wakeup-processor.ts:896-901, 988-1000` — the two orchestration reads that feed description into agent prompts.
- `apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx:458, 555, 152` — the inline editor, the edit-dialog passthrough, and the activity-log entry.
- `apps/admin/src/components/threads/CreateThreadDialog.tsx` — zod schema, INITIAL_FORM default, form field JSX, mutation payload.
- `apps/admin/src/routes/_authed/_tenant/dashboard.tsx:357-360` — dashboard's description rendering for the selected thread.
- `apps/mobile/app/threads/index.tsx:141` — legacy mobile create modal.
- `apps/cli/src/commands/thread.ts` — `--body <text>` option on `create` and `update`.
- `packages/react-native-sdk/src/types.ts:105, 117` — SDK input types.
- `packages/skill-catalog/agent-thread-management/scripts/threads.py` — Python agent-side mutations.

### Institutional Learnings

- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` — invert the usual rule for field *removals*: resolver/GraphQL drop lands first, DB column drop follows (U5). This PR follows that ordering.
- U3d's autofix round (HEAD of branch) caught three classes of hidden consumers we missed in the initial sweep: (1) hidden resolver writers (`thread-helpers.ts`), (2) sibling GraphQL types with the same column selection (`LinkedThread`), (3) Python skill catalog scripts + Markdown reference docs. Apply the same aggressive sweep for description.

### External References

None — pattern is established by U3d.

---

## Key Technical Decisions

- **Bundle into U3d's PR #539** rather than stack a new PR. Rationale: U3d is unmerged and PRs-stacking-on-PRs violates the project's branch hygiene (`feedback_pr_target_main.md`). Adding another commit to the same branch is consistent with U3a/U3b/U3c sequencing done on a single branch would have been, except we've been splitting for reviewability — here "one shot" is explicit per the user.
- **PromptTemplateContext drop is included**, not deferred. Same rationale as U3d — once the field is gone from the source DB SELECT, the context type must follow or downstream code has a phantom `thread.description` field that always resolves `undefined`.
- **Leave DB column in place.** Same as U3d. U5 destructive migration is the single authoritative drop point.
- **Skill-catalog sweep is non-optional.** U3d's manual test caught skill-catalog drift via the ce-agent-native-reviewer. Run the same sweep proactively here: `grep -rn "description" packages/skill-catalog/` after editing threads.py.
- **No deprecation markers.** User confirmed "little downtime while it deploys is fine" — hard removal, same as U3d's priority/type drop.

---

## Open Questions

### Resolved During Planning

- **Are there backward-compat concerns for mobile TestFlight builds?** Yes, same as U3d. Old mobile clients will send `CreateThreadInput { description: "..." }` and the server will reject with "Field not defined". Accepted per user statement that downtime is fine. The mobile TestFlight build shipped with U3d's changes will also include this.
- **Does description feed agent prompts?** Yes, in two places: (1) `wakeup-processor.ts:896-901` builds a human-readable threadContext preamble and appends description to it; (2) `wakeup-processor.ts:988-1000` populates `PromptTemplateContext.thread.description` for template rendering. Both are removed. Prompt templates referencing `{{thread.description}}` will render the literal placeholder post-deploy (same fallback behavior U3d ships for priority).

### Deferred to Implementation

- Exact text of the commit message — follows conventional form `feat(api,admin,mobile,cli,sdk): drop thread.description end-to-end (U3e)`.
- Whether any test file needs updating beyond what `pnpm --filter @thinkwork/api test` surfaces.

---

## Implementation Units

- U1. **Server: drop description from GraphQL schema, resolvers, and orchestration**

**Goal:** Remove `Thread.description`, `CreateThreadInput.description`, `UpdateThreadInput.description` from the canonical GraphQL. Drop the write paths in `createThread` / `updateThread` mutations. Drop the orchestration reads in `wakeup-processor.ts` and the corresponding field in `PromptTemplateContext`.

**Requirements:** R1, R2, R3, R9.

**Dependencies:** None.

**Files:**
- Modify: `packages/database-pg/graphql/types/threads.graphql` (drop `description: String` at lines 32, 122, 139 — scoped to Thread, CreateThreadInput, UpdateThreadInput. Leave `ThreadAttachment.description` alone if present; leave all `ThreadLabel*Input.description` alone).
- Modify: `packages/api/src/graphql/resolvers/threads/createThread.mutation.ts` (drop `description: i.description` at line 64).
- Modify: `packages/api/src/graphql/resolvers/threads/updateThread.mutation.ts` (drop `if (i.description !== undefined) updates.description = i.description;` at line 14).
- Modify: `packages/api/src/handlers/wakeup-processor.ts` (drop `description: threads.description` at line 988; drop `description: threadRow.description || undefined` at line 1000; at lines 896-901, drop the description read + append from the `threadContext` preamble).
- Modify: `packages/api/src/lib/orchestration/prompt-template.ts` (drop `description?: string;` from `PromptTemplateContext.thread` at line 23).
- Modify: `packages/api/src/__tests__/orchestration-batch4.test.ts` if any test covers description fallback — update to use another field or drop the test.
- Test: `packages/api/src/__tests__/orchestration-batch4.test.ts` (existing file; verify + update).

**Approach:**
- GraphQL schema drop lands first in the same commit as resolver drops to avoid a runtime window where resolvers reference a missing input field.
- The wakeup-processor change has two separate sites — both need to land together.
- Run `pnpm schema:build` after the schema edit; confirm zero diff on `terraform/schema.graphql` (description was never in the subscription schema — same as priority/type).

**Patterns to follow:**
- U3d's server-side commit (HEAD~1). The edits here mirror its pattern in `createThread.mutation.ts`, `updateThread.mutation.ts`, and `wakeup-processor.ts`.

**Test scenarios:**
- Happy path: `createThread` with no `description` input succeeds; the returned thread has no `description` field in the response shape.
- Happy path: `updateThread` with only `status` updates succeeds; no SQL error referencing description.
- Error path: `createThread` mutation with `description` in the input errors with "Field not defined by type 'CreateThreadInput'".
- Integration: `packages/api/src/__tests__/orchestration-batch4.test.ts` still passes — no test asserts description-field rendering now.
- Integration: `thread(id)` query without selecting description succeeds; selecting description returns "Cannot query field" validation error.
- Integration: wakeup-processor builds a valid `PromptTemplateContext.thread` object with no `description` key; `renderPromptTemplate` with `{{thread.description}}` in a template renders the literal placeholder (unknown-placeholder fallback).

**Verification:**
- `pnpm --filter @thinkwork/api typecheck` passes.
- `pnpm --filter @thinkwork/api test` passes (1263+ tests).
- `pnpm schema:build` produces no `terraform/schema.graphql` diff.

---

- U2. **Admin SPA: drop description UI and form paths**

**Goal:** Remove the inline "Add a description..." editor on the Thread detail page. Drop the description form field from `CreateThreadDialog` and its edit-dialog passthrough. Drop the Dashboard's description block. Drop the "updated the description" activity log entry. Regenerate codegen.

**Requirements:** R4.

**Dependencies:** U1 (schema drops first so codegen regenerates cleanly).

**Files:**
- Modify: `apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx` (drop the inline `<Textarea>` description editor at ~line 458; drop `description: thread.description ?? ""` from ThreadFormDialog initial props at line 555; drop the activity-log clause at line 152 `if (details.description !== undefined) parts.push("updated the description");`).
- Modify: `apps/admin/src/components/threads/CreateThreadDialog.tsx` (drop `description: z.string()` from threadSchema at line 78; drop `description: ""` from INITIAL_FORM at line 92; drop the `<Textarea>` Description form field in the dialog body; drop `description: values.description.trim() || undefined` from the create and edit mutation payloads at lines 215 and 232).
- Modify: `apps/admin/src/routes/_authed/_tenant/dashboard.tsx` (drop the `{thread.description && …}` block at lines 357-360).
- Modify: `apps/admin/src/lib/graphql-queries.ts` (drop `description` from `ThreadDetailQuery`, `ThreadsListQuery` / `ThreadsPagedQuery` if present, `UpdateThreadMutation` if present, `CreateThreadMutation` if present).
- Regenerate: `apps/admin/src/gql/*.ts` via `pnpm --filter @thinkwork/admin codegen`.

**Approach:**
- Start with `graphql-queries.ts`; regenerate codegen; then fix the consumer TypeScript errors that codegen surfaces. This is the U3d pattern — codegen errors become the authoritative checklist for component-level cleanup.
- The Textarea on `$threadId.tsx:458` is an inline editor bound to an `updateThread` mutation; removing it eliminates the mutation call, so the Activity feed will no longer show a "updated the description" event naturally.

**Patterns to follow:**
- U3d's admin cleanup — same pattern of `graphql-queries.ts` first, then codegen, then consumers.

**Test scenarios:**
- Happy path: Thread detail page loads with no "Add a description..." affordance between title and Activity.
- Happy path: CreateThreadDialog renders without a Description textarea; submitting creates a thread successfully.
- Happy path: Dashboard renders selected-thread details with no Description block.
- Happy path: Editing a thread via the edit dialog persists successfully with no description field.
- Error path: No console errors referencing `thread.description` (undefined access / missing field).

**Verification:**
- `pnpm --filter @thinkwork/admin build` succeeds.
- `cd apps/admin && npx tsc --noEmit` reports 30 errors (unchanged from `origin/main` baseline).
- Manual smoke: load `/threads/<id>` in dev server — no description row/editor visible; open create dialog — no description textarea.

---

- U3. **Mobile app: drop description from render paths and createThread call**

**Goal:** Remove any rendering of `thread.description` on the mobile app. Drop `description` from the legacy create modal's mutation call. Drop `description` from mobile graphql-queries. Regenerate codegen.

**Requirements:** R5.

**Dependencies:** U1.

**Files:**
- Modify: `apps/mobile/lib/graphql-queries.ts` (drop `description` from `ThreadQuery`, `ThreadsQuery`, `CreateThreadMutation`, `UpdateThreadMutation`).
- Modify: `apps/mobile/app/threads/index.tsx` (drop `description: description.trim() || undefined` at line 141 and any local state for description input in the create modal).
- Modify: `apps/mobile/app/thread/[threadId]/info.tsx` (drop any description render row if present; confirm via `grep -n description`).
- Modify: `apps/mobile/app/threads/[id]/index.tsx` (drop any description render row if present).
- Regenerate: `apps/mobile/lib/gql/*.ts` via `pnpm --filter @thinkwork/mobile codegen`.

**Approach:**
- Same `graphql-queries.ts` → codegen → consumers pattern.
- The mobile legacy create modal has a description input state + passthrough; remove both the state and the input TextInput.

**Patterns to follow:**
- U3d's mobile cleanup.

**Test scenarios:**
- Happy path: mobile thread list renders without crashing.
- Happy path: mobile thread detail renders with no orphan description row between title and attachments.
- Happy path: mobile create modal lets users enter title + agent and create a thread with no description input.

**Verification:**
- `cd apps/mobile && npx tsc --noEmit` reports 114 errors (unchanged from `origin/main` baseline).

---

- U4. **CLI: drop `--body` flag on `thread create` and `thread update`**

**Goal:** Remove the `--body <text>` option, which was the description alias, from `thread create` and `thread update`. Update help text.

**Requirements:** R6.

**Dependencies:** U1.

**Files:**
- Modify: `apps/cli/src/commands/thread.ts` (drop `.option("--body <text>", "Description body (markdown)")` from `create` at ~line 72 and from `update` at ~line 102; scrub help-text examples that reference `--body`; update the top-level `thread create` description if it mentions description).
- Regenerate: `apps/cli/src/gql/graphql.ts` via `pnpm --filter thinkwork-cli codegen`.

**Approach:**
- All `thread` command action bodies are `notYetImplemented`, so this is a pure help-text + option-surface change.

**Patterns to follow:**
- U3d's CLI edits (parent description, example scrubs).

**Test scenarios:**
- Happy path: `thinkwork thread --help` shows no `--body` flag on create or update.
- Happy path: `thinkwork thread create --help` lists no description-related examples.
- Error path (commander-native): `thinkwork thread create --body "x"` exits with `error: unknown option '--body'`.

**Verification:**
- `pnpm --filter thinkwork-cli typecheck` passes.

---

- U5. **react-native-sdk: drop description from input types**

**Goal:** Remove `description?` from `CreateThreadInput` and `UpdateThreadInput` in the SDK. The SDK's `ThreadQuery`/`ThreadsQuery` in `queries.ts` do not select description today (verified in U3d survey), so nothing to change there. `Thread` interface in `types.ts` similarly — if it carries description, drop it.

**Requirements:** R7.

**Dependencies:** U1.

**Files:**
- Modify: `packages/react-native-sdk/src/types.ts` (drop `description?` from `CreateThreadInput` at line 105, `UpdateThreadInput` at line 117, and `Thread` interface if present — verify with `grep -n description packages/react-native-sdk/src/types.ts`).
- Modify: `packages/react-native-sdk/src/hooks/use-threads.ts` if its JSDoc mentions description (line 15 search comment references "title + description" — update to just "title").
- Modify: `packages/react-native-sdk/src/graphql/queries.ts` only if it selects description anywhere — verify via grep.

**Approach:**
- SDK is workspace-only (not yet published), so no npm cut required.

**Patterns to follow:**
- U3d autofix removed priority/type from this exact file; mirror.

**Test scenarios:**
- Test expectation: none — SDK has no tests; change is type-only.

**Verification:**
- `pnpm --filter @thinkwork/react-native-sdk build` succeeds.

---

- U6. **Python skill catalog: drop description from agent-thread-management mutations**

**Goal:** Remove `description` from `create_sub_thread`, `update_thread_status`, `promote_to_task` in the agent-thread-management skill's `threads.py`. Update `skill.yaml` tool description. Update `graphql-mutations.md` reference doc. Update `customer-onboarding/SKILL.md` example. Drop `description` from the `THREAD_FIELDS` query selection.

**Requirements:** R8.

**Dependencies:** U1.

**Files:**
- Modify: `packages/skill-catalog/agent-thread-management/scripts/threads.py`:
  - Drop `description` from `THREAD_FIELDS` constant.
  - Drop `description: str` param and `"description": description or None` from `create_sub_thread`'s `input_data`.
  - Drop `description: str = ""` param and `if description: input_data["description"] = description` from `update_thread_status`.
  - Drop `description: str = ""` param and `if description: input_data["description"] = description` from `promote_to_task`.
  - Update docstrings to remove description references.
- Modify: `packages/skill-catalog/agent-thread-management/skill.yaml` (drop "description" from the `update_thread_status` tool description string).
- Modify: `packages/skill-catalog/agent-thread-management/references/graphql-mutations.md` (drop `description` from create / update / get curl examples).
- Modify: `packages/skill-catalog/customer-onboarding/SKILL.md` (drop `description="..."` from the `promote_to_task` example block; drop any "with description" instruction copy).
- Audit: `grep -rn description packages/skill-catalog/` for any other mentions.

**Approach:**
- Agents currently consume this skill at runtime. Until this unit ships, they'll send `description: "..."` in createThread / updateThread inputs, which the server will reject post-U1. These must land in the same commit/PR as U1 — same rule as U3d.

**Patterns to follow:**
- U3d autofix's skill-catalog sweep.

**Test scenarios:**
- Test expectation: none — no Python unit tests exist for this skill; smoke is "agent creates a thread successfully in dev stage post-deploy".

**Verification:**
- `grep -rn "description" packages/skill-catalog/agent-thread-management/` returns zero hits (outside of label / agent descriptions that are out of scope).
- `grep -rn "description" packages/skill-catalog/customer-onboarding/SKILL.md` returns zero thread-description hits.

---

- U7. **Codegen + AppSync rebuild + full-suite verification**

**Goal:** After U1-U6 land, run the tooling checklist end-to-end and confirm no regressions.

**Requirements:** R10.

**Dependencies:** U1, U2, U3, U4, U5, U6.

**Files:** None (tooling only).

**Approach:**
- `pnpm schema:build` — confirm zero `terraform/schema.graphql` diff (description was never in subscription schema).
- `pnpm --filter @thinkwork/database-pg build`
- `pnpm --filter @thinkwork/admin codegen`
- `pnpm --filter @thinkwork/mobile codegen`
- `pnpm --filter thinkwork-cli codegen`
- `pnpm -r --if-present typecheck`
- `cd packages/api && npx vitest run` — all tests pass
- `cd apps/admin && npx tsc --noEmit` — 30 errors (baseline)
- `cd apps/mobile && npx tsc --noEmit` — 114 errors (baseline)
- `npx prettier --check "**/*.{ts,tsx,js,jsx,json,md,yml,yaml}"`

**Test scenarios:**
- Test expectation: none — this unit is the aggregate verification step.

**Verification:**
- Every command in the Approach block exits 0 (or with the stated pre-existing error count).

---

## System-Wide Impact

- **Interaction graph:** wakeup-processor reads threads.description for both the legacy threadContext preamble (line 896) and PromptTemplateContext population (line 988). Both go away together. No other orchestration hook references description.
- **Error propagation:** Mobile and admin clients built from an older commit will send `CreateThreadInput { description: "..." }` post-deploy and receive "Field not defined" from Yoga. Accepted by user as short-window downtime.
- **State lifecycle risks:** None. DB column is retained; existing rows keep their stored description. Reads via Drizzle (outside GraphQL) would still return the string — but nothing in the codebase does that outside wakeup-processor, which this plan drops.
- **API surface parity:** Same change applied to admin, mobile, CLI, SDK, skill-catalog — parity maintained.
- **Integration coverage:** Covered by U7's vitest run + admin/mobile tsc baseline comparison.
- **Unchanged invariants:** `ThreadLabel.description`, `Agent.description`, `Message.description` (if present), `SkillConfig.description`, etc. — all non-thread description fields remain.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Mobile TestFlight users on stale builds will fail to create threads during the deploy window. | Accepted per user ("little downtime fine"). Same class as U3d. |
| Prompt templates with `{{thread.description}}` render literal placeholders post-deploy. | Run `SELECT DISTINCT prompt_template FROM workflow_configs WHERE prompt_template LIKE '%thread.description%'` on dev before deploy; patch via admin if any hits. Residual risk, not a plan blocker. |
| Existing threads with populated descriptions become operator-invisible. | Data is preserved in DB column until U5. If a future reviewer needs to see pre-migration description content, they can query Drizzle directly. |
| Agent prompts that previously included description lose a chunk of context. | Agent wake-ups happen on new messages (chat carries intent) or scheduled triggers (payload carries intent). Description was rarely populated except by operators via the admin UI. |
| Hidden consumer discovered during autofix round (same surprise pattern as U3d). | ce-code-review autofix mode catches this — same pipeline handled U3d's skill-catalog / react-native-sdk misses. |

---

## Documentation / Operational Notes

- PR body on #539 should note that the branch now bundles U3d + U3e. Update the branch description to reflect the combined scope.
- U5 of the parent plan (`docs/plans/2026-04-24-002-...`) must add `threads.description` to its `-- drops-column: public.threads.description` markers.
- After dev-stage deploy, run a smoke test: create a new thread from the mobile app, confirm it succeeds; open an existing thread with a populated description, confirm the page loads (description silently invisible).

---

## Sources & References

- **Parent plan:** [docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md](../plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md)
- **Sibling slice (U3d, in-flight on same branch):** PR #539 (`feat/thread-cleanup-u3d-priority-type`)
- **Shipping-inert pattern institutional memory:** `feedback_ship_inert_pattern`
- **Thread domain drift incident:** `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`
