---
title: Company Brain provisioning contracts must be tenant-scoped before production behavior
date: 2026-06-15
category: docs/solutions/architecture-patterns
module: Company Brain / Deployment Runner
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "A premium substrate is backed by an internal managed-app adapter"
  - "Terraform state is shared by a stage but resources must be tenant-specific"
  - "A product-facing plugin should hide raw substrate environment variables"
  - "Default and production storage tiers need different safety contracts"
  - "Operator evidence needs infrastructure details without leaking them to product surfaces"
related_components:
  - terraform
  - deployment-runner
  - plugin-infrastructure
  - managed-applications
  - company-brain
tags:
  [
    company-brain,
    cognee,
    deployment-runner,
    terraform,
    tenant-scoped,
    managed-apps,
    neptune-analytics,
    thnk-18,
  ]
---

# Company Brain provisioning contracts must be tenant-scoped before production behavior

## Context

THNK-18 added the provisioning contract that lets Company Brain create
tenant-scoped Brain substrate instances through the existing internal Cognee
managed-app path. Before this work, the Cognee module and runner path were
effectively stage-wide: resource names, log groups, service names, secret paths,
and status evidence could all point at the same stage-level substrate.

That was acceptable for early dogfood infrastructure, but not for a premium
Company Brain product. Company Brain is the customer-facing layer; Cognee is an
internal implementation detail. The substrate must be able to provision per
tenant, expose operator evidence, and later support default-to-production
migration without teaching product surfaces about Cognee environment variables,
stage-wide names, or raw graph/vector storage choices.

The durable learning is that the provisioning contract has to become
tenant-scoped before reads, migration, or operations UI can honestly claim
premium physical-substrate behavior. THNK-18 did that by putting tenant identity
and tier posture into `desiredConfig`, mapping it through the deployment runner,
and deriving Terraform resources and outputs from that stable identity.

## Guidance

Treat a premium managed substrate as three related contracts: desired config,
Terraform identity, and evidence.

First, seed product-owned intent into managed-app `desiredConfig` instead of
surfacing raw provider variables in the plugin UI. For Company Brain, net-new
installs seed tenant identity, a stable instance key, the default storage tier,
and private-substrate posture:

```json
{
  "phase": "plan",
  "appKey": "cognee",
  "tenantId": "tenant-id",
  "jobId": "deployment-job-id",
  "desiredConfig": {
    "brainTenantId": "tenant-id",
    "brainInstanceKey": "tenant-<stable-hash>",
    "brainStorageTier": "default",
    "privateSubstrateMode": true
  }
}
```

The deployment-runner adapter then translates that product-shaped config into
Terraform variables:

```ts
const brainStorageTier = normalizeBrainStorageTier(desiredConfig);
const backendMode =
  optionalString(desiredConfig, "backendMode") ??
  (brainStorageTier === "production" ? "remote" : "dogfood");
const vectorDbProvider =
  optionalString(desiredConfig, "vectorDbProvider") ??
  (brainStorageTier === "production" ? "neptune_analytics" : "lancedb");
const graphDatabaseProvider =
  optionalString(desiredConfig, "graphDatabaseProvider") ??
  (brainStorageTier === "production" ? "neptune_analytics" : "kuzu");

return compactObject({
  cognee_brain_tenant_id: optionalString(desiredConfig, "brainTenantId"),
  cognee_brain_instance_key: optionalString(desiredConfig, "brainInstanceKey"),
  cognee_brain_storage_tier: brainStorageTier,
  cognee_private_substrate_mode:
    optionalBoolean(desiredConfig, "privateSubstrateMode") ?? true,
});
```

Second, derive resource identity from the tenant Brain instance, not from only
the deployment stage. The Terraform module should use `brain_instance_key` or
`brain_tenant_id` to derive ECS service families, ALB and target group names,
EFS creation tokens, secret paths, log groups, and evidence labels. Leaving both
values empty can preserve legacy stage-wide names for existing deployments, but
new premium substrate work should avoid that path.

