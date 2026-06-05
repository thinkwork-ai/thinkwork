import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  KNOWLEDGE_GRAPH_EVIDENCE_SOURCE_KINDS,
  KNOWLEDGE_GRAPH_GROUNDING_STATUSES,
  KNOWLEDGE_GRAPH_INGEST_STATUSES,
  KNOWLEDGE_GRAPH_PROVENANCE_STATUSES,
  KNOWLEDGE_GRAPH_SOURCE_KINDS,
  knowledgeGraphEntities,
  knowledgeGraphEvidence,
  knowledgeGraphIngestRuns,
  knowledgeGraphRelationships,
} from "../src/schema/knowledge-graph";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0145 = readFileSync(
  join(HERE, "..", "drizzle", "0145_knowledge_graph_thread_ingest.sql"),
  "utf-8",
);
const migration0146 = readFileSync(
  join(HERE, "..", "drizzle", "0146_knowledge_graph_source_scope.sql"),
  "utf-8",
);

describe("Knowledge Graph schema", () => {
  it("defines tenant-scoped ingest runs with the manual run ledger fields", () => {
    expect(getTableName(knowledgeGraphIngestRuns)).toBe(
      "knowledge_graph_ingest_runs",
    );

    const columns = getTableColumns(knowledgeGraphIngestRuns);
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.thread_id.notNull).toBe(false);
    expect(columns.source_kind.notNull).toBe(true);
    expect(columns.source_kind.default).toBe("thread");
    expect(columns.source_ref.notNull).toBe(true);
    expect(columns.source_label.notNull).toBe(false);
    expect(columns.requested_by_user_id.notNull).toBe(false);
    expect(columns.status.default).toBe("queued");
    expect(columns.trigger.default).toBe("manual");
    expect(columns.cognee_dataset_name.notNull).toBe(true);
    expect(columns.entity_count.default).toBe(0);
    expect(columns.relationship_count.default).toBe(0);
    expect(columns.evidence_count.default).toBe(0);
    expect(columns.diagnostic_count.default).toBe(0);
    expect(columns.message_count.default).toBe(0);

    expect(KNOWLEDGE_GRAPH_INGEST_STATUSES).toEqual([
      "queued",
      "running",
      "succeeded",
      "failed",
      "canceled",
      "stale_noop",
    ]);
  });

  it("separates normalized entities, relationships, and evidence", () => {
    expect(getTableName(knowledgeGraphEntities)).toBe(
      "knowledge_graph_entities",
    );
    expect(getTableName(knowledgeGraphRelationships)).toBe(
      "knowledge_graph_relationships",
    );
    expect(getTableName(knowledgeGraphEvidence)).toBe(
      "knowledge_graph_evidence",
    );

    const entityColumns = getTableColumns(knowledgeGraphEntities);
    expect(entityColumns.ingest_run_id.notNull).toBe(true);
    expect(entityColumns.thread_id.notNull).toBe(false);
    expect(entityColumns.source_kind.default).toBe("thread");
    expect(entityColumns.source_ref.notNull).toBe(true);
    expect(entityColumns.cognee_node_id.notNull).toBe(true);
    expect(entityColumns.normalized_label.notNull).toBe(true);
    expect(entityColumns.aliases.notNull).toBe(true);
    expect(entityColumns.grounding_status.default).toBe("unknown");
    expect(entityColumns.provenance_status.default).toBe("missing");

    const relationshipColumns = getTableColumns(knowledgeGraphRelationships);
    expect(relationshipColumns.thread_id.notNull).toBe(false);
    expect(relationshipColumns.source_kind.default).toBe("thread");
    expect(relationshipColumns.source_ref.notNull).toBe(true);
    expect(relationshipColumns.source_entity_id.notNull).toBe(true);
    expect(relationshipColumns.target_entity_id.notNull).toBe(true);
    expect(relationshipColumns.confidence.notNull).toBe(false);

    const evidenceColumns = getTableColumns(knowledgeGraphEvidence);
    expect(evidenceColumns.thread_id.notNull).toBe(false);
    expect(evidenceColumns.source_kind.default).toBe("thread");
    expect(evidenceColumns.source_ref.notNull).toBe(true);
    expect(evidenceColumns.entity_id.notNull).toBe(false);
    expect(evidenceColumns.relationship_id.notNull).toBe(false);
    expect(evidenceColumns.message_id.notNull).toBe(false);
    expect(evidenceColumns.snippet.notNull).toBe(true);
    expect(evidenceColumns.evidence_source_kind.default).toBe("thread_message");
    expect(evidenceColumns.evidence_source_ref.notNull).toBe(false);
  });

  it("keeps trust and provenance status values explicit", () => {
    expect(KNOWLEDGE_GRAPH_SOURCE_KINDS).toEqual(["thread", "wiki", "brain"]);
    expect(KNOWLEDGE_GRAPH_GROUNDING_STATUSES).toEqual([
      "grounded",
      "unapproved_type",
      "ungrounded",
      "conflict",
      "unknown",
    ]);
    expect(KNOWLEDGE_GRAPH_PROVENANCE_STATUSES).toEqual([
      "strong",
      "weak",
      "missing",
    ]);
    expect(KNOWLEDGE_GRAPH_EVIDENCE_SOURCE_KINDS).toEqual([
      "thread_message",
      "wiki_page",
      "wiki_section",
      "brain_page",
      "brain_section",
      "cognee_payload",
      "normalizer",
    ]);
  });

  it("declares manual migration drift markers for every table and read index", () => {
    for (const table of [
      "knowledge_graph_ingest_runs",
      "knowledge_graph_entities",
      "knowledge_graph_relationships",
      "knowledge_graph_evidence",
    ]) {
      expect(migration0145).toMatch(
        new RegExp(`--\\s*creates:\\s*public\\.${table}\\b`),
      );
      expect(migration0145).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`),
      );
    }

    for (const indexName of [
      "idx_kg_ingest_runs_tenant_thread_created",
      "uq_kg_ingest_runs_active_thread",
      "idx_kg_entities_tenant_thread_label",
      "idx_kg_entities_tenant_thread_type",
      "idx_kg_entities_tenant_thread_trust",
      "idx_kg_relationships_tenant_thread_source",
      "idx_kg_relationships_tenant_thread_target",
      "idx_kg_evidence_tenant_thread_message",
    ]) {
      expect(migration0145).toMatch(
        new RegExp(`--\\s*creates:\\s*public\\.${indexName}\\b`),
      );
      expect(migration0145).toContain(indexName);
    }
  });

  it("declares source-scope migration markers for wiki and brain ingest", () => {
    for (const marker of [
      "public.knowledge_graph_ingest_runs.source_kind",
      "public.knowledge_graph_ingest_runs.source_ref",
      "public.knowledge_graph_ingest_runs.source_label",
      "public.knowledge_graph_entities.source_kind",
      "public.knowledge_graph_entities.source_ref",
      "public.knowledge_graph_relationships.source_kind",
      "public.knowledge_graph_relationships.source_ref",
      "public.knowledge_graph_evidence.source_kind",
      "public.knowledge_graph_evidence.source_ref",
      "public.knowledge_graph_evidence.evidence_source_kind",
      "public.knowledge_graph_evidence.evidence_source_ref",
    ]) {
      expect(migration0146).toMatch(
        new RegExp(`--\\s*creates-column:\\s*${marker}\\b`),
      );
    }

    for (const marker of [
      "public.idx_kg_ingest_runs_tenant_source_created",
      "public.uq_kg_ingest_runs_active_source",
      "public.idx_kg_entities_tenant_source_label",
      "public.idx_kg_relationships_tenant_source_type",
      "public.idx_kg_evidence_tenant_source",
    ]) {
      expect(migration0146).toMatch(
        new RegExp(`--\\s*creates:\\s*${marker}\\b`),
      );
      expect(migration0146).toContain(marker.replace("public.", ""));
    }

    expect(migration0146).toContain("ALTER COLUMN thread_id DROP NOT NULL");
    expect(migration0146).toContain("source_kind IN ('thread','wiki','brain')");
    expect(migration0146).toContain(
      "evidence_source_kind IN ('thread_message','wiki_page','wiki_section','brain_page','brain_section','cognee_payload','normalizer')",
    );
  });

  it("guards derived graph rows against cross-tenant and cross-thread links", () => {
    for (const functionName of [
      "enforce_knowledge_graph_ingest_run_scope",
      "enforce_knowledge_graph_entity_scope",
      "enforce_knowledge_graph_relationship_scope",
      "enforce_knowledge_graph_evidence_scope",
    ]) {
      expect(migration0145).toMatch(
        new RegExp(`--\\s*creates-function:\\s*public\\.${functionName}\\b`),
      );
      expect(migration0145).toContain(
        `CREATE OR REPLACE FUNCTION public.${functionName}`,
      );
    }

    for (const triggerName of [
      "knowledge_graph_ingest_runs_scope_guard",
      "knowledge_graph_entities_scope_guard",
      "knowledge_graph_relationships_scope_guard",
      "knowledge_graph_evidence_scope_guard",
    ]) {
      expect(migration0145).toMatch(
        new RegExp(`--\\s*creates-trigger:[\\s\\S]*\\.${triggerName}\\b`),
      );
      expect(migration0145).toContain(`CREATE TRIGGER ${triggerName}`);
    }

    expect(migration0145).toContain(
      "knowledge graph relationship source scope mismatch",
    );
    expect(migration0145).toContain(
      "knowledge graph evidence message scope mismatch",
    );
    expect(migration0145).toContain(
      "knowledge graph entity ontology tenant mismatch",
    );
  });

  it("rejects unknown run, grounding, provenance, and evidence source states in SQL", () => {
    expect(migration0145).toMatch(
      /knowledge_graph_ingest_runs_status_allowed[\s\S]*'queued'[\s\S]*'running'[\s\S]*'succeeded'[\s\S]*'failed'[\s\S]*'canceled'[\s\S]*'stale_noop'/,
    );
    expect(migration0145).toMatch(
      /knowledge_graph_entities_grounding_allowed[\s\S]*'grounded'[\s\S]*'unapproved_type'[\s\S]*'ungrounded'[\s\S]*'conflict'[\s\S]*'unknown'/,
    );
    expect(migration0145).toMatch(
      /knowledge_graph_relationships_provenance_allowed[\s\S]*'strong'[\s\S]*'weak'[\s\S]*'missing'/,
    );
    expect(migration0145).toMatch(
      /knowledge_graph_evidence_source_kind_allowed[\s\S]*'thread_message'[\s\S]*'cognee_payload'[\s\S]*'normalizer'/,
    );
    expect(migration0145).toContain(
      "CHECK (entity_id IS NOT NULL OR relationship_id IS NOT NULL)",
    );
  });
});
