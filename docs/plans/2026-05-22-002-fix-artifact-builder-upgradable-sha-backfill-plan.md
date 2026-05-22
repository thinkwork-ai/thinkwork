---
title: "fix: backfill artifact-builder upgradable SHA history"
type: fix
status: active
created: 2026-05-22
---

# Backfill Artifact Builder Upgradable-SHA History

## Problem Frame

`ensureArtifactBuilderDefaults` in `packages/api/src/lib/computers/artifact-builder-defaults.ts` decides whether to overwrite an agent's workspace `SKILL.md` (or `references/crm-dashboard.md`) by checking the existing content's SHA256 against a hand-maintained `UPGRADABLE_ARTIFACT_BUILDER_SHA256_BY_PATH` set. Five historical SHAs are registered for `SKILL.md`; two for `crm-dashboard.md`. The set is incomplete.

Eric's Computer agent in dev (tenant `sleek-squirrel-230`, agent `fleet-caterpillar-456`) is materialized with a `SKILL.md` whose SHA256 is `4281155ec9c4b488d45d494d959765be3c2ac503f04a069334b09b711c4d988e` — that SHA was never registered, so every dispatch silently classifies the file as `skipped` (custom content). PR #1550 shipped a fix to the on-demand shadcn-lookup contract, but Eric's agent never received it. Two dev test threads (`fc4328eb`, `3cbeb92b`) timed out the chat-agent-invoke Lambda at 5 min because they were still loading the old fanout-prone SKILL.md.

The same drift class hits `crm-dashboard.md`. Any agent that was materialized between two registered-SHA windows is permanently stranded.

## Goals

- Every historical version of `packages/workspace-defaults/files/skills/artifact-builder/SKILL.md` that ever shipped on `main` is treated as an upgradable platform default.
- Same for `packages/workspace-defaults/files/skills/artifact-builder/references/crm-dashboard.md`.
- Drift never recurs: the next time someone edits one of these files without registering the immediate-prior SHA, CI fails the parity test rather than silently stranding agents.

## Non-Goals

- Do NOT change the upgrade strategy to "always overwrite platform-default path." Agents may legitimately customize their workspace files; the SHA check protects against clobbering that custom content.
- Do NOT introduce a YAML/JSON manifest for SHA history. Keep it as a TS `Set<string>` literal in the same file, machine-readable, one line per historical SHA with a commit-hash comment.
- Do NOT proactively run `ensureArtifactBuilderDefaults` from `chat-agent-invoke`. It already runs from `dispatchComputerThreadTurn`, which is the correct trigger.
- Do NOT change which files the function manages. `SKILL.md` and the CRM dashboard reference stay in scope; nothing else gets added.

## Key Technical Decisions

1. **SHAs are inlined as static literals, not computed at runtime.** Computing via `git show` at function-call time would require shipping `.git` into the Lambda — not viable. Computing at build time would add complexity to the bundle. A static `Set<string>` is what already exists; we're just backfilling it.

2. **Each historical SHA carries a one-line `// commit <short-sha>: <subject>` comment.** Future readers can reverse-trace each SHA to the commit that introduced it without re-walking history.

3. **Parity is enforced by a new test that walks `git log` at test time** and asserts every historical SHA at HEAD-of-each-commit appears in the upgradable set. The test reads from the repo's `.git` (available in CI and locally) and writes nothing. When someone edits `SKILL.md` or `crm-dashboard.md` without registering the immediate-prior SHA, this test fails with a clear "add SHA X to the set for path Y" message.