Third, make tier posture explicit. The default tier is a bounded dogfood tier:
Postgres metadata plus local LanceDB/Kuzu-style graph/vector stores on the task
storage substrate, with one task and no high-availability promise. The
production tier is a remote tier: Cognee-supported Neptune Analytics
graph/vector providers, a Neptune graph id and endpoint, scoped graph IAM when
needed, and no direct OpenSearch vector storage.

Finally, expose outputs for operators and dependent product units instead of
making callers reconstruct names. THNK-18 added outputs for tier, backend mode,
graph/vector providers, S3 roots, Neptune ids/endpoints, EFS id, private
substrate mode, production posture, endpoint, log group, and service identity.
Those outputs feed later status, migration, operations, and smoke surfaces while
keeping customer-facing copy on Company Brain.

## Why This Matters

Tenant scoping is a trust boundary, not just a naming preference. If two tenant
Brain instances can target the same stage-wide resource names, a later
production migration or operations action can read, overwrite, or destroy the
wrong substrate. Even when data isolation remains intact elsewhere, operator
evidence becomes ambiguous: an endpoint, log group, or EFS id no longer proves
which tenant's Brain substrate is being discussed.

The desired-config boundary matters for product clarity. Company Brain should
not expose Cognee, LanceDB, Kuzu, Neptune, S3 prefixes, or ECS settings as
tenant-admin choices. The product owns install, entitlement, lifecycle, and
status language; the adapter owns how those choices become runner inputs and
Terraform variables.

Tier posture also prevents accidental overclaiming. A default dogfood tier can
be useful and real without pretending to be production. A production tier can
switch graph/vector providers to Neptune Analytics without introducing a second
direct vector-store path that later reads and migrations must reconcile.

## When to Apply

- When a premium product feature is implemented through an internal managed-app
  adapter.
- When existing Terraform module resources were originally stage-wide but the
  product now needs per-tenant instances.
- When a deployment runner has to carry product-level intent into
  infrastructure variables.
- When status, migration, operations, or smoke work needs durable evidence about
  which tenant substrate was provisioned.
- When default and production tiers have different storage, scale, and
  destructive-data semantics.

## Examples

Good Company Brain provisioning shape:

```text
Plugin install
  -> infrastructure handler seeds tenant Brain desiredConfig
  -> managed-app deployment runner maps desiredConfig to cognee_* variables
  -> Terraform derives names from brain_instance_key
  -> outputs report tier, providers, S3 roots, Neptune, EFS, endpoint, evidence
  -> product surfaces say Company Brain; operator evidence may mention Cognee
```

Poor provisioning shape:

```text
Plugin install
  -> UI exposes raw Cognee env vars
  -> runner applies stage-wide resource names
  -> default and production use caller-selected storage strings
  -> status reconstructs endpoints and storage roots from naming conventions
  -> later migration cannot prove which tenant substrate is active
```

The poor shape can pass a single-tenant smoke, but it does not create a durable
premium substrate contract. The good shape makes later migration, active reads,
operations UI, and smoke validation consume a stable tenant-scoped substrate
record instead of reverse-engineering infrastructure.

## Related

- [THNK-18 implementation plan](../../plans/2026-06-14-003-feat-brain-provisioning-contract-plan.md)
- [THNK-18 autopilot status](../../plans/autopilot/THNK-18-status.md)
- [PR #2459: add tenant-scoped Brain provisioning contract](https://github.com/thinkwork-ai/thinkwork/pull/2459)
- [Company Brain premium plugin operations](../runbooks/company-brain-premium-plugin-operations-2026-06-13.md)
- [Managed applications should reconcile MCP connectors and keep user OAuth separate](./managed-app-mcp-oauth-lifecycle-2026-06-06.md)
- [Company Brain migrations keep reads on the active backend until validated cutover](./company-brain-migrations-keep-active-read-path-2026-06-15.md)
- [Company Brain active-substrate reads stay behind Context Engine](./company-brain-active-substrate-reads-through-context-engine-2026-06-15.md)
