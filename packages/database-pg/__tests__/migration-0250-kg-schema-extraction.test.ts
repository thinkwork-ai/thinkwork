import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  kgEntities,
  kgEvidence,
  kgIngestRuns,
  kgObservationCursors,
  kgRelationships,
} from "../src/schema/knowledge-graph";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(HERE, "..", "drizzle", "0250_kg_schema_extraction.sql"),
  "utf-8",
);

const MOVES: Array<[oldName: string, newName: string]> = [
  ["knowledge_graph_ingest_runs", "ingest_runs"],
  ["knowledge_graph_entities", "entities"],
  ["knowledge_graph_relationships", "relationships"],
  ["knowledge_graph_evidence", "evidence"],
  ["knowledge_graph_observation_cursors", "observation_cursors"],
];

describe("migration 0250 — kg schema extraction", () => {
  it("moves every table with symmetric pre-flight guards and a compat view", () => {
    for (const [oldName, newName] of MOVES) {
      expect(migration).toContain(`to_regclass('public.${oldName}')`);
      expect(migration).toContain(`to_regclass('kg.${newName}')`);
      expect(migration).toContain(
        `ALTER TABLE public.${oldName} SET SCHEMA kg;`,
      );
      expect(migration).toContain(
        `ALTER TABLE kg.${oldName} RENAME TO ${newName};`,
      );
      expect(migration).toContain(`CREATE VIEW public.${oldName} AS`);
      expect(migration).toMatch(
        new RegExp(`--\\s*creates:\\s*kg\\.${newName}\\b`),
      );
      expect(migration).toMatch(
        new RegExp(`--\\s*creates:\\s*public\\.${oldName}\\b`),
      );
    }
  });

  it("declares safety rails for unattended application", () => {
    expect(migration).toContain("\\set ON_ERROR_STOP on");
    expect(migration).toContain(
      "pg_advisory_xact_lock(hashtext('kg_schema_extraction'))",
    );
    expect(migration).toContain("current_database() != 'thinkwork'");
    expect(migration).toContain("SET LOCAL lock_timeout");
    expect(migration).toContain("SET LOCAL statement_timeout");
  });

  it("renames every CHECK constraint to the new table stems with markers", () => {
    for (const table of [
      kgIngestRuns,
      kgEntities,
      kgRelationships,
      kgEvidence,
    ]) {
      const cfg = getTableConfig(table);
      expect(cfg.schema).toBe("kg");
      for (const check of cfg.checks) {
        // Every old CHECK name was the new name with the knowledge_graph_
        // prefix; the rename table must map each one.
        expect(migration).toContain(`'knowledge_graph_${check.name}',`);
        expect(migration).toMatch(
          new RegExp(
            `--\\s*creates-constraint:\\s*kg\\.${cfg.name}\\.${check.name}\\b`,
          ),
        );
      }
    }
  });

  it("re-points the scope-guard functions at kg.* and leaves no stale references", () => {
    for (const fn of [
      "enforce_knowledge_graph_entity_scope",
      "enforce_knowledge_graph_relationship_scope",
      "enforce_knowledge_graph_evidence_scope",
    ]) {
      expect(migration).toContain(`CREATE OR REPLACE FUNCTION public.${fn}()`);
    }
    expect(migration).toContain("FROM kg.ingest_runs");
    expect(migration).toContain("FROM kg.entities AS e");
    expect(migration).toContain("FROM kg.relationships AS r");
    // The function bodies must not read through the compat views — they
    // would break when U4 drops them.
    expect(migration).not.toMatch(/FROM public\.knowledge_graph_/);
  });

  it("enumerates every current column in each compat view", () => {
    const tables = [
      kgIngestRuns,
      kgEntities,
      kgRelationships,
      kgEvidence,
      kgObservationCursors,
    ];
    for (const table of tables) {
      const cfg = getTableConfig(table);
      const viewMatch = migration.match(
        new RegExp(
          `CREATE VIEW public\\.knowledge_graph_${cfg.name} AS\\s+SELECT ([\\s\\S]*?)\\s+FROM kg\\.${cfg.name};`,
        ),
      );
      expect(viewMatch, `view for kg.${cfg.name}`).toBeTruthy();
      const enumerated = viewMatch![1]
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      const columns = cfg.columns.map((c) => c.name);
      expect(enumerated.sort()).toEqual([...columns].sort());
    }
  });
});
