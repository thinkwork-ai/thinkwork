---
title: "feat: Add Plane application plugin"
type: feat
status: active
date: 2026-06-14
origin: docs/brainstorms/2026-06-14-plane-application-plugin-requirements.md
linear: THNK-27
---

# feat: Add Plane Application Plugin

## Summary

Build Plane as a curated ThinkWork Application Plugin. Plane should provision a
self-hosted runtime through the managed-app deployment runner, expose Plane
work-item tools through a user-scoped activation path, and bundle a
`plane--issue-loop` skill so agents preserve task context in Plane work items.

## Implementation Units

### U1. Plane Contract Proof

Add the Plane managed-app adapter contract, status extraction, data-impact copy,
and planning/status evidence without publishing Plane in the catalog.

Tests:

- `packages/deployment-runner/test/deployment-runner-managed-apps.test.ts`

### U2. Plugin Manifest and Catalog Entry

Add a Plane manifest with infrastructure and skills. Register it in the catalog
only after U4 makes the infrastructure executable.

Tests:

- `packages/plugin-catalog/src/__tests__/plane-manifest.test.ts`

### U3. Plane Managed-App Adapter

Wire the adapter into the deployment runner and API infra parity tests.

Tests:

- `packages/api/src/lib/plugins/plane-manifest-parity.test.ts`

### U4. Plane Terraform Runtime Module

Add `terraform/modules/app/plane` and wire `terraform/modules/thinkwork` plus
greenfield examples. Use a compact ECS/Fargate runtime: one Plane all-in-one
application container plus the separate Plane MCP sidecar in one ECS service
and task definition. Plane AIO is not dependency-free: satisfy its required
`REDIS_URL` and `AMQP_URL` with private in-task loopback sidecars, not managed
AWS services. Use the dedicated Postgres contract, S3, public HTTPS ALB,
CloudWatch evidence, and retained park/destroy semantics.

Stop-the-line rule: do not add or approve a Plane plan that provisions
per-service Plane ECS services, ElastiCache/Redis/Valkey, Amazon MQ/RabbitMQ,
Elasticsearch/OpenSearch, or more than one Plane ECS service speculatively. If
live deployment evidence proves the compact sidecar topology cannot work, a
managed dependency is allowed as an explicit exception after recording the
evidence, rationale, and resource impact in Linear. If these resources appear
in Terraform plan output without that evidence trail, abort the apply and fix
the module first. Do not remove the Plane AIO `REDIS_URL` or `AMQP_URL`; they
must stay pointed at task-local sidecars unless the evidence-backed exception
changes the dependency shape.

### U5. Per-User Plane MCP Activation

Extend plugin MCP activation/runtime dispatch to support Plane HTTP PAT bearer
auth plus auxiliary workspace headers (`Authorization: Bearer <PAT>`,
`x-workspace-slug`) or prove an OAuth bridge. Do not use a tenant-wide
fallback.

### U6. Plane Issue-Loop Skill

Bundle `plane--issue-loop` with guidance for context-first reads, narrow writes,
readable ID to UUID resolution, and write-back discipline.

### U7. Plane Seed and End-to-End Smoke

Add smoke scripts that seed workspace/project/work-item data, verify MCP
`get_me`, read seeded data, write back to an existing item, and create a new
work item.

Verification must exercise the ThinkWork application-plugin flow against a
deployed AWS environment: install Plane through ThinkWork, inspect deployment
evidence before approving/applying, open the deployed self-hosted Plane app,
activate per-user MCP credentials, prove a ThinkWork agent can call Plane MCP,
then teardown through ThinkWork and verify cleanup/parking. Do not use Plane
Cloud, local Docker Compose, a local Plane runtime, or a Terraform-only shortcut
as the end-to-end proof.

### U8. Release Packaging and Controller Wiring

Include Plane image provenance/digest requirements and release-manifest wiring.

### U9. Docs, Rollout, and Operator Copy

Document install, park, destroy, activation, smoke, and known limitations.

## Key Risks

- Plane MCP HTTP PAT requires bearer auth plus custom workspace headers that the
  current ThinkWork MCP dispatch contract does not yet model together.
- Plane self-hosting for ThinkWork is deliberately tighter than Plane's
  multi-service reference topology: one ECS task with Plane AIO, MCP, and
  task-local Redis/RabbitMQ sidecars. Terraform must not create separate
  Redis/RabbitMQ managed services for Plane.
- The catalog must not expose Plane as installable until the runtime module and
  auth path are executable.

## Sources

- `docs/brainstorms/2026-06-14-plane-application-plugin-requirements.md`
- `docs/plans/2026-06-12-001-feat-application-plugins-plan.md`
- `docs/plans/2026-06-05-003-feat-twenty-crm-managed-app-plan.md`
- `docs/solutions/architecture-patterns/managed-app-mcp-oauth-lifecycle-2026-06-06.md`
- `packages/deployment-runner/src/apps/registry.ts`
- `packages/deployment-runner/src/apps/twenty.ts`
- `packages/plugin-catalog/src/contracts.ts`
- `packages/plugin-catalog/src/plugins/twenty/manifest.ts`
