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

- **U1 — Database schema: Slack tables**
- Branch: `codex/slack-workspace-u1-schema`
- Worktree: `.Codex/worktrees/slack-workspace-u1-schema`
- Status: locally verified; preparing PR

### Progress Log

| Date       | Unit | Branch                            | PR  | Status           | Verification                                                                                                                                                                                                                        | Notes                                                                                                                                                                                                              |
| ---------- | ---- | --------------------------------- | --- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-05-16 | U1   | `codex/slack-workspace-u1-schema` | TBD | Locally verified | `pnpm --filter @thinkwork/database-pg test`; `pnpm --filter @thinkwork/database-pg typecheck`; `bash scripts/db-migrate-manual.sh --dry-run packages/database-pg/drizzle/0094_slack_workspace_app.sql`; touched-file Prettier check | Added `slack_workspaces`, `slack_user_links`, and `slack_threads` schema plus migration tests. `db:generate` attempted but Drizzle stopped at an existing interactive schema-conflict prompt before writing files. |

### CI / Merge Log

- No PRs opened yet.

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
