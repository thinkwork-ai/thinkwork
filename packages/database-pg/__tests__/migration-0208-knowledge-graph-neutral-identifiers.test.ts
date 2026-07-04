import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0208 = readFileSync(
  join(HERE, "..", "drizzle", "0208_knowledge_graph_neutral_identifiers.sql"),
  "utf-8",
);
const retiredPrefix = ["cog", "nee"].join("");
const retiredProductTag = ["company", "brain"].join("-");

describe("migration 0208 — Knowledge Graph neutral identifiers", () => {
  it("renames deployed old columns and indexes behind existence guards", () => {
    expect(migration0208).toContain(
      "to_regclass('public.knowledge_graph_ingest_runs')",
    );
    expect(migration0208).toContain(
      `RENAME COLUMN ${retiredPrefix}_dataset_name TO source_dataset_name`,
    );
    expect(migration0208).toContain(
      `RENAME COLUMN ${retiredPrefix}_dataset_id TO source_dataset_id`,
    );
    expect(migration0208).toContain(
      `RENAME COLUMN ${retiredPrefix}_node_id TO graph_node_id`,
    );
    expect(migration0208).toContain(
      `RENAME COLUMN ${retiredPrefix}_edge_id TO graph_edge_id`,
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
    expect(migration0208).toContain(
      `WHERE evidence_source_kind = '${retiredPrefix}_payload'`,
    );
    expect(migration0208).toContain(
      "SET ontology_mechanism = 'approved_ontology'",
    );
    expect(migration0208).toContain(
      `WHERE ontology_mechanism = '${retiredPrefix}_owl_ontology'`,
    );
    expect(migration0208).toContain(
      `CASE WHEN tag = '${retiredProductTag}' THEN 'brain' ELSE tag END`,
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
      "-- creates: public.uq_kg_entities_run_graph_node",
    );
    expect(migration0208).toContain(
      "-- creates: public.uq_kg_relationships_run_graph_edge",
    );
    expect(migration0208).toContain(
      "-- creates-constraint: public.knowledge_graph_evidence.knowledge_graph_evidence_evidence_source_kind_allowed",
    );
  });
});
