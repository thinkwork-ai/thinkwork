---
title: "Autopilot status ledger"
date: 2026-05-16
status: active
---

# Autopilot Status Ledger

## Current Run: ThinkWork Slack Workspace App

Plan: `docs/plans/2026-05-16-004-feat-thinkwork-computer-slack-workspace-app-plan.md`

Target branch: `main`

### Current Unit

- **U11 - Acceptance examples test coverage + observability**
- Branch: `codex/slack-workspace-u11-tests-metrics`
- Worktree: `.Codex/worktrees/slack-workspace-u11-tests-metrics`
- PR: pending
- Status: ready for PR

### Progress Log

| Date       | Unit | Branch                                    | PR                                                           | Status       | Verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | ---- | ----------------------------------------- | ------------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-16 | U1   | `codex/slack-workspace-u1-schema`         | [#1273](https://github.com/thinkwork-ai/thinkwork/pull/1273) | Merged       | `pnpm --filter @thinkwork/database-pg test`; `pnpm --filter @thinkwork/database-pg typecheck`; `bash scripts/db-migrate-manual.sh --dry-run packages/database-pg/drizzle/0094_slack_workspace_app.sql`; touched-file Prettier check; dev `psql -f packages/database-pg/drizzle/0094_slack_workspace_app.sql`; GitHub checks; post-merge Deploy run                                                                                                                                                                                                                                                                                                                                                                                                             | Added `slack_workspaces`, `slack_user_links`, and `slack_threads` schema plus migration tests. `db:generate` attempted but Drizzle stopped at an existing interactive schema-conflict prompt before writing files. Migration Drift Precheck initially failed because `0094` had not yet been applied to dev; applied it to dev and reran the failed check. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                           |
| 2026-05-16 | U2   | `codex/slack-workspace-u2-terraform`      | [#1275](https://github.com/thinkwork-ai/thinkwork/pull/1275) | Merged       | `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/lambda typecheck`; `pnpm -r --if-present typecheck`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/lambda test`; targeted Slack Lambda builds; `pnpm build:lambdas`; `terraform -chdir=terraform/examples/greenfield validate`; targeted no-refresh Terraform plan for Slack resources; touched-file Prettier check; `terraform fmt -check`; `bash -n scripts/build-lambdas.sh`; `git diff --check`; GitHub checks; post-merge Deploy run                                                                                                                                                                                                                                 | Added Slack app credentials secret, five Lambda registrations, five public API Gateway routes, build entries, inert handler stubs, and a handler README. Full greenfield plan is not clean locally because this shell lacks Cloudflare credentials and the ignored local tfvars do not mirror deployed custom-domain toggles; targeted Slack plan with `lambda_zips_dir` confirmed the new secret, Lambdas, route integrations, and routes are addressable. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                          |
| 2026-05-16 | U3   | `codex/slack-workspace-u3-signature`      | [#1277](https://github.com/thinkwork-ai/thinkwork/pull/1277) | Merged       | `pnpm --filter @thinkwork/api test -- src/handlers/slack/_shared.test.ts src/lib/slack/workspace-store.test.ts`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/api test`; `pnpm -r --if-present typecheck`; touched-file Prettier check; `git diff --check`; GitHub checks; post-merge Deploy run                                                                                                                                                                                                                                                                                                                                                                                                                                        | Added Slack v0 signature verification, replay-window enforcement, retry short-circuiting, workspace lookup dispatch wrapper, and Secrets Manager-backed Slack app/bot-token cache. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                                                                                                                                                                                                   |
| 2026-05-16 | U4   | `codex/slack-workspace-u4-oauth-admin`    | [#1279](https://github.com/thinkwork-ai/thinkwork/pull/1279) | Merged       | `pnpm --filter @thinkwork/api test -- src/lib/slack/oauth-state.test.ts src/handlers/slack/oauth-install.test.ts src/graphql/resolvers/slack/slack.resolvers.test.ts src/lib/slack/workspace-store.test.ts`; `pnpm --filter @thinkwork/api test`; `pnpm schema:build`; GraphQL codegen for CLI/mobile/admin; `pnpm --filter @thinkwork/api typecheck`; `pnpm -r --if-present typecheck`; `pnpm --filter @thinkwork/admin build`; `pnpm --filter @thinkwork/admin test`; `bash scripts/build-lambdas.sh slack-oauth-install`; `git diff --check`; touched-file Prettier check; Chrome visual check; GitHub checks; post-merge Deploy run                                                                                                                        | Implemented signed Slack OAuth install state, OAuth callback token storage/upsert, Slack workspace GraphQL query/mutations, and admin install/list/uninstall UI. Admin codegen initially failed on an existing remote-Symphony extension GraphQL document; excluded that sample from ThinkWork schema codegen because it targets a separate backend schema. Chrome visual check rendered the Slack page and install dialog; the page showed the expected deployed-schema GraphQL error until this PR reached deploy. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed. |
| 2026-05-16 | U5   | `codex/slack-workspace-u5-user-linking`   | [#1280](https://github.com/thinkwork-ai/thinkwork/pull/1280) | Merged       | `pnpm install`; `pnpm schema:build`; GraphQL codegen for CLI/mobile/admin; `pnpm --filter @thinkwork/api test -- src/lib/slack/user-link-store.test.ts src/graphql/resolvers/slack/slack.resolvers.test.ts`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/mobile test`; `pnpm -r --if-present typecheck`; `bash scripts/build-lambdas.sh oauth-authorize`; `bash scripts/build-lambdas.sh oauth-callback`; `git diff --check`; touched-file Prettier check; `terraform fmt -check terraform/modules/app/lambda-api/handlers.tf`; GitHub checks; post-merge Deploy run                                                                                                                              | Implemented Slack per-user OAuth linking through the existing mobile credentials flow, `slack_user_links` GraphQL query/unlink mutation, mobile Slack connect/unlink UI, and Slack app credential wiring for the generic OAuth handlers. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                                                                                                                                             |
| 2026-05-16 | U6   | `codex/slack-workspace-u6-events`         | [#1283](https://github.com/thinkwork-ai/thinkwork/pull/1283) | Merged       | `pnpm --filter @thinkwork/api test -- src/handlers/slack/events.test.ts src/handlers/slack/_shared.test.ts src/lib/slack/envelope.test.ts src/lib/computers/tasks.test.ts`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/lambda typecheck`; `pnpm -r --if-present typecheck`; `pnpm --filter @thinkwork/lambda test`; `bash scripts/build-lambdas.sh slack-events`; `bash scripts/build-lambdas.sh slack-dispatch`; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run                                                                                                                                                                                          | Implemented Slack Events API intake: signed URL verification, app mention / DM handling, Slack identity lookup, Computer task enqueue, placeholder posting, and event dedupe. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                                                                                                                                                                                                        |
| 2026-05-16 | U7   | `codex/slack-workspace-u7-slash-command`  | [#1285](https://github.com/thinkwork-ai/thinkwork/pull/1285) | Merged       | `pnpm --filter @thinkwork/api test -- src/handlers/slack/slash-command.test.ts src/handlers/slack/events.test.ts src/lib/slack/envelope.test.ts src/lib/computers/tasks.test.ts`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/api typecheck`; `pnpm -r --if-present typecheck`; `bash scripts/build-lambdas.sh slack-slash-command`; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run                                                                                                                                                                                                                                                                                                                  | Implemented `/thinkwork` slash command handler, response_url envelope wiring, shared linked-Computer routing, and ephemeral attribution blocks. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-05-16 | U8   | `codex/slack-workspace-u8-interactivity`  | [#1287](https://github.com/thinkwork-ai/thinkwork/pull/1287) | Merged       | `pnpm install`; `pnpm --filter @thinkwork/api test -- src/handlers/slack/interactivity.test.ts` (failed before implementation, passed after implementation); `pnpm --filter @thinkwork/api test -- src/handlers/slack/interactivity.test.ts src/lib/slack/envelope.test.ts src/lib/computers/tasks.test.ts`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/api typecheck`; `pnpm -r --if-present typecheck`; `bash scripts/build-lambdas.sh slack-interactivity`; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run                                                                                                                                                                                       | Implemented Slack interactivity intake for message actions, ephemeral promotion, App Home connect action, modal metadata, and file-aware message-action envelopes. Local Compound-style review added a guard so failed public promotions do not delete the original ephemeral response. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                                                                                              |
| 2026-05-16 | U9   | `codex/slack-workspace-u9-envelope`       | [#1289](https://github.com/thinkwork-ai/thinkwork/pull/1289) | Merged       | `pnpm install`; `pnpm --filter @thinkwork/api test -- src/lib/slack/envelope.test.ts src/lib/slack/thread-mapping.test.ts src/lib/computers/tasks.test.ts src/handlers/slack/events.test.ts src/handlers/slack/slash-command.test.ts src/handlers/slack/interactivity.test.ts`; `uv run pytest packages/agentcore-strands/agent-container/test_invoker_env.py`; `uv run ruff check packages/agentcore-strands/agent-container/container-sources/invocation_env.py packages/agentcore-strands/agent-container/test_invoker_env.py`; `pnpm --filter @thinkwork/api typecheck`; `pnpm -r --if-present typecheck`; `pnpm --filter @thinkwork/api test`; Slack Lambda builds; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run | Implemented the canonical Slack task envelope, centralized Slack-to-ThinkWork thread/message mapping, handler mapping integration, stricter Computer task normalization, and Python runtime environment passthrough for Slack metadata. Branch required a clean rebase onto `origin/main` before merge; focused tests/typecheck passed after the rebase. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                             |
| 2026-05-16 | U10  | `codex/slack-workspace-u10-dispatch`      | [#1290](https://github.com/thinkwork-ai/thinkwork/pull/1290) | Merged       | `pnpm install`; `pnpm --filter @thinkwork/lambda test -- __tests__/slack-dispatch.test.ts`; `pnpm --filter @thinkwork/api test -- src/handlers/computer-runtime.test.ts src/lib/computers/runtime-api.test.ts`; `uv run pytest packages/agentcore-strands/agent-container/test_computer_thread_response.py packages/agentcore-strands/agent-container/test_slack_post_back.py`; `pnpm --filter @thinkwork/lambda typecheck`; `pnpm --filter @thinkwork/api typecheck`; `pnpm -r --if-present typecheck`; `pnpm --filter @thinkwork/lambda test`; `pnpm --filter @thinkwork/api test`; `bash scripts/build-lambdas.sh slack-dispatch`; Terraform fmt/validate; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run            | Implemented the platform-owned Slack post-back runtime wrapper, Slack completion dispatcher, attribution fallback, and scheduled drain wiring. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-05-17 | U11  | `codex/slack-workspace-u11-tests-metrics` | pending                                                      | Ready for PR | `pnpm install`; `pnpm --filter @thinkwork/api test -- src/handlers/slack/_shared.test.ts src/handlers/slack/events.test.ts src/handlers/slack/slash-command.test.ts src/handlers/slack/interactivity.test.ts test/integration/slack-acceptance.test.ts`; `pnpm --filter @thinkwork/lambda test -- __tests__/slack-dispatch.test.ts`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/lambda typecheck`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/lambda test`; `pnpm -r --if-present typecheck`; `bash scripts/build-lambdas.sh slack-dispatch`; `git diff --check`; touched-file Prettier check                                                                                                                     | Added Slack EMF metric helpers, Slack ingress/dispatch metric wiring, AE1-AE6 acceptance-example coverage, and dispatch/degradation metric assertions. Local verification passed; PR is pending.                                                                                                                                                                                                                                                                                                                                                                                                           |

### CI / Merge Log

- Opened [#1273](https://github.com/thinkwork-ai/thinkwork/pull/1273).
- First CI run: `cla`, `lint`, `typecheck`, and `verify` passed; `Migration Drift Precheck (dev)` failed because the new hand-rolled migration objects were missing in dev.
- Applied `packages/database-pg/drizzle/0094_slack_workspace_app.sql` to dev and verified the scoped drift reporter returned all markers present; reran the failed precheck.
- Rerun checks on [#1273](https://github.com/thinkwork-ai/thinkwork/pull/1273) passed (`cla`, `lint`, `Migration Drift Precheck (dev)`, `verify`, `test`, `typecheck`).
- Squash merged [#1273](https://github.com/thinkwork-ai/thinkwork/pull/1273) into `main` as `505bdebc1e4c7fc21a93098137323761f8b5a1a0`; deleted the local worktree/branch and confirmed the remote branch was gone.
- Watched the post-merge Deploy run for `main`; it passed.
- Opened [#1275](https://github.com/thinkwork-ai/thinkwork/pull/1275) for U2.
- GitHub required checks for [#1275](https://github.com/thinkwork-ai/thinkwork/pull/1275) passed after a clean rebase onto `origin/main`.
- Squash merged [#1275](https://github.com/thinkwork-ai/thinkwork/pull/1275) into `main` as `61e0feb7029e9eeb89c1bdbc19931b2b3779293d`; deleted the local worktree/branch and confirmed the remote branch was gone.
- Watched the post-merge Deploy run for `main`; it passed.
- Opened [#1277](https://github.com/thinkwork-ai/thinkwork/pull/1277) for U3.
- GitHub required checks for [#1277](https://github.com/thinkwork-ai/thinkwork/pull/1277) passed.
- Squash merged [#1277](https://github.com/thinkwork-ai/thinkwork/pull/1277) into `main` as `3dc6d8cdd7f673f36377661074aae44e05f3ac63`; deleted the local worktree/branch and confirmed the remote branch was gone.
- Watched the post-merge Deploy run for `main`; it passed.
- Started U4 in `.Codex/worktrees/slack-workspace-u4-oauth-admin` on branch `codex/slack-workspace-u4-oauth-admin`.
- Completed local U4 verification, including API focused/full tests, workspace typecheck, admin build/test, Slack OAuth Lambda build, touched-file formatting, and Chrome visual inspection.
- Opened [#1279](https://github.com/thinkwork-ai/thinkwork/pull/1279) for U4.
- Rebased [#1279](https://github.com/thinkwork-ai/thinkwork/pull/1279) onto `origin/main`, reran required checks, and squash merged it as `df40d1d4d84f518a08bc8a2fe01c483c8704f757`.
- Deleted U4 remote/local branch and worktree; watched post-merge Deploy run `25973083180`, which passed.
- Started U5 in `.Codex/worktrees/slack-workspace-u5-user-linking` on branch `codex/slack-workspace-u5-user-linking`.
- Opened [#1280](https://github.com/thinkwork-ai/thinkwork/pull/1280) for U5.
- Required checks for [#1280](https://github.com/thinkwork-ai/thinkwork/pull/1280) passed; squash merged it as `f308cf6bfcfd70da43af850d8b4378354edfd4db`.
- Watched post-merge Deploy run `25973695133`, which passed; deleted U5 remote/local branch and worktree.
- Started U6 in `.Codex/worktrees/slack-workspace-u6-events` on branch `codex/slack-workspace-u6-events`.
- Completed U6 local verification and prepared the branch for PR.
- Opened [#1283](https://github.com/thinkwork-ai/thinkwork/pull/1283) for U6.
- Required checks for [#1283](https://github.com/thinkwork-ai/thinkwork/pull/1283) passed; squash merged it as `8f4d1ab3d58c7843ee329f889950703d441b45ce`.
- Watched post-merge Deploy run `25974260815`, which passed; deleted U6 remote/local branch and worktree.
- Started U7 in `.Codex/worktrees/slack-workspace-u7-slash-command` on branch `codex/slack-workspace-u7-slash-command`.
- Completed U7 local verification and prepared the branch for PR.
- Opened [#1285](https://github.com/thinkwork-ai/thinkwork/pull/1285) for U7.
- Required checks for [#1285](https://github.com/thinkwork-ai/thinkwork/pull/1285) passed; squash merged it as `9612c3173af6d991fe7ae63c727523cd87e1514c`.
- Watched post-merge Deploy run `25974693969`, which passed; deleted U7 remote/local branch and worktree.
- Started U8 in `.Codex/worktrees/slack-workspace-u8-interactivity` on branch `codex/slack-workspace-u8-interactivity`.
- Completed U8 local implementation and verification; preparing the branch for PR.
- Opened [#1287](https://github.com/thinkwork-ai/thinkwork/pull/1287) for U8.
- Required checks for [#1287](https://github.com/thinkwork-ai/thinkwork/pull/1287) passed; squash merged it as `3128ae12999ac70d6c00e42ab142981a04f02969`.
- Watched post-merge Deploy run `25975222668`, which passed; deleted U8 remote/local branch and worktree.
- Started U9 in `.Codex/worktrees/slack-workspace-u9-envelope` on branch `codex/slack-workspace-u9-envelope`.
- Completed U9 local implementation and verification; preparing the branch for PR.
- Opened [#1289](https://github.com/thinkwork-ai/thinkwork/pull/1289) for U9.
- Required checks for [#1289](https://github.com/thinkwork-ai/thinkwork/pull/1289) passed; merge initially required rebasing onto `origin/main`.
- Rebased U9, reran focused API/Python checks, pushed with `--force-with-lease`, and required checks passed again.
- Squash merged [#1289](https://github.com/thinkwork-ai/thinkwork/pull/1289) as `09383bec5306130ce6701be85a3446dac84bcaca`; merge command reported the known local `main` worktree bookkeeping error, but GitHub confirmed the PR was merged.
- Watched post-merge Deploy run `25975833265`, which passed; deleted U9 remote/local branch and worktree.
- Started U10 in `.Codex/worktrees/slack-workspace-u10-dispatch` on branch `codex/slack-workspace-u10-dispatch`.
- Completed U10 local implementation and verification; preparing the branch for PR.
- Opened [#1290](https://github.com/thinkwork-ai/thinkwork/pull/1290) for U10.
- Required checks for [#1290](https://github.com/thinkwork-ai/thinkwork/pull/1290) passed; squash merged it as `af8698793d856a719f7fe9aa632bf948b1ba045f`.
- Watched post-merge Deploy run `25976357907`, which passed; deleted U10 remote/local branch and worktree.
- Started U11 in `.Codex/worktrees/slack-workspace-u11-tests-metrics` on branch `codex/slack-workspace-u11-tests-metrics`.
- Added Slack EMF metric helpers and acceptance-example integration coverage; local focused/full package tests, repo typecheck, Slack dispatch Lambda build, whitespace check, and touched-file formatting check passed.

### Blockers

- None.

---

# Prior Run: Retire OSS Symphony And Connectors

## Current State

- Target branch: `main`
- Active unit: none - plan implementation complete
- Active branch: none
- Active worktree: none
- Started: 2026-05-14
- Completed: 2026-05-14

## Progress Log

### 2026-05-14

- Read `AGENTS.md`.
- Read `docs/plans/2026-05-14-001-refactor-retire-oss-symphony-connectors-plan.md`.
- Read migration-related prior learnings:
  - `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`
  - `docs/solutions/workflow-issues/survey-before-applying-parent-plan-destructive-work-2026-04-24.md`
- Created isolated worktree from `origin/main` for U1.
- Confirmed `origin/main` already has `0086_update_default_template_models.sql`; U1 will use `0087_retire_oss_connectors.sql`.
- Implemented the grouped U1-U6 cleanup:
  - Removed the OSS connector/Symphony GraphQL contract, generated clients, admin/computer UI routes, CLI command, runtime/poller code, Terraform poller resources, and public docs.
  - Removed connector database schema exports and obsolete connector migrations from the OSS tree.
  - Added `0087_retire_oss_connectors.sql` to drop installed connector tables and tracker-specific external refs during upgrade.
  - Replaced connector-focused docs with narrower integration/MCP language that does not expose Symphony as an OSS feature.
- Verified repo search no longer finds active Symphony/connector runtime identifiers outside the retirement migration and tests.
- Opened [#1226](https://github.com/thinkwork-ai/thinkwork/pull/1226), waited for required checks, and squash-merged it to `main`.
- Deleted the remote branch `codex/retire-oss-connectors-u1`.

## Pull Requests

| Unit  | Branch                           | PR                                                           | Status | Notes                                                                                                                                                                               |
| ----- | -------------------------------- | ------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1-U7 | `codex/retire-oss-connectors-u1` | [#1226](https://github.com/thinkwork-ai/thinkwork/pull/1226) | Merged | Grouped because deleting the database connector schema breaks API, admin, computer, generated clients, and rollout verification until the connector contract is removed everywhere. |

## CI / Verification Log

- `pnpm install` - passed.
- `pnpm schema:build` - passed.
- `pnpm --filter @thinkwork/admin codegen` - passed.
- `pnpm --filter @thinkwork/mobile codegen` - passed.
- `pnpm --filter thinkwork-cli codegen` - passed.
- `pnpm --filter @thinkwork/admin build` - passed.
- `pnpm --filter @thinkwork/computer typecheck` - passed.
- `pnpm --filter @thinkwork/computer build` - passed.
- Targeted database/API/computer/computer-runtime tests for removed connector behavior - passed.
- `pnpm --filter thinkwork-cli test` - passed.
- `pnpm --filter @thinkwork/docs build` - passed.
- `pnpm --filter @thinkwork/admin test` - passed.
- `pnpm -r --if-present typecheck` - passed.
- `pnpm -r --if-present test` - passed.
- `git diff --check` - passed.
- `pnpm format:check` - blocked locally because `prettier` is not installed in this workspace (`sh: prettier: command not found`).
- GitHub PR checks on [#1226](https://github.com/thinkwork-ai/thinkwork/pull/1226) - passed:
  - `cla`
  - `lint`
  - `test`
  - `typecheck`
  - `verify`

## Blockers

None.
