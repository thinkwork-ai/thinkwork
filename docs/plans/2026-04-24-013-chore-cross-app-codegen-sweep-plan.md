---
title: Cross-app codegen sweep + schema.graphql sync + thread-cleanup smoke script (U11, partial)
type: chore
status: active
date: 2026-04-24
origin: docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md
---

# Cross-app codegen sweep + schema.graphql sync + thread-cleanup smoke script (U11, partial)

## Overview

Carves a pragmatic slice out of the parent plan's U11 block (`docs/plans/2026-04-24-002-*`, lines 659–688). U11 was the "final cross-app codegen regen + smoke + monitoring" unit. It has three asks:

1. **Regenerate codegen in every consumer** — `apps/admin`, `apps/mobile`, `apps/cli`. Commit any drift.
2. **Run `pnpm schema:build`** — sync `terraform/schema.graphql` with the current canonical GraphQL types. Commit any drift (expected: none for this cleanup).
3. **Create `scripts/smoke-thread-cleanup.sh`** — invokes `scripts/verify-thread-traces.ts`, curls `thread(id)` with every dropped field to confirm GraphQL errors, spot-checks admin/mobile/cli build outputs.
4. **Add CloudWatch metric filters + alarms** on the `graphql-http` Lambda log group for `column "..." does not exist` / `relation "..." does not exist` patterns, wired to an existing ops SNS topic.

**This slice ships (1), (2), and (3).** It intentionally **defers (4)** — the CloudWatch alarms — because:

- There is **no existing SNS topic** in `terraform/modules/` to wire alarms to. Provisioning one requires decisions about subscribers (ops-only email list? PagerDuty integration? Slack webhook?) that are separate infra concerns.
- U5 (the destructive migration that drops `thread_comments` / `artifacts` / `message_artifacts`) **has not merged yet** — it's gated on U13 (the `thinkwork-${stage}-backups` bucket + Aurora `aws_s3` extension). The "column does not exist" errors these alarms would catch do not exist in production yet.
- Alarms with nothing to alarm on, wired to an SNS topic with no subscribers, are theatre.

Instead, the slice plan below carves out (4) as an explicit `Deferred to Follow-Up Work` item with acceptance criteria and the file paths that need touching. When U5 ships, a follow-up PR provisions SNS + the alarms in one coherent infrastructure change.

The `smoke-thread-cleanup.sh` script is also scoped carefully: the "curl with removed field → expect GraphQL error" assertions are gated on an `AFTER_U5=1` env flag and no-op until that flag is set. Running the smoke pre-U5 validates the parts that work today (verify-thread-traces, admin/mobile/cli build outputs, trigger-rendering via dev thread creation) and leaves the field-removal assertions dormant.

---

## Problem Frame

After six merged cleanup PRs (U3d, U4, U6, U7, U8, U9, U10), cross-app codegen may have drifted silently. The three consumers each run `pnpm --filter <name> codegen` from their own package, but nothing enforces all three stay in sync with the canonical schema under `packages/database-pg/graphql/types/*.graphql`. A single `pnpm schema:build` + three codegen runs reconciles the tree.

The parent plan's U11 also called for a repeatable end-to-end smoke that operators can run post-deploy to validate the thread-cleanup arc actually works (trigger rendering, lifecycle derivation, agent-thread-management skill call paths). That scaffolding is still valuable pre-U5 even if a few assertions are gated on U5's column drops.

The monitoring piece (CloudWatch alarms for schema-drift errors) is valuable **after** U5 — they guard against a future regression where some hidden SQL path still references a dropped column. Before U5 they have nothing to watch.

---

## Requirements Trace

- R1. `pnpm --filter @thinkwork/admin codegen`, `pnpm --filter @thinkwork/mobile codegen`, and `pnpm --filter thinkwork-cli codegen` all run; any resulting diffs in `apps/admin/src/gql/*`, `apps/mobile/lib/gql/*`, `apps/cli/src/gql/*` are committed.
- R2. `pnpm schema:build` runs; any resulting diff in `terraform/schema.graphql` is committed.
- R3. `scripts/smoke-thread-cleanup.sh` exists, is executable, and exits 0 on dev when the stack is healthy.
- R4. The smoke script gates U5-dependent assertions behind an `AFTER_U5=1` env flag; without that flag it only runs pre-U5-safe checks.
- R5. The script is documented with a short header comment explaining how to run it, what it checks, and the `AFTER_U5` contract.
- R6. `pnpm -r --if-present typecheck` still passes or maintains the same baseline error counts.
- R7. CloudWatch alarms + SNS provisioning are deferred to a separate follow-up PR with explicit criteria.

