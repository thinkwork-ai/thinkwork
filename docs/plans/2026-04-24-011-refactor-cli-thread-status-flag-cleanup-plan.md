---
title: CLI thread — drop status/priority/type flags + shortcut commands (U10)
type: refactor
status: active
date: 2026-04-24
origin: docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md
---

# CLI thread — drop status/priority/type flags + shortcut commands (U10)

## Overview

Carves U10 out of the pre-launch thread-detail cleanup plan (`docs/plans/2026-04-24-002-*`, lines 632–656) into a standalone slice. U3d retired the writable `status`/`priority`/`type` axes; U4 shipped the derived `lifecycleStatus`. The CLI still exposes task-era flags on `thinkwork thread ...` — mostly in help text since the command bodies are still `notYetImplemented` stubs — but the surface itself (flag declarations, help examples, subcommands that are defined purely as "shortcut for `--status X`") needs to come down before v1.

This slice:

1. Drops `--status` from `thread list`, `thread update`, and `thread release`.
2. Removes `thread close` and `thread reopen` — their descriptions are literally "Shortcut for `thread update <id> --status DONE`" / "Move a thread from DONE/CANCELLED back to TODO". With status gone, they have no meaning in the new derived-lifecycle model.
3. Scrubs help-text examples referencing the removed flags and statuses.
4. Regenerates CLI codegen for cleanliness (no schema change in this slice; server-side `threadsPaged(statuses: [String!])` and `ThreadStatus` enum stay on the server).

Parent plan U10 also lists `--priority` and `--type` — **a filesystem scan shows neither flag exists in `apps/cli/src/commands/thread.ts` today**, so the scope shrinks to `--status` + the two status-shortcut commands + help text.

---

## Problem Frame

