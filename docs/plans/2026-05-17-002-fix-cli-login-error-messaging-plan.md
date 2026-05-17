---
status: active
date: 2026-05-17
type: fix
title: "fix(cli): make login/tenant errors lead with the actual fix"
origin: docs/brainstorms/2026-05-17-thinkwork-cli-roadmap-completion-requirements.md
depth: lightweight
---

# fix(cli): make login/tenant errors lead with the actual fix

## Summary

Ship the first two existing-surface fixes called out as **F1** and **F2** in the parent brainstorm (see origin: `docs/brainstorms/2026-05-17-thinkwork-cli-roadmap-completion-requirements.md`). The implementation is already complete in the worktree at `.claude/worktrees/cli-login-error-fix` (branch `fix/cli-login-error-messaging`, off `origin/main`). This plan covers the ship pipeline — commit, push, PR, CI watch, merge, and post-merge deploy watch — for the LFG flow that fired alongside it.

## Problem Frame

Two friction points on the **implemented** CLI surface, both surfaced when the user ran `thinkwork eval`:

- **F1** — `thinkwork login` is verb-overloaded: with no `--stage` flag it runs deploy-side (AWS profile picker for terraform shellouts); with `--stage <s>` it runs API-side (Cognito OAuth + tenant resolution). The two modes share one verb with no scent trail. A user who finishes deploy-login and then runs any API-side command (e.g. `thinkwork eval`) hits an unfriendly tenant-resolve error with nothing pointing them back to `thinkwork login --stage <s>`.
- **F2** — The tenant-unresolved error currently reads *"Pass `--tenant <slug>`, set `THINKWORK_TENANT`, or run `thinkwork login --stage dev`."* The actual fix that 90% of users need is buried as comma-separated option 3, after two flag suggestions almost no one would prefer.

The fix introduces a new `printMissingApiSessionError(stage, hasSession)` helper in `apps/cli/src/ui.ts` and wires it into all three sites that emit the legacy comma-list error (`apps/cli/src/lib/resolve-tenant.ts`, `apps/cli/src/commands/eval/helpers.ts`, `apps/cli/src/commands/wiki/helpers.ts`). It branches on whether a session exists so the diagnosis matches reality. Separately, `apps/cli/src/commands/login.ts` gains a "Next:" hint appended to the deploy-side login success output, pointing at the API-side login the user almost certainly needs next.

## Scope

### In scope

- The 5 already-implemented source edits in the worktree.
- The parent brainstorm doc (`docs/brainstorms/2026-05-17-thinkwork-cli-roadmap-completion-requirements.md`) included in the same PR so the doc lands alongside the fix it justifies.
- Pre-push local smoke check that the new error renders (best-effort for the deploy-login hint, which needs an AWS profile to fully reproduce).
- Standard ship pipeline: commit → push → PR → CI watch → squash-merge → branch + worktree cleanup → post-merge Deploy watch.

### Out of scope (deferred to follow-up work)

- Implementing any of the 25 stub commands from the brainstorm.
- Updating `apps/cli/README.md` or `docs/src/content/docs/applications/cli/commands.mdx`. Neither quotes the legacy error wording, and both already explain the two-mode login. No doc edits required for this PR.
- Refactors beyond the new helper.
- A live e2e test against a deployed stage's API. The vitest suite (`apps/cli/__tests__/`) is the validation surface; the user explicitly accepted CI as validation in the LFG invocation.

## Key Technical Decisions

- **One commit, not two.** Source edits + brainstorm doc go in a single commit. The brainstorm is the durable record of *why* these specific edits exist; splitting them would weaken the trail. Conventional-commit subject: `fix(cli): make login/tenant errors lead with the actual fix`.
- **Squash-merge as soon as CI is green.** Per memory `feedback_merge_prs_as_ci_passes` (v1 pre-launch default: squash-merge + delete branch + clean worktree the moment the 4 checks go green). User explicitly authorized merge in the LFG prompt.
- **Worktree cleanup is part of the ship pipeline**, not a separate step. Per memory `feedback_cleanup_worktrees_when_done`.
- **Post-merge Deploy run is watched**, not assumed green. Per memory `feedback_watch_post_merge_deploy_run` — pre-merge CI doesn't run terraform apply, so silent post-merge Deploy failures skip every downstream job.

## Implementation Units

### U1. Local pre-push smoke

**Goal:** Verify the new error message and the deploy-login "Next:" hint render correctly before push, so we don't burn a CI cycle on a typo.