**Origin trace:** parent plan R13 (cleanup complete across all client surfaces) + R14 (rollback/monitoring posture).

---

## Scope Boundaries

- **Out of scope — CloudWatch metric filters + alarms on `graphql-http` Lambda log group.** See `Deferred to Follow-Up Work` below. Rationale: no existing SNS topic; U5 hasn't merged so the error patterns don't exist in prod yet.
- **Out of scope — any behavioral code change in admin/mobile/cli.** This slice is strictly codegen regen + a new shell script + any mechanical type drift the codegen surfaces.
- **Out of scope — investigating the codegen drift.** If regen produces a large diff, commit it as-is. The diff is the drift; it has to land before anything else is confident.
- **Out of scope — updating any documentation beyond the smoke script's own header comment.**
- **Out of scope — migrating `smoke-thread-cleanup.sh` to TypeScript.** It's a shell wrapper around existing tools (`curl`, `jq`, `pnpm tsx scripts/verify-thread-traces.ts`); shell is the right tool.
- **Out of scope — wiring the smoke script into CI.** It's a human-run validation script; CI-wiring comes later once U5 is merged and the assertions are complete.

### Deferred to Follow-Up Work

- **CloudWatch alarms for schema-drift errors on `graphql-http`.** Create in a dedicated follow-up PR after U5 merges. Acceptance criteria for that PR:
  1. `aws_sns_topic` resource named `thinkwork-${stage}-ops-alerts` (or similar) under `terraform/modules/app/lambda-api/` or a new `terraform/modules/app/monitoring/` submodule. Subscribers are a variable input (list of email addresses).
  2. `aws_cloudwatch_log_metric_filter` on the `graphql-http` Lambda log group for patterns `"column \".*\" does not exist"` and `"relation \".*\" does not exist"` (two filters, two metrics).
  3. `aws_cloudwatch_metric_alarm` for each, threshold `sum >= 1 over 5-minute period`, `alarm_actions` pointed at the SNS topic.
  4. A terraform `output` for the SNS topic ARN so other modules can subscribe.
  5. Deploy to dev, manually trip one alarm by sending a malformed SQL query, verify the SNS topic receives the alarm payload.
- **Wire `smoke-thread-cleanup.sh` into a CI workflow** that runs against dev after deploy. Cross-stack smoke; needs stage + tenant env injection from the deploy workflow.

---

## Context & Research

### Relevant Code and Patterns

- `packages/database-pg/graphql/types/*.graphql` — canonical GraphQL source.
- `scripts/schema-build.sh` — derives `terraform/schema.graphql` (AppSync subscription-only).
- `apps/admin/codegen.ts`, `apps/mobile/codegen.ts`, `apps/cli/codegen.ts` — graphql-codegen configs per consumer.
- Existing `scripts/verify-thread-traces.ts` (from U1) — the smoke script wraps this.
- `terraform/modules/app/lambda-api/handlers.tf:125-127` — `graphql-http` Lambda resource. The CloudWatch log group is created implicitly by Lambda.

### Institutional Learnings

- `feedback_worktree_tsbuildinfo_bootstrap` — clean `tsconfig.tsbuildinfo` + rebuild database-pg before typecheck in a fresh worktree.
- `feedback_ship_inert_pattern` — new code can land without consumers as long as tests pass. Applied to the smoke script: ship it with the `AFTER_U5` gate today, wire into CI post-U5.
- `feedback_graphql_deploy_via_pr` — GraphQL Lambda changes go through PR to main, not `aws lambda update-function-code`. Not directly relevant here (this slice touches codegen output, not Lambda handlers) but worth respecting if drift surprises.

---

## Key Technical Decisions

- **Decision 1: Ship codegen regen + schema:build + smoke script scaffold; defer CloudWatch alarms.** See Overview rationale.
- **Decision 2: Smoke script is bash, not TypeScript.** It orchestrates `pnpm tsx`, `curl`, and `jq` calls; TS-wrapping those would add complexity without value.
- **Decision 3: `AFTER_U5=1` env gate on U5-dependent assertions.** Lets the script ship today with the checks visible in-tree, but inert in prod until U5 lands. When U5 merges, the follow-up simply flips the default.
- **Decision 4: No admin codegen consumer beyond the three already running.** `packages/api` has no `codegen` script despite CLAUDE.md's mention — verify at execution and flag if that changes.
- **Decision 5: If codegen or schema:build produces a large surprising diff, commit it as-is.** Investigating drift is an infinite rabbit hole; the drift IS the bug. Subsequent PRs can polish.

