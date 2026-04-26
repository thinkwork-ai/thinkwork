---
title: "feat: Ship workspace orchestration dev rollout and HITL review controls"
type: feat
status: active
date: 2026-04-26
origin: docs/brainstorms/2026-04-25-s3-file-orchestration-primitive-requirements.md
---

# feat: Ship workspace orchestration dev rollout and HITL review controls

## Overview

Finish the next workspace orchestration slice after PR #605. The work has two parts:

1. Promote the S3 orchestration foundation to `main`, deploy it to dev with `enable_workspace_orchestration = true`, run the migration, enable one tenant, and smoke test a routed folder end to end.
2. Add the missing operator/HITL review path: humans need a clean admin surface and GraphQL mutations to respond to or cancel workspace review requests, and those decisions must resume or terminate the blocked workspace run through canonical events.

The key planning finding is that PR #605 intentionally shipped a foundation. It adds schema, event parsing/canonicalization helpers, routing validation, protected write guards, and `wake_workspace`, but it does not yet persist dispatcher candidates into `agent_workspace_events` or create workspace-event wakeup requests from S3 events. The smoke test requested here ("confirm a `work.requested` row lands") requires that persistence path before deployment can prove anything meaningful.

## Problem Frame

Workspace orchestration only becomes operational when three surfaces line up:

- **Infrastructure:** S3 EventBridge/SQS routing reaches `workspace-event-dispatcher`.
- **Canonical processing:** dispatcher candidates become database events, runs, audit mirrors, and wakeup requests.
- **Human review:** review files and blocked runs are exposed to operators, who can respond or cancel without raw S3 edits.

The feature should keep the "folder-native primitive, not workflow engine" boundary from the origin requirements. HITL review is not a separate workflow system; it is a specific run state (`awaiting_review`) resolved by a human-authored response file/event and a wakeup to the same workspace run.

## Requirements Trace

- Origin R1-R3: only explicit workspace prefixes are eventful; targets are folder-addressed through `AGENTS.md`.
- Origin R4-R7: agents express intent through files, but the platform writes canonical events and rejects malformed or unauthorized intents.
- Origin R8-R10: runs pause by writing files/events and resume through later file events; cross-tenant and unrelated peer-root writes remain rejected.
- Origin R12-R14: operators can inspect run/event history and answer "why did this agent wake up?"
- User rollout requirements: merge PR #605, deploy dev with `enable_workspace_orchestration = true`, migrate DB, enable one tenant, smoke test `wake_workspace`, confirm canonical row+wakeup, and confirm protected generic writes return `use orchestration writer`.
- User feature requirement: add operator/HITL review UI and mutations so review files are not only detected but can be accepted, cancelled, and used to resume work.

## Scope Boundaries

- Do not build a DAG/fan-in engine. Parent-managed `status.json` remains the v1 fan-out pattern.
- Do not add arbitrary eventful prefixes.
- Do not bypass `agent_wakeup_requests`; workspace event resumes route through the existing wakeup processor.
- Do not make generic `POST /api/workspaces/files` write protected orchestration paths.
- Do not hand-author production secrets or commit `terraform.tfvars`.
- Do not broaden the admin app into a full orchestration console; this slice adds review controls and enough run/event visibility to support them.

## Context & Research

### Relevant Code and Patterns

- PR #605 branch `codex/feat-s3-file-orchestration`:
  - `packages/api/src/handlers/workspace-event-dispatcher.ts` parses EventBridge/SQS records and returns `CanonicalWorkspaceEventDraft`, but currently does not persist events.
  - `packages/api/src/lib/workspace-events/canonicalize.ts` maps S3 keys to the small event vocabulary.
  - `packages/api/src/lib/workspace-events/write-api.ts` writes `work/inbox/*.md` and, for `waitForResult`, writes a parent blocked event before the child inbox write.
  - `packages/database-pg/src/schema/agent-workspace-events.ts` and `packages/database-pg/drizzle/0034_agent_workspace_events.sql` define runs, events, waits, and `tenants.workspace_orchestration_enabled`.
  - `packages/api/src/handlers/wakeup-processor.ts` already validates `source === "workspace_event"` requires `payload.workspaceRunId`.
  - `packages/api/workspace-files.ts` blocks direct generic PUTs to protected orchestration paths.
  - `packages/agentcore-strands/agent-container/container-sources/wake_workspace_tool.py` posts to `/api/workspaces/orchestration/write`.
