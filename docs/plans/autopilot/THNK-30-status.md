---
issue: THNK-30
title: Rename Cognee Cluster
updated: 2026-06-15
dispatcher: dispatcher:THNK-30:InProgress:Codex
---

# THNK-30 Autopilot Status

## Current Pass

- Started from fresh `origin/main` at
  `08dcda665e14394ad8bc39fac034ca5597fe4016` in branch
  `codex/thnk-30-rename-cognee-cluster`.
- Read Linear issue THNK-30, comments, requirements document, plan document,
  merged requirements artifact, and merged plan artifact before changing code.
- Moved THNK-30 from `Ready to Work` to `In Progress` when implementation
  began, preserving Codex routing.
- Project framing for comments/docs/status evidence: TEI ThinkWork under the
  broader Texas Enterprises projects area.
- PR boundary: U1-U4 are bundled into one implementation PR because merging U1
  alone would trigger the dev cutover through main CD before the API fallback,
  smoke gate, and verification artifact were present.

## Implementation Progress

- U1 Terraform cluster identity:
  - Added a dedicated legacy stage-wide ECS cluster local that resolves to
    `thinkwork-${stage}-brain-cluster`.
  - Kept Cognee-derived service, task family, ALB/TG, EFS, IAM, secret, log,
    database, resource-short-name, and managed-app identities unchanged.
  - Preserved the Terraform output name `cognee_cluster_arn` and clarified that
    it is the Company Brain ECS cluster hosting Cognee.
- U2 API cluster identity:
  - Added a shared Cognee cluster identity helper.
  - Updated deployment status, managed application status, and Knowledge Graph
    health probes to use the Brain fallback.
  - Preserved `COGNEE_CLUSTER_ARN` as an exact optional compatibility override;
    no `BRAIN_CLUSTER_ARN` was added.
- U3 smoke/evidence:
  - Extended the Cognee managed-app smoke to compare Terraform output, GraphQL
    deployment status, Cognee managed-app status, and the inferred health-check
    target cluster.
  - Added Brain-cluster assertions for enabled deployments while keeping disabled
    deployments skippable.
  - Added break-glass owner/reason fields for temporary non-Brain recovery
    evidence.
- U4 verification artifact:
  - Added `docs/verification/rename-cognee-cluster-dev-cutover.md` with the
    plan allowlist, recovery matrix, non-dev inventory slot, and redacted
    post-CD evidence slots.

## Verification Notes

- Implementation PR:
  https://github.com/thinkwork-ai/thinkwork/pull/2520
- PR #2520 checks passed on 2026-06-15:
  - `cla`
  - `lint`
  - `verify`
  - `typecheck`
  - `test`
- PR #2520 is not merged yet. Merge remains blocked on an acceptable dev
  maintenance window and a refreshed Terraform plan artifact from the shared
  dev backend/main-CD secrets context.
- No production mutation commands were run.
- No manual deployment commands were run.
- Deployed AWS verification remains pending until the implementation PR merges
  and main CD applies the dev cutover.