---

## Open Questions

### Resolved During Planning

- **Q:** Is there an existing SNS topic for ops alerts? **A:** No (`rg aws_sns_topic terraform/modules` returns zero). Deferred.
- **Q:** Does `packages/api` have a `codegen` script? **A:** No — CLAUDE.md's mention is stale. Three consumers: admin, mobile, cli.
- **Q:** Does the smoke script need to check terraform Lambda outputs? **A:** No — it's a runtime smoke, not an infrastructure test. Terraform state validation is out of scope.
- **Q:** Pre-U5 with `AFTER_U5` unset, what does the smoke script verify? **A:** (a) `verify-thread-traces.ts` runs green; (b) admin/mobile/cli `pnpm build` outputs produce non-empty artifacts; (c) `thread(id)` with `lifecycleStatus` returns a valid enum; (d) `thread(id)` with `channel` returns a valid enum; (e) a fresh chat-channel thread renders `lifecycleStatus: IDLE` or `RUNNING`.

### Deferred to Implementation

- The exact `curl` + `jq` shape for the dev-stack `thread(id)` probe. Depends on authentication: use `thinkwork login --stage dev` + cached token from `~/.thinkwork/config.json`? Or require the operator to pass `--token`? Pick the least-magical option at implementation time.
- Whether to exit 0 or exit non-zero on non-AFTER-U5 assertions that fail. Prefer exit 0 with warnings for missing-field checks when `AFTER_U5` is unset; exit non-zero for anything that should pass today.

---

## Implementation Units

- U1. **Codegen sweep + schema:build + smoke script scaffold**

**Goal:** Three `codegen` commands + `schema:build` run; any diff committed. `scripts/smoke-thread-cleanup.sh` lands with pre-U5 assertions active and U5-gated assertions dormant.

**Requirements:** R1, R2, R3, R4, R5, R6.

**Dependencies:** None beyond `origin/main`.

**Files:**
- Modify (codegen output, if drift exists): `apps/admin/src/gql/*`, `apps/mobile/lib/gql/*`, `apps/cli/src/gql/*`.
- Modify (schema:build output, if drift exists): `terraform/schema.graphql`.
- Create: `scripts/smoke-thread-cleanup.sh`.

