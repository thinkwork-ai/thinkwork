---
title: "feat: Company Brain artifact manifests"
type: feat
status: active
date: 2026-06-14
origin: docs/plans/2026-06-13-003-feat-company-brain-physical-substrate-plan.md
linear: THNK-19
---

# feat: Company Brain artifact manifests

## Overview

THNK-19 implements the U3 slice from the Company Brain physical substrate plan: make S3 the durable replay and projection layer for Company Brain. The work adds canonical Brain artifact storage separate from short-lived wiki exports, persists replayable ingest manifests, records vault projections as projections rather than graph source of truth, and keeps credential and S3 identifier leakage out of tenant-visible surfaces.

---

## Problem Frame

Today the Knowledge Graph ingest pipeline can queue runs, send rendered source documents to Cognee, normalize graph snapshots into Aurora, and export wiki/vault markdown into a short-lived `wiki_exports` bucket. That proves graph observability, but it does not yet create a durable replay layer for Company Brain. Production migration and provenance need exact source artifacts, metadata, checksums, ontology and embedding evidence, and S3 object references that can be enumerated later without treating the markdown vault as canonical storage.

---

## Requirements Trace

- R1. Canonical Brain source artifacts, ingestion manifests, migration snapshots, vault projections, and exports live in substrate-owned S3 locations, not the `wiki_exports` bucket.
- R2. Every Brain ingest batch writes a replayable manifest linked to source artifacts.
- R3. Manifest metadata includes source ids, source type, ontology version, embedding model, vector dimension, checksums, and S3 object references.
- R4. Migration/replay code can enumerate exact source artifacts and metadata from manifests.
- R5. Vault/materialized output is represented as a projection, not the graph source of truth.
- R6. Existing deterministic source families expose stable source/DataPoint metadata where practical.
- R7. Source-connector credentials are contractually separated from source ids and artifacts: per-tenant secrets, least privilege, rotation/revocation, and no secrets in manifests, logs, traces, or client errors.
- R8. Tenant-visible errors redact S3 object keys/source ids unless the caller is in an operator evidence path.

**Origin acceptance examples:** AE1 default tier stores canonical artifacts in S3, AE3 migration replays from S3 and validates parity.

---

## Scope Boundaries

- Do not build default-to-production migration orchestration; this unit supplies the manifest substrate it will use.
- Do not implement broad dlt-style structured ingestion for CRM, ERP, databases, repositories, or tabular sources.
- Do not replace the existing wiki export schedule; update it to write projection evidence to canonical Brain storage while preserving its current short-lived export behavior.
- Do not surface raw S3 keys, source ids, Cognee internals, or credentials in end-user payloads.
- Do not introduce a new customer-visible Cognee product surface.

### Deferred to Follow-Up Work

- Migration phases, replay validation thresholds, and cutover/rollback behavior: THNK-6 U4.
- First-party Brain retrieval provenance through Context Engine: THNK-20.
- External Brain MCP registration/token lifecycle and egress controls: later THNK-6 slice.

---

## Context & Research

### Relevant Code and Patterns

- `terraform/modules/app/lambda-api/handlers.tf` defines handler env wiring and the existing `wiki_exports` bucket.
- `terraform/modules/app/lambda-api/iam-grouped.tf` is the only place to add shared API Lambda S3 grants.
- `packages/database-pg/src/schema/knowledge-graph.ts` holds ingest run/entity/relationship/evidence tables and source-kind enums.
- `packages/database-pg/graphql/types/knowledge-graph.graphql` is the canonical GraphQL type source.
- `packages/api/src/handlers/knowledge-graph-thread-ingest.ts` centralizes thread/wiki source bundles before Cognee ingest.
- `packages/api/src/handlers/knowledge-graph-observations-ingest.ts` handles stable per-tenant observations ingest.
- `packages/api/src/handlers/wiki-export.ts` emits short-lived markdown vault bundles to `WIKI_EXPORT_BUCKET`.
- `packages/api/src/lib/knowledge-graph/runs.ts` creates run records and source metadata.
- `packages/api/src/lib/knowledge-graph/source-adapters.ts`, `wiki-source.ts`, and `thread-transcript.ts` define existing source bundle/document metadata.

### Institutional Learnings