- Existing HITL-ish admin pattern:
  - `packages/database-pg/graphql/types/inbox-items.graphql` defines statused inbox items and decision mutations.
  - `packages/api/src/graphql/resolvers/inbox/*.ts` update inbox item status and can enqueue an agent wakeup on approval/rejection.
  - `apps/admin/src/routes/_authed/_tenant/inbox/$inboxItemId.tsx` renders request details, payload, comments, and action buttons.
  - `apps/admin/src/components/inbox/InboxItemPayload.tsx` is the type-specific payload renderer extension point.
- Existing auth pattern:
  - `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md` requires row-derived `requireTenantAdmin(ctx, tenantId)` before admin-reachable side effects.
- Existing workspace-defaults learning:
  - `docs/solutions/workflow-issues/workspace-defaults-md-byte-parity-needs-ts-test-2026-04-25.md` applies if any default workspace file guidance changes. Run `pnpm --filter @thinkwork/workspace-defaults test`.

### External Research Decision

No new external research is needed for this slice. The risky AWS/EventBridge pieces were researched in the prior S3 orchestration plan, and this work is mainly internal GraphQL, S3, Drizzle, wakeup queue, and admin UI plumbing with strong local patterns.

## Key Decisions

- **Merge #605 first, then rebase this branch onto updated `main`.** This slice depends on the schema, protected paths, `wake_workspace`, and Terraform flag from #605. Do not duplicate foundation code.
- **Implement canonical processing before dev smoke.** The requested smoke test must observe an `agent_workspace_events` row and a wakeup. Add that processing path before deploying.
- **Use workspace-specific GraphQL for review decisions, while optionally linking to Inbox.** Existing `inbox_items` are useful for operator queues, but workspace review decisions need run-aware side effects: conditional S3 writes, canonical events, run status transitions, and `workspace_event` wakeups. Keep those in explicit workspace review mutations instead of overloading generic `approveInboxItem`.
- **Add one narrowly scoped review resolution event.** PR #605 can detect `review/*` as `review.requested`, but accepting a human answer needs a distinct canonical signal. Add `review.responded` for human response/resume and use existing `run.failed` with `reason = "review_cancelled"` for cancellation. Update schema/docs/tests with the expanded vocabulary.
- **ETag-conditional review responses.** The mutation should take an optional expected ETag from the UI and use S3 conditional write semantics where available. A conflict should return a clear GraphQL error and not wake the run.
- **Cancellation is a mutation, not raw S3 deletion.** Direct S3 deletion of `review/*` remains rejected/audited. `cancelWorkspaceReview` updates run status to `cancelled`, records a canonical event, and does not resume the run.
- **Admin UI starts in Inbox, not a new console.** Render workspace review payloads and action controls in the existing inbox detail flow, and add lightweight links from the agent workspace/orchestration docs. A full run timeline console is follow-up.

## Implementation Units

### U0. Merge foundation and prepare the dependent branch

**Goal:** Land PR #605 and make this branch build on the foundation.

**Files:** None expected, unless merge conflict resolution is needed.

**Approach:**
- Confirm PR #605 is open, non-draft, clean, and checks are green.
- Merge PR #605 into `main`.
- Fetch `origin/main`.
- Rebase `codex/workspace-orchestration-hitl-review` onto the updated `origin/main`.
- Keep the dirty main checkout untouched; work inside `.Codex/worktrees/workspace-orchestration-hitl-review`.

**Test scenarios:**
- `gh pr view 605 --json state,mergeStateStatus,statusCheckRollup` reports mergeable/green before merge.
- After rebase, `git status --short` in the feature worktree shows only intentional plan/code edits.

### U1. Persist workspace events and create wakeups

**Goal:** Turn dispatcher candidates into durable runs, canonical event rows, audit mirrors, and `workspace_event` wakeup requests.

**Requirements:** Origin R1-R7, R10-R14; user smoke row+wakeup checks.

**Dependencies:** U0.

**Files:**
- Modify: `packages/api/src/handlers/workspace-event-dispatcher.ts`
- Create: `packages/api/src/lib/workspace-events/processor.ts`
- Modify: `packages/api/src/lib/workspace-events/canonicalize.ts`
- Modify: `packages/api/src/graphql/utils.ts` if new schema exports need resolver access
- Modify: `packages/database-pg/src/schema/agent-workspace-events.ts`
- Modify: `packages/database-pg/drizzle/0034_agent_workspace_events.sql` or add follow-up migration if #605 is already merged with 0034
- Create/modify: `packages/api/src/__tests__/workspace-event-processor.test.ts`
- Modify: existing dispatcher/canonicalization tests under `packages/api/src/__tests__/`

