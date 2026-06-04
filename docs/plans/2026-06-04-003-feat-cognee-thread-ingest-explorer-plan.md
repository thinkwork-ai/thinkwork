---
title: "feat: Add Cognee thread ingest and explorer"
type: feat
status: active
date: 2026-06-04
origin:
  - docs/brainstorms/2026-06-04-cognee-phase-ii-ingest-explorer-requirements.md
related:
  - docs/plans/2026-06-04-001-feat-cognee-terraform-infrastructure-plan.md
  - docs/solutions/best-practices/business-ontology-change-set-loop-2026-05-17.md
  - docs/solutions/best-practices/graph-filter-states-no-restart-2026-04-20.md
  - docs/solutions/best-practices/react-native-force-sim-camera-persistence-2026-04-20.md
---

# feat: Add Cognee Thread Ingest and Explorer

## Overview

Add Phase II of the Cognee Knowledge Graph feature: tenant operators can ingest
complete ThinkWork thread message histories into Cognee, then inspect the
resulting graph from `apps/spaces` Settings > Knowledge Graph. The Explorer is
the default surface and shows a Wiki-like Table/Graph view with a right-side
entity detail sheet. Deployment configuration and service health remain
available behind the page header info toggle.

This plan intentionally keeps Cognee out of agent runtime retrieval. Phase II is
an observability and validation layer: prove what Cognee produces, preserve
thread-message evidence, and make weak or ungrounded graph output visible before
it can influence answers.

---

## Problem Frame

The first Cognee plan made the service deployable and visible in Spaces. That
still leaves the product unable to answer the important question: what graph did
Cognee build from real ThinkWork work?

The origin requirements changed the ingestion source from Hindsight records to
complete thread message histories. Hindsight is too granular for this phase; a
full thread carries the context needed to classify entities and relationships
against approved ontology definitions. Each selected thread should be processed
as a deterministic ingest event, and operators should see the resulting Cognee
entities, relationships, diagnostics, and evidence in the same style as Wiki
Memory.

---

## Requirements Trace

- R1-R5. Manual ingest processes complete selected threads, constrained by
  approved ontology definitions, not Hindsight deltas or Wiki pages.
- R6-R10. Settings > Knowledge Graph is the home; Explorer is default;
  configuration/status moves behind an info icon toggle; current/last run
  state and compact history are inline.
- R11-R16. Table defaults to entities with entity, type, grounding status,
  relationship count, evidence count, and last seen. Table and Graph show the
  same filtered Cognee dataset and distinguish trusted, diagnostic, and
  weak-provenance items.
- R17-R20. Clicking an entity row or graph node opens a Wiki-like read-only
  detail sheet with relationships, source thread messages, evidence, and
  neighbor re-anchoring.
- R21-R22. No agent retrieval through Cognee and no graph/ontology editing in
  Phase II.

**Origin actors:** A1 tenant operator/admin, A2 requester/user, A3 thread
message source, A4 approved ontology layer, A5 Cognee service, A6 ThinkWork
agent as a deferred consumer.

**Origin flows:** F1 manual thread ingest, F2 explore graph output, F3 inspect
entity provenance.

**Origin acceptance examples:** AE1-AE5 are carried forward as acceptance tests
for this implementation.

---

## Scope Boundaries

- No agent-facing Cognee retrieval in Phase II.
- No incremental, scheduled, automatic, or post-turn Cognee ingest.
- No tenant-wide graph rollup or space-scoped graph.
- No direct graph editing, approval, rejection, correction, or ontology editor.
- No migration from Wiki Memory, Hindsight, Company Brain, or Bedrock Knowledge
  Bases to Cognee.
- No browser or GraphQL live calls to Cognee's private ALB for Explorer reads.
  The UI reads ThinkWork-normalized data from GraphQL.

### Deferred Follow-Up Work

