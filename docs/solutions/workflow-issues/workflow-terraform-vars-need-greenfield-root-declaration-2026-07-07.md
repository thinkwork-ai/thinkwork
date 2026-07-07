# Workflow-passed terraform vars must land with their greenfield-root declaration — and deploy-unblock fixes need one owner

**Date:** 2026-07-07
**Context:** THINK-220 (#3499) added `-var "hindsight_database_name=…"` to deploy.yml's terraform invocation. THINK-155's post-merge deploy watch caught the fallout.

## What happened

1. #3499 added the `-var` flag to `.github/workflows/deploy.yml` but did not declare `variable "hindsight_database_name"` in `terraform/examples/greenfield/main.tf` — the **deploy root**. The variable existed in `terraform/modules/thinkwork/variables.tf`, which is one level down; terraform rejects command-line vars the *root* module doesn't declare. Every main deploy failed with `Error: Value for undeclared variable`.
2. **Three sessions fixed it in parallel** (#3501, #3502, #3503 — near-identical patches, minutes apart). All three merged: no textual conflict because each added the block at a different location, so main ended up with duplicate `variable` blocks and duplicate module arguments → `Error: Duplicate variable declaration`. Deploys still red.
3. Two lanes then opened dedupe PRs (#3505, #3508) and **both stood down in deference to the other** — #3508 closed unmerged, #3505 removed only one of two duplicates. Main stayed broken through five more deploy attempts until #3509 landed the final dedupe.

## Rules

- **A new `-var` in deploy.yml and its `variable` declaration in `terraform/examples/greenfield/main.tf` (plus the module passthrough) are one atomic change.** The module-level declaration is not enough — deploy's root is greenfield. Grep check before merging a workflow `-var` change: the same name must appear in `terraform/examples/greenfield/main.tf` both as a `variable` block and as a module argument.
- **Deploy-unblock fixes need explicit ownership.** When main's deploy is red, say so in the team channel / Linear before pushing a fix; check `gh pr list` for an in-flight fix of the same break first. Parallel identical fixes merge cleanly and *create a second break* (duplicate declarations), and mutual deference leaves the break unowned.
- After any deploy-fix merge, verify with `git show origin/main:terraform/examples/greenfield/main.tf | grep -c 'variable "<name>"'` — expect exactly 1 — before assuming the next deploy will go green.

## Related

- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` (the deploy gate that shares this pipeline)
- Failing runs: 28886230788, 28888768123 (duplicate), fixed by #3509.