**Approach:**
- Add a processing function that accepts bucket/key/sequencer/detail type plus the parsed/canonical draft.
- Resolve tenant and agent by slug from the S3 key; ignore or reject when missing.
- Respect `tenants.workspace_orchestration_enabled`; log and no-op when false.
- For `work.requested`, create an `agent_workspace_runs` row with status `pending`, target path, source/request object keys, and depth. Insert an `agent_workspace_events` row with unique idempotency, then enqueue `agentWakeupRequests` with `source = "workspace_event"` and payload containing `workspaceRunId`, `workspaceEventId`, `targetPath`, `sourceObjectKey`, and `causeType`.
- For duplicate idempotency, log the collision and do not enqueue a duplicate wakeup.
- For `review.requested`, update the run to `awaiting_review` when a run id is resolvable, and optionally create an inbox item of type `workspace_review` for operator discoverability.
- For direct review deletion, keep PR #605's `event.rejected` behavior and do not cancel the run.
- Write the S3 audit mirror best-effort after DB insert; set `mirror_status = "failed"` if mirror write fails.

**Patterns to follow:**
- `packages/api/src/handlers/wakeup-processor.ts` for `agentWakeupRequests` payload expectations.
- `docs/solutions/logic-errors/compile-continuation-dedupe-bucket-2026-04-20.md` guidance carried in the prior plan: log duplicate no-ops explicitly.

**Test scenarios:**
- Happy path: inbox S3 event inserts one run, one `work.requested` event, and one `agent_wakeup_requests` row with required `workspaceRunId`.
- Idempotency: replaying the same key+sequencer creates no second event or wakeup and logs the duplicate.
- Tenant disabled: event is ignored with no run/wakeup.
- Review request: `review/{runId}.needs-human.md` transitions the run to `awaiting_review` and records a canonical event.
- Delete event: deleting a review file records `event.rejected` reason `review_deleted_directly` and does not cancel/resume.

**Verification:**
- `pnpm --filter @thinkwork/api exec vitest run src/__tests__/workspace-event-processor.test.ts src/__tests__/workspace-event-dispatcher-event-pattern.test.ts src/__tests__/workspace-event-canonicalize.test.ts`
- `pnpm --filter @thinkwork/api typecheck`

### U2. Add workspace review GraphQL contract and mutations

**Goal:** Give operators run-aware review actions that write canonical state and wake or cancel the blocked run safely.

**Requirements:** Origin R8-R10, R12-R14; user accept/cancel/resume requirement.

**Dependencies:** U1.

**Files:**
- Modify: `packages/database-pg/graphql/types/agent-workspace-events.graphql`
- Create: `packages/api/src/graphql/resolvers/workspace-reviews/workspaceReviewRequests.query.ts`
- Create: `packages/api/src/graphql/resolvers/workspace-reviews/respondWorkspaceReview.mutation.ts`
- Create: `packages/api/src/graphql/resolvers/workspace-reviews/cancelWorkspaceReview.mutation.ts`
- Create: `packages/api/src/graphql/resolvers/workspace-reviews/index.ts`
- Modify: `packages/api/src/graphql/resolvers/index.ts`
- Create: `packages/api/src/lib/workspace-events/review-actions.ts`
- Create: `packages/api/src/__tests__/workspace-review-mutations.test.ts`

**Approach:**
- Add GraphQL types/inputs for `WorkspaceReviewRequest`, `WorkspaceReviewResponseInput`, and `WorkspaceReviewCancelInput`.
- Query pending review requests from `agent_workspace_runs` (`status = "awaiting_review"`) joined to recent `review.requested` events. Include run id, agent id, target path, review object key, source event id, current review markdown, ETag when available, status, and timestamps.
- `respondWorkspaceReview(runId, input)`:
  - Load the run row, derive tenant id from the row, and call `requireTenantAdmin(ctx, run.tenant_id)` before S3 or DB side effects.
  - Fetch the review object and enforce optional expected ETag.
  - Write the human response to a deterministic review response object or a response section in the existing review object. Prefer deterministic `review/{runId}.response.md` if it keeps the original request immutable enough for audit; document the exact path in tests.
  - Insert canonical event `review.responded` and transition the run back to `pending` or `processing` depending on wakeup timing.
  - Enqueue `agentWakeupRequests` with `source = "workspace_event"` and payload containing `workspaceRunId`, `workspaceEventId`, `causeType = "review.responded"`, and response object key.