- Agent retrieval and context-engine adapters backed by validated Cognee data.
- Automatic end-of-thread ingest once manual thread ingest is proven.
- Incremental re-ingest and dedupe/reconciliation across multiple threads.
- Tenant/company rollups and space-scoped graph projections.
- Operator approval workflow for accepting or rejecting graph facts.
- Dedicated eval harness comparing Cognee output to Wiki Memory.

---

## Context & Research

### Local Patterns

- `apps/spaces/src/components/settings/SettingsKnowledgeGraph.tsx` already owns
  the Settings > Knowledge Graph surface on `origin/main`; it currently shows
  deployment/configuration and health.
- `apps/spaces/src/components/settings/settings-nav.tsx` on `origin/main`
  already places Knowledge Graph above Knowledge Bases and uses
  `IconTopologyStar3`.
- `apps/spaces/src/components/settings/SettingsWiki.tsx` is the closest UI
  pattern for Table/Graph, search, side sheet, and Settings page layout.
- `apps/spaces/src/components/memory/WikiPageDetailSheet.tsx` is the side-sheet
  interaction pattern to mirror for entity details and neighbor navigation.
- `packages/graph/src/WikiGraph.tsx` and `packages/graph/src/queries.ts` provide
  the reusable force-graph conventions. Filtering must preserve the
  no-simulation-restart invariant documented in
  `docs/solutions/best-practices/graph-filter-states-no-restart-2026-04-20.md`.
- `packages/api/src/graphql/resolvers/wiki/wikiGraph.query.ts` shows the
  normalized one-round-trip graph payload pattern.
- `packages/database-pg/src/schema/wiki.ts` shows a derived graph store with
  pages, links, evidence-like source rows, jobs, and tenant scoping.
- `packages/database-pg/src/schema/thread-idle-learning.ts` and
  `packages/api/src/graphql/resolvers/memory/threadIdleLearningRuns.query.ts`
  show run-ledger and run-history serialization patterns.
- `packages/api/src/graphql/resolvers/threads/access.ts` and
  `packages/api/src/graphql/resolvers/messages/messages.query.ts` are the
  authoritative thread/message visibility patterns. Ingest must not bypass
  tenant scoping when invoked by a user.
- `packages/database-pg/src/schema/ontology.ts` and
  `packages/database-pg/graphql/types/ontology.graphql` expose approved entity
  and relationship definitions that should ground trusted Cognee output.
- `packages/api/src/graphql/resolvers/core/knowledgeGraphHealthCheck.query.ts`
  documents the current network reality: the GraphQL Lambda cannot call the
  private Cognee ALB directly, so private Cognee calls need a runtime with the
  right VPC path.
- `packages/api/src/graphql/resolvers/wiki/compileWikiNow.mutation.ts` and
  `packages/api/src/handlers/wiki-compile.ts` show async job enqueue and Lambda
  handler patterns to reuse.

### Institutional Learnings

- `docs/solutions/best-practices/business-ontology-change-set-loop-2026-05-17.md`
  warns that generated ontology structure must not silently mutate approved
  schema. Phase II should use approved ontology definitions as constraints and
  diagnostic labels, not create new types.
- `docs/solutions/best-practices/graph-filter-states-no-restart-2026-04-20.md`
  requires graph filtering to mutate visual state in place so search/filter
  changes do not restart the force simulation or reset camera state.
- `docs/solutions/best-practices/react-native-force-sim-camera-persistence-2026-04-20.md`
  reinforces preserving graph layout/camera state across data re-emits.
- `docs/solutions/workflow-issues/deploy-silent-arch-mismatch-took-a-week-to-surface-2026-04-24.md`
  supports adding deployed smoke checks for runtime features; Terraform success
  alone is not sufficient.

### External References

- Cognee API reference: `/api/v1` includes `add`, `cognify`, `remember`,
  `search`, and dataset management. See
  <https://docs.cognee.ai/api-reference/introduction>.
