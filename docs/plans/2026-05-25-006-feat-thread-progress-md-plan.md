---
title: "feat: Thread PROGRESS.md state"
type: feat
status: completed
date: 2026-05-25
origin: docs/brainstorms/2026-05-19-spaces-customer-onboarding-v1-requirements.md
completed_by:
  - "PR #1719"
  - "PR #1722"
---

# feat: Thread PROGRESS.md state

## Problem Frame

Customer Onboarding threads are becoming durable case files, but the current state is split across chat history, thread metadata, linked checklist rows, and the Info Panel. Agents need a compact current-state document on every turn: goal, progress, open tasks, assignments, blockers, and next steps. Without that document, a new turn can answer from stale transcript context or generic memory instead of the workflow's actual current state.

The first implementation should use an S3-backed per-thread markdown file rather than a new database text column. S3 keeps the state inspectable, easy to overwrite atomically, and aligned with the "Folder is the Agent" / ICM file model without adding migration and codegen churn. The database remains the source of structured truth for checklist rows; `PROGRESS.md` is a rendered operational briefing.

## Scope

- Add a per-thread progress markdown file stored in S3.
- Inject the file into every agent turn for a thread when it exists.
- Generate and refresh the file for Customer Onboarding from existing ThinkWork state: thread metadata, linked tasks, task owners/roles, blockers, missing intake, and completion state.
- Keep the file out of Space Workspace source trees so it does not appear as another magic folder or editable Space document.
- Do not add a `threads.progress` column in this slice.
- Do not build a general end-user markdown editor for progress files.
- Do not add external DocuSign, D&B, credit, tax, P21, or LastMile integrations.

## Requirements Trace

- R1. Each workflow thread can have a durable `PROGRESS.md` with the current goal, progress summary, task state, assignments, blockers, next steps, and last updated timestamp.
- R2. For Customer Onboarding, `PROGRESS.md` is derived from canonical ThinkWork state, not handwritten free text.
- R3. The file is stored in S3 under a tenant/thread-scoped key that includes the thread UUID and is not part of the Space `source/` tree.
- R4. Agent wakeups for a thread load and inject the current `PROGRESS.md` into the turn prompt when present.
- R5. The deterministic Customer Onboarding workflow writes the initial progress file when the onboarding thread/checklist is created.
- R6. Customer Onboarding chat updates rewrite `PROGRESS.md` after intake facts or task statuses change.
- R7. `PROGRESS.md` is refreshed at the end of each relevant thread turn so the next agent turn sees the latest goal, status, task assignments, blockers, and next steps.
- R8. Status answers and Info Panel Progress remain based on structured state; `PROGRESS.md` is a turn-context briefing and audit artifact, not a second source of truth.
- R9. Tests prove the file is rendered, persisted to S3, refreshed after chat updates and agent turns, and injected into the agent wakeup prompt.

## Existing Patterns

- `docs/brainstorms/2026-05-19-spaces-customer-onboarding-v1-requirements.md` frames the Thread as the durable case file and Customer Onboarding as the first workflow proof.
- `packages/api/src/lib/spaces/customer-onboarding-workflow.ts` creates onboarding threads and native linked tasks.
- `packages/api/src/lib/spaces/customer-onboarding-chat-updates.ts` deterministically updates onboarding metadata and linked task statuses before default agent dispatch.
- `packages/api/src/lib/mentions/default-agent-routing.ts` and `packages/api/src/lib/mentions/dispatch-agent-mentions.ts` enqueue agent wakeups with thread ids.
- `packages/api/src/handlers/wakeup-processor.ts` already loads thread context before rendering the agent prompt; this is the natural injection point for thread progress markdown.
- `packages/api/src/handlers/seed-workspace-defaults.ts`, `packages/api/src/lib/requester-memory/storage.ts`, and S3 helper tests provide local patterns for tenant-scoped S3 reads/writes and missing-key handling.
- `apps/spaces/src/components/workbench/TaskThreadView.tsx` displays structured Progress in the Info Panel; this plan should not introduce a second visible progress side panel.

## Storage Decision

Use S3 for v1:

```text
tenants/<tenant-slug>/threads/<thread-id>/PROGRESS.md
```

Rationale:

- The file is thread-owned operational context, not Space source content.
- It can be overwritten whenever canonical state changes.
- It is easy to inject into prompt construction without adding GraphQL schema/codegen or database migration work.
- The path is tenant-scoped and thread-id-addressable, matching the user's desired "file name that matches the thread UUID" intent while avoiding Workspace tree magic.

The implementation should resolve `tenantSlug` from existing tenant data when writing/reading. If slug resolution is unavailable in a call path, the helper should fail softly and log, not block the user message or workflow.

## Markdown Shape

The rendered file should stay short and predictable:

```markdown
# PROGRESS

Thread: <title>
Goal: <goal>
Status: <summary>
Updated: <ISO timestamp>

## Progress

- Required complete: <done>/<total>
- Overall: <percent>%

## Tasks

| Task | Status | Owner | Required | Blocker/Notes |
| ---- | ------ | ----- | -------- | ------------- |

## Blockers

- <owner>: <blocked task> - <reason>

## Missing Information

- <field>

## Next Steps

1. <next action>
```

The exact copy can evolve in implementation, but the sections above are required so agents can reliably scan it.

## Implementation Units

### U1. Plan and Progress Storage Primitive

Add a small thread-progress module that computes the S3 key, reads a progress file, and writes markdown with safe content type/cache metadata. Keep this generic and workflow-agnostic.

Files:

- `docs/plans/2026-05-25-006-feat-thread-progress-md-plan.md`
- `packages/api/src/lib/thread-progress/storage.ts`
- `packages/api/src/lib/thread-progress/storage.test.ts`

Tests:

- Computes `tenants/<tenant-slug>/threads/<thread-id>/PROGRESS.md`.
- Missing file returns `null`, not an exception.
- Writes markdown as `text/markdown; charset=utf-8`.

### U2. Customer Onboarding Progress Renderer

Render Customer Onboarding `PROGRESS.md` from canonical state. Include the thread goal/title, checklist progress, task statuses, owners or role fallbacks, blockers, missing intake, and next steps.

Files:

- `packages/api/src/lib/spaces/customer-onboarding-progress-md.ts`
- `packages/api/src/lib/spaces/customer-onboarding-progress-md.test.ts`
- `packages/api/src/lib/spaces/customer-onboarding-workflow.ts`
- `packages/api/src/lib/spaces/customer-onboarding-chat-updates.ts`

Tests:

- Initial onboarding state renders required sections and incomplete tasks.
- Credit/tax applicability affects tasks and missing information.
- Blocked tasks appear under `## Blockers` with owner/role.
- Chat update paths call the progress writer after structured state changes.

### U3. Inject Thread Progress Into Agent Turns and Refresh After Turns

Load `PROGRESS.md` in `wakeup-processor` when a wakeup payload has `threadId`, then prepend or append a bounded `Current Thread PROGRESS.md` block to the agent turn prompt. Do not inject when no file exists. Keep the block clearly system-provided and read-only.

Refresh the file after each relevant turn completes:

- Human/chat turns that deterministically update Customer Onboarding state rewrite the file immediately after canonical DB updates.
- Agent turn finalization refreshes the file after the assistant response is persisted so the next turn has the latest transcript-adjacent state.
- Refresh failures are logged and non-fatal; canonical DB/message writes still win.

Files:

- `packages/api/src/handlers/wakeup-processor.ts`
- `packages/api/src/lib/chat-finalize/process-finalize.ts`
- `packages/api/src/handlers/wakeup-processor.test.ts` or the existing focused wakeup processor test file if one already covers prompt composition
- `packages/api/src/lib/thread-progress/storage.ts`

Tests:

- Wakeup with a thread id and existing progress markdown includes the markdown in the agent prompt.
- Wakeup without a progress file preserves current behavior.
- Oversized progress files are bounded or truncated before prompt injection.
- Customer Onboarding agent-turn finalization refreshes `PROGRESS.md` after the assistant message is saved.

### U4. Customer Onboarding Live Path Verification

Verify the Customer Onboarding path end to end after merge/deploy:

Files:

- `docs/plans/autopilot-status.md`

Checks:

- Focused API tests for storage, renderer, workflow, chat updates, and wakeup injection.
- `pnpm --filter @thinkwork/api typecheck`.
- Browser E2E on the live Customer Onboarding Space:
  - Start a fresh onboarding thread.
  - Confirm `PROGRESS.md` is written in S3 at the expected thread path.
  - Confirm Info Panel Progress still renders from linked tasks.
  - Send a task update in chat and confirm the S3 markdown refreshes.
  - Ask for status and confirm the response uses Progress semantics.
  - Confirm a subsequent agent turn receives the injected progress file.

## Risks and Mitigations

- Risk: S3 write failures could block chat.
  - Mitigation: Treat progress write failures as non-fatal after canonical DB updates succeed; log enough context to retry/debug.
- Risk: `PROGRESS.md` becomes a second truth source.
  - Mitigation: Render it from DB/metadata every time; do not parse it back into workflow state in this slice.
- Risk: Prompt bloat.
  - Mitigation: Keep the rendered markdown compact and truncate at injection time.
- Risk: Tenant slug lookup missing in hot paths.
  - Mitigation: Centralize slug resolution in the storage/write service and degrade gracefully.

## Dependencies

- Depends on the native Customer Onboarding checklist and chat-update hooks from `docs/plans/2026-05-25-004-feat-customer-onboarding-native-checklist-plan.md` and `docs/plans/2026-05-25-005-fix-customer-onboarding-progress-workflow-plan.md`.
- The live Start onboarding enum serialization hotfix should merge before final live E2E so fresh manual onboarding can be created cleanly.