**Approach:**
- Run codegen in three consumers in sequence: `pnpm --filter @thinkwork/admin codegen`, `pnpm --filter @thinkwork/mobile codegen`, `pnpm --filter thinkwork-cli codegen`. Commit any non-empty diff as a single codegen-sweep hunk.
- Run `pnpm schema:build`. Commit any non-empty diff.
- Create `scripts/smoke-thread-cleanup.sh` with:
  - Header comment: purpose, how to run, `AFTER_U5` contract, exit codes.
  - Stage + tenant resolution: read from `~/.thinkwork/config.json` (`jq`), or accept `--stage` / `--tenant` CLI args.
  - Auth token resolution: same config cache.
  - Checks (always run, exit 1 on failure):
    1. `pnpm tsx scripts/verify-thread-traces.ts --stage ${STAGE}` exits 0.
    2. `pnpm --filter @thinkwork/admin build` produces `apps/admin/dist/index.html` non-empty.
    3. `pnpm --filter @thinkwork/cli build` produces `apps/cli/dist/thinkwork.mjs` non-empty.
    4. `mobile/build:web` (use `pnpm --filter @thinkwork/mobile build:web`) exits 0.
    5. Create a dev thread via `createThread` mutation with `channel: CHAT`, `agentId: <dev-agent>`. Query it back via `thread(id)`. Assert `lifecycleStatus` is one of `IDLE` / `RUNNING` / `COMPLETED` / etc. — a valid enum value (not null, not the error-state null).
    6. Query the same thread's `channel` — assert it's one of the `ThreadChannel` enum values.
  - Checks gated on `AFTER_U5=1` (skip with warning if unset, exit 1 on failure if set):
    1. Curl `thread(id)` with `thread.description` selection → expect GraphQL error `Cannot query field "description"`.
    2. Curl with `thread.priority` → expect error.
    3. Curl with `thread.type` → expect error.
    4. Curl with `thread.children` → expect error.
    5. Curl with `thread.parent` → expect error.
    6. Curl with `thread.comments` → expect error.
    7. Curl with `message.durableArtifact` → expect error (only if U5 also drops that; plan says it doesn't, but U9 surveyed durableArtifact still live; gate behind a `U5_DROPS_ARTIFACTS=1` sub-flag).
  - Final line: `echo "✓ smoke-thread-cleanup passed"` and exit 0.
- `chmod +x scripts/smoke-thread-cleanup.sh`.

**Execution note:** Mechanical. No test-first.

**Patterns to follow:**
- Existing `scripts/schema-build.sh` for shell-script style in this repo.
- `scripts/verify-thread-traces.ts` signature for the subshell invocation.

**Test scenarios:**
- **Pre-U5 smoke.** Run `bash scripts/smoke-thread-cleanup.sh` without `AFTER_U5` set. Expect: all non-gated checks pass; gated checks print "skipped — AFTER_U5 not set" warnings; exit 0.
- **Post-U5 smoke (gated).** Run with `AFTER_U5=1`. All checks should pass on a stack where U5 has deployed.
- **Failure paths.** Break one check (e.g., point `STAGE` at a stage that doesn't exist) and confirm the script exits non-zero with a clear message.

**Verification:**
- `rg "ThreadStatus\|ThreadPriority\|ThreadType" apps/mobile/lib/gql/ apps/cli/src/gql/ apps/admin/src/gql/` — the enum definitions should match the current server schema (either all retain the enum per server, or all drop consistently). A divergence is a codegen-drift signal.
- Codegen diff is bounded, mechanical, no unexpected type changes outside the enum/query surface the past six PRs touched.
- `ls -la scripts/smoke-thread-cleanup.sh` shows executable bit.
- `bash -n scripts/smoke-thread-cleanup.sh` parses cleanly.
- `pnpm -r --if-present typecheck` shows no new errors vs origin/main baseline.

---

## System-Wide Impact

- **Interaction graph:** None. Codegen output is mechanical; smoke script is human-run.
- **Error propagation:** Smoke script uses `set -euo pipefail`; any failed sub-command exits non-zero.
- **State lifecycle risks:** The smoke script creates a dev thread. Cleanup: explicitly delete the thread at the end via `deleteThread` mutation, or accept orphan-thread noise (dev stack — tolerable).
- **API surface parity:** Codegen stays aligned across admin/mobile/cli; `terraform/schema.graphql` stays aligned with canonical types.
- **Integration coverage:** The smoke script IS integration coverage.
- **Unchanged invariants:** No schema edits, no handler changes, no infrastructure changes (CloudWatch deferred).

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Codegen regen produces unexpectedly large diff hiding a real drift bug. | Commit as-is; the drift is the bug. Subsequent PRs investigate. |
| `pnpm schema:build` fails because `scripts/schema-build.sh` needs `bash`-specific env. | Already relied on in CLAUDE.md's standard flow; if it fails, investigate and fix as a separate `fix:` commit in this PR. |
| Smoke script's `createThread` + `deleteThread` dev round-trip leaves orphans. | Accept orphan noise on dev; add a cleanup at end of script. |
| The dev agent ID the smoke script uses is stage-specific and drift-prone. | Resolve at runtime: query `agents(tenantId:)` and pick the first agent, or accept `--agent <id>` CLI arg. Default: first agent returned. |
| Codegen in `apps/mobile` fails due to the stale tsbuildinfo pattern. | Use the memory-documented bootstrap: `find . -name tsconfig.tsbuildinfo -not -path '*/node_modules/*' -delete && pnpm --filter @thinkwork/database-pg build` before running codegen. |

---

## Documentation / Operational Notes

- After this PR merges, link `scripts/smoke-thread-cleanup.sh` from a future runbook entry under `docs/` once U5 lands and the script's assertions are fully active.
- The follow-up CloudWatch PR should update `docs/` with alarm + paging runbook entries.

---

## Sources & References

- **Origin plan:** `docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md` (U11 block: lines 659–688; U5 block around line 435 for the dropped-column context; U13 at line ~670 for the gate on infrastructure prereqs).
- **Predecessors on `origin/main`:** U3d, U4 (#546), U6 (#549), U7 (#551), U8 (#553), U9 (#555 merging at time of writing), U10 (#554) all merged.
- **Files touched by this slice:**
  - `apps/admin/src/gql/gql.ts`, `apps/admin/src/gql/graphql.ts` (codegen drift if any)
  - `apps/mobile/lib/gql/gql.ts`, `apps/mobile/lib/gql/graphql.ts` (codegen drift if any)
  - `apps/cli/src/gql/gql.ts`, `apps/cli/src/gql/graphql.ts` (codegen drift if any)
  - `terraform/schema.graphql` (schema:build drift if any)
  - `scripts/smoke-thread-cleanup.sh` (new)