- Cognee `remember` combines ingest and graph construction in one call and
  accepts dataset name/id, node sets, background mode, and custom prompt. See
  <https://docs.cognee.ai/api-reference/remember/remember>.
- Cognee `cognify` processes datasets into graph output and accepts
  `ontologyKey`, `customPrompt`, chunk size, and background mode. See
  <https://docs.cognee.ai/api-reference/cognify/cognify>.
- Cognee dataset graph retrieval returns nodes with `id`, `label`, `type`,
  `properties` and edges with `source`, `target`, and `label`. See
  <https://docs.cognee.ai/api-reference/datasets/get-dataset-graph>.
- Cognee ontology management supports uploading ontology files by
  `ontology_key`; ontologies constrain which entity types and relationships
  Cognee should extract during cognify. See
  <https://docs.cognee.ai/cognee-cloud/functionality/configuration-and-ontologies>.

---

## Key Technical Decisions

- **Manual single-thread ingest is the first unit of truth.** The UI should let
  operators select one thread. A requester filter can help find candidate
  threads, but batching multiple requester threads should wait until the
  single-thread path is stable.
- **Use a dedicated private ingest worker.** GraphQL creates an ingest run row
  and invokes a worker asynchronously. The worker, not the browser or ordinary
  GraphQL resolver path, calls Cognee from a network context that can reach the
  private Cognee service.
- **Persist a ThinkWork-normalized graph snapshot in Aurora.** Cognee is the
  graph materializer, but ThinkWork stores entities, relationships, evidence,
  diagnostics, counts, and run history in Postgres for filtered reads, side
  sheets, auditability, and tenant enforcement.
- **Use one Cognee dataset per tenant-thread.** Dataset names should be stable,
  e.g. `thinkwork:<tenantId>:thread:<threadId>`, with the Cognee dataset id
  recorded on the ingest run and graph snapshot. Re-ingesting a thread replaces
  the ThinkWork normalized snapshot for that thread.
- **Represent trust explicitly, not by omission.** The graph should keep
  Cognee-produced ungrounded entities and weak-provenance edges as diagnostic
  rows/nodes. Grounding/provenance status drives styling and filtering.
- **Evidence points to thread messages first.** Store message ids, message
  timestamps, roles, speaker labels, and quoted snippets. Character offsets are
  optional and should be stored only if the normalizer can derive them safely.
- **Ontology is a constraint and classifier in Phase II.** The worker exports or
  maps approved ontology entity/relationship definitions into Cognee ingest and
  then classifies Cognee output as approved-grounded, unapproved/diagnostic, or
  weak/missing provenance. It does not create ontology change sets.
- **Explorer reads GraphQL only.** The Spaces UI calls ThinkWork GraphQL queries
  for entities, graph, details, runs, and thread picker data. It never calls
  Cognee directly.
- **Config is behind an info toggle.** `SettingsKnowledgeGraph` should default
  to Explorer and use a header icon button to switch to the existing deployment
  status/configuration view.

---

## Data Model Direction

Add a dedicated schema module for Cognee-derived graph state, preferably
`packages/database-pg/src/schema/knowledge-graph.ts`, and export it from
`packages/database-pg/src/schema/index.ts`.

Proposed tables:

- `knowledge_graph_ingest_runs`
  - `id`, `tenant_id`, `thread_id`, `requested_by_user_id`
  - `status`: `queued`, `running`, `succeeded`, `failed`, `canceled`,
    `stale_noop`
  - `trigger`: `manual`
  - `cognee_dataset_name`, `cognee_dataset_id`
  - `started_at`, `finished_at`, `duration_ms`, `error`
  - counts: `entity_count`, `relationship_count`, `evidence_count`,
    `diagnostic_count`, `message_count`
  - `input`, `metrics`, `metadata`
