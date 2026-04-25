---
title: "Merge PR #588 and verify post-deploy AgentCore image check passes"
type: fix
status: active
date: 2026-04-25
---

# Merge PR #588 and verify post-deploy AgentCore image check passes

## Overview

PR #587 (U31 admin-gate Cognito-sub regression fix) is already merged and live in dev. The post-deploy "Verify AgentCore runtime image" step on that merge run reported a **false-negative** drift warning and failed the deploy-summary job in `--strict` mode, even though every real deploy job succeeded (Terraform Apply, Build & Deploy Admin, Build Lambdas, Migration Drift Check). PR #588 adds `fetch-depth: 0` to the `deploy-summary` job's `actions/checkout@v4` so `scripts/post-deploy.sh`'s `git cat-file -e <sha>^{commit}` can resolve prior commits.

This plan covers the remaining work: get #588 merged and confirm the next deploy run lands the verifier in the green.

---

## Problem Frame

`scripts/post-deploy.sh` calls `image_contains_source_sha`, which runs:

```bash
git cat-file -e "${image_sha}^{commit}" || return 1
git cat-file -e "${source_sha}^{commit}" || return 1
git merge-base --is-ancestor "$source_sha" "$image_sha"
```

In a default `actions/checkout@v4` (depth=1), only the merge-commit at HEAD is present locally. When the merging PR didn't touch container paths, both `image_sha` and `source_sha` point at an *earlier* commit (here `8426121` — PR #585). `cat-file -e` then fails on a perfectly clean state, the function returns 1, the verifier emits "image does not include required source sha" with the **same sha on both sides**, and `--strict` fails the deploy-summary job.

PR #585 already fixed this for the `detect-changes` job by adding `fetch-depth: 0`. The same line was missing on `deploy-summary`. PR #588 supplies it.

---

## Requirements Trace

- R1. PR #588 merges to `main` with all required PR checks green.
- R2. The first post-merge deploy run shows the `Verify AgentCore runtime image` step pass (or warn-without-failing) for the active strands runtime.

---

## Scope Boundaries

- Not changing the verification logic in `scripts/post-deploy.sh`. The shallow-clone fix is the workflow-level half of belt-and-suspenders; script hardening is a separate possible follow-up the user explicitly declined for this PR.
- Not introducing new tests in `scripts/post-deploy.test.sh` — the existing `test_active_runtime_with_min_source_sha_passes` and `test_stale_active_runtime_with_min_source_sha_fails` cases already exercise the function with the local commit graph; the bug is environmental (shallow clone), not logic.
- Not auditing other workflow jobs for the same shallow-clone trap. If any others run `git cat-file` against ancestor commits, they would surface as separate failures and be addressed individually.

---

## Context & Research

### Relevant Code and Patterns

- `.github/workflows/deploy.yml:37-40` — `detect-changes` already pairs `actions/checkout@v4` with `with: fetch-depth: 0` for the same reason.
- `.github/workflows/deploy.yml:598` — the line PR #588 changes.
- `scripts/post-deploy.sh:80-94` — the function whose `git cat-file` calls require non-shallow history.

### Institutional Learnings

- `docs/solutions/runtime-errors/stale-agentcore-runtime-image-entrypoint-not-found-2026-04-25.md` — documents PR #585's verifier design and the `fetch-depth: 0` requirement, but the solution doc only references the `detect-changes` checkout. PR #588 closes that gap on the summary side.

### External References

- None needed — this is a one-line GHA change with a well-understood failure mode.

---

## Key Technical Decisions

- **Workflow fix only, no script hardening.** Mirroring `detect-changes`'s `fetch-depth: 0` is the smallest, most local change. The user explicitly chose this option over also adding equality short-circuit / shallow-safe handling inside `image_contains_source_sha`. If the same false negative surfaces in another job later, harden the script then.

---

## Open Questions

### Resolved During Planning

- *Should `image_contains_source_sha` short-circuit on equal shas?* Deferred — user picked the workflow-only option.

