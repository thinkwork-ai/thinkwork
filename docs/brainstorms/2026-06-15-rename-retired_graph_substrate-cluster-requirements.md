---
date: 2026-06-15
topic: rename-retired_graph_substrate-cluster
linear: THNK-30
---

# Rename the retired graph substrate Cluster - Requirements

## Problem Frame

The shared dev ThinkWork Brain substrate still exposes its legacy ECS cluster name as `thinkwork-dev-retired_graph_substrate-cluster`. That name leaks implementation vocabulary into AWS operator surfaces even though the customer-facing concept is ThinkWork Brain / Brain. Operators should see the stage-wide Brain cluster as `thinkwork-dev-brain-cluster`, while the retired graph substrate remains the underlying implementation service and managed application key.

The work is primarily an infrastructure naming and migration requirement. The repo already has tenant-scoped Brain naming for newer the retired graph substrate substrate instances, but the legacy stage-wide path still derives cluster identity from `thinkwork-${stage}-retired_graph_substrate`. Planning must preserve the live dev the retired graph substrate service and avoid assuming an in-place ECS rename; AWS ECS update APIs modify cluster settings/configuration, not the cluster name.

---

## Actors

- A1. ThinkWork operator: inspects and migrates the AWS dev managed application resources.
- A2. Terraform/deployment runner: applies the durable naming contract for future deploys.
- A3. API/admin status surfaces: report the retired graph substrate/Brain infrastructure names to operators.

---

## Key Flows

- F1. Dev cluster migration
  - **Trigger:** THNK-30 is approved for planning and implementation.
  - **Actors:** A1, A2, A3
  - **Steps:** Confirm the live dev cluster currently exists as `thinkwork-dev-retired_graph_substrate-cluster`; plan a migration path that results in an active ECS cluster named `thinkwork-dev-brain-cluster`; preserve the the retired graph substrate service endpoint, logs, storage, and health visibility through the migration; verify API/admin status reports the new cluster ARN/name.
  - **Outcome:** Operators can inspect the dev ThinkWork Brain substrate under the Brain cluster name without losing the retired graph substrate service continuity.
  - **Covered by:** R1, R2, R4, R5, R7

- F2. Future deployment naming
  - **Trigger:** A deployment creates or reconciles the legacy stage-wide the retired graph substrate substrate.
  - **Actors:** A2, A3
  - **Steps:** Terraform derives the legacy stage-wide ECS cluster identity from Brain vocabulary; outputs propagate the actual cluster ARN; API/admin status reads the configured output/env value instead of reconstructing stale `retired_graph_substrate-cluster` defaults.
  - **Outcome:** New or reconciled stage-wide deployments use `thinkwork-${stage}-brain-cluster` for the ECS cluster while keeping the retired graph substrate implementation identifiers where they are intentionally internal.
  - **Covered by:** R2, R3, R6, R7

---

## Requirements

**Naming outcome**

- R1. The live dev ThinkWork Brain ECS cluster must end up named `thinkwork-dev-brain-cluster`.
- R2. Future legacy stage-wide the retired graph substrate substrate deployments must derive their ECS cluster name as `thinkwork-${stage}-brain-cluster`, not `thinkwork-${stage}-retired_graph_substrate-cluster`.
- R3. The rename must not imply a global product-key rename: the managed application key, the retired graph substrate container name, service name, log stream prefix, and implementation docs may continue to use `retired_graph_substrate` unless planning identifies a required dependency on cluster identity.

**Migration safety**

- R4. The implementation plan must account for ECS cluster name immutability by using a safe migration/replacement/state strategy rather than assuming an AWS CLI in-place rename.
- R5. The dev migration must preserve or intentionally reattach the existing the retired graph substrate service dependencies: task definition, service desired count, internal ALB/target group, EFS-backed storage, security groups, IAM roles, CloudWatch log group, and Terraform state ownership.
- R6. Terraform must remain the durable source of truth after the migration; one-off AWS CLI actions are acceptable only as migration steps that are reconciled back into Terraform.

**Operator visibility**

- R7. API/admin deployment status and health checks must report and probe the actual Brain cluster ARN/name after the change, with tests updated away from hard-coded `thinkwork-dev-retired_graph_substrate-cluster` expectations.
- R8. The requirement is satisfied only after the dev cluster is verifiably healthy under the Brain name and a future deploy would not recreate or revert it back to the the retired graph substrate cluster name.

---

## Acceptance Examples

