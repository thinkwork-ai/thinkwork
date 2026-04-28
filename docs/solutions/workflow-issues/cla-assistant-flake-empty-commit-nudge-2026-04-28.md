---
title: "CLA Assistant action flakes on GitHub 503; empty commit nudges it onto a fresh runner"
module: .github/workflows (CLA gate)
date: 2026-04-28
problem_type: workflow_issue
component: ci
severity: medium
symptoms:
  - "CLA check fails on a PR even though the contributor has signed the CLA"
  - "Action log shows `All contributors have signed the CLA 📝 ✅` immediately followed by `##[error]<!DOCTYPE html>` with `<title>Unicorn! · GitHub</title>`"
  - "Re-running the failed job reproduces the exact same `Unicorn` 503 page two or three times in a row"
  - "Other PR checks (lint, test, typecheck) pass; only the `cla` check is red and `mergeStateStatus` is `UNSTABLE`"
root_cause: external_flake
resolution_type: workflow_workaround
related_components:
  - ci
  - development_workflow
tags:
  - cla
  - cla-assistant
  - github-actions
  - flaky-ci
  - merge-gate
last_updated: 2026-04-28
---

# CLA Assistant action flakes on GitHub 503; empty commit nudges it onto a fresh runner

## What we saw

PR #675 (`feat(admin): add Harness selector to Agent detail header`) had three checks green (`lint`, `test`, `typecheck`) but the `cla` check failed three times in a row. Each failure log showed the action successfully reading the signature file:

```
cla    CLA Assistant    All contributors have signed the CLA 📝 ✅
cla    CLA Assistant    ##[error]<!DOCTYPE html>
                          <title>Unicorn! · GitHub</title>
```

That's GitHub's branded 503 page. The signature check itself passes — what fails is the action's *follow-up* call back to the GitHub API (status check update / comment post). `gh run rerun --failed` reproduced the same error each time on the same runner.

## What worked

A single empty commit on the PR branch:

```bash
git commit --allow-empty -m "chore: empty commit to retrigger flaky CLA action"
git push
```

That triggered a fresh CI run on a different GitHub Actions runner. All four checks went green on the first attempt; PR squash-merged immediately afterward.

## Why retries didn't work

`gh run rerun` re-executes the failed job on the same workflow run, which appears to land on the same Actions infrastructure that's already serving Unicorns to that PR. A `git push` (even of an empty commit) creates a new workflow run with a new run ID, which gets fresh runner allocation.

## When to reach for this

- The CLA action log says "All contributors have signed" but the job is red.
- The error body is a GitHub HTML page (Unicorn, "Whale", or any other GitHub-styled 5xx).
- `gh run rerun --failed` has reproduced the same error twice or more.
- Other PR checks are green and you have no real reason to think the CLA itself is the problem.

## When this is NOT the right move

- The CLA log says the user has *not* signed — that's a real failure; the contributor needs to sign via the bot's link.
- The CLA action errors *before* the "All contributors have signed" line — that's typically a config or permissions issue in the action itself, not infrastructure.
- The PR contains uncommitted work that you're not ready to push.

## Don't bypass the gate without trying this first

`gh pr merge --admin` is also an option but it leaves the merge commit with a red CLA check forever, and it skips the bot's automatic signature-PR comment. The empty-commit nudge takes ~90 seconds and lands a clean merge with a green status row, which is preferable for audit trail when the only blocker is GitHub-side flake.
