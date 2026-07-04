import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0208 = readFileSync(
  join(HERE, "..", "drizzle", "0208_knowledge_graph_neutral_identifiers.sql"),
  "utf-8",
);

describe("migration 0208 — Knowledge Graph neutral identifiers", () => {
  it("renames deployed old columns and indexes behind existence guards", () => {
    expect(migration0208).toContain(
      "to_regclass('public.knowledge_graph_ingest_runs')",
    );
    expect(migration0208).toContain("retired_prefix text := 'co' || 'gnee'");
    expect(migration0208).toContain(
      "old_dataset_name text := retired_prefix || '_dataset_name'",
    );
    expect(migration0208).toContain(
      "old_dataset_id text := retired_prefix || '_dataset_id'",
    );
    expect(migration0208).toContain(
      "old_node_id text := retired_prefix || '_node_id'",
    );
    expect(migration0208).toContain(
      "old_edge_id text := retired_prefix || '_edge_id'",
    );
    expect(migration0208).toContain("RENAME COLUMN %I TO source_dataset_name");
    expect(migration0208).toContain("RENAME COLUMN %I TO source_dataset_id");
    expect(migration0208).toContain("RENAME COLUMN %I TO graph_node_id");
    expect(migration0208).toContain("RENAME COLUMN %I TO graph_edge_id");
    expect(migration0208).toContain(
      "old_entity_index text := 'uq_kg_entities_run_' || retired_prefix || '_node'",
    );
    expect(migration0208).toContain(
      "old_relationship_index text := 'uq_kg_relationships_run_' || retired_prefix || '_edge'",
    );
    expect(migration0208).toContain("RENAME TO uq_kg_entities_run_graph_node");
    expect(migration0208).toContain(
      "RENAME TO uq_kg_relationships_run_graph_edge",
    );
  });

  it("migrates persisted mechanism, evidence-kind, and wiki tag values", () => {
    expect(migration0208).toContain(
      "SET evidence_source_kind = 'graph_payload'",
    );
    expect(migration0208).toContain("retired_payload text :=");
    expect(migration0208).toContain(
      "WHERE evidence_source_kind = retired_payload",
    );
    expect(migration0208).toContain(
      "SET ontology_mechanism = 'approved_ontology'",
    );
    expect(migration0208).toContain("retired_mechanism text :=");
    expect(migration0208).toContain(
      "WHERE ontology_mechanism = retired_mechanism",
    );
    expect(migration0208).toContain(
      "retired_tag text := 'company-' || 'brain'",
    );
    expect(migration0208).toContain(
      "CASE WHEN tag = retired_tag THEN 'brain' ELSE tag END",
    );
    expect(migration0208).toContain("WHERE tags @> ARRAY[retired_tag]::text[]");
  });

  it("upgrades already-applied brain substrate rows to the neutral schema contract", () => {
    expect(migration0208).toContain("to_regclass('brain.substrate_states')");
    expect(migration0208).toContain(
      "old_version_column text := retired_prefix || '_version'",
    );
    expect(migration0208).toContain(
      "old_endpoint_column text := retired_prefix || '_endpoint'",
    );
    expect(migration0208).toContain(
      "old_backend_value text := 'legacy_' || retired_prefix",
    );
    expect(migration0208).toContain("RENAME COLUMN %I TO substrate_version");
    expect(migration0208).toContain("RENAME COLUMN %I TO substrate_endpoint");
    expect(migration0208).toContain(
      "DROP CONSTRAINT IF EXISTS brain_substrate_states_backend_allowed",
    );
    expect(migration0208).toContain("SET active_backend = 'legacy_graph'");
    expect(migration0208).toContain("WHERE active_backend = old_backend_value");
    expect(migration0208).toContain(
      "CHECK (active_backend IN ('none', 'default', 'production', 'legacy_graph'))",
    );
  });

  it("declares drift-reporter markers for the new column, index, and constraint names", () => {
    expect(migration0208).toContain(
      "-- creates-column: public.knowledge_graph_ingest_runs.source_dataset_name",
    );
    expect(migration0208).toContain(
      "-- creates-column: public.knowledge_graph_ingest_runs.source_dataset_id",
    );
    expect(migration0208).toContain(
      "-- creates-column: public.knowledge_graph_entities.graph_node_id",
    );
    expect(migration0208).toContain(
      "-- creates-column: public.knowledge_graph_relationships.graph_edge_id",
    );
    expect(migration0208).toContain(
      "-- creates-column: brain.substrate_states.substrate_version",
    );
    expect(migration0208).toContain(
      "-- creates-column: brain.substrate_states.substrate_endpoint",
    );
    expect(migration0208).toContain(
      "-- creates: public.uq_kg_entities_run_graph_node",
    );
    expect(migration0208).toContain(
      "-- creates: public.uq_kg_relationships_run_graph_edge",
    );
    expect(migration0208).toContain(
      "-- creates-constraint: public.knowledge_graph_evidence.knowledge_graph_evidence_evidence_source_kind_allowed",
    );
    expect(migration0208).toContain(
      "-- creates-constraint: brain.substrate_states.brain_substrate_states_backend_allowed",
    );
  });
});