- `cancelWorkspaceReview(runId, input)`:
  - Gate with row-derived `requireTenantAdmin`.
  - Transition run to `cancelled`, insert `run.failed` with `reason = "review_cancelled"`, and write an audit mirror.
  - Do not enqueue a runtime wake unless a later product decision wants cancellation callbacks.
- Make repeat decisions idempotent: responding to a run no longer awaiting review should return a clear conflict, not enqueue another wake.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/agents/acceptTemplateUpdate.mutation.ts` for row-derived agent/tenant authorization and S3 file handling.
- `packages/api/src/graphql/resolvers/inbox/approveInboxItem.mutation.ts` for decision-style mutations and activity recording, but do not reuse its generic wakeup payload.

**Test scenarios:**
- Happy path response writes the response object, records `review.responded`, updates run status, and enqueues one `workspace_event` wakeup.
- ETag conflict returns a GraphQL conflict/error and performs no DB/S3/wakeup writes.
- Cancellation records `run.failed` with `review_cancelled`, marks run `cancelled`, and enqueues no wakeup.
- Unauthorized tenant member cannot respond/cancel a review in another tenant.
- Already-completed or already-cancelled runs reject response/cancel transitions.

**Verification:**
- `pnpm --filter @thinkwork/api exec vitest run src/__tests__/workspace-review-mutations.test.ts`
- `pnpm --filter @thinkwork/api typecheck`

### U3. Add admin review UI for workspace review requests

**Goal:** Let operators see, answer, and cancel workspace review requests without editing protected S3 paths manually.

**Requirements:** Origin R13-R14; user HITL UI requirement.

**Dependencies:** U2.

**Files:**
- Modify: `apps/admin/src/lib/graphql-queries.ts`
- Modify: `apps/admin/src/components/inbox/InboxItemPayload.tsx`
- Modify: `apps/admin/src/routes/_authed/_tenant/inbox/$inboxItemId.tsx`
- Optionally create: `apps/admin/src/components/inbox/WorkspaceReviewActions.tsx`
- Optionally modify: `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.workspace.tsx`
- Create/modify tests under `apps/admin/src/components/inbox/__tests__/` or `apps/admin/src/lib/__tests__/`
- Generated: `apps/admin/src/gql/graphql.ts`, `apps/admin/src/gql/gql.ts`

**Approach:**
- Add queries/mutations for workspace review requests and actions.
- Render `workspace_review` inbox payloads with run id, agent/target, review object key, current review markdown, and status.
- Replace generic Approve/Reject buttons for `workspace_review` items with a response textarea and explicit actions: **Submit response** and **Cancel run**.
- After successful response/cancel, refresh the inbox detail query and show status change.
- Keep the UI quiet and operational. This is an admin tool surface, not a marketing page: compact metadata, clear review text, and obvious primary/secondary actions.
- If the agent Workspace tab is touched, add only a small pending-review link/count to the existing workspace layout; do not redesign the whole tab.

**Test scenarios:**
- `workspace_review` payload renders run metadata and markdown review text.
- Submit response calls `respondWorkspaceReview` with notes/ETag and refreshes on success.
- Cancel calls `cancelWorkspaceReview` and disables response actions afterward.
- Non-workspace inbox items keep existing Approve/Reject/Request revision behavior.

**Verification:**
- `pnpm --filter @thinkwork/admin codegen`
- `pnpm --filter @thinkwork/admin test`
- `pnpm --filter @thinkwork/admin typecheck` if a typecheck script exists; otherwise `pnpm --filter @thinkwork/admin build`

### U4. Update docs and operational runbook

**Goal:** Document the now-real dev rollout and review-response path.

**Requirements:** user documentation/leveraging requirement from previous turn plus this rollout.

**Dependencies:** U1-U3.

**Files:**
- Modify: `docs/src/content/docs/concepts/agents/workspace-orchestration.mdx`
- Modify: `docs/src/content/docs/applications/admin/agents.mdx`
- Optionally create: `docs/src/content/docs/guides/workspace-orchestration-operations.mdx`
- Modify: `docs/astro.config.mjs` if a new guide page is added

**Approach:**
- Add the operator review flow: how review files appear, how humans respond/cancel, what canonical events are written, and what wakes the agent.
- Add the exact smoke-test checklist from this plan: `wake_workspace`, `agent_workspace_events`, `agent_wakeup_requests`, protected write behavior.
- Keep configuration docs aligned with the two gates: Terraform flag and tenant DB flag.

**Test scenarios:**
- Docs build includes the updated/new pages.
- Links resolve in the Starlight generated route list.

**Verification:**
- `pnpm --filter @thinkwork/docs build`

### U5. Deploy to dev and run the workspace orchestration smoke test

**Goal:** Prove the feature works in an AWS dev stack with one tenant enabled.

**Requirements:** user rollout/smoke requirements.

**Dependencies:** U0-U4.

**Files:** No committed secrets. Temporary local changes to `terraform/examples/greenfield/terraform.tfvars` must not be committed.

**Approach:**
- Build deploy artifacts needed by the dev stack, including `workspace-event-dispatcher`.
- Set `enable_workspace_orchestration = true` for the dev stack using the repo's accepted config path.
- Deploy dev.
- Apply/verify DB migration `0034_agent_workspace_events.sql` and any follow-up migration added in this plan.
- Enable one tenant with `workspace_orchestration_enabled = true`.
- Add a route in `AGENTS.md` for a test specialist folder.
- Call `wake_workspace(...)` or the orchestration write endpoint to write `work/inbox/*.md`.
- Confirm:
  - one `work.requested` row lands in `agent_workspace_events`,
  - one `agent_workspace_runs` row exists,
  - one `agent_wakeup_requests` row exists with `source = "workspace_event"`,
  - the wakeup processor invokes the target agent,
  - generic `POST /api/workspaces/files` direct write to a protected path returns `use orchestration writer`.
- Create a review request fixture and confirm response/cancel mutations behave against dev S3/DB.

**Test scenarios:**
- Dev smoke SQL and CLI outputs are captured in the PR body summary, not committed with secrets.
- If deploy is blocked by missing credentials or stack drift, stop with the exact failed command and what was verified locally.

**Verification:**
- `thinkwork plan|deploy -s dev` or the repo-local equivalent from `apps/cli`
- Targeted SQL queries against dev Aurora
- API call to protected generic write path

### U6. Final quality gates and PR

**Goal:** Leave a reviewable PR with code, docs, tests, and smoke status.

**Dependencies:** U1-U5.

**Files:** PR description only, unless residual review findings require `docs/residual-review-findings/*`.

**Approach:**
- Run focused tests from U1-U4.
- Run broader checks if time/cost permits:
  - `pnpm --filter @thinkwork/api typecheck`
  - `pnpm --filter @thinkwork/database-pg typecheck`
  - `pnpm --filter @thinkwork/admin build`
  - `pnpm --filter @thinkwork/docs build`
- Use browser testing for the admin inbox review flow if the admin route changed.
- Capture deploy/smoke outcomes in the PR body.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| PR #605 merge changes commit SHAs and this branch was created from old `main`. | Merge #605 first, fetch, then rebase this branch onto updated `origin/main`. |
| Dispatcher creates duplicate wakeups on duplicate S3 events. | Unique tenant idempotency key plus explicit duplicate logging and tests. |
| Review response races with another operator. | ETag-conditional writes and conflict test. |
| Generic inbox mutations bypass workspace run state. | Workspace review actions use workspace-specific mutations; generic inbox decisions are not the source of run truth. |
| Cross-tenant admin mutation exposure. | Row-derived `requireTenantAdmin` before every S3/DB/wakeup side effect. |
| Dev deployment cannot run from this environment. | Complete local implementation and tests, then stop with exact deploy blocker rather than pretending the smoke passed. |

## Open Questions

- Which tenant slug should be enabled for the dev smoke test? If not supplied, implementation should discover a safe dev tenant from existing config or use the operator's current dev tenant.
- Should `review.responded` become part of the documented v1 event vocabulary, or should it remain an internal cause type while the canonical row uses an existing event type? This plan recommends making it explicit because it is operationally meaningful.
- Should workspace review requests also create `inbox_items` for notification/listing, or should the first slice render them only through workspace-review queries? This plan recommends creating/linking `inbox_items` only if it is low-risk after U1; direct workspace queries are enough for correctness.