- `docs/solutions/best-practices/cognee-thread-ingest-explorer-2026-06-04.md`: deployed verification should go through ThinkWork GraphQL/smoke paths, not direct Cognee ALB access.
- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`: hand-rolled migrations need markers and dev drift awareness.
- `docs/solutions/best-practices/oauth-client-credentials-in-secrets-manager-2026-04-21.md`: source credentials belong in managed secrets, not env/log/S3 payloads.
- `docs/solutions/design-patterns/gitkeep-materialization-s3-empty-folders-2026-05-13.md`: S3 prefixes are object-derived; durable folder semantics require actual objects and careful key design.

### External References

- Upstream THNK-6 plan already reviewed Cognee and AWS storage documentation. No new external dependency is required for this bounded implementation.

---

## Key Technical Decisions

- Add a dedicated `thinkwork-${stage}-brain-artifacts` bucket in `lambda-api`, with public access blocked, encryption enabled, HTTPS-only policy, and lifecycle rules by object class.
- Wire `BRAIN_ARTIFACTS_BUCKET` to `knowledge-graph-thread-ingest`, `knowledge-graph-observations-ingest`, and `wiki-export`; keep `WIKI_EXPORT_BUCKET` for legacy short-lived export output.
- Reuse and extend the existing `brain.artifact_manifests` substrate ledger from THNK-15 instead of creating a second Knowledge Graph manifest table.
- Store S3 URIs and source ids in internal S3 manifests and database rows for operator/replay use, but expose only redacted manifest summaries through tenant-visible GraphQL.
- Write source artifacts and ingestion manifests after source validation and before Cognee ingest so the source batch is replayable even if downstream indexing fails. Failure paths should record safe failure metadata without exposing raw keys to client errors.
- Treat wiki export output as `vault_projection` manifest class in canonical Brain storage while still writing the current `vault.md.gz` bundle to `wiki_exports`.
- Express the source-connector credential contract in types/docs/tests now, but keep actual connector ingestion out of this PR.

---

## Open Questions

### Resolved During Planning

- **Is `wiki_exports` canonical Brain storage?** No. It remains a short-lived export bucket.
- **Is the vault source of truth?** No. Vault markdown is a projection of graph/source state.
- **Should this PR build migration replay?** No. It must make manifests enumerable for a later migration PR.

### Deferred to Implementation

- Migration filename/ordinal resolved as `0167_company_brain_artifact_manifest_runtime.sql`.
- The composite module wires the existing stage KMS key to the Brain artifacts bucket; the lower `lambda-api` module keeps an AES256 fallback for standalone use.
- Tenant-visible GraphQL field naming resolved as `KnowledgeGraphArtifactManifestSummary` on `KnowledgeGraphIngestRun`.

---

## Implementation Units

- U1. **Canonical Brain S3 Bucket and Handler Wiring**

**Goal:** Add substrate-owned S3 storage for Brain artifacts and wire only the handlers that need it.

**Requirements:** R1, R5, R8

**Dependencies:** None

**Files:**

- Modify: `terraform/modules/app/lambda-api/handlers.tf`
- Modify: `terraform/modules/app/lambda-api/iam-grouped.tf`
- Modify: `terraform/modules/app/lambda-api/outputs.tf`
- Test: `apps/cli/__tests__/terraform-cognee-fixture.test.ts` or nearest Terraform fixture test if the module snapshot covers lambda-api resources

**Approach:**

- Create the canonical bucket separate from `wiki_exports`.
- Add public access block, encryption, HTTPS-only bucket policy, lifecycle rules for artifact classes, and tags.
- Add S3 read/write permissions for the shared API Lambda role scoped to the Brain artifact bucket.
- Add `BRAIN_ARTIFACTS_BUCKET` env to `knowledge-graph-thread-ingest`, `knowledge-graph-observations-ingest`, and `wiki-export`.

**Patterns to follow:**

- `terraform/modules/app/lambda-api/handlers.tf`
- `terraform/modules/app/lambda-api/iam-grouped.tf`
- `terraform/modules/app/routines-stepfunctions/main.tf`
- `terraform/modules/data/s3-buckets/main.tf`

**Test scenarios:**

- Happy path: Terraform rendering includes a distinct Brain artifacts bucket and does not repoint `WIKI_EXPORT_BUCKET`.
- Error path: handler env remains absent only for handlers that do not need Brain artifacts.
- Security: bucket policy denies non-TLS access and public access is blocked.

**Verification:**

- Terraform validation or targeted fixture tests show bucket/env/IAM resources render correctly.

---

- U2. **Manifest Schema and Redacted API Shape**

**Goal:** Persist replayable Brain artifact manifests and expose safe summaries for status/replay consumers.

**Requirements:** R2, R3, R4, R7, R8

**Dependencies:** U1

**Files:**

- Modify: `packages/database-pg/src/schema/brain.ts`
- Modify: `packages/database-pg/graphql/types/knowledge-graph.graphql`
- Create: `packages/database-pg/drizzle/0167_company_brain_artifact_manifest_runtime.sql`
- Modify: `packages/api/src/graphql/resolvers/knowledge-graph/mappers.ts`
- Modify: `packages/api/src/graphql/resolvers/knowledge-graph/ingestRuns.query.ts`
- Modify: `packages/api/src/__tests__/knowledge-graph-resolvers.test.ts`
- Test: `packages/database-pg/__tests__/migration-0167-company-brain-artifact-manifests.test.ts`

**Approach:**

- Extend `brain.artifact_manifests` with ingest-run linkage and tenant/source scope.
- Include manifest kind, S3 URI/version/checksum metadata, source ids, source type, ontology version/mechanism, embedding model, vector dimension, content metadata, and projection metadata.
- Keep raw S3 URIs and source identifiers available in internal DB/S3 records but redacted from tenant-visible GraphQL fields.
- Add helpers for redacted summaries so future operator evidence paths can opt into raw references intentionally.

**Patterns to follow:**

- Existing `brain.artifact_manifests` table/check/index style.
- Existing mapper enum/AWSJSON serialization style in knowledge graph resolvers.
- Manual migration marker guidance from `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`.

**Test scenarios:**

- Happy path: manifest summaries appear on ingest run results with artifact class, checksum, status, and redacted object reference.
- Edge case: missing optional vector dimension or embedding model remains explicit as null/unknown rather than lying.
- Security: GraphQL does not return raw S3 object keys, bucket names, or source ids in tenant-visible run payloads.
- Migration: SQL header declares all created tables, indexes, constraints, and columns with correct drift markers.

**Verification:**

- Schema tests and GraphQL resolver tests prove manifest persistence shape and redaction behavior.

---

- U3. **Artifact and Manifest Writes from Ingest and Vault Paths**

**Goal:** Write source artifacts and projection manifests for existing thread/wiki/observations/vault paths.

**Requirements:** R2, R3, R4, R5, R6, R7, R8

**Dependencies:** U1, U2

**Files:**

- Create: `packages/api/src/lib/knowledge-graph/artifacts.ts`
- Modify: `packages/api/src/handlers/knowledge-graph-thread-ingest.ts`
- Modify: `packages/api/src/handlers/knowledge-graph-observations-ingest.ts`
- Modify: `packages/api/src/handlers/wiki-export.ts`
- Reuse: `packages/api/src/lib/knowledge-graph/source-adapters.ts`
- Reuse: `packages/api/src/lib/knowledge-graph/wiki-source.ts`
- Reuse: `packages/api/src/lib/knowledge-graph/thread-transcript.ts`
- Test: `packages/api/src/handlers/knowledge-graph-thread-ingest.test.ts`
- Test: `packages/api/src/handlers/knowledge-graph-observations-ingest.test.ts`
- Test: `packages/api/src/__tests__/wiki-export.test.ts`
- Test: `packages/api/src/lib/knowledge-graph/artifacts.test.ts`

**Approach:**

- Implement tenant-scoped key builders and checksum helpers in one module.
- For source ingest, write the rendered source document and an ingestion manifest to the Brain artifacts bucket after source validation and before Cognee ingest.
- For observations ingest, write the stable observations document and manifest when there are promoted source candidates; stale no-op runs should not create fake artifacts.
- For wiki export, keep the existing short-lived export behavior and additionally write the compressed vault projection to the Brain artifacts bucket with a projection manifest.
- Include deterministic source metadata in packets/evidence where existing stable ids exist; avoid inventing broad structured connector support.
- Ensure thrown errors and returned error payloads redact S3 keys/source ids.

**Patterns to follow:**

- `packages/api/src/__tests__/wiki-export.test.ts` for S3 mocking.
- `packages/api/src/lib/knowledge-graph/repository.ts` for run completion/error handling.
- `packages/api/src/lib/knowledge-graph/source-adapters.ts` for deterministic source packet metadata.

**Test scenarios:**

- Happy path: thread ingest writes a source artifact and manifest linked to the run.
- Happy path: wiki ingest writes source artifact metadata with stable page ids represented as redacted source references.
- Happy path: observations ingest writes a source artifact only when source candidates exist.
- Happy path: wiki export still writes to `WIKI_EXPORT_BUCKET` and also writes a canonical `vault_projection` artifact to `BRAIN_ARTIFACTS_BUCKET`.
- Edge case: `BRAIN_ARTIFACTS_BUCKET` missing disables canonical writes with a clear server-side diagnostic and no credential/key leakage.
- Error path: S3 write failures mark the run failed without exposing raw object keys in returned errors.
- Security: manifests/log-safe summaries do not include connector secrets or source credential material.

**Verification:**

- Focused handler tests prove artifact writes, manifest rows, legacy export preservation, and redaction.

---

- U4. **Docs, Codegen, and Smoke Coverage**

**Goal:** Make the new artifact substrate discoverable to operators and future migration/retrieval slices.

**Requirements:** R1-R8

**Dependencies:** U1, U2, U3

**Files:**

- Modify: generated GraphQL artifacts for changed consumers as required
- Modify: this plan and `docs/plans/autopilot/THNK-19-status.md`

**Approach:**

- Capture implementation and verification details in the plan and autopilot status doc.
- Leave deployed smoke script expansion to the follow-up replay/retrieval slice; this PR adds the manifest data those scripts can later report.
- Regenerate schema/codegen for affected packages following repo instructions.

**Patterns to follow:**

- AGENTS.md GraphQL schema/codegen workflow.

**Test scenarios:**

- Happy path: generated GraphQL clients include `KnowledgeGraphArtifactManifestSummary` and `BRAIN` source kind.
- Security: resolver tests prove tenant-visible summaries omit object keys and source ids.
- Docs: Company Brain, not Cognee, is the customer-facing product language.

**Verification:**

- Focused tests plus generated schema/codegen diffs are clean.

---

## System-Wide Impact

- **Terraform:** Adds a canonical Brain artifact bucket, policies, env wiring, and IAM grants in `lambda-api`.
- **Database:** Extends `brain.artifact_manifests` with runtime manifest metadata linked to knowledge graph ingest runs.
- **GraphQL:** Extends knowledge graph run summaries with redacted manifest/projection evidence.
- **Knowledge Graph ingest:** Adds source artifact writes before Cognee ingest while preserving current Cognee dataset behavior.
- **Wiki export:** Preserves existing short-lived export output and adds canonical projection output.
- **Security:** Prevents credentials, raw object keys, and source ids from leaking into tenant-visible payloads.

---

## Risks & Dependencies

| Risk                                                      | Mitigation                                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Canonical Brain artifacts accidentally use `wiki_exports` | Terraform/env tests and handler tests assert separate buckets.                                                      |
| S3 object keys leak in tenant-visible errors              | Central redaction helper and resolver tests.                                                                        |
| Manifest writes make ingest brittle                       | Keep artifact writes explicit and fail runs safely with redacted diagnostics; do not partially claim replayability. |
| Manual migration drifts from dev                          | Add correct migration markers and run drift reporter before PR.                                                     |
| Scope expands into migration or broad connectors          | Keep U4/U5 migration and structured-source expansion explicitly deferred.                                           |

---

## Documentation / Operational Notes

- Update operator docs to explain Brain artifact classes and retention posture.
- State that source connector credentials must live in per-tenant managed secrets and never in manifests/S3/logs/traces.
- Do not imply production migration exists until a later THNK-6 slice implements replay and validation.

---

## Sources & References

- Origin plan: `docs/plans/2026-06-13-003-feat-company-brain-physical-substrate-plan.md`
- Origin requirements: `docs/brainstorms/2026-06-13-company-brain-physical-substrate-requirements.md`
- THNK-19 Linear issue
- Related prerequisite plan: `docs/plans/2026-06-13-002-feat-company-brain-premium-plugin-plan.md`