**Requirements:** Validates F1 (login hint) and F2 (tenant-error rewrite) end-to-end at runtime, not just at the typecheck/test level.

**Dependencies:** none.

**Files:** none modified.

**Approach:**

- Build the CLI in the worktree: `pnpm --filter thinkwork-cli build`.
- Invoke the built binary against a non-existent stage to trigger the F2 path: `node apps/cli/dist/cli.js eval --stage doesnotexist`. Expect the new multi-line block leading with `To fix:  thinkwork login --stage doesnotexist` rather than the legacy comma list.
- For F1, the deploy-login success path needs an AWS profile; if one is available, run `node apps/cli/dist/cli.js login` and visually confirm the appended "Next:" hint. If not, fall back to reading the rendered code path in `apps/cli/src/commands/login.ts` and confirming the new lines exist. Treat this half as best-effort, not blocking.

**Verification:** F2 message renders with the new shape; F1 hint either renders (if AWS profile present) or is confirmed via source read.

**Test scenarios:**

- Covers F2. `node apps/cli/dist/cli.js eval --stage doesnotexist` exits non-zero AND prints `No API session for stage "doesnotexist".` as the bold-red first line, followed by `To fix:  thinkwork login --stage doesnotexist` on its own line.
- Covers F1 (best-effort). When a default AWS profile exists, `node apps/cli/dist/cli.js login` after success prints the new `Next:` block referencing `thinkwork login --stage <stage>` with `eval`, `agent`, `thread` named as examples.

### U2. Commit, push, PR

**Goal:** Land the change on `fix/cli-login-error-messaging` with a PR body that names F1/F2, links the brainstorm, and tells the next reviewer everything they need.

**Requirements:** Ship pipeline gate before CI watch.

**Dependencies:** U1.

**Files:**

- Staged: `apps/cli/src/ui.ts`, `apps/cli/src/lib/resolve-tenant.ts`, `apps/cli/src/commands/eval/helpers.ts`, `apps/cli/src/commands/wiki/helpers.ts`, `apps/cli/src/commands/login.ts`, `docs/brainstorms/2026-05-17-thinkwork-cli-roadmap-completion-requirements.md`.

**Approach:**

- Single commit, conventional subject `fix(cli): make login/tenant errors lead with the actual fix`, body that includes a short before/after of the two messages and a link back to the brainstorm doc.
- Push to origin with `git push --set-upstream origin fix/cli-login-error-messaging`.
- Open PR via `gh pr create --base main` with a body containing: Summary (F1+F2), Why (the eval bug Eric just hit), Before/after error snippets, Test plan (CI + manual smoke), and a link to the brainstorm doc.

**Verification:** `gh pr view --json url,number,state` returns an open PR targeting `main`.

**Test scenarios:** Test expectation: none — this unit is the ship operation itself; no new unit tests required (vitest suite already covers the helper and call sites at U0 with 173/173 green).

### U3. CI watch (and autofix loop is owned by LFG step 8)

**Goal:** Confirm all 4 required PR checks go green. If any fail, the LFG pipeline's own autofix loop (step 8) handles fixes; this unit just defines the success criterion.

**Requirements:** Gate before merge per `feedback_merge_prs_as_ci_passes`.

**Dependencies:** U2.

**Files:** none modified at this unit unless CI fixes are needed (handled by LFG step 8, not specced here).

**Approach:**

- `gh pr checks --watch` until exit 0.
- If any check fails, LFG step 8 takes over (read `gh run view <id> --log-failed`, diagnose, fix, push, re-watch — up to 3 iterations).

**Verification:** `gh pr checks` exits 0 with all 4 required checks green.

**Test scenarios:** Test expectation: none — verification is the existing CI suite.

### U4. Squash-merge and clean up

**Goal:** Merge the PR, delete the branch, remove the worktree.

**Requirements:** Closes the ship loop per `feedback_merge_prs_as_ci_passes` and `feedback_cleanup_worktrees_when_done`.

**Dependencies:** U3.

**Files:** none modified.

**Approach:**

- `gh pr merge <number> --squash --delete-branch`.
- From the primary checkout: `git worktree remove .claude/worktrees/cli-login-error-fix` (add `--force` only if the worktree dir is clean and remove without `--force` declines).
- `git branch -D fix/cli-login-error-messaging` if it still exists locally after delete-branch (it usually does for the local copy).