- `knowledge_graph_entities`
  - `id`, `tenant_id`, `thread_id`, `ingest_run_id`
  - `cognee_node_id`, `label`, `normalized_label`, `type_label`
  - `ontology_entity_type_id`, `ontology_type_slug`
  - `grounding_status`: `grounded`, `unapproved_type`, `ungrounded`,
    `conflict`, `unknown`
  - `provenance_status`: `strong`, `weak`, `missing`
  - `summary`, `aliases`, `properties`, `diagnostics`
  - `relationship_count`, `evidence_count`, `last_seen_at`
- `knowledge_graph_relationships`
  - `id`, `tenant_id`, `thread_id`, `ingest_run_id`
  - `cognee_edge_id`, `source_entity_id`, `target_entity_id`, `label`
  - `ontology_relationship_type_id`, `ontology_type_slug`
  - `grounding_status`, `provenance_status`, `confidence`
  - `properties`, `diagnostics`, `evidence_count`, `last_seen_at`
- `knowledge_graph_evidence`
  - `id`, `tenant_id`, `thread_id`, `ingest_run_id`
  - `entity_id`, `relationship_id`
  - `message_id`, `message_role`, `message_created_at`
  - `speaker_label`, `snippet`, `char_start`, `char_end`
  - `source_kind`: `thread_message`, `cognee_payload`, `normalizer`
  - `source_ref`, `metadata`, `observed_at`

Index for read paths:

- `(tenant_id, thread_id, created_at)` on runs.
- `(tenant_id, thread_id, normalized_label)` and trigram/full-text support for
  entity label/alias search if available.
- `(tenant_id, thread_id, ontology_type_slug)`.
- `(tenant_id, thread_id, grounding_status, provenance_status)`.
- `(tenant_id, thread_id, source_entity_id)` and target equivalent on
  relationships.
- `(tenant_id, thread_id, message_id)` on evidence.

The implementation can adjust exact column names, but it must preserve the
normalized graph/evidence/run separation so the UI can query efficiently and
the worker can replace one thread snapshot idempotently.

---

## GraphQL Contract Direction

Add `packages/database-pg/graphql/types/knowledge-graph.graphql` and resolvers
under `packages/api/src/graphql/resolvers/knowledge-graph/`.

Suggested types:

- `KnowledgeGraphIngestRun`
- `KnowledgeGraphEntity`
- `KnowledgeGraphRelationship`
- `KnowledgeGraphEvidence`
- `KnowledgeGraphGraph`, `KnowledgeGraphGraphNode`,
  `KnowledgeGraphGraphEdge`
- `KnowledgeGraphThreadCandidate`
- enums for ingest status, grounding status, provenance status

Suggested queries:

- `knowledgeGraphThreadCandidates(tenantId: ID!, requesterUserId: ID, query: String, limit: Int): [KnowledgeGraphThreadCandidate!]!`
- `knowledgeGraphIngestRuns(tenantId: ID!, threadId: ID, limit: Int): [KnowledgeGraphIngestRun!]!`
- `knowledgeGraphEntities(tenantId: ID!, threadId: ID, search: String, ontologyType: String, groundingStatus: KnowledgeGraphGroundingStatus, provenanceStatus: KnowledgeGraphProvenanceStatus, limit: Int): [KnowledgeGraphEntity!]!`
- `knowledgeGraphGraph(tenantId: ID!, threadId: ID, search: String, ontologyType: String, groundingStatus: KnowledgeGraphGroundingStatus, provenanceStatus: KnowledgeGraphProvenanceStatus): KnowledgeGraphGraph!`
- `knowledgeGraphEntity(tenantId: ID!, entityId: ID!): KnowledgeGraphEntity`

Suggested mutation:

- `startKnowledgeGraphThreadIngest(input: StartKnowledgeGraphThreadIngestInput!): KnowledgeGraphIngestRun!`

Auth and visibility:

- All queries/mutations require tenant operator/admin access for Phase II.
- User callers must resolve tenant through `resolveCallerTenantId`.
- Thread selection must reuse `callerVisibleThreadPredicate` or an
  admin-equivalent tenant gate. Operator access is required, but private-space
  thread visibility should not accidentally broaden beyond existing tenant
  operator conventions without an explicit code comment.