- AE1. **Covers R1, R7, R8.** Given the dev the retired graph substrate substrate is enabled, when an operator checks AWS ECS or the admin Knowledge Graph status, then the cluster is shown as `thinkwork-dev-brain-cluster` and the the retired graph substrate service remains healthy.
- AE2. **Covers R2, R6.** Given a fresh legacy stage-wide deployment with the retired graph substrate enabled for stage `prod`, when Terraform creates the ECS cluster, then the cluster name is `thinkwork-prod-brain-cluster` and the `retired_graph_substrate_cluster_arn` output points to that resource.
- AE3. **Covers R3.** Given the cluster rename ships, when downstream code references the managed application, then the app key remains `retired_graph_substrate` and existing the retired graph substrate service/runtime behavior is not rebranded unless explicitly required by the migration plan.
- AE4. **Covers R4, R5.** Given AWS cannot rename an ECS cluster in place, when planning the live dev migration, then the plan includes a concrete replacement/import/state sequence and rollback posture before any destructive apply.

---

## Success Criteria

- AWS dev no longer exposes `thinkwork-dev-retired_graph_substrate-cluster` as the active ThinkWork Brain ECS cluster, and the active cluster is `thinkwork-dev-brain-cluster`.
- Terraform, deployment outputs, API status, and health probes agree on the active cluster identity.
- Future deploys preserve the Brain cluster name instead of silently recreating the old the retired graph substrate cluster name.
- A planner can move directly into `ce-plan` without inventing product intent, scope boundaries, or acceptance criteria.

---

## Scope Boundaries

- This does not rename the the retired graph substrate managed application key, database, container image, API routes, GraphQL fields, or user-facing Knowledge Graph feature.
- This does not migrate ThinkWork Brain data, alter the retired graph substrate ingestion behavior, or change Hindsight/memory semantics.
- This does not generalize all the retired graph substrate resource names. Only the ECS cluster identity is required to move from the retired graph substrate vocabulary to Brain vocabulary for THNK-30.
- This does not introduce a local-only or non-AWS deployment path.

---

## Key Decisions

- Treat this as an operator-facing infrastructure identity fix, not a product-wide the retired graph substrate rebrand.
- Keep Terraform as the final authority even if the dev cutover uses targeted AWS CLI commands.
- Require planning to handle ECS cluster replacement/import risk explicitly because the requested AWS CLI "update" path is not an in-place cluster rename.

---

## Dependencies / Assumptions

- The live dev substrate referenced by Linear is the ECS cluster shown in AWS as `thinkwork-dev-retired_graph_substrate-cluster`.
- The the retired graph substrate app module's legacy path currently derives the ECS cluster name from `local.legacy_name = "thinkwork-${stage}-retired_graph_substrate"` and `aws_ecs_cluster.main.name = "${local.name}-cluster"`.
- API status and health-check code currently reconstructs fallback cluster identity as `thinkwork-${stage}-retired_graph_substrate-cluster` when `GRAPH_CLUSTER_ARN` is absent.
- AWS ECS update APIs do not expose a new-name field; planning should validate the final migration mechanism against current AWS/Terraform behavior before touching dev.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R4, R5][Technical] What is the safest dev cutover sequence: Terraform replacement with downtime accepted, create/import/move state, or a staged parallel cluster and service migration?
- [Affects R7][Technical] Should status/health probes continue accepting `GRAPH_CLUSTER_ARN` as the source of truth while changing only the fallback default, or should a Brain-named env/output alias be introduced?

---

## Sources / Research

- Linear issue `THNK-30` and attached screenshot showing the current AWS cluster display name `thinkwork-dev-retired_graph_substrate-cluster`.
- `terraform/modules/app/retired_graph_substrate/main.tf` - legacy name derivation and `aws_ecs_cluster.main`.
- `terraform/modules/app/retired_graph_substrate/README.md` - ThinkWork Brain vs the retired graph substrate naming boundary and operator outputs.
- `terraform/modules/thinkwork/outputs.tf` - `retired_graph_substrate_cluster_arn` deployment output.
- `packages/api/src/graphql/resolvers/core/deploymentStatus.query.ts` - API status fallback cluster ARN.
- `packages/api/src/graphql/resolvers/core/managedApplications.ts` - managed application cluster ARN fallback.
- `packages/api/src/graphql/resolvers/core/knowledgeGraphHealthCheck.query.ts` - ECS health probe cluster default.
- `docs/plans/retired_graph_substrate-terraform-infrastructure-autopilot-status.md` - dev the retired graph substrate service evidence under the current cluster name.
- AWS ECS `UpdateCluster` / `update-cluster-settings` documentation - cluster update operations target settings/configuration and identify the cluster to update, not a replacement name.

---

## Next Steps

-> /ce-plan for structured implementation planning
