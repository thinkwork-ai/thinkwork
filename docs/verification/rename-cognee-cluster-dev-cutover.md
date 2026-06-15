---
title: Rename Cognee Cluster Dev Cutover Verification
issue: THNK-30
date: 2026-06-15
status: pending-main-cd
---

# Rename Cognee Cluster Dev Cutover Verification

## Scope

This artifact records the TEI ThinkWork dev cutover proof for renaming the
legacy stage-wide Company Brain ECS cluster from
`thinkwork-dev-cognee-cluster` to `thinkwork-dev-brain-cluster`.

Cognee remains the implementation key, ECS service name, task family, container,
database, log stream prefix, and GraphQL/API contract. No non-dev rollout is
authorized by this artifact.

## Pre-Cutover Gate

- Source of Terraform plan evidence: pending PR/main-CD plan artifact from the
  shared `dev` backend and the same deploy secrets/variables surface as main CD.
- Allowed resource changes:
  - Expected: `aws_ecs_cluster.main` replacement to
    `thinkwork-dev-brain-cluster`.
  - Acceptable if unavoidable: Cognee ECS service relocation/replacement to the
    new cluster while preserving service name and dependencies.
  - Abort for review: ALB/TG, EFS, IAM roles, secrets, database, CloudWatch log
    group, task family, service name, or managed application key replacement or
    rename.
- Non-dev inventory: pending. Check Terraform workspaces/state outputs,
  deployment-controller environments, GitHub environments/variables, and known
  registry module consumers before approving non-dev rollout.

## Recovery Matrix

| State                                            | Allowed action                                                                                                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terraform state old, AWS old service active      | Proceed only after refreshed plan allowlist passes.                                                                                                |
| Terraform state new, AWS new service active      | Verify health, old cluster absence, and clean plan.                                                                                                |
| Terraform state new, service missing or draining | Use saved plan/apply logs and read-only AWS state to choose rerun, PR revert, or dev-only state repair.                                            |
| Both old and new clusters exist                  | Keep the healthy service path, remove or decommission stale cluster through Terraform-owned recovery, and record owner/date if removal is blocked. |
| Neither service is steady                        | Revert by PR/main CD or perform approved dev-only state repair with lock, backup, exact import IDs, and refreshed clean plan.                      |
| CI times out after valid resources are created   | Continue only under documented timeout continuation criteria; otherwise restore through PR/state recovery.                                         |

## Post-CD Evidence Slots

Record redacted conclusions only. Do not commit account IDs, raw secret ARNs,
full resource IDs, or environment values.

- AWS ECS active Brain cluster:
  - Status: pending
  - Redacted evidence:
- Cognee service `thinkwork-dev-cognee` active under Brain cluster:
  - Status: pending
  - Desired/running/pending:
- ALB target group healthy for desired count:
  - Status: pending
  - Redacted evidence:
- Terraform `cognee_cluster_arn`, GraphQL `deploymentStatus.cogneeClusterArn`,
  Cognee managed app `clusterArn`, ECS service identity, and
  `knowledgeGraphHealthCheck` agree on Brain cluster:
  - Status: pending
  - Redacted evidence:
- `COGNEE_CLUSTER_ARN` absent or Brain-named:
  - Status: pending
  - Redacted evidence:
- Old cluster `thinkwork-dev-cognee-cluster` absent, or decommission owner/date:
  - Status: pending
  - Redacted evidence:
- Post-apply Terraform plan clean:
  - Status: pending
  - Redacted evidence:

## Commands / Evidence Sources

- Terraform plan artifact from GitHub Actions or deployment controller using the
  shared dev backend.
- `plugins/company-brain/smoke/cognee-managed-app-smoke.mjs` with live smoke enabled.
- Read-only ECS describe checks for both the Brain cluster and legacy Cognee
  cluster.
- HTTP GraphQL deployment status and Knowledge Graph health check.