- Service-secret callers may bypass user visibility only for the ingest worker.

---

## Implementation Units

### U1. Persistence and GraphQL Contract

**Goal:** Add durable, tenant-scoped normalized graph tables and GraphQL schema
types before implementing ingestion or UI.

**Files**

- `packages/database-pg/src/schema/knowledge-graph.ts`
- `packages/database-pg/src/schema/index.ts`
- `packages/database-pg/drizzle/NNNN_knowledge_graph_thread_ingest.sql`
- `packages/database-pg/graphql/types/knowledge-graph.graphql`
- `packages/api/src/graphql/resolvers/index.ts`
- Codegen outputs for every consumer with a `codegen` script:
  `apps/cli`, `apps/admin`, `apps/mobile`, `apps/spaces`, and `packages/api`.

**Tests**

- `packages/database-pg/__tests__/knowledge-graph-schema.test.ts`
- `packages/api/src/__tests__/knowledge-graph-schema.test.ts`

**Scenarios**

- Migration creates run/entity/relationship/evidence tables with tenant,
  thread, run, and message foreign keys.
- Check constraints reject unknown run, grounding, and provenance statuses.
- GraphQL schema exposes expected types and fields and codegen succeeds.

### U2. GraphQL Read Resolvers and Thread Picker

**Goal:** Let Spaces read thread candidates, runs, entities, graph payloads, and
entity details from normalized Aurora rows.

**Files**

- `packages/api/src/graphql/resolvers/knowledge-graph/index.ts`
- `packages/api/src/graphql/resolvers/knowledge-graph/auth.ts`
- `packages/api/src/graphql/resolvers/knowledge-graph/threadCandidates.query.ts`
- `packages/api/src/graphql/resolvers/knowledge-graph/ingestRuns.query.ts`
- `packages/api/src/graphql/resolvers/knowledge-graph/entities.query.ts`
- `packages/api/src/graphql/resolvers/knowledge-graph/graph.query.ts`
- `packages/api/src/graphql/resolvers/knowledge-graph/entity.query.ts`
- `packages/api/src/graphql/resolvers/index.ts`

**Tests**

- `packages/api/src/__tests__/knowledge-graph-resolvers.test.ts`
- `packages/api/src/__tests__/knowledge-graph-tenant-scoping.test.ts`

**Scenarios**

- Tenant admin can list candidate threads and recent ingest runs.
- Non-operator user cannot access Knowledge Graph Explorer queries.
- Entity list supports label/alias search and type/status filters.
- Graph query returns the same filtered entity set as the table query.
- Entity detail returns relationships plus evidence snippets and source message
  references.
- Cross-tenant entity, run, message, and thread ids return null/empty or
  forbidden without leaking existence.

### U3. Manual Ingest Mutation and Worker Enqueue

**Goal:** Add a mutation that creates an ingest run and async-invokes a dedicated
worker without doing long Cognee work in the GraphQL request.

**Files**

- `packages/api/src/graphql/resolvers/knowledge-graph/startThreadIngest.mutation.ts`
- `packages/api/src/lib/knowledge-graph/runs.ts`
- `packages/api/src/lib/knowledge-graph/invoke-worker.ts`
- `packages/api/src/graphql/resolvers/knowledge-graph/index.ts`
- `terraform/modules/app/lambda-api/handlers.tf`

**Tests**

- `packages/api/src/__tests__/knowledge-graph-start-ingest.test.ts`

**Scenarios**

- Operator starts ingest for a visible thread and receives a queued run row.
- Mutation records selected thread id, requester/user id when available,
  message count estimate, and input metadata.
- Mutation uses an idempotency guard so repeated clicks do not create multiple
  concurrent runs for the same thread.
