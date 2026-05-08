---
title: "Symphony PR-Producing Connector Work Harness"
status: active
created: 2026-05-08
origin: direct
---

# Symphony PR-Producing Connector Work Harness

## Problem Frame

The Linear-only Symphony checkpoint now proves unattended pickup and Computer-owned visibility, but the work stops too early. A Linear issue with the `symphony` label creates a connector execution, `connector_work` Computer task, delegation, and thread, then moves Linear to `In Progress`. The delegated work path still behaves like generic chat: it acknowledges the issue instead of performing repo-backed coding work.

The intended checkpoint is the old Symphony behavior from `../symphony/WORKFLOW.md`: claim a Linear coding issue, create a deterministic work branch, make the smallest repo change, push, open a draft PR, comment back on Linear, and move the card to `In Review` only after the PR exists.

## Scope

In scope:

- Route Linear `connector_work` tasks through a PR-producing harness instead of generic `invokeChatAgent` chat.
- Use a v0 deterministic repo edit path for safe checkpoint tasks, targeting a small Markdown file such as `README.md` or `CHANGELOG.md`.
- Create or reuse a deterministic branch and draft PR.
- Post old-Symphony-style Linear comments for dispatch and PR-opened transitions.
- Move Linear to `In Review` only after the draft PR is created or reused.
- Record branch, commit, PR URL, Linear comment/writeback results, connector execution id, Computer task id, delegation id, and thread id in lifecycle metadata.
- Preserve idempotency across duplicate polling and task retry.
- Surface branch/PR/writeback metadata in Symphony Runs without breaking single-line/no-horizontal-scroll table constraints.

Out of scope:

- Building a full autonomous code-editing agent loop inside the Computer runtime.
- Adding Slack, GitHub issues, or other connector types.
- Replacing the broader Computer runtime architecture.
- Shipping a general repo-credential UI. The v0 can read repo and credential settings from connector config, with safe defaults for the Symphony checkpoint.

## Existing Patterns

- `packages/api/src/lib/connectors/runtime.ts` creates `connector_work` Computer tasks, Computer-owned threads, and terminal connector execution outcome payloads.
- `packages/api/src/lib/computers/runtime-api.ts` currently delegates `connector_work` by looking up the Computer's `migrated_from_agent_id`, inserting `computer_delegations`, and calling `invokeChatAgent`.
- `packages/api/src/lib/connectors/linear.ts` already contains Linear fetch and state-move helpers; it should grow comment helpers rather than adding Linear GraphQL calls ad hoc elsewhere.
- `packages/lambda/github-workspace.ts` contains older GitHub branch/commit/PR utilities, but the deployed GraphQL/runtime path does not currently receive GitHub App env wiring. The v0 harness should use explicit connector/tenant credential config and plain GitHub REST calls so the checkpoint does not depend on parked Code Factory env vars.
- `apps/admin/src/lib/connector-admin.ts` and `apps/admin/src/routes/_authed/_tenant/symphony.tsx` already parse connector execution/delegation/thread-turn metadata for the Runs tab and enforce single-line table rows.

## Decisions

1. **Harness lives in the API `connector_work` delegation path.**
   The Computer runtime already claims and completes tasks by calling the API. Keeping repo credentials and Linear writeback in the API avoids pushing provider secrets into the ECS Computer runtime.

2. **V0 uses deterministic Markdown edits via GitHub API.**
   The first checkpoint needs proof of branch/commit/draft PR/writeback, not a complete agent editing loop. The harness should append or update a bounded checkpoint section in a configured Markdown file, enough to prove repo mutation safely.

3. **Connector config owns repo and writeback settings.**
   Support a `workflow` or `github` config block for owner/repo/base branch/file/credential. Defaults may target `thinkwork-ai/thinkwork`, `main`, `README.md`, and credential slug `github` for the internal Symphony checkpoint.

4. **Idempotency is branch and metadata based.**
   Use a deterministic branch derived from the `connector_work` task or connector execution id. Reuse an existing branch/PR and skip duplicate Linear comments if the same marker is already present.

5. **Thread turn visibility is represented as a system lifecycle turn.**
   Because the v0 harness performs deterministic server-side repo work instead of launching a chat turn, it should create a succeeded `thread_turns` system-event row and link it through `computer_delegations.result.threadTurnId`. This keeps the Runs lifecycle row complete while making the result metadata honest.

## Implementation Units

