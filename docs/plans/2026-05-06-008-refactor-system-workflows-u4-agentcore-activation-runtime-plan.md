---
title: "Phase 2 U4: Delete AgentCore activation runtime source"
type: refactor
status: active
date: 2026-05-06
origin: docs/plans/2026-05-06-001-refactor-system-workflows-activation-removal-plan.md
---

# Phase 2 U4: Delete AgentCore activation runtime source

## Summary

Phase 2 U4 of the System Workflows revert. Delete `packages/agentcore-activation/` source directory. The AWS-side teardown (Bedrock AgentCore runtime + ECR repo) is **already done**: both verified empty in dev at planning time.

## Problem Frame

Parent plan establishes the full motivation. Briefly: U4 was originally framed as "delete runtime + delete ECR + delete source + audit CI" because the Python runtime was assumed to be live. Verification at planning time confirmed both AWS resources are already gone in dev — the runtime was either never deployed past the spike or already torn down at some point. U4 collapses to a source-only delete.

See origin: `docs/plans/2026-05-06-001-refactor-system-workflows-activation-removal-plan.md` lines 343-385.

---

## Requirements

- R1. Carry forward parent R3 (Activation runtime invocation removed at the runtime layer).
- R2. `pnpm typecheck` and `pnpm test` stay green post-deletion (no TS imports reference the Python runtime — already verified).
- R3. `uv sync` succeeds post-deletion (workspace was always clean — `pyproject.toml` `[tool.uv.workspace]` lists only `packages/agentcore-strands`, never `packages/agentcore-activation`).
- R4. `.github/workflows/` has no orphan jobs referencing the deleted runtime — already verified zero matches at planning time.

---

## Scope Boundaries

- AWS-side teardown (Bedrock AgentCore runtime + ECR repo) is **out of scope for this PR** — both already deleted in dev. If a future stage exists where the runtime was deployed, that's a per-stage AWS CLI op, not a source-code change.
- `terraform/modules/app/system-workflows-stepfunctions/` module + state machines + IAM → U5.
- Postgres schema (`packages/database-pg/src/schema/{system-workflows,activation}.ts` + migrations 0059/0060) → U6.

### Deferred to Follow-Up Work

- AWS-side teardown if it ever lights up in another stage: `aws bedrock-agentcore delete-agent-runtime` + `aws ecr delete-repository --force` per stage. Operational, not code.

---

## Context & Research

### Relevant Code and Patterns

- `packages/agentcore-activation/` — 68K total. Contents at planning time:
  - `agent-container/` — Python source, Dockerfile, `pyproject.toml`, container-sources/, tests
  - `scripts/` — likely `build-and-push.sh` (per parent plan §358)
  - `test_env_snapshot.py` — top-level test
- Root `pyproject.toml` `[tool.uv.workspace] members` lists only `packages/agentcore-strands`. The activation runtime was never registered as a uv workspace member, so `uv sync` is unaffected by deletion.

### Institutional Learnings

- `feedback_diff_against_origin_before_patching.md` — verified pre-flight: ran `aws bedrock-agentcore-control list-agent-runtimes` + `aws ecr describe-repositories` filtered for "activation" — both returned `[]`.
- `feedback_worktree_isolation.md` — same pattern as U3 (`.claude/worktrees/sw-revert-phase-2-u4`).
- `feedback_merge_prs_as_ci_passes.md` — engineers blocked → merge as CI green.

### External References

- None.

---

## Key Technical Decisions