- Worker invoke failure leaves a run row with a clear queued/invoke-failed
  state or error and surfaces a useful GraphQL error.
- Non-operator and cross-tenant starts are rejected.

### U4. Cognee Thread Ingest Worker and Normalizer

**Goal:** Process one thread into Cognee, fetch Cognee graph output, normalize
it into ThinkWork graph/evidence tables, and update run metrics.

**Files**

- `packages/api/src/handlers/knowledge-graph-thread-ingest.ts`
- `packages/api/src/lib/knowledge-graph/thread-transcript.ts`
- `packages/api/src/lib/knowledge-graph/ontology-export.ts`
- `packages/api/src/lib/knowledge-graph/cognee-client.ts`
- `packages/api/src/lib/knowledge-graph/normalizer.ts`
- `packages/api/src/lib/knowledge-graph/repository.ts`
- `scripts/build-lambdas.sh`

**Tests**

- `packages/api/src/handlers/knowledge-graph-thread-ingest.test.ts`
- `packages/api/src/lib/knowledge-graph/normalizer.test.ts`
- `packages/api/src/lib/knowledge-graph/thread-transcript.test.ts`

**Scenarios**

- Worker loads complete thread messages in chronological order, including
  content, parts-derived text when needed, role, speaker, and timestamps.
- Worker exports approved ontology entity and relationship definitions and
  passes them to Cognee through the selected supported mechanism
  (`ontologyKey` upload/reuse, `graphModel`, or custom prompt), recording which
  mechanism was used.
- Worker uses Cognee `remember` when supported for one-step ingest, or
  `add` + `cognify` + dataset graph retrieval when that is more reliable for
  the deployed Cognee version.
- Worker fetches Cognee dataset graph and normalizes nodes/edges into
  entities/relationships.
- Worker classifies grounding/provenance statuses against approved ontology and
  stored evidence.
- Worker persists message-level evidence snippets and relationship evidence.
- Re-ingesting the same thread replaces the previous normalized snapshot for
  that thread without deleting run history.
- Failed Cognee calls update run status, error, duration, and partial counts
  without throwing unhandled Lambda errors.

### U5. Worker Infrastructure, IAM, and Private Cognee Access

**Goal:** Deploy the ingest worker with the right environment, timeout, IAM,
and network path to call the private Cognee service.

**Files**

- `terraform/modules/app/lambda-api/handlers.tf`
- `terraform/modules/app/lambda-api/main.tf`
- `terraform/modules/app/lambda-api/variables.tf`
- `terraform/modules/app/lambda-api/outputs.tf`
- `terraform/modules/app/cognee/main.tf`
- `terraform/modules/app/cognee/outputs.tf`
- `terraform/modules/thinkwork/main.tf`
- `terraform/modules/thinkwork/variables.tf`
- `terraform/modules/thinkwork/outputs.tf`
- `.github/workflows/verify.yml`
- `.github/workflows/deploy.yml`

**Tests / Validation**

- `terraform -chdir=terraform/examples/greenfield validate`
- `bash scripts/build-lambdas.sh knowledge-graph-thread-ingest`
- Targeted Terraform plan in CI.

**Scenarios**

- Worker receives `COGNEE_ENDPOINT`, stage, database, and worker function-name
  env vars.
- Worker has Lambda invoke permissions where needed, database access, and only
  scoped Secrets Manager/SSM access for Cognee auth/config.
- Worker can reach the private Cognee endpoint. If Lambda VPC attachment is
  required, add it explicitly with security-group ingress to Cognee's internal
  ALB; if the existing Lambda module cannot safely support VPC attachment,
  use an ECS one-off task worker and document the choice in code comments.
- Deployment status/config GraphQL continues to work after adding the worker.

### U6. Generic Knowledge Graph Renderer

**Goal:** Reuse Wiki graph ergonomics while supporting Cognee trust styling and
filtered graph payloads.

**Files**

