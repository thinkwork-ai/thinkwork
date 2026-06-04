---
title: Cognee thread ingest Explorer validation pattern
date: 2026-06-04
category: best-practices
module: knowledge-graph
problem_type: best_practice
component: deployed_smoke
severity: medium
related_components:
  - packages/api
  - packages/graph
  - apps/spaces
  - scripts/smoke
tags:
  - cognee
  - knowledge-graph
  - deployed-smoke
  - graphql
  - evidence
---

# Cognee Thread Ingest Explorer Validation Pattern

## Context

Phase II of the Cognee Knowledge Graph feature deliberately keeps Cognee out of
agent retrieval. Its product value is observability: operators ingest one real
ThinkWork thread, inspect Cognee-derived entities/relationships, and verify
message-level evidence before any future retrieval path can trust the graph.

That makes green unit tests necessary but insufficient. The end-to-end feature
crosses GraphQL auth, run creation, Lambda invocation, private Cognee
networking, normalization, Aurora snapshot reads, graph rendering, and the
Spaces settings shell. A deployed smoke is the cheapest way to catch the gaps
that typecheck and Terraform cannot see.

## Guidance

Use `scripts/smoke/knowledge-graph-thread-ingest-smoke.mjs` as the canonical
operator validation path.

Dry-run is safe everywhere:

```sh
node scripts/smoke/knowledge-graph-thread-ingest-smoke.mjs
```

Live mode is explicit because it mutates the target dev stage by creating an
ingest run and invoking the worker:

```sh
SMOKE_ENABLE_KNOWLEDGE_GRAPH=1 \
  SMOKE_TENANT_ID=<tenant-id> \
  SMOKE_USER_ID=<operator-user-id> \
  SMOKE_KG_THREAD_ID=<thread-id> \
  node scripts/smoke/knowledge-graph-thread-ingest-smoke.mjs
```

The script exercises the same GraphQL contract the Explorer uses:

- `knowledgeGraphThreadCandidates` when a thread id is not supplied.
- `startKnowledgeGraphThreadIngest` to enqueue one manual run.
- `knowledgeGraphIngestRuns` to poll until terminal status.
- `knowledgeGraphEntities` and `knowledgeGraphGraph` to verify the normalized
  table/graph snapshot.
- `knowledgeGraphEntity` to verify the side-sheet read path when an entity
  exists.

## Passing Criteria

The run passes when ingest reaches `SUCCEEDED` and the normalized read paths are
queryable. A graph with zero nodes is not automatically a smoke failure, because
Cognee can legitimately return an empty graph for a short or low-signal thread.
In that case the script prints `emptyGraphDiagnostic` with run counts and ids so
the operator can distinguish "feature path works, Cognee found nothing" from
"the smoke forgot to check graph output."

Failures before terminal status are real product bugs unless the message clearly
points at missing credentials or an intentionally unavailable dev stack:

- GraphQL auth/tenant errors mean the operator identity is wrong or the auth
  gate regressed.
- A stuck `QUEUED`/`RUNNING` run means worker invocation, networking, or Cognee
  processing needs investigation.
- `FAILED` run status means the worker recorded a recoverable ingest failure;
  inspect the run error before rerunning with `SMOKE_KG_FORCE=1`.
- Table/graph mismatch means the normalized snapshot contract has drifted.

## Browser Check

After a live smoke, open Spaces at `/settings/knowledge-graph` on the same stage
and validate the operator workflow:

1. Explorer is the default surface.
2. The header info action toggles to the Cognee deployment/configuration panel.
3. The selected thread shows the latest ingest status and compact history.
4. Table and Graph use the same filters.
5. Clicking a row or graph node opens the read-only entity sheet with evidence
   and relationship context.

This browser pass intentionally reads ThinkWork GraphQL only. The browser must
not call Cognee's private ALB directly.

## Related

- `docs/plans/2026-06-04-003-feat-cognee-thread-ingest-explorer-plan.md`
- `docs/solutions/best-practices/graph-filter-states-no-restart-2026-04-20.md`
- `docs/solutions/workflow-issues/deploy-silent-arch-mismatch-took-a-week-to-surface-2026-04-24.md`
