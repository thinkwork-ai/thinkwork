---
title: Company Brain migrations keep reads on the active backend until validated cutover
date: 2026-06-15
category: docs/solutions/architecture-patterns
module: Company Brain / Context Engine
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "A premium substrate has default and production backends with a cutover path"
  - "Agent or runtime reads must stay available while a shadow backend is replayed and validated"
  - "Tenant-facing status or provenance could expose backend evidence if summaries are not allowlisted"
  - "Operators need migration controls without direct backend access"
tags:
  [
    company-brain,
    context-engine,
    migration,
    active-backend,
    read-posture,
    redaction,
    production-cutover,
    s3-manifests,
  ]
---

# Company Brain migrations keep reads on the active backend until validated cutover

## Context

THNK-6 finished the Company Brain parent-scope substrate work after the initial
dogfood proof. The merged units added default-to-production migration
orchestration, migration-aware Context Engine reads, an operator Brain
operations surface, and dry-run-first smoke coverage.

The durable learning is that a production migration is not a retrieval switch.
It is an API-owned state machine over canonical S3 replay manifests and
operator evidence. Runtime reads continue through the current
`active_backend` until validation passes and the migration reaches completed
cutover. Shadow production evidence can be shown to operators and included in
redacted read posture, but it does not serve agent traffic early.

This closes a gap that product docs and runbooks only imply: Company Brain can
offer a production storage tier without teaching agents, tenant callers, or UI
status payloads about raw Cognee, Neptune, S3, or EFS implementation details.

## Guidance

Treat production migration as three separate contracts.

First, the mutation/domain contract owns the state machine. Requesting a
production migration should only succeed when the substrate is installed,
ready, still on the default tier, and has no active migration. The request
should validate replay manifests, vector dimension, and embedding model before
creating a migration row. Progress updates should be transaction-wrapped,
adjacent-phase only, and should require public validation evidence before
cutover.

```ts
if (substrate.storage_tier !== "default") throw badInput(...);
if (substrate.active_backend !== "default") throw badInput(...);
if (activeMigration) throw badInput(...);

validatePhaseTransition(migration, input);
validateCutoverReadiness({ phase, status, validationSummary, migration, substrate });
```

Only a completed migration flips the substrate to production:

```ts
if (input.phase === "completed" && status === "completed") {
  await updateSubstrate({
    storage_tier: "production",
    active_backend: "production",
    status: "ready",
    health_status: "healthy",
  });
}
```

Failed migrations keep the prior active backend, and rollback explicitly
restores default. This keeps a failed validation or provisioning run from
silently redirecting first-party reads.

Second, the read contract makes the migration visible without using it as the
read path. The Context Engine Brain provider should load latest migration
state, compute read posture, and query only the active backend. A running
production migration can appear as a shadow route; failed or rolled-back
migrations appear as default fallback posture.

```text
active: serving the current active backend
shadow: production migration is running; reads remain on default
fallback: default remains available after production cutover or failure
vault: provenance projection, not canonical storage
```

Third, the evidence contract keeps raw backend details behind operator access.
Tenant-visible status, agent provenance, provider metadata, and migration
events should use allowlisted public summaries. Operator evidence can include
Cognee endpoints, S3 roots, Neptune ids/endpoints, EFS ids, and deployment job
details, but only behind the Brain operations evidence permission.

Use the same boundary in verification. Smokes should be read-only and dry-run
by default, with any production migration request behind an explicit opt-in
environment flag.

## Why This Matters

Substrate migrations sit on the boundary between platform operations and agent
trust. If production replay state doubles as a runtime routing switch, a
partially replayed graph can start answering agent questions before ontology,
vector, source-count, and retrieval-parity checks pass. If migration evidence
is not redacted, tenant-facing status and agent provenance can leak internal
backend names, private endpoints, S3 roots, or infrastructure identifiers.

Keeping reads on `active_backend` until validated cutover gives operators a
safe upgrade path without sacrificing availability. It also makes failures
legible: a shadow production backend can be degraded, failed, or rolled back
while agents continue reading the last known safe Company Brain route.

## When to Apply

- When adding a new production tier for a tenant-scoped substrate.
- When a migration replays canonical artifacts into a shadow backend before
  cutover.
- When Context Engine or agent runtime reads need provenance about migration
  posture but should not call the shadow backend directly.
- When tenant admins and platform operators need different evidence views.
- When a smoke or runbook could accidentally mutate production without an
  explicit opt-in guard.

## Examples

Good Company Brain migration shape:

```text
Request mutation:
- verifies default tier and active backend
- rejects duplicate active migrations
- records replay manifest counts and vector/model requirements

Progress mutation:
- enforces requested -> snapshotting -> provisioning -> replaying -> validating -> cutover -> completed
- requires validationPassed and matching vector dimension before cutover
- flips active_backend only at completed

Context Engine:
- reads from active_backend
- reports shadow/fallback/vault posture
- redacts validation and manifest metadata
```

Poor migration shape:

```text
Request migration:
- starts production backend and immediately marks it active
- lets providers decide which backend to query
- stores raw replay evidence in public status metadata
- runs live mutation smoke unless the user remembers a special dry-run flag
```

The poor version may pass happy-path tests, but it makes cutover, rollback,
tenant redaction, and agent provenance depend on discipline in every caller.
The good version centralizes those guarantees in the API/domain layer and lets
Context Engine consume a simple, redacted read posture.

## Related

- [THNK-6 status ledger](../../plans/autopilot/THNK-6-status.md)
- [THNK-6 remaining substrate plan](../../plans/2026-06-14-004-feat-company-brain-remaining-substrate-plan.md)
- [PR #2461: add Company Brain migration orchestration](https://github.com/thinkwork-ai/thinkwork/pull/2461)
- [PR #2462: make Company Brain reads migration-aware](https://github.com/thinkwork-ai/thinkwork/pull/2462)
- [PR #2464: add Company Brain operations surface](https://github.com/thinkwork-ai/thinkwork/pull/2464)
- [PR #2465: add Company Brain smoke closure](https://github.com/thinkwork-ai/thinkwork/pull/2465)
- [Context Engine API docs](../../src/content/docs/api/context-engine.mdx)
- [Company Brain premium plugin operations](../runbooks/company-brain-premium-plugin-operations-2026-06-13.md)
- [Context Engine adapters need operator-level verification](../best-practices/context-engine-adapters-operator-verification-2026-04-29.md)
- [First-party provider tools should stay behind policy facades](./first-party-provider-tools-stay-behind-policy-facades-2026-06-14.md)