**Verification:** PR state is `MERGED`; worktree dir no longer exists; local branch is gone.

**Test scenarios:** Test expectation: none.

### U5. Post-merge Deploy watch

**Goal:** Catch silent post-merge Deploy failures per `feedback_watch_post_merge_deploy_run`. Pre-merge CI doesn't run terraform apply; the post-merge `Deploy` workflow on `main` is the real backstop, and it can fail silently while every downstream job skips.

**Requirements:** Closes the operational loop.

**Dependencies:** U4.

**Files:** none modified.

**Approach:**

- After merge, identify the post-merge Deploy run on `main`: `gh run list --branch main --workflow Deploy --limit 1`.
- Watch it: `gh run watch <id>` (or poll status if `watch` isn't appropriate).
- If it fails: read the failed step's logs and surface to the user. Do NOT auto-fix Deploy failures inside this ship pipeline — those are infra/terraform concerns that need explicit user attention.

**Verification:** Deploy run on `main` completes with status `success`. If failure, the run URL and the failing-step name are surfaced.

**Test scenarios:** Test expectation: none.

## System-Wide Impact

- **CLI user experience.** The three error sites improve immediately for any user who lands on them after merge + dev deploy. The deploy-login hint surfaces for every operator running `thinkwork login` without `--stage`.
- **CLI release.** No version bump in this PR (no new commands, no breaking output contract). A future patch release (`thinkwork-cli@0.9.3`) picks these up via the normal publish pipeline.
- **Docs.** README and commands.mdx unchanged — neither quoted the legacy wording and both already explain the two-login-mode distinction. The "Authentication" docs improvement noted in R11 of the brainstorm stays deferred.
- **Other CLI commands.** All API-side commands (`mcp`, `tools`, `me`, etc.) that bottom out at `resolve-tenant.ts` get the improved error for free. The two helpers (`eval`, `wiki`) are the only commands that didn't go through `resolve-tenant.ts` and needed the direct change.

## Risks

- **F1 hint wording.** The "Next:" hint is appended unconditionally to every deploy-login success — including for users who never need an API session (e.g., pure infra operators running `thinkwork plan/deploy/destroy`). Risk: minor noise. Mitigated by keeping the hint two lines, dim-cyan styled rather than red/error, and explicitly framed as "if you also need."
- **F2 helper differentiation.** `printMissingApiSessionError(stage, hasSession)` distinguishes "no session at all" from "session but no tenant." If a caller passes the wrong `hasSession` value, the user sees the wrong-shaped error. Mitigated by deriving `hasSession` at each call site directly from `loadStageSession(stage) !== null`, which is what the surrounding code was already doing.
- **No live API e2e test.** A real eval against a deployed stage would catch any regression in the eval flow's tenant-resolution path. Accepted as residual; the existing vitest suite plus U1's runtime smoke is the floor.

## Patterns Followed

- `printError` (`apps/cli/src/ui.ts`) for the primary error line, with explicit `console.log` calls for the multi-line follow-up — same shape used by `finalizeAws` in `apps/cli/src/commands/login.ts:208-219`.
- `chalk.bold(...)` for the actionable line, `chalk.dim(...)` for the secondary guidance — matches the existing CLI tone (`apps/cli/src/ui.ts`, `apps/cli/src/commands/login.ts`).
- Single helper called from all sites of a repeated pattern — same DRY shape as the existing `requireTty` (`apps/cli/src/lib/interactive.ts`) and `resolveStage` (`apps/cli/src/lib/resolve-stage.ts`).

## Deferred to Follow-Up Work

- Update `apps/cli/README.md` "Authentication" section to recommend `thinkwork user api-key create` + `$THINKWORK_API_KEY` for scripted/daily use (R11 in brainstorm).
- Add an "Authentication" section to `docs/src/content/docs/applications/cli/commands.mdx` that links to the README pattern.
- Live API e2e: run `thinkwork eval seed` + `thinkwork eval run --category <name>` against `dev` from the primary checkout (after merge + Deploy) to confirm the eval flow Eric originally hit now works clean. Owner: Eric (or next ce-work pass).

## Verification (Plan-Level)

- PR merged to `main` via squash.
- Post-merge Deploy run on `main` status: `success`.
- Worktree `.claude/worktrees/cli-login-error-fix` removed.
- Local branch `fix/cli-login-error-messaging` deleted.
- Memory updated: `project_cli_roadmap_completion_brainstorm.md` gains a line noting F1+F2 shipped in PR #N.