### U1. Linear Comment Helpers

Files:

- Modify `packages/api/src/lib/connectors/linear.ts`
- Modify `packages/api/src/lib/connectors/linear.test.ts`

Requirements:

- Add `postLinearIssueCommentOnce` or equivalent helper.
- Query recent comments for the issue and skip when a marker/body fragment already exists.
- Create a comment when missing.
- Keep `moveLinearIssueToState` behavior unchanged.

Test scenarios:

- Creates a comment when no existing comment contains the marker.
- Skips comment creation when a matching marker already exists.
- Surfaces Linear GraphQL errors consistently with existing helpers.

### U2. PR-Producing Harness

Files:

- Add `packages/api/src/lib/computers/symphony-pr-harness.ts`
- Modify `packages/api/src/lib/computers/runtime-api.ts`
- Modify `packages/api/src/lib/computers/runtime-api.test.ts`

Requirements:

- Detect Linear `connector_work` payloads from connector metadata.
- Load connector config and tenant credentials for Linear and GitHub.
- Resolve repo config with safe defaults.
- Create or reuse deterministic branch.
- Read configured Markdown file, append/update a bounded checkpoint section for the Linear issue, commit it to the branch, and create or reuse a draft PR.
- Post dispatch and PR-opened Linear comments matching the old Symphony templates from `../symphony/packages/linear-adapter/src/messages.ts`.
- Move Linear to `In Review` only after PR creation/reuse.
- Update `computer_delegations` to `completed` with branch, commit SHA, PR URL, Linear comment/writeback results, and `threadTurnId`.
- Update the connector execution `outcome_payload` with branch/PR/writeback metadata.
- Return idempotent results without repeating provider side effects.

Test scenarios:

- Happy path creates branch, commits file, opens draft PR, posts two Linear comments, moves to `In Review`, completes delegation, and records metadata.
- Retry path with existing completed delegation returns idempotently without provider calls.
- Retry path with existing branch/PR reuses them and does not duplicate Linear comments.
- GitHub credential missing fails the delegation with clear error metadata.

### U3. Runs UI PR Visibility

Files:

- Modify `apps/admin/src/lib/connector-admin.ts`
- Modify `apps/admin/src/routes/_authed/_tenant/symphony.tsx`
- Modify focused admin tests if present for connector admin helpers.

Requirements:

- Parse PR metadata from `delegation.result`, `delegation.outputArtifacts`, or connector execution `outcomePayload`.
- Add a compact PR/Branch affordance to the Runs table, preserving single-line rows and no horizontal scroll.
- Keep existing Writeback column behavior, and show `Linear: In Review` or PR-opened metadata when available.

Test scenarios:

- PR URL helper returns the PR URL from delegation result first, then outcome payload fallback.
- Runs row renders link text/icon without forcing horizontal scroll.

### U4. Operator Runbook Update

Files:

- Modify `docs/runbooks/computer-first-linear-connector-checkpoint.md`

Requirements:

- Document required connector config keys for repo/credential/writeback.
- Add checkpoint verification steps for branch, commit, draft PR, Linear comments, Linear `In Review`, and Symphony Runs PR link.
- Document idempotency expectations.

## Risks

- **GitHub credential availability:** If the internal tenant lacks a `github` credential with repo write permission, the code can land but the post-deploy checkpoint will fail until that credential is added.
- **API-side deterministic edit is not full autonomy:** This proves repo/PR/writeback plumbing but not arbitrary coding intelligence. A follow-up should replace the deterministic edit with a real Computer workspace coding loop.
- **Linear duplicate comments:** Comment helpers must use stable markers so retry paths remain quiet.

## Verification

- `pnpm --filter @thinkwork/api test -- src/lib/connectors/linear.test.ts src/lib/computers/runtime-api.test.ts`
- `pnpm --filter @thinkwork/admin test` if focused tests exist or are added.
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm --filter @thinkwork/admin typecheck`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm format:check`

Post-deploy checkpoint:

- Create a fresh Linear issue with only the `symphony` label asking for a tiny README or changelog edit.
- Let scheduled polling pick it up.
- Verify exactly one connector execution, one completed `connector_work` task, one completed delegation, one succeeded lifecycle thread turn, one Computer-owned thread, one branch, one draft PR, dispatch and PR-opened Linear comments, Linear state `In Review`, and a Symphony Runs row with PR link and writeback metadata.