- `packages/graph/src/KnowledgeGraph.tsx`
- `packages/graph/src/queries.ts`
- `packages/graph/src/index.ts`
- `packages/graph/src/index.test.ts`
- Potentially refactor shared utilities from `packages/graph/src/WikiGraph.tsx`
  into `packages/graph/src/graph-utils.ts`.

**Tests**

- `packages/graph/src/KnowledgeGraph.test.tsx`
- `packages/graph/src/index.test.ts`

**Scenarios**

- Graph renders nodes/edges from `knowledgeGraphGraph`.
- Trusted/grounded, diagnostic/ungrounded, and weak-provenance states are
  visually distinct.
- Search/filter changes do not rebuild graph data or reset camera state.
- Node click returns connected edges for the entity detail sheet.
- Empty, loading, and error states fit the Settings surface.

### U7. Spaces Knowledge Graph Explorer UI

**Goal:** Make Settings > Knowledge Graph default to Explorer with table/graph,
ingest controls, run banner/history, and Wiki-like side sheet.

**Files**

- `apps/spaces/src/components/settings/SettingsKnowledgeGraph.tsx`
- `apps/spaces/src/components/settings/knowledge-graph/KnowledgeGraphExplorer.tsx`
- `apps/spaces/src/components/settings/knowledge-graph/KnowledgeGraphConfigPanel.tsx`
- `apps/spaces/src/components/settings/knowledge-graph/KnowledgeGraphIngestControls.tsx`
- `apps/spaces/src/components/settings/knowledge-graph/KnowledgeGraphRunBanner.tsx`
- `apps/spaces/src/components/settings/knowledge-graph/KnowledgeGraphEntitySheet.tsx`
- `apps/spaces/src/lib/settings-queries.ts`
- `apps/spaces/src/gql/graphql.ts`
- `apps/spaces/src/gql/gql.ts`

**Tests**

- `apps/spaces/src/components/settings/SettingsKnowledgeGraph.test.tsx`
- `apps/spaces/src/components/settings/knowledge-graph/KnowledgeGraphExplorer.test.tsx`

**Scenarios**

- Opening Settings > Knowledge Graph shows Explorer by default.
- Header info icon toggles between Explorer and existing configuration/status.
- Ingest controls let an operator search/select a thread and click `Ingest now`.
- Current/last run banner shows status, selected thread, counts, duration, and
  error summary.
- Run history shows compact recent runs.
- Table has required columns and opens entity detail sheet on row click.
- Graph view and table view use the same filters and selected thread scope.
- Entity sheet shows label, type/status, summary/properties, aliases,
  relationships, evidence snippets, message references, and neighbor
  re-anchoring.
- Non-operator users do not see the Settings nav item due to existing
  `OperatorGuard`.

### U8. Smoke Test, Docs, and E2E Validation

**Goal:** Provide a deployed-stage validation path before Phase II is considered
complete.

**Files**

- `scripts/smoke/knowledge-graph-thread-ingest-smoke.mjs`
- `scripts/smoke/README.md`
- `docs/solutions/best-practices/cognee-thread-ingest-explorer-2026-06-04.md`
- `docs/plans/cognee-terraform-infrastructure-autopilot-status.md` if
  continuing the existing autopilot status convention.

**Tests / Validation**

- `pnpm --filter @thinkwork/database-pg test`
- `pnpm --filter @thinkwork/api test`
- `pnpm --filter @thinkwork/graph test`
- `pnpm --filter @thinkwork/spaces test`
- `pnpm --filter @thinkwork/spaces typecheck`
- `pnpm --filter @thinkwork/spaces dev -- --host 127.0.0.1 --port 5174`
- Browser validation on `http://localhost:5174/settings/knowledge-graph`.
- Deployed smoke: select a real dev thread, run ingest, confirm graph/table
  rows and entity sheet evidence.

**Scenarios**

- Smoke script can start ingest for a supplied dev thread id and poll until
  success/failure.