`thinkwork thread list --status IN_PROGRESS` implies a writable status axis that no longer exists as a product concept. The admin SPA stopped surfacing it in U7 (#551), and the mobile sweep (U9) will do the same. Leaving the CLI flag in place:

- Confuses operators into thinking they can filter by a server-supported axis that is actually retired.
- The `--status` flag's stub body (`notYetImplemented`) would silently succeed if run against the production Lambda, returning a "not yet implemented" stub message — so no real harm today, but the stub-by-stub removal should happen before anyone actually wires up the action bodies and accidentally wires them against the retired axis.
- `thread close` and `thread reopen` are wholly status-dependent. Their descriptions and help text lean entirely on `DONE`/`TODO`/`CANCELLED` state names. Shipping v1 with subcommands that reference nonexistent states is incoherent.

The corresponding agent path (`update_thread_status` skill in `agent-thread-management`, backed by `updateThread(input: { status })` GraphQL mutation) is untouched — server-side `ThreadStatus` stays in place and the mutation still accepts it. Agents keep their capability; the CLI just stops offering the task-era UI for it.

---

## Requirements Trace

- R1. `rg '\-\-status' apps/cli/src/commands/thread.ts` returns zero hits after this slice.
- R2. `rg '\-\-priority|\-\-type' apps/cli/src/commands/thread.ts` returns zero hits (these flags don't exist today — confirmation after edits).
- R3. `thread close` and `thread reopen` subcommands are deleted from the command registrar.
- R4. Help text examples no longer reference `IN_PROGRESS`, `IN_REVIEW`, `DONE`, `CANCELLED`, `BACKLOG`, `TODO`, or `BLOCKED` as CLI state names.
- R5. The `registration-smoke.test.ts` file at `apps/cli/__tests__/registration-smoke.test.ts` still passes — specifically, `thread list` subcommand registration continues to work.
- R6. CLI codegen is regenerated; the resulting diff is small and bounded to legitimate schema reflection (if any net-new changes exist since last regen).
- R7. CLI typecheck + test suite pass without new errors.

**Origin trace:** parent plan R13 (retire task-era thread axes from all client surfaces) — mobile + CLI + admin all share this requirement.

---

## Scope Boundaries

- **Out of scope — server-side `ThreadStatus` enum removal.** The GraphQL schema retains `ThreadStatus` since `threadsPaged(statuses: [String!])` and `updateThread(input: { status })` still accept it. Removing the enum is a coordinated multi-surface change, not this slice.
- **Out of scope — `--priority` / `--type` removal.** These flags don't exist on `thread.ts` today. The parent plan's mention of them predates U3d's merge. No-op confirmation, nothing to remove.
- **Out of scope — adding a `--lifecycle` filter.** Parent plan U10 entertained this as optional (read-only filter pointing at `lifecycleStatus`). `lifecycleStatus` is a derived read field, not a server-side filter arg, so a CLI `--lifecycle` flag would filter client-side after fetching. Not enough value to justify the complexity; defer until a concrete operator use case surfaces.
- **Out of scope — implementing the stub bodies.** All thread subcommands are still `notYetImplemented`. Real GraphQL wiring is Phase 1 work per the file header comment. This slice touches option declarations and help text only.
- **Out of scope — agent/artifact command flags.** Other CLI commands (`agent --status`, `agent --type`, `artifact --status`, `artifact --type`) have their own unrelated `--status`/`--type` flags. Different domains, not part of U10.
- **Out of scope — adjusting the command description on `thread update`.** The description "Update a thread's title, status, assignee, labels, or due date." mentions "status" verbally but the flag itself is removed by this slice. Editing the prose is a P3 polish; leave it for the follow-up that wires up the action bodies.

Actually, re-reading: the description prose is load-bearing enough to fix here — if the flag is gone, the description should match. Move that into scope.

---

## Context & Research

### Relevant Code and Patterns

- `apps/cli/src/commands/thread.ts` — the sole file with `--status` flag declarations, the `thread close`/`thread reopen` subcommands, and the help-text examples. Current state:
  - Line 25: `thread list --status <status>` with help text listing every legacy ThreadStatus value.
  - Lines 36, 39: help examples reference `--status IN_PROGRESS` and `.status=="IN_PROGRESS"` in jq.
  - Line 90: `thread update` description mentions "status" in prose.
  - Line 94: `thread update --status <s>` flag declaration.
  - Line 101: help example references `thread update thr-abc --status IN_REVIEW`.
  - Lines 107–121: `thread close <id>` subcommand — description says "Shortcut for `thread update <id> --status DONE`".
  - Lines 123–128: `thread reopen <id>` subcommand — description says "Move a thread from DONE/CANCELLED back to TODO".
  - Line 147: `thread release` description mentions "optionally moving it to a new status".
  - Line 150: `thread release --status <s>` flag declaration.
- `apps/cli/__tests__/registration-smoke.test.ts` — verifies `thread list` subcommand registers. Expects `expectedSubcommand: "list"`. Safe (`list` is preserved). Lines 42, 116 reference `thread`/`thread list`.
- `apps/cli/src/gql/graphql.ts` — still references `ThreadStatus` (server schema reflection). Unchanged by this slice; codegen regen is cleanup-only.
- Parent plan U10 block at `docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md:632–656`.
- CLI's file-header comment at `apps/cli/src/commands/thread.ts:1–6` explicitly notes: "Scaffolded in Phase 0; action bodies land in Phase 1."

### Institutional Learnings

- `feedback_worktree_tsbuildinfo_bootstrap` — fresh worktree needs `find . -name tsconfig.tsbuildinfo -not -path '*/node_modules/*' -delete && pnpm --filter @thinkwork/database-pg build` before `pnpm --filter @thinkwork/cli typecheck`.
- `feedback_worktree_isolation` / `feedback_pr_target_main` / `feedback_merge_prs_as_ci_passes` — standard pre-launch workflow.
- `feedback_ci_lacks_uv` — CI has no uv on PATH; irrelevant here (pure TypeScript slice).
- No existing learning specifically covers CLI flag deprecation.

### External References

None — localized CLI declaration cleanup; no new library, no new API.

---

## Key Technical Decisions

- **Decision 1: Delete `thread close` and `thread reopen` rather than rewrite.** Both commands are defined purely as status-transition shortcuts. Rewriting them to call `updateThread` with a non-status field would be inventing new semantics the product hasn't chosen. If operators ever want a "mark thread done" shortcut in the new derived-lifecycle model, scope it against real usage signals post-v1.
- **Decision 2: Drop `--status` from `thread update` and `thread release` entirely, not gate it behind a deprecation warning.** All command bodies are `notYetImplemented` — there is no deployed production behavior to preserve. A deprecation shim would be pure cruft. Hard removal is cleaner.
- **Decision 3: Fix the `thread update` description prose to remove "status".** The description appears in `--help` output; mismatch between description and available flags degrades the CLI UX. In scope as a ~1-line edit.
- **Decision 4: Regenerate codegen even though no schema edit is required.** CLAUDE.md calls for codegen regen after GraphQL type edits — which haven't happened here. But running codegen once as cleanup catches any drift between the committed `apps/cli/src/gql/*` and the current schema. If the regen produces an empty diff, the commit is clean; if it produces a drift, that's surfaced and committed. No-op default.
- **Decision 5: Do not add a `--lifecycle` read filter.** Per scope boundary — premature optimization without a concrete use case.
- **Decision 6: Keep `thread release` itself; only drop its `--status` option.** `thread release <id>` is a checkout-release semantic (releases an agent's lock on the thread), independent of status. The `--status` flag was a "release AND set status in one call" affordance; drop the status half, preserve the release half.

---

## Open Questions

### Resolved During Planning

- **Q:** Are `--priority` and `--type` present on `thread.ts` today? **A:** No — parent plan text predates U3d. No-op.
- **Q:** Should `thread close` / `thread reopen` be deleted or rewritten? **A:** Deleted. (Decision 1.)
- **Q:** Should a deprecation warning shim exist? **A:** No. (Decision 2.)
- **Q:** Does the `registration-smoke.test.ts` break when `close` / `reopen` are removed? **A:** No — that file only verifies `thread list` subcommand registration, not `close` or `reopen`.
- **Q:** Does any agent-facing skill depend on these CLI commands? **A:** No — Strands skills call `updateThread(input: { status })` directly via MCP/GraphQL, not through the CLI.
- **Q:** Does codegen regen break anything? **A:** Unlikely — no GraphQL edits in this slice. Verify at implementation time.

### Deferred to Implementation

- **Exact codegen regen diff size.** Run `pnpm --filter @thinkwork/cli codegen` and commit whatever it produces. If it's empty, skip the codegen commit. If it's non-trivial, note in the PR body.
- **Whether to tweak the `thread release` description.** Current: "Release a checked-out thread, optionally moving it to a new status." After flag removal, the "optionally moving it to a new status" clause should go. Simple one-line prose edit.

---

## Implementation Units

- U1. **Remove status flags + status-shortcut subcommands from `thinkwork thread`**

**Goal:** `apps/cli/src/commands/thread.ts` contains no `--status` flag declarations, no `thread close` or `thread reopen` subcommands, and no help-text examples referencing retired ThreadStatus values. Description prose aligns with the surviving flag set.

**Requirements:** R1, R3, R4, R5, R7 (plus R2 confirmation; R6 cleanup).

**Dependencies:** None beyond `origin/main`.

**Files:**
- Modify: `apps/cli/src/commands/thread.ts` — drop flags, drop subcommands, scrub help text, tighten descriptions.
- Modify (codegen regen, optional): `apps/cli/src/gql/gql.ts`, `apps/cli/src/gql/graphql.ts` — only if `pnpm --filter @thinkwork/cli codegen` produces a diff. Skip commit if empty.
- Test: no new tests. Existing `apps/cli/__tests__/registration-smoke.test.ts` covers `thread list` registration and must continue passing.

**Approach:**
- `thread list`:
  - Drop the `--status <status>` option.
  - Scrub the help-text example `$ thinkwork thread list --status IN_PROGRESS` (replace with an `--assignee me` or `--archived` example).
  - Scrub the jq example `.status=="IN_PROGRESS"` → replace with a comparable example or remove.
- `thread update`:
  - Drop the `--status <s>` option.
  - Tighten the command description from "Update a thread's title, status, assignee, labels, or due date." → "Update a thread's title, assignee, labels, or due date."
  - Scrub the help-text example `$ thinkwork thread update thr-abc --status IN_REVIEW`.
- `thread close` subcommand: delete entirely (entire `thread.command("close <id>")...` block, lines ~107–121).
- `thread reopen` subcommand: delete entirely (entire `thread.command("reopen <id>")...` block, lines ~123–128).
- `thread release`:
  - Drop the `--status <s>` option.
  - Tighten the description from "Release a checked-out thread, optionally moving it to a new status." → "Release a checked-out thread (unlocks it so another agent can claim it)."
- Run `pnpm --filter @thinkwork/cli codegen`; if the diff is empty, revert the file mtime touch to avoid a pointless commit hunk.
- Run `pnpm --filter @thinkwork/cli typecheck` and `pnpm --filter @thinkwork/cli test` to verify no regression.

**Execution note:** Mechanical flag + subcommand removal. Standard posture.

**Patterns to follow:**
- Existing help-text style in `apps/cli/src/commands/thread.ts` (backtick-fenced example blocks, leading `$` prompt, interspersed comments).
- `notYetImplemented("thread <subcommand>", 1)` stub pattern for action bodies — unchanged by this slice.

**Test scenarios:**
- `apps/cli/__tests__/registration-smoke.test.ts` — existing test passes unchanged. It exercises `["node", "thinkwork", "thread", "list"]` which no longer has `--status` but the smoke test doesn't pass flags, so it is unaffected.
- *Edge case — attempt a deleted subcommand.* After this PR, invoking `thinkwork thread close thr-abc` should produce commander's "unknown command: close" (or similar) error. No test added; manual verification.
- *Edge case — attempt a deleted flag.* `thinkwork thread list --status IN_PROGRESS` should produce "unknown option: --status" error. No test added; manual verification.
- *Happy path — surviving flags.* `thinkwork thread list --assignee me --limit 10` still parses cleanly. `thinkwork thread update thr-abc --title "new title"` still parses. `thinkwork thread release thr-abc` still parses.

**Verification:**
- `rg '\-\-status' apps/cli/src/commands/thread.ts` returns zero hits.
- `rg 'IN_PROGRESS|IN_REVIEW|BACKLOG|TODO|BLOCKED|DONE|CANCELLED' apps/cli/src/commands/thread.ts` returns zero hits.
- `rg 'close|reopen' apps/cli/src/commands/thread.ts` returns zero matches as subcommand definitions (may still match text inside delete confirmation prose — verify visually).
- `pnpm --filter @thinkwork/cli typecheck` passes with no new errors.
- `pnpm --filter @thinkwork/cli test` passes (registration-smoke specifically).
- `pnpm --filter @thinkwork/cli build` still produces a working bundle if the package has a `build` script; non-blocking if it does not.
- Manual: `thinkwork thread --help` output is clean.

---

## System-Wide Impact

- **Interaction graph:** None. CLI subcommand registrations are leaf nodes. No Lambda handlers, no cross-surface wiring, no background jobs.
- **Error propagation:** Commander.js will now reject the removed flags/subcommands with standard "unknown option"/"unknown command" errors. That's the desired behavior.
- **State lifecycle risks:** None. No persisted state, no config read.
- **API surface parity:** Admin already removed status filter/sort/group (U7, #551 merged). Mobile will remove same in U9. Server-side `ThreadStatus` enum and `threadsPaged(statuses:)` arg remain — other callers (Strands `update_thread_status` skill, direct GraphQL) still work.
- **Integration coverage:** None — no cross-layer behavior changes.
- **Unchanged invariants:** (1) `thread list`, `thread get`, `thread create`, `thread update`, `thread release`, `thread comment`, `thread label`, `thread checkout`, `thread escalate`, `thread delegate`, `thread delete` all continue to register. (2) `update_thread_status` Strands skill is unaffected. (3) GraphQL schema unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Some downstream consumer imports `thread.ts` expecting `close` or `reopen` to be registered. | `rg "thread close\|thread reopen"` across the repo before PR. Codebase-wide search confirms no external imports reference those subcommands; the only consumer is the command registrar itself. |
| CLI codegen regen produces a large drift diff unrelated to this slice. | If that happens, commit the drift as a separate follow-up PR titled `chore(cli): codegen regen drift`. Don't bury it in a U10 commit that would then be confusing to reviewers. |
| `registration-smoke.test.ts` is actually tighter than assumed and tests `close`/`reopen` registration. | Read the file before deleting; verify no hit for close/reopen. Already confirmed at planning time — test only exercises `list` subcommand registration via `expectedSubcommand: "list"` for the thread domain. |
| The CLI is published to npm as `thinkwork-cli`. A user running `npx thinkwork-cli thread close thr-abc` gets a broken command in the next release. | Pre-v1 — the CLI is not widely deployed yet; removing unimplemented subcommands is zero-regression. Worth a one-line note in the PR body. |
| `pnpm --filter @thinkwork/cli test` uses vitest; running in a fresh worktree with stale tsbuildinfo could produce false positives. | Run the standard worktree bootstrap (`feedback_worktree_tsbuildinfo_bootstrap`) before typecheck/test. |

---

## Documentation / Operational Notes

- No external docs reference these CLI subcommands (confirmed: `rg "thread close" docs/src/`).
- No runbook or monitoring updates.
- Post-merge: `thinkwork thread --help` output is the manual validation surface.

---

## Sources & References

- **Origin plan:** `docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md` (U10 block: lines 632–656; R13 context).
- **Predecessors on `origin/main`:** U3d (#539, merged) — dropped status/priority from schema input; U4 (#546, merged) — shipped `lifecycleStatus` resolver; U7 (#551, merged) — admin list view dropped status filter/sort/group; U6 (#549, merged) — admin detail reshaped with `ThreadLifecycleBadge`; U8 (#553, merged) — admin Traces "Open in X-Ray" link.
- **Files touched by this slice:**
  - `apps/cli/src/commands/thread.ts`
  - `apps/cli/src/gql/gql.ts` (codegen; optional)
  - `apps/cli/src/gql/graphql.ts` (codegen; optional)