4. **The current-HEAD SHA is intentionally excluded** from the upgradable set. The upgradable set means "if S3 has this content, overwrite it with the current default." Including the current SHA would create a no-op upgrade path (S3 content already matches what we'd write). The test must exclude the HEAD-commit version of each file when checking set membership.

5. **The test reads git history via `simple-git` or `child_process.execSync('git log ...')`.** The repo already shells out to git in build scripts; no new dependency needed.

## Implementation Units

### U1. Backfill historical SHAs into `UPGRADABLE_ARTIFACT_BUILDER_SHA256_BY_PATH`

**Goal:** every prior `SKILL.md` and `crm-dashboard.md` version that ever existed on `main` is registered as an upgradable platform default.

**Files:**

- `packages/api/src/lib/computers/artifact-builder-defaults.ts` (modify the existing `UPGRADABLE_ARTIFACT_BUILDER_SHA256_BY_PATH` Set literal)

**Approach:**

1. Run `git log --pretty=format:%H -- <path>` for each path to enumerate commits.
2. For each commit, run `git show <commit>:<path> | sha256sum` to compute the content SHA at that commit.
3. Deduplicate the resulting SHA list.
4. Exclude the SHA of the current HEAD content (this is what `loadDefaults()` would write; including it produces a no-op-overwrite that wastes an S3 PUT on every dispatch).
5. Add each remaining unique SHA as a literal in the `Set` with a `// <short-sha>: <commit subject>` comment.

Expected outcome: ~15 SHAs for `SKILL.md` (currently has 5), ~12 SHAs for `crm-dashboard.md` (currently has 2). The orphan SHA `4281155ec9c4b488d45d494d959765be3c2ac503f04a069334b09b711c4d988e` will be among them.

**Patterns to follow:**

- The existing five entries in the Set use the format `// PR #NNN <one-line description>`. New entries should use `// <short-sha> <commit subject>` since not all historical commits are tied to a PR (some are direct pushes).

**Test scenarios:** This unit is content-only. The behavioral assertion lives in U2.

**Verification:**

- Function compiles.
- `pnpm --filter @thinkwork/api test -- src/lib/computers/artifact-builder-defaults.test.ts` still passes (existing tests pin specific cases that should still work).

---

### U2. Parity test: every historical platform-default SHA must be in the upgradable set

**Goal:** drift is mechanically prevented. If a future PR edits `SKILL.md` or `crm-dashboard.md` without registering the immediate-prior SHA, this test fails with an actionable diff.

**Files:**

- `packages/api/src/lib/computers/artifact-builder-defaults.history.test.ts` (new file — keeps it separate from the existing unit-mock test which mocks `@aws-sdk/client-s3` and `@thinkwork/database-pg`)

**Approach:**

1. Test enumerates commits for each managed path via `git log --pretty=format:%H -- <path>`.
2. For each commit, fetch the content via `git show <commit>:<path>` and compute SHA256.
3. Exclude the HEAD-commit content SHA.
4. Assert each remaining SHA appears in the `UPGRADABLE_ARTIFACT_BUILDER_SHA256_BY_PATH` set for that path.
5. On failure, the assertion message names the missing SHA plus the commit it came from so the fix is one comment + one line: "add `// <short-sha> <subject>` to the set for <path>".

**Approach note on cross-platform `git`:** the test must work on macOS, Linux CI, and Windows-WSL. `child_process.execFileSync('git', ['log', ...])` is the portable form. The CI image already has `git` available (used by checkout actions); local dev is the same.

**Approach note on shallow clones:** GitHub Actions checkout defaults to depth 1, which means only HEAD has history. The test must either (a) use `actions/checkout@v4` with `fetch-depth: 0` in the workflow file that runs this test, or (b) detect a shallow clone and skip with a clear "this test requires full git history; CI workflow needs fetch-depth: 0" message rather than silently passing.

Decision: option (b) — skip-with-clear-message. Forcing every CI workflow to `fetch-depth: 0` slows other jobs that don't need history. The skip message is loud enough that an operator who removes `fetch-depth: 0` from the relevant workflow will know to add it back.

**Patterns to follow:**

- Other `.test.ts` files in `packages/api/src/lib/` for vitest structure.
- `packages/workspace-defaults/src/__tests__/parity.test.ts` is conceptually similar (it walks the filesystem to verify inline string constants match `.md` source files). The new test walks git history rather than the filesystem, but the spirit — "the assertion is computed from a source of truth, not hand-maintained" — is the same.

**Test scenarios:**

- **Happy path:** with full git history available, the test enumerates all historical SHAs for both managed paths, excludes the HEAD-commit SHA, and asserts every remaining SHA is present in the upgradable set. After U1 ships, this passes green.
- **Drift detection (negative):** simulated by temporarily removing a SHA from the set in a fixture variant — the assertion fails with a message naming the missing SHA and source commit. (Implementation: not a separate test case; verified manually during U2 authoring by deleting one SHA and confirming the failure message is readable.)
- **Shallow-clone skip:** when `.git/shallow` exists (or `git rev-parse --is-shallow-repository` returns `true`), the test calls `it.skip` (or vitest equivalent) with a message pointing the operator at `fetch-depth: 0`. (Implementation: covered by a `beforeAll` guard that throws-to-skip when shallow.)

**Verification:**

- `pnpm --filter @thinkwork/api test -- src/lib/computers/artifact-builder-defaults.history.test.ts` passes against the full-history checkout.
- Manually verify: temporarily delete the orphan SHA `4281155ec9c4b488d45d494d959765be3c2ac503f04a069334b09b711c4d988e` from the Set after U1 — the test fails with a message naming that SHA and commit `dd570705` (or whichever commit it actually came from).

---

### U3. Backfill Eric's stranded dev agent

**Goal:** Eric's specific Computer agent that's stuck on the orphan SHA gets the new `SKILL.md` even before the next `ensureArtifactBuilderDefaults` dispatch. (I already did this manually via `aws s3 cp` during the troubleshooting session; this unit documents that step so it's reproducible and reviewable.)

**Files:** none (operational step, not code).

**Approach:** documented in the PR description as a one-liner — `aws s3 cp` of the post-merge SKILL.md from main to the agent's workspace S3 path. Confirms the path-construction logic that `ensureArtifactBuilderDefaults` would have used.

**Test scenarios:** none — this is a one-time data fix on dev only.

**Verification:** Eric starts a fresh thread, sees ~5-8 sequential `get_component_source` calls rather than 31 parallel, turn completes under 5 min.

This unit is **optional** and may be dropped if Eric prefers to verify the U1+U2 fix path end-to-end (where the next thread dispatch triggers the auto-upgrade via the now-complete SHA set). Either way the systemic fix is U1+U2.

## Scope Boundaries

- In scope: backfill historical SHAs for the two managed paths; add a parity test that prevents recurrence.
- Out of scope: any other workspace-default file's drift story (`AGENTS.md`, `USER.md`, `CONTEXT.md`, etc.). Those don't currently use the upgradable-SHA pattern. If they ever need it, copy this pattern.

### Deferred to Follow-Up Work

- Replacing the SHA-based upgrade strategy with a different mechanism (e.g., a "platform-version stamp" on each managed file). The hand-maintained set is brittle; this plan fixes the immediate symptom by mechanically completing it. A separate brainstorm/plan can revisit the strategy if drift continues to bite.
- Wiring `ensureArtifactBuilderDefaults` (or a similar ensure function) into more code paths. Currently it runs only from `dispatchComputerThreadTurn`. If non-Computer paths ever need to ensure these defaults, that's a separate change.

## Risks & Mitigations

| Risk                                               | Mitigation                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test fails in CI because the checkout is shallow   | Skip-with-clear-message guard (U2 approach note).                                                                                                                                                                                                                                                                                                                             |
| Walking git history is slow                        | Two paths × ~15 commits each = ~30 `git show` calls per run. Bounded; on the order of 100-200ms locally. Acceptable for a unit test.                                                                                                                                                                                                                                          |
| A new SKILL.md edit lands without updating the set | U2's test fails the PR's CI with a single-line fix instruction. The cost of fixing drift is one comment + one line per edit.                                                                                                                                                                                                                                                  |
| The HEAD-commit SHA is accidentally included in U1 | U2's HEAD-exclusion check catches it — including the HEAD SHA would mean the set contains a SHA that the test explicitly excludes, which is fine for correctness but represents a wasted entry. A weaker assertion in U2 (presence-only, no HEAD exclusion) would let it pass; the spec-compliant version of U2 catches it via a "set should not contain HEAD SHA" assertion. |

## System-Wide Impact

- The function `ensureArtifactBuilderDefaults` is called from `dispatchComputerThreadTurn` in `packages/api/src/lib/computers/thread-cutover.ts`. After this plan ships, the first dispatch for every stranded agent will trigger one extra S3 PUT (the upgrade) and emit a `computer_events` row noting the update. This is the intended behavior; no other code paths are affected.
- No GraphQL schema changes.
- No database migrations.
- No Lambda config changes.

## Verification

Sequence to confirm end-to-end success:

1. `pnpm --filter @thinkwork/api test` — all existing tests pass plus the new history test.
2. `pnpm --filter @thinkwork/api run typecheck` — clean.
3. After deploy: Eric's stranded agent (if U3 is skipped) triggers an upgrade on its next thread dispatch — confirmed by checking S3 file modification time and the `computer_events` insert.
4. Eric runs the same crm-dashboard prompt on a fresh thread, observes ~5-8 sequential `get_component_source` calls and a turn time under 5 min.
