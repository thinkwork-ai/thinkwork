# THINK-83 Autopilot Status

## Objective

Implement THINK-83 end to end: pivot user and Space memory back to Hindsight,
keep Cognee as optional ThinkWork Brain ontology/graph infrastructure, keep
Memory under `/settings/memory` for this pass, fix the operator Memory table,
and rebrand customer-facing Company surfaces to ThinkWork names.

## Context Discovery

- Started: 2026-06-27.
- Repository instructions read from `AGENTS.md`.
- Compound Engineering workflow read: `lfg` and `ce-work`.
- Linear issue read: `THINK-83` / "Pivot user and Space memory back to
  Hindsight".
- Linear comments read. Newest correction says:
  - Do not move Memory routing in this pass.
  - Keep the operator Memory UI under `/settings/memory`.
  - Add the blank Memory Table as an explicit operator-only Hindsight issue.
  - The table should show all operator-visible Hindsight records with bank,
    created/updated date, scope/owner where derivable, type/strategy, and
    content.
- Linear attached document read:
  `Plan: Pivot Memory to Hindsight in ThinkWork Brain`.
- Conflict resolution:
  - The Linear document is older and still says to move Memory out of Settings.
  - The latest Linear comment and repo-local plan supersede it.
  - Current implementation keeps `/settings/memory` and fixes the data contract.
- Related issue read: `THINK-79` / "Company Brain".
- Related THINK-79 comments and document read:
  `Plan: Cognee user and space memory cutover`.
- PR #3018 inspected. It is draft/open by design and is diagnostic evidence for
  Cognee scope bleed, not the merge path for THINK-83.
- No child issues found for THINK-83. Implementation units come from the plan.
- Repo search for `THNK-83`, `THINK-83`, the plan filename, and the issue title
  found only the new local brainstorm and plan files.
- Origin/main does not yet contain the THINK-83 brainstorm or plan files; the
  first implementation unit should include those planning artifacts.

## Repo-Local Planning Files

- `docs/brainstorms/2026-06-27-thnk-83-hindsight-thinkwork-brain-boundary-requirements.md`
- `docs/plans/2026-06-27-001-feat-thinkwork-brain-hindsight-memory-plan.md`

## Prior Solution Docs Read

- `docs/solutions/architecture-patterns/company-brain-active-substrate-reads-through-context-engine-2026-06-15.md`
- `docs/solutions/architecture-patterns/company-brain-provisioning-contract-tenant-scoped-2026-06-15.md`
- `docs/solutions/runbooks/company-brain-premium-plugin-operations-2026-06-13.md`
- `docs/solutions/best-practices/context-engine-adapters-operator-verification-2026-04-29.md`
- `docs/solutions/best-practices/cognee-thread-ingest-explorer-2026-06-04.md`
- `docs/solutions/logic-errors/admin-graph-dims-measure-ref-2026-04-20.md`

## Implementation Units

1. U0: Deployment boundary.
2. U1: Hindsight owner-aware banks.
3. U2: GraphQL memory pivot.
4. U3: Settings Memory operator table.
5. U6: Isolation verification and smoke coverage.
6. U4: Product rebrand.
7. U5: Docs and tool copy.
8. U7: Rollout, compatibility, and Linear handoff evidence.

U3 and U6 both depend on U2 and can be sequenced after U2. U4 depends on U3,
U5 depends on U4, and U7 depends on U5 and U6.

## Status Log

### 2026-06-27 - Context discovery

- Read repository, Linear, plan, brainstorm, related issue, related PR, and
  prior solution context.
- No Linear state changes made during discovery.
- Created this status document.

### 2026-06-27 - U0 objective

Make deployment behavior match the product boundary: Hindsight is core memory
infrastructure, while Cognee is optional ThinkWork Brain ontology/graph
infrastructure deployed through the Brain plugin/managed-app path.

- Moved Linear THINK-83 to `In Progress`.
- Posted Linear implementation-start comment.
- Created isolated U0 branch/worktree:
  `codex/think-83-u0-deployment-boundary` at
  `/Users/ericodom/.codex/worktrees/think-83-u0`.
- Implemented U0 deployment-boundary slice:
  - `enable_hindsight` now defaults to true in the composite module,
    greenfield example, CLI init scaffold, and enterprise deploy template.
  - Empty `memory_engine` now documents Hindsight as the full-install default;
    `agentcore` is the explicit low-cost/development opt-out.
  - `memory_engine = "cognee"` remains accepted only as legacy diagnostic
    compatibility and is no longer described as the user/Space memory path.
  - Cognee plugin/managed-app copy now frames Cognee as optional Brain
    ontology/knowledge-graph infrastructure.
  - Hindsight README now describes Hindsight as canonical user/Space memory
    for full installs.
- U0 verification passed:
  - `pnpm --filter thinkwork-cli test -- __tests__/terraform-cognee-fixture.test.ts`
  - `pnpm --filter @thinkwork/plugin-company-brain test -- test/manifest.test.ts`
  - `pnpm --filter @thinkwork/deployment-runner test -- test/deployment-runner-managed-apps.test.ts`
  - `pnpm --filter thinkwork-cli typecheck`
  - `pnpm --filter @thinkwork/plugin-company-brain typecheck`
  - `pnpm --filter @thinkwork/deployment-runner typecheck`
  - `pnpm dlx prettier --check ...` for touched TS/MD files
  - `git diff --check`
  - `terraform fmt -check` for touched Terraform files
- Note: `pnpm install` logged an optional `canvas` native build failure under
  Node 25 because `pkg-config` is unavailable, but exited successfully and the
  focused package tests/typechecks ran afterward.
