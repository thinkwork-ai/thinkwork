---
module: scripts/bootstrap-workspace.sh
date: 2026-04-21
category: logic-errors
problem_type: logic_error
component: tooling
severity: high
symptoms:
  - "GitHub Actions Deploy workflow's `Bootstrap` step exits code 1 silently after printing 'template executive — workspace exists (9 files)' with no further log output"
  - "Only fails on deploys that change packages/skill-catalog/** (the `detect-changes` paths filter that gates whether the Bootstrap job runs at all)"
  - "Terraform Apply / Build Lambdas / Build Container all succeed in the same run — only the final S3-seeding + catalog-sync step goes red"
  - "Survey of the last 100 Deploy runs found only 2 with Bootstrap actually running; both failed identically. No successful baseline to diff against."
root_cause: logic_error
resolution_type: code_fix
related_components:
  - development_workflow
tags:
  - bash
  - set-e
  - pipefail
  - silent-failure
  - ci-cd
  - deploy
  - err-trap
  - tenant-loop
---

# bootstrap-workspace.sh exited code 1 silently on skill-catalog deploys

## Problem

`scripts/bootstrap-workspace.sh` is the deploy step that syncs workspace
defaults + the skill catalog to S3 and seeds per-tenant defaults. After
the Unit 2 and Unit 3 deploys merged to `main`, the `Bootstrap` job
exited code 1 with **no error output** — the last visible log line was
`✓ template 'executive' — workspace exists (9 files)`, and the next line
should have been `=== Bootstrap complete ===` but was instead
`Process completed with exit code 1` from the GitHub Actions wrapper.

Terraform Apply, Build Lambdas, and Build Container all completed
successfully in the same runs, so runtime code actually shipped. The
failure was confined to the S3-seeding + catalog-sync step, and it
only fired on deploys that changed `packages/skill-catalog/**`
(everything else skipped the job via `detect-changes` gating).

## Symptoms