- **Single PR for the source delete.** No splitting — there's only one directory to remove.
- **Skip the AWS CLI ops in U4.** They're noted in the parent plan but already done; reproducing the verification commands in the PR body for posterity.
- **Worktree off `origin/main`**, branch `refactor/sw-revert-phase-2-u4`, single squash-merged PR — same shape as U3 (#851).

---

## Open Questions

### Resolve Before Work

- **RBW1**: Re-confirm AgentCore runtime + ECR repo are still empty in dev immediately before the PR opens. Run `aws bedrock-agentcore-control list-agent-runtimes --region us-east-1 --query 'agentRuntimes[?contains(agentRuntimeName, \`activation\`)]'` and `aws ecr describe-repositories --region us-east-1 --query 'repositories[?contains(repositoryName, \`activation\`)]'` — both must return `[]`. If either is non-empty, stop and run the AWS CLI deletion ops first.
- **RBW2**: Verify zero remaining importers across the entire repo (TS/Python/Shell/JSON/YAML): `grep -rln "agentcore-activation\|agentcore_activation" packages/ apps/ terraform/ scripts/ .github/ pyproject.toml --include="*.ts" --include="*.tsx" --include="*.py" --include="*.tf" --include="*.sh" --include="*.json" --include="*.toml" --include="*.yml"` — must return zero matches outside `packages/agentcore-activation/` itself.

### Resolved During Planning

- **AgentCore runtime status**: empty in dev (`aws bedrock-agentcore-control list-agent-runtimes` returned `[]`).
- **ECR repo status**: empty in dev (`aws ecr describe-repositories` returned `[]` for activation-named repos).
- **pyproject.toml workspace cleanliness**: confirmed — `[tool.uv.workspace] members = ["packages/agentcore-strands"]` only.
- **CI workflow refs**: zero matches in `.github/`.
- **TS importer status**: zero matches across `packages/`, `apps/`, `terraform/`, `scripts/`.
- **Activation Python HTTP client**: `agent-container/container-sources/activation_api_client.py` POSTs to `/api/activation/*` routes deleted in U3. Doesn't matter — entire directory is being deleted.

### Deferred to Implementation

- None.

---

## Implementation Units

- U1. **Delete the AgentCore activation runtime source directory**

**Goal:** Remove `packages/agentcore-activation/` in a single coordinated PR. Runtime + ECR already empty in dev (RBW1).

**Requirements:** R1, R2, R3, R4.

**Dependencies:** U2 of parent plan (PR #848, merged), U3 of parent plan (PR #851, merged + autofix #853).

**Files:**
- Delete (entire directory):
  - `packages/agentcore-activation/` — Python source, Dockerfile, `pyproject.toml`, `agent-container/container-sources/*`, `scripts/build-and-push.sh`, `test_env_snapshot.py`, etc.

**Approach:**
- Worktree: `git worktree add .claude/worktrees/sw-revert-phase-2-u4 -b refactor/sw-revert-phase-2-u4 origin/main`.
- Bootstrap: `pnpm install`, kill stale tsbuildinfos, `pnpm --filter @thinkwork/database-pg build` (per `feedback_worktree_tsbuildinfo_bootstrap`).
- Pre-flight RBW1 + RBW2 from a shell with AWS credentials configured.
- `git rm -r packages/agentcore-activation`.
- Verify: `pnpm -r --if-present typecheck`, `pnpm -r --if-present test`, `uv sync` (succeeds because workspace was always clean).
- Format: `pnpm exec prettier --check` on changed files (only the plan doc since the deletion has no remaining files to check).
- Commit + push + open PR per `feedback_pr_target_main`. Engineers blocked → merge as CI green.

**Patterns to follow:**
- Worktree isolation: `feedback_worktree_isolation` + `feedback_cleanup_worktrees_when_done`.

**Test scenarios:**
- *Test expectation: none — pure source deletion of an unregistered uv workspace member with zero in-tree importers. CI's typecheck + test + verify jobs are the regression gate.*

**Verification:**
- All CI checks (cla, lint, verify, test, typecheck) green on the PR.
- `pnpm exec prettier --check` clean.
- Post-merge: `grep -rln "agentcore-activation\|agentcore_activation" .` returns zero matches outside `docs/plans/` and `docs/brainstorms/` (which reference the runtime by name in plan/brainstorm prose — that's expected).

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| AgentCore runtime / ECR repo lights up in another stage between planning and merge | RBW1 immediately before push. If non-empty, stop and run AWS CLI deletion ops first. |
| Hidden importer surfaces post-merge typecheck/test failures | RBW2 repo-wide grep covers TS, Python, shell, JSON, TOML, YAML. CI typecheck + uv sync are the fall-through gate. |

---

## Documentation / Operational Notes

- No user-facing docs touched.
- Operational impact: zero AWS resources change in dev (already empty). 68K of source tree removed.
- Memory file `project_system_workflows_revert_compliance_reframe.md` should be updated post-merge to reflect U4 SHIPPED.

---

## Sources & References

- **Origin (parent plan):** [docs/plans/2026-05-06-001-refactor-system-workflows-activation-removal-plan.md](docs/plans/2026-05-06-001-refactor-system-workflows-activation-removal-plan.md), specifically lines 343-385 (U4 unit).
- **Brainstorm:** [docs/brainstorms/2026-05-06-system-workflows-revert-compliance-reframe-requirements.md](docs/brainstorms/2026-05-06-system-workflows-revert-compliance-reframe-requirements.md)
- **Predecessor PRs:** #845 (Phase 1), #846 (Phase 2 U1), #848 (Phase 2 U2), #851 (Phase 2 U3), #853 (U3 autofix)
- **Memory:** `project_system_workflows_revert_compliance_reframe.md`
