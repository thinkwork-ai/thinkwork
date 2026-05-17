---
title: "Autopilot status ledger"
date: 2026-05-17
status: active
---

# Autopilot Status Ledger

## Current Run: Shared Computers Product Reframe

Plan: `docs/plans/2026-05-17-001-feat-shared-computers-reframe-plan.md`

Target branch: `main`

### Current Unit

- Active unit: U1 Schema and migration for shared Computers and assignments
- Active branch: `codex/shared-computers-u1-schema`
- Active worktree: `.Codex/worktrees/shared-computers-u1-schema`
- Started: 2026-05-17
- PR: [#1322](https://github.com/thinkwork-ai/thinkwork/pull/1322)
- CI: passed after rerunning the migration drift precheck

### Progress Log

| Date       | Unit | Branch                             | PR                                                           | Status    | Verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Notes                                                                                                                                                                                                                                                                        |
| ---------- | ---- | ---------------------------------- | ------------------------------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-17 | U1   | `codex/shared-computers-u1-schema` | [#1322](https://github.com/thinkwork-ai/thinkwork/pull/1322) | CI passed | `pnpm schema:build`; GraphQL codegen for admin/mobile/CLI; `pnpm --filter @thinkwork/database-pg test`; `pnpm --filter @thinkwork/database-pg typecheck`; `bash scripts/db-migrate-manual.sh --dry-run packages/database-pg/drizzle/0097_shared_computers.sql`; `pnpm --filter @thinkwork/api typecheck`; focused API compatibility tests; `pnpm --filter @thinkwork/lambda typecheck`; focused Lambda test; `pnpm --filter thinkwork-cli typecheck`; `pnpm --filter @thinkwork/admin build`; `pnpm --filter @thinkwork/mobile test`; `pnpm -r --if-present typecheck`; `pnpm -r --if-present test`; `git diff --check`; GitHub checks | Created isolated worktree from `origin/main`, copied the approved plan/brainstorm docs into the branch, added shared Computer schema/assignment migration, regenerated GraphQL clients, and added nullable-owner compatibility guards for legacy owner-scoped runtime paths. |

### CI / Merge Log

- Opened [#1322](https://github.com/thinkwork-ai/thinkwork/pull/1322).
- First CI run passed `cla`, `lint`, `verify`, `typecheck`, and `test`; `Migration Drift Precheck (dev)` failed because `0097_shared_computers.sql` had not yet been applied to dev.
- Applied `packages/database-pg/drizzle/0097_shared_computers.sql` to dev and verified the scoped drift reporter returned all markers present.
- Reran the failed migration drift precheck; it passed.

### Blockers

- None.

---

## Current Run: ThinkWork Slack Workspace App

Plan: `docs/plans/2026-05-16-004-feat-thinkwork-computer-slack-workspace-app-plan.md`

Target branch: `main`

### Current Unit

- Active unit: none - plan implementation complete
- Active branch: none
- Active worktree: none
- Completed: 2026-05-17

### Progress Log

| Date       | Unit | Branch                                    | PR                                                           | Status | Verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | ---- | ----------------------------------------- | ------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-16 | U1   | `codex/slack-workspace-u1-schema`         | [#1273](https://github.com/thinkwork-ai/thinkwork/pull/1273) | Merged | `pnpm --filter @thinkwork/database-pg test`; `pnpm --filter @thinkwork/database-pg typecheck`; `bash scripts/db-migrate-manual.sh --dry-run packages/database-pg/drizzle/0094_slack_workspace_app.sql`; touched-file Prettier check; dev `psql -f packages/database-pg/drizzle/0094_slack_workspace_app.sql`; GitHub checks; post-merge Deploy run                                                                                                                                                                                                                                                                                                                                                                                                             | Added `slack_workspaces`, `slack_user_links`, and `slack_threads` schema plus migration tests. `db:generate` attempted but Drizzle stopped at an existing interactive schema-conflict prompt before writing files. Migration Drift Precheck initially failed because `0094` had not yet been applied to dev; applied it to dev and reran the failed check. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                           |
| 2026-05-16 | U2   | `codex/slack-workspace-u2-terraform`      | [#1275](https://github.com/thinkwork-ai/thinkwork/pull/1275) | Merged | `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/lambda typecheck`; `pnpm -r --if-present typecheck`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/lambda test`; targeted Slack Lambda builds; `pnpm build:lambdas`; `terraform -chdir=terraform/examples/greenfield validate`; targeted no-refresh Terraform plan for Slack resources; touched-file Prettier check; `terraform fmt -check`; `bash -n scripts/build-lambdas.sh`; `git diff --check`; GitHub checks; post-merge Deploy run                                                                                                                                                                                                                                 | Added Slack app credentials secret, five Lambda registrations, five public API Gateway routes, build entries, inert handler stubs, and a handler README. Full greenfield plan is not clean locally because this shell lacks Cloudflare credentials and the ignored local tfvars do not mirror deployed custom-domain toggles; targeted Slack plan with `lambda_zips_dir` confirmed the new secret, Lambdas, route integrations, and routes are addressable. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                          |
| 2026-05-16 | U3   | `codex/slack-workspace-u3-signature`      | [#1277](https://github.com/thinkwork-ai/thinkwork/pull/1277) | Merged | `pnpm --filter @thinkwork/api test -- src/handlers/slack/_shared.test.ts src/lib/slack/workspace-store.test.ts`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/api test`; `pnpm -r --if-present typecheck`; touched-file Prettier check; `git diff --check`; GitHub checks; post-merge Deploy run                                                                                                                                                                                                                                                                                                                                                                                                                                        | Added Slack v0 signature verification, replay-window enforcement, retry short-circuiting, workspace lookup dispatch wrapper, and Secrets Manager-backed Slack app/bot-token cache. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                                                                                                                                                                                                   |
| 2026-05-16 | U4   | `codex/slack-workspace-u4-oauth-admin`    | [#1279](https://github.com/thinkwork-ai/thinkwork/pull/1279) | Merged | `pnpm --filter @thinkwork/api test -- src/lib/slack/oauth-state.test.ts src/handlers/slack/oauth-install.test.ts src/graphql/resolvers/slack/slack.resolvers.test.ts src/lib/slack/workspace-store.test.ts`; `pnpm --filter @thinkwork/api test`; `pnpm schema:build`; GraphQL codegen for CLI/mobile/admin; `pnpm --filter @thinkwork/api typecheck`; `pnpm -r --if-present typecheck`; `pnpm --filter @thinkwork/admin build`; `pnpm --filter @thinkwork/admin test`; `bash scripts/build-lambdas.sh slack-oauth-install`; `git diff --check`; touched-file Prettier check; Chrome visual check; GitHub checks; post-merge Deploy run                                                                                                                        | Implemented signed Slack OAuth install state, OAuth callback token storage/upsert, Slack workspace GraphQL query/mutations, and admin install/list/uninstall UI. Admin codegen initially failed on an existing remote-Symphony extension GraphQL document; excluded that sample from ThinkWork schema codegen because it targets a separate backend schema. Chrome visual check rendered the Slack page and install dialog; the page showed the expected deployed-schema GraphQL error until this PR reached deploy. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed. |
| 2026-05-16 | U5   | `codex/slack-workspace-u5-user-linking`   | [#1280](https://github.com/thinkwork-ai/thinkwork/pull/1280) | Merged | `pnpm install`; `pnpm schema:build`; GraphQL codegen for CLI/mobile/admin; `pnpm --filter @thinkwork/api test -- src/lib/slack/user-link-store.test.ts src/graphql/resolvers/slack/slack.resolvers.test.ts`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/mobile test`; `pnpm -r --if-present typecheck`; `bash scripts/build-lambdas.sh oauth-authorize`; `bash scripts/build-lambdas.sh oauth-callback`; `git diff --check`; touched-file Prettier check; `terraform fmt -check terraform/modules/app/lambda-api/handlers.tf`; GitHub checks; post-merge Deploy run                                                                                                                              | Implemented Slack per-user OAuth linking through the existing mobile credentials flow, `slack_user_links` GraphQL query/unlink mutation, mobile Slack connect/unlink UI, and Slack app credential wiring for the generic OAuth handlers. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                                                                                                                                             |
| 2026-05-16 | U6   | `codex/slack-workspace-u6-events`         | [#1283](https://github.com/thinkwork-ai/thinkwork/pull/1283) | Merged | `pnpm --filter @thinkwork/api test -- src/handlers/slack/events.test.ts src/handlers/slack/_shared.test.ts src/lib/slack/envelope.test.ts src/lib/computers/tasks.test.ts`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/lambda typecheck`; `pnpm -r --if-present typecheck`; `pnpm --filter @thinkwork/lambda test`; `bash scripts/build-lambdas.sh slack-events`; `bash scripts/build-lambdas.sh slack-dispatch`; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run                                                                                                                                                                                          | Implemented Slack Events API intake: signed URL verification, app mention / DM handling, Slack identity lookup, Computer task enqueue, placeholder posting, and event dedupe. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                                                                                                                                                                                                        |
| 2026-05-16 | U7   | `codex/slack-workspace-u7-slash-command`  | [#1285](https://github.com/thinkwork-ai/thinkwork/pull/1285) | Merged | `pnpm --filter @thinkwork/api test -- src/handlers/slack/slash-command.test.ts src/handlers/slack/events.test.ts src/lib/slack/envelope.test.ts src/lib/computers/tasks.test.ts`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/api typecheck`; `pnpm -r --if-present typecheck`; `bash scripts/build-lambdas.sh slack-slash-command`; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run                                                                                                                                                                                                                                                                                                                  | Implemented `/thinkwork` slash command handler, response_url envelope wiring, shared linked-Computer routing, and ephemeral attribution blocks. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-05-16 | U8   | `codex/slack-workspace-u8-interactivity`  | [#1287](https://github.com/thinkwork-ai/thinkwork/pull/1287) | Merged | `pnpm install`; `pnpm --filter @thinkwork/api test -- src/handlers/slack/interactivity.test.ts` (failed before implementation, passed after implementation); `pnpm --filter @thinkwork/api test -- src/handlers/slack/interactivity.test.ts src/lib/slack/envelope.test.ts src/lib/computers/tasks.test.ts`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/api typecheck`; `pnpm -r --if-present typecheck`; `bash scripts/build-lambdas.sh slack-interactivity`; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run                                                                                                                                                                                       | Implemented Slack interactivity intake for message actions, ephemeral promotion, App Home connect action, modal metadata, and file-aware message-action envelopes. Local Compound-style review added a guard so failed public promotions do not delete the original ephemeral response. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                                                                                              |
| 2026-05-16 | U9   | `codex/slack-workspace-u9-envelope`       | [#1289](https://github.com/thinkwork-ai/thinkwork/pull/1289) | Merged | `pnpm install`; `pnpm --filter @thinkwork/api test -- src/lib/slack/envelope.test.ts src/lib/slack/thread-mapping.test.ts src/lib/computers/tasks.test.ts src/handlers/slack/events.test.ts src/handlers/slack/slash-command.test.ts src/handlers/slack/interactivity.test.ts`; `uv run pytest packages/agentcore-strands/agent-container/test_invoker_env.py`; `uv run ruff check packages/agentcore-strands/agent-container/container-sources/invocation_env.py packages/agentcore-strands/agent-container/test_invoker_env.py`; `pnpm --filter @thinkwork/api typecheck`; `pnpm -r --if-present typecheck`; `pnpm --filter @thinkwork/api test`; Slack Lambda builds; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run | Implemented the canonical Slack task envelope, centralized Slack-to-ThinkWork thread/message mapping, handler mapping integration, stricter Computer task normalization, and Python runtime environment passthrough for Slack metadata. Branch required a clean rebase onto `origin/main` before merge; focused tests/typecheck passed after the rebase. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                             |
| 2026-05-16 | U10  | `codex/slack-workspace-u10-dispatch`      | [#1290](https://github.com/thinkwork-ai/thinkwork/pull/1290) | Merged | `pnpm install`; `pnpm --filter @thinkwork/lambda test -- __tests__/slack-dispatch.test.ts`; `pnpm --filter @thinkwork/api test -- src/handlers/computer-runtime.test.ts src/lib/computers/runtime-api.test.ts`; `uv run pytest packages/agentcore-strands/agent-container/test_computer_thread_response.py packages/agentcore-strands/agent-container/test_slack_post_back.py`; `pnpm --filter @thinkwork/lambda typecheck`; `pnpm --filter @thinkwork/api typecheck`; `pnpm -r --if-present typecheck`; `pnpm --filter @thinkwork/lambda test`; `pnpm --filter @thinkwork/api test`; `bash scripts/build-lambdas.sh slack-dispatch`; Terraform fmt/validate; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run            | Implemented the platform-owned Slack post-back runtime wrapper, Slack completion dispatcher, attribution fallback, and scheduled drain wiring. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-05-17 | U11  | `codex/slack-workspace-u11-tests-metrics` | [#1292](https://github.com/thinkwork-ai/thinkwork/pull/1292) | Merged | `pnpm install`; `pnpm --filter @thinkwork/api test -- src/handlers/slack/_shared.test.ts src/handlers/slack/events.test.ts src/handlers/slack/slash-command.test.ts src/handlers/slack/interactivity.test.ts test/integration/slack-acceptance.test.ts`; `pnpm --filter @thinkwork/lambda test -- __tests__/slack-dispatch.test.ts`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/lambda typecheck`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/lambda test`; `pnpm -r --if-present typecheck`; `bash scripts/build-lambdas.sh slack-dispatch`; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run                                                                               | Added Slack EMF metric helpers, Slack ingress/dispatch metric wiring, AE1-AE6 acceptance-example coverage, and dispatch/degradation metric assertions. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                                                                                                                                                                                                                               |
| 2026-05-17 | U12  | `codex/slack-workspace-u12-docs`          | [#1294](https://github.com/thinkwork-ai/thinkwork/pull/1294) | Merged | `pnpm install`; `pnpm --filter @thinkwork/docs build`; `pnpm --filter @thinkwork/workspace-defaults test`; `pnpm --filter @thinkwork/workspace-defaults typecheck`; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Added the Slack Workspace App integration guide, Slack data-handling compliance page, Slack dispatch runbook, handler README refresh, and workspace-default guidance that marks Slack as a first-class Computer surface. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                                                                                                                                                             |

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
- Opened [#1292](https://github.com/thinkwork-ai/thinkwork/pull/1292) for U11.
- Required checks for [#1292](https://github.com/thinkwork-ai/thinkwork/pull/1292) passed; squash merged it as `85a0f6bbcb07062fa584512c3281ca5acee0aa70`.
- Watched post-merge Deploy run `25976879391`, which passed; deleted U11 remote/local branch and worktree.
- Started U12 in `.Codex/worktrees/slack-workspace-u12-docs` on branch `codex/slack-workspace-u12-docs`.
- Completed U12 documentation updates and local verification; preparing the branch for PR.
- Opened [#1294](https://github.com/thinkwork-ai/thinkwork/pull/1294) for U12.
- Required checks for [#1294](https://github.com/thinkwork-ai/thinkwork/pull/1294) passed; squash merged it as `0afb7dfd24572e3ef4ef5ce6db6f7a4effd76030`.
- Watched post-merge Deploy run `25977319292`, which passed; deleted U12 remote/local branch and worktree.
- All implementation units from `docs/plans/2026-05-16-004-feat-thinkwork-computer-slack-workspace-app-plan.md` are complete and merged.

### Live Slack Setup / E2E Verification

- Created the dev Slack app `ThinkWork Dev` in the Homecare Intelligence Slack workspace.
- Populated the `thinkwork/dev/slack/app` Secrets Manager secret with Slack app credentials and verified the secret shape without exposing the secret values.
- Verified signed Slack Events URL challenge smoke against the deployed `/slack/events` route returned `200` and echoed the challenge.
- Verified unsigned Slack Events API requests are rejected with `401`.
- Confirmed deployed docs/admin routes are live:
  - `https://docs.thinkwork.ai/integrations/slack/`
  - `https://docs.thinkwork.ai/operations/slack-dispatch-runbook/`
  - `https://admin.thinkwork.ai/slack`
- Found live admin install failure after U12: `startSlackWorkspaceInstall` returned a GraphQL error because `graphql-http` lacked access to Slack app credentials.
- Opened and merged [#1298](https://github.com/thinkwork-ai/thinkwork/pull/1298) (`fix(slack): wire app credentials into GraphQL`), but its post-merge deploy failed during Terraform apply because the added Lambda environment variable pushed `graphql-http` past AWS's 4KB environment limit.
- Opened and merged [#1300](https://github.com/thinkwork-ai/thinkwork/pull/1300) (`fix(slack): load app credentials without GraphQL env`) to use the stage-scoped secret fallback from `graphql-http` instead of wiring another environment variable. Required checks passed and Deploy run `25979254054` passed.
- Verified deployed `thinkwork-dev-api-graphql-http` was updated at `2026-05-17T02:37:31Z`, is on `STAGE=dev`, and does not include `SLACK_APP_CREDENTIALS_SECRET_ARN`.
- Started Slack workspace install through the deployed `startSlackWorkspaceInstall` GraphQL mutation using the live admin owner session, completed Slack OAuth approval in Brave, and verified the redirect returned `slackInstall=success`.
- Verified `slack_workspaces` contains one active Homecare Intelligence workspace row:
  - `slack_team_id`: `T1U9X1BEH`
  - `app_id`: `A0B443U357D`
  - `bot_user_id`: `U0B54RVL9NU`
  - `status`: `active`
- Ran the deployed per-user Slack OAuth linking flow through `/api/oauth/authorize?provider=slack`, approved Sign in with Slack, and verified the redirect returned `status=connected&provider=slack`.
- Verified `slack_user_links` contains one active link for the ThinkWork user `4dee701a-c17b-46fe-9f38-a333d4c3fad0` and Slack user `U1UA2R8V7`.
- Verified Slack Web API `auth.test` succeeds for the installed bot in Homecare Intelligence.
- Ran a signed Slack Events API DM smoke for the linked user. The deployed `/slack/events` route returned `200` with task `759fd77c-ac07-450f-a4c9-dbad85c52306`; the task completed, created Slack thread mapping `695b782a-7712-4959-8a4c-79768cbabbce`, and wrote a user/assistant exchange to ThinkWork thread `3711ff02-a2a5-482d-9005-9a44f6af5d54`.
- Verified the bot DM channel received a Slack bot message after the event smoke.
- Ran a signed `/thinkwork` slash-command ingress smoke for the linked user. The deployed `/slack/slash-command` route returned `200` and queued task `b976be63-6d84-4381-924a-0217bf36bb39`; the Computer completed the ThinkWork response, but final Slack delivery failed because the smoke used an intentionally fake `response_url`.

### Post-Implementation Live Debug

- Started hotfix branch `codex/debug-slack-threads` in `.Codex/worktrees/debug-slack-threads` after live reports that Slack placeholders were not becoming useful answers and both Admin/Computer Threads pages showed `[GraphQL] Unexpected error`.
- Confirmed GraphQL root cause in CloudWatch: Slack-created threads persisted `channel = 'slack'`, `threadToCamel` returned `SLACK`, but `ThreadChannel` did not include `SLACK`, causing `Enum "ThreadChannel" cannot represent value: "SLACK"` for `threadsPaged.items[0].channel`.
- Confirmed Slack dispatch root cause from dev DB rows: completed Slack tasks stored `output.responseMessageId` with a valid assistant message, but `output.response` was empty, so `slack-dispatch` sent the fallback `"ThinkWork response"` instead of the message content.
- Implemented hotfix to add `SLACK` to the GraphQL enum, regenerate generated GraphQL clients, and have `slack-dispatch` resolve assistant message content from `responseMessageId` when inline output text is absent.
- Local verification passed:
  - `pnpm install --frozen-lockfile`
  - `pnpm schema:build`
  - GraphQL codegen for `apps/admin`, `apps/mobile`, and `apps/cli`
  - `pnpm --filter @thinkwork/lambda test -- slack-dispatch.test.ts`
  - `pnpm --filter @thinkwork/api test -- src/__tests__/graphql-contract.test.ts src/__tests__/thread-resolver.test.ts`
  - `pnpm --filter @thinkwork/lambda typecheck`
  - `pnpm --filter @thinkwork/api typecheck`
- Opened and merged [#1312](https://github.com/thinkwork-ai/thinkwork/pull/1312) (`fix(slack): surface thread channels and response text`). Required checks passed and Deploy run `25987731904` passed.
- Verified deployed `threadsPaged` now returns Slack threads with `channel: SLACK`; Admin and Computer Threads pages can load Slack-created threads again.
- Ran a signed Slack Events API DM smoke. The task completed with assistant message `Got it. Marco here and operational.`, but the scheduled Slack dispatch Lambda continued timing out before marking `slack.dispatch_completed`.
- Started follow-up hotfix branch `codex/fix-slack-dispatch-drain` in `.Codex/worktrees/debug-slack-threads`.
- Confirmed Slack dispatch timeout root cause: `loadPending` scanned from `computer_events` task-completion rows, then filtered for Slack tasks and dispatch markers. In dev this exceeded the 30s Lambda timeout before the pending Slack completion could be posted.
- Implemented follow-up hotfix to load pending Slack completions from completed `computer_tasks` first, resolve the source completion event with a per-task subquery, and keep assistant-message lookup tenant-scoped.
- Incorporated live UX feedback: Slack event ingestion no longer posts a visible `Marco is thinking...` placeholder for app mentions/DMs. Final answers post as the only bot reply when dispatch completes; existing legacy placeholders can still be updated if already present on older tasks.
- Local verification for the follow-up hotfix passed:
  - `pnpm --filter @thinkwork/api test -- src/handlers/slack/events.test.ts test/integration/slack-acceptance.test.ts`
  - `pnpm --filter @thinkwork/lambda test -- slack-dispatch.test.ts`
  - `pnpm --filter @thinkwork/api typecheck`
  - `pnpm --filter @thinkwork/lambda typecheck`
  - `bash scripts/build-lambdas.sh slack-events`
  - `bash scripts/build-lambdas.sh slack-dispatch`
  - `git diff --check`
- Opened and merged [#1313](https://github.com/thinkwork-ai/thinkwork/pull/1313) (`fix(slack): drain completed tasks and remove placeholders`). Required checks passed and Deploy run `25988195062` passed.
- Verified deployed Lambda timestamps after the deploy:
  - `thinkwork-dev-api-slack-events`: `2026-05-17T10:25:18Z`
  - `thinkwork-dev-api-slack-dispatch`: `2026-05-17T10:25:11Z`
- Ran a signed Slack Events API DM smoke after deploy. The deployed route returned task `2805de2c-eb9b-4705-8f1a-5136f9dbab1c`; the Computer completed it and `slack-dispatch` posted `slack final response ok` to Slack at `1779013812.283429`.
- Verified the previously stuck task `4bb289b6-acfb-422c-ab49-178081308ecd` also now has `slack.dispatch_completed` with Slack timestamp `1779012410.992669`.
- Started follow-up UX hotfix branch `codex/slack-branding-placeholders` in `.Codex/worktrees/slack-branding-placeholders` after live feedback that Slack needs a pending response and should consistently display as `ThinkWork` with the brain logo rather than `Eric Odom's Computer`.
- Implemented branded pending placeholders for Slack Events API DM/app-mention tasks. New Slack tasks post `Marco is thinking...` as `ThinkWork`, persist the placeholder timestamp, and replace that same message with the final response.
- Standardized outbound Slack dispatcher messages to use `ThinkWork` plus `https://admin.thinkwork.ai/logo.png` for `chat.postMessage`/`chat.update`, while preserving the per-Computer routing attribution in the message footer.
- Local verification for the branding/placeholder hotfix passed:
  - `pnpm install --frozen-lockfile`
  - `pnpm --filter @thinkwork/api test -- src/handlers/slack/events.test.ts test/integration/slack-acceptance.test.ts`
  - `pnpm --filter @thinkwork/lambda test -- slack-dispatch.test.ts`
  - `pnpm --filter @thinkwork/api typecheck`
  - `pnpm --filter @thinkwork/lambda typecheck`
  - `bash scripts/build-lambdas.sh slack-events`
  - `bash scripts/build-lambdas.sh slack-dispatch`
  - `git diff --check`
- Opened and merged [#1316](https://github.com/thinkwork-ai/thinkwork/pull/1316) (`fix(slack): brand responses and update placeholders`). Required checks passed, then the branch was rebased because it was behind `main`; checks passed again after the rebase and Deploy run `25989295990` passed.
- Verified deployed Lambda timestamps after the deploy:
  - `thinkwork-dev-api-slack-events`: `2026-05-17T11:18:27Z`
  - `thinkwork-dev-api-slack-dispatch`: `2026-05-17T11:18:21Z`
- Ran a signed Slack Events API DM smoke after deploy. The deployed route returned task `8eaa1373-8764-4159-9fd7-cde9c48df0ad`; the task completed with placeholder timestamp `1779017099.807819`, stored the same timestamp in `input.slack.placeholderTs`, and `slack-dispatch` completed with `mode: chat_update`.
- Verified Slack API history for the smoke message shows the final visible message at timestamp `1779017099.807819` with `username: ThinkWork`, text `branded placeholder ok`, and a Slack-cached bot icon derived from the configured ThinkWork logo.
- Started follow-up visual hotfix branch `codex/slack-dark-icon` in `.Codex/worktrees/slack-dark-icon` after live feedback that the Slack icon was showing the transparent logo against a white tile in dark-mode Slack.
- Added `apps/admin/public/slack-icon.png`, a 512x512 opaque dark square generated by the admin brand asset script, and changed Slack event placeholders plus Slack dispatch defaults to use `https://admin.thinkwork.ai/slack-icon.png`.
- Local verification for the dark Slack icon hotfix passed:
  - `pnpm install --frozen-lockfile`
  - `node apps/admin/scripts/generate-brand-assets.mjs`
  - `pnpm --filter @thinkwork/api test -- src/handlers/slack/events.test.ts test/integration/slack-acceptance.test.ts`
  - `pnpm --filter @thinkwork/lambda test -- slack-dispatch.test.ts`
  - `pnpm --filter @thinkwork/api typecheck`
  - `pnpm --filter @thinkwork/lambda typecheck`
  - `bash scripts/build-lambdas.sh slack-events`
  - `bash scripts/build-lambdas.sh slack-dispatch`
  - `pnpm --filter @thinkwork/admin build`
  - `git diff --check`

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

---

# Slack File Attachment Hotfix - 2026-05-17

## Status

- Branch: `codex/slack-file-attachments`
- Started: `2026-05-17T12:32:34Z`
- Root cause:
  - Slack file uploads arrive as human `message` events with `subtype: "file_share"`, but `slack-events` ignored all subtyped messages.
  - Slack file refs were preserved in task metadata, but they were never downloaded into ThinkWork `thread_attachments` or linked through `messages.metadata.attachments`, so the Computer runtime had no staged files to read.
- Implemented:
  - Accept human Slack `file_share` DMs and bot-mentioned channel file shares as Slack turns.
  - Download Slack files with the bot token, validate safe attachment types, store them under the existing tenant/thread attachment S3 prefix, insert `thread_attachments`, and link attachment IDs onto the user message metadata before dispatch.
  - Extend attachment validation to safe text documents (`.md`, `.txt`) in addition to the existing Excel/CSV support so Slack document review works for uploaded Markdown files.

## Verification Log

- `pnpm install` - passed.
- Targeted API tests for Slack events, Slack envelope parsing, Slack file materialization, attachment validation, and Slack acceptance examples - passed.
- `pnpm --filter @thinkwork/api typecheck` - passed.
- `pnpm --filter @thinkwork/api test` - passed.
- `pnpm --filter @thinkwork/api build` - passed.

## CI / PR

- Opened [#1320](https://github.com/thinkwork-ai/thinkwork/pull/1320).
- GitHub PR checks on [#1320](https://github.com/thinkwork-ai/thinkwork/pull/1320) passed:
  - `cla`
  - `lint`
  - `test`
  - `typecheck`
  - `verify`
- Squash merged [#1320](https://github.com/thinkwork-ai/thinkwork/pull/1320) as `190e2299d1f8086b9364357d4746c5b9df595e5c`; Deploy run `25991215749` passed.
- Live smoke confirmed Slack file-share tasks now enqueue, but follow-up testing exposed a second gap: replies like "Can you review this file?" need to inherit files uploaded earlier in the Slack thread.

# Slack Thread File Context Hotfix - 2026-05-17

## Status

- Branch: `codex/slack-thread-file-context`
- Started: `2026-05-17T13:00:00Z`
- Root cause:
  - Slack `conversations.replies` returns file metadata for earlier messages in the thread, but `slack-events` reduced thread context to `{ user, botId, ts, text }` and discarded `files`.
  - `buildSlackThreadTurnInput` only considered files attached to the exact triggering Slack event, so a reply such as "Can you review this file?" had no `fileRefs` even when the file was visible earlier in the Slack thread.
- Implemented:
  - Preserve parsed Slack file refs on `SlackThreadContextMessage`.
  - Merge current-message file refs with prior Slack thread-context file refs, deduped by Slack file id, before materializing ThinkWork attachments.
  - Keep file-bearing Slack thread-context messages even when long thread text exceeds the summary budget, so attachment metadata is not dropped by summarization.

## Verification Log

- `pnpm install` - passed.
- `pnpm --filter @thinkwork/api exec vitest run src/lib/slack/envelope.test.ts src/handlers/slack/events.test.ts test/integration/slack-acceptance.test.ts` - passed.
- `pnpm --filter @thinkwork/api typecheck` - passed.
- `pnpm --filter @thinkwork/api test` - passed.
- `bash scripts/build-lambdas.sh slack-events` - passed.
- `git diff --check` - passed.
- `pnpm exec prettier --check ...` - blocked locally because `prettier` is not installed in this workspace (`Command "prettier" not found`).

## CI / PR

- Opened [#1321](https://github.com/thinkwork-ai/thinkwork/pull/1321).
- GitHub PR checks on [#1321](https://github.com/thinkwork-ai/thinkwork/pull/1321) passed:
  - `cla`
  - `lint`
  - `test`
  - `typecheck`
  - `verify`
- Squash merged [#1321](https://github.com/thinkwork-ai/thinkwork/pull/1321) as `323c94776a18a66e05e8f47778cd3f8186476c68`; Deploy run `25991999562` passed.
- Live smoke still returned `threadContext: []`; CloudWatch showed Slack `conversations.replies` returned `invalid_arguments`.

# Slack Thread Context Fetch Hotfix - 2026-05-17

## Status

- Branch: `codex/slack-replies-form-fetch`
- Started: `2026-05-17T13:30:00Z`
- Root cause:
  - Slack `chat.postMessage` accepts JSON, but `conversations.replies` rejected the JSON request body with `invalid_arguments` and reported missing `channel`/`ts`.
  - The same `conversations.replies` call succeeds when sent as `application/x-www-form-urlencoded`, so the deployed Slack Events Lambda was discarding thread context before the #1321 merge logic could see prior file uploads.
- Implemented:
  - Use a form-encoded Slack Web API helper for `conversations.replies`.
  - Added a regression test that asserts `conversations.replies` is called with form encoding and that earlier thread files are materialized.

## Verification Log

- `pnpm --filter @thinkwork/api exec vitest run src/handlers/slack/events.test.ts src/lib/slack/envelope.test.ts test/integration/slack-acceptance.test.ts` - passed.
- `pnpm --filter @thinkwork/api typecheck` - passed.
- `bash scripts/build-lambdas.sh slack-events` - passed.
- `git diff --check` - passed.

## CI / PR

- Pending: commit, PR, CI, squash merge, deploy, and live Slack smoke.

## Blockers

None.