### Deferred to Implementation

- None. PR #588 is already pushed; the only execution-time question is whether the verifier passes on the next merge-driven deploy, which Unit 2 confirms.

---

## Implementation Units

- U1. **Merge PR #588**

**Goal:** Land the `fetch-depth: 0` fix on `main`.

**Requirements:** R1.

**Dependencies:** None — all 4 PR checks are green and `mergeStateStatus` is `CLEAN`.

**Files:**
- Modify: `.github/workflows/deploy.yml` (already changed in the PR; merging only)

**Approach:**
- Use `gh pr merge 588 --squash --delete-branch` (project convention from memory `feedback_merge_prs_as_ci_passes`: squash + delete branch as soon as the 4 checks go green).
- Squash-merge collapses the single commit anyway; `--delete-branch` cleans up `fix/post-deploy-fetch-depth` per the worktree-isolation memory.

**Patterns to follow:**
- Same merge command pattern used for #587 earlier this session.

**Test scenarios:**
- Happy path: `gh pr merge 588 --squash --delete-branch` returns success → `gh pr view 588 --json state` reports `MERGED`.
- Edge case: if a check has flipped to `FAILURE` between this plan and the merge attempt, abort and surface the failing check rather than retrying.

**Verification:**
- `gh pr view 588 --json state,mergedAt` reports `state=MERGED` with a recent `mergedAt`.
- `git fetch origin main && git log --oneline origin/main -3` shows the merge commit at HEAD.

---

- U2. **Confirm next post-deploy run passes the AgentCore image verifier**

**Goal:** Prove R2 — the false-negative is gone on the deploy triggered by U1's merge.

**Requirements:** R2.

**Dependencies:** U1.

**Files:** None (observation only).

**Approach:**
- Watch the deploy run kicked off by the U1 merge with `gh run watch <id>` (or `gh pr checks 588 --watch` until the merge run finishes — the post-deploy job is in the same workflow).
- On completion, verify the `Verify AgentCore runtime image` step exits 0 and logs `ok thinkwork_dev_strands_<id>` for the SSM-active runtime.
- If the step still fails with the same false-negative shape (`image sha=X does not include required source sha=X` with X identical on both sides), the workflow fix didn't take — escalate by investigating script behavior, not by re-merging.

**Test scenarios:**
- Happy path: Verify AgentCore runtime image step → conclusion `success`; log line `ok thinkwork_dev_strands_*` present for the active runtime.
- Edge case: a *real* drift warning (different shas) is acceptable and means the verifier is now working correctly — note it but don't treat it as a regression of this fix.
- Error path: any other job in the deploy run fails (e.g., Terraform Apply, Build & Deploy Admin) — out of scope for this plan; surface to the user.

**Verification:**
- `gh run view <run-id> --log | grep "Verify AgentCore"` shows `ok` for the active strands runtime and the job conclusion is `success`.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Deploy run kicked off by U1's merge fails for an unrelated reason (CI flake, AWS rate-limit). | Re-run the failed job; do not amend or re-merge unless the failure recurs and points back at this fix. |
| The `fetch-depth: 0` change interacts badly with caching or makes the summary job materially slower. | Acceptable — `detect-changes` already fetches full history and runtime is a small fraction of the deploy total; reverting is a one-line change if observed. |
| A second job in the workflow has the same shallow-clone trap and also fails the verifier on a future deploy. | Out of scope here; address case-by-case as it appears, with the same one-line fix or by hardening `scripts/post-deploy.sh` (the option the user declined for now). |

---

## Sources & References

- PR #588: https://github.com/thinkwork-ai/thinkwork/pull/588
- Failing run: https://github.com/thinkwork-ai/thinkwork/actions/runs/24935041241
- PR #585 background: `docs/solutions/runtime-errors/stale-agentcore-runtime-image-entrypoint-not-found-2026-04-25.md`
- Modified file: `.github/workflows/deploy.yml`
- Related script: `scripts/post-deploy.sh`