- Smoke script verifies at least one graph query result or records an explicit
  empty-graph diagnostic when Cognee returns no nodes.
- Browser validation confirms default Explorer, config toggle, table/graph
  toggle, and side sheet behavior.

---

## Sequencing

1. U1 and U2 establish the durable contract and read APIs.
2. U3 and U4 add manual ingest and worker logic.
3. U5 makes the worker deployable and able to reach private Cognee.
4. U6 and U7 build the Explorer from the GraphQL contract.
5. U8 validates the end-to-end path locally and on the deployed dev stack.

U6 can start after U1/U2 schema shape is stable using fixture data, but final UI
acceptance depends on U4/U5 producing real normalized rows.

---

## Risks and Mitigations

- **Cognee API version drift.** The worker should isolate Cognee calls in
  `cognee-client.ts` and record the selected ingestion mode in run metadata.
  Tests should mock both `remember` and `add` + `cognify` paths.
- **Private networking mismatch.** Do not assume GraphQL can call Cognee because
  health checks currently use AWS control-plane probes. U5 must validate actual
  worker-to-Cognee connectivity.
- **Evidence gaps from Cognee graph output.** If Cognee's graph endpoint lacks
  source references, the normalizer should still create message-level evidence
  from extracted snippets or mark provenance as weak/missing. Do not hide the
  entity.
- **Ontology overtrust.** Grounding status is a UI/audit signal, not an approval
  workflow. Unknown types stay diagnostic.
- **Force graph regressions.** Follow the no-simulation-restart invariant from
  the Wiki graph solution docs and add tests around filter state derivation.
- **Thread privacy.** Thread and message content is sensitive. Every resolver
  must gate by tenant/operator and avoid cross-tenant id lookups.
- **Long-running ingest.** The GraphQL mutation should enqueue and return;
  Cognee work happens async with visible run status and errors.

---

## Acceptance Test Map

- AE1: U3/U4/U5/U8 prove selected complete-thread ingest through Cognee and run
  history recording.
- AE2: U7 proves Explorer default and info-icon configuration toggle.
- AE3: U1/U2/U6/U7 prove table/graph sync, trust states, and filters.
- AE4: U2/U6/U7 prove row/node click opens Wiki-like side sheet with evidence
  and neighbor navigation.
- AE5: U4/U7 preserve read-only Explorer behavior and no agent retrieval.

---

## Open Questions

### Resolved During Planning

- **Single thread or requester batch?** Start with single-thread ingest.
  Requester/user search is a picker convenience only. Multi-thread batch ingest
  is deferred.
- **Worker shape?** Use a dedicated async worker with private Cognee access.
  Prefer Lambda if VPC/security-group wiring is clean; otherwise use an ECS
  one-off task worker rather than exposing Cognee.
- **Normalized representation?** Store ThinkWork-normalized runs, entities,
  relationships, and evidence in Aurora.
- **Graph payload source?** GraphQL returns the normalized payload. Cognee's
  dataset graph is an upstream input, not the browser contract.
- **Run state storage?** Store run state in Aurora in
  `knowledge_graph_ingest_runs`.
- **Relationship evidence gaps?** Preserve diagnostic relationships and mark
  provenance `weak` or `missing` when Cognee does not provide enough source
  data.
- **Message evidence shape?** Store whole-message references plus snippets.
  Character offsets are optional and only stored when reliable.

### Deferred to Implementation

- Exact Cognee ingestion mode for the deployed image/version:
  `remember` versus `add` + `cognify`.
- Exact ontology handoff format: uploaded OWL ontology, Cognee `graphModel`, or
  custom prompt. The worker should pick the most reliable option for the
  deployed Cognee version and record it in metadata.
- Whether Lambda VPC attachment is sufficient for Cognee access or an ECS worker
  is cleaner in the current Terraform module.
- How much message `parts` content should be included in the transcript beyond
  plain `content` for assistant/tool messages.