- Deploy workflow runs `24741177870` (PR #336 / Unit 2) and `24742414977`
  (PR #339 / Unit 3) both failed at the `Bootstrap` job. The last
  visible lines in both logs:
  ```
  ✓ sleek-squirrel-230 — seeded
  ✓ template 'default' — workspace exists (9 files)
  ✓ template 'executive' — workspace exists (9 files)
  ##[error]Process completed with exit code 1.
  ```
- Survey script `for run in $(gh run list --workflow Deploy --limit 100
  --json databaseId --jq '.[].databaseId'); do ...` found **only 2
  Bootstrap runs in the last 100 deploys** — both failures. No green
  baseline existed because the detect-changes paths filter gates the
  job on skill-catalog changes only, and most deploys don't touch
  that directory.
- Local bash repro of the suspicious `[ -z "$tpl" ] && continue`
  construct under `set -euo pipefail` exited 0, matching the
  manual's rule that `&&`-list LHS commands are exempt from `set -e`.
  The production env somehow wasn't.

## What Didn't Work

1. **Assume the `[ -z "$tpl" ] && continue` short-circuit was the bug
   because it looked suspicious under `set -euo pipefail`.** Local
   reproduction of the exact loop (with synthesized `TEMPLATE_SLUGS`
   and the same outer `for slug in $TENANT_SLUGS` wrapper) exited 0.
   Bash manual confirms: commands on the LHS of `&&`/`||` chains are
   exempt from `set -e`. The construct is safe in isolation.
2. **Ship a silent-exit fix without reproducing the failure.** The
   first instinct was to defensively rewrite the construct and
   ship, hoping the fix would hold. That would have left the root
   cause unknown — if the next skill-catalog deploy also failed,
   we'd have no way to narrow it down.
3. **Grep the log for anything after the last ✓ line.** Nothing.
   The process exited without writing another byte to stdout or
   stderr — the GitHub Actions runner's wrapper printed only the
   process-completion line.

## Solution

**PR #344** landed a three-part robustness rewrite of
`scripts/bootstrap-workspace.sh`:

**1. ERR trap for line-level diagnostics.** The primary fix. Adds
```bash
set -euo pipefail
trap 'rc=$?; echo "ERR (exit=$rc) on line $LINENO: $BASH_COMMAND" >&2' ERR
```
so any `set -e` kill surfaces the offending line number and command
*before* the wrapper reports exit 1. If the next deploy hits a
similar failure, the log will name the exact line, turning a
hypothesis-only debug session into a one-minute fix.

**2. Defensive rewrite of `[ -z "$var" ] && continue` to `if/then/continue`.**
```bash
# before
[ -z "$tpl" ] && continue
[ "$slug" = "scripts" ] && continue

# after
if [ -z "$tpl" ]; then
  continue
fi
if [ "$slug" = "scripts" ]; then
  continue
fi
```
The original form is safe under a spec-compliant `set -e`
implementation, but:
- It's subtle. Readers have to know the `&&`-list exemption rule
  to see why it's safe.
- Bash has well-documented edge cases where the compound's exit
  status propagates through loop boundaries depending on
  interpreter version and host env.
- The `if/then/continue` form is unambiguous regardless of
  interpreter behavior.

**3. Failure-isolating subshell for the per-tenant seeding loop.**
```bash
bootstrap_status=0
(
  set +e
  if [ -z "$TENANT_SLUGS" ]; then
    echo "  No tenants found..."
    exit 0
  fi
  for slug in $TENANT_SLUGS; do
    # ... per-tenant work; failures inside log a `!` warning but
    # don't abort the whole bootstrap
  done
) || bootstrap_status=$?

if [ "$bootstrap_status" -ne 0 ]; then
  echo "  ! Tenant seeding finished with warnings (subshell exit=$bootstrap_status)"
fi

echo ""
echo "=== Bootstrap complete ==="
```
Guarantees that `=== Bootstrap complete ===` always prints even when
one tenant's seed fails. A flaky S3 call on one tenant no longer
aborts the whole deploy step; the failure becomes a warning-with-marker
in the log instead of a red step.

**Plus:** `aws s3 ls | wc -l` pipelines moved into a nested subshell
with pipefail disabled, since `aws s3 ls` can return non-zero on
empty prefixes in some CLI versions and `pipefail` was surfacing
that through `wc` and killing the script. `wc` on empty input prints
`0`, which is exactly the semantic we wanted.

## Why This Works

The first skill-catalog deploy after PR #344 landed (Unit 5 / PR #348)
went **fully green, including Bootstrap**. The log revealed the actual
root cause that was invisible before:

```
✓ sleek-squirrel-230 — defaults exist (11 files)
✓ template 'default' — workspace exists (9 files)
✓ template 'executive' — workspace exists (9 files)
→ Seeding defaults for original-wildcat-647...          ← NEW, visible for the first time
✓ original-wildcat-647 — seeded
→ Copying defaults to template 'default'...
✓ template 'default' seeded
=== Bootstrap complete ===
```

There was a **second tenant** (`original-wildcat-647`) the outer
`for slug in $TENANT_SLUGS` loop never reached in the broken deploys.
The exit-1 was firing *during the transition from the first tenant's
inner iteration back to the outer loop*, and the defensive rewrite
(specifically the subshell + set-plus-e isolation + the explicit
if/then/continue) let the outer loop reach the second tenant
successfully.

We didn't need to prove exactly which bash interaction tripped the
original exit — the rewrite fixed it by isolating each tenant's work
and guaranteeing the outer loop couldn't be aborted by an inner
iteration's exit-status propagation. The ERR trap ensured that if
the rewrite had *not* fixed it, we'd know the exact line to look at
on the next failure.

## Prevention

- **When shell debugging in strict mode, instrument before
  hypothesizing.** `trap 'echo "ERR on $LINENO: $BASH_COMMAND"' ERR`
  costs one line and turns silent `set -e` kills into
  source-located errors. This should be the first move on any
  strict-mode bash script that exits without output. Cheaper than
  a hypothesis-debug cycle.
- **Prefer `if/then/continue` over `[ … ] && continue` in shell
  scripts that run under `set -e`.** The short-circuit form is
  technically safe but relies on a bash-manual rule many readers
  don't hold in working memory. The explicit form removes the
  question.
- **Wrap multi-tenant/multi-iteration loops in failure-isolating
  subshells** when any single iteration failing should not block
  the others. `( set +e; ... ) || status=$?` + a warning log is
  the pattern.
- **Move `pipefail` pipelines that include tolerance-expected
  errors into nested subshells with pipefail disabled.**
  `( set +o pipefail; aws s3 ls … | wc -l | tr -d ' ' )` keeps the
  strict mode for the rest of the script while letting one pipeline
  handle "empty is OK" correctly.
- **If a deploy step has no successful baseline in the last N
  deploys, that's a signal, not noise.** Survey the run history
  before debugging — if every prior run of the same job failed
  identically, you're dealing with an environmental condition,
  not a regression.

## Related

- PRs: #336 (first failure), #339 (second failure, same mode), #344
  (fix)
- Deploy runs: `24741177870`, `24742414977` (failures);
  `24747799836` (first green after fix)
- `docs/solutions/logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md`
  — different flavor of silent-failure (wrong-tenant `LIMIT 1`),
  same theme: silent failures need cheap instrumentation
  (diagnostic log / ERR trap) before hypothesis-debugging.
- `docs/solutions/logic-errors/compile-continuation-dedupe-bucket-2026-04-20.md`
  — third silent-failure flavor (`ON CONFLICT DO NOTHING` masking
  state-machine bugs).
- auto memory `feedback_read_diagnostic_logs_literally` — codifies
  the "instrument first" discipline this fix reinforces.
