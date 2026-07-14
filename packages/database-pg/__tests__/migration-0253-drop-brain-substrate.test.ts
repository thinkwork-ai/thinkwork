import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(HERE, "..", "drizzle", "0253_drop_brain_substrate.sql"),
  "utf-8",
);

const DROPPED_TABLES = [
  "substrate_events",
  "substrate_migrations",
  "substrate_states",
];

const DROPPED_COLUMNS = ["substrate_id", "migration_id"];

describe("0253_drop_brain_substrate", () => {
  it("declares a drops marker for each substrate table", () => {
    for (const table of DROPPED_TABLES) {
      expect(migration).toContain(`-- drops: brain.${table}`);
    }
  });

  it("declares drops-column markers for the artifact_manifests linkage columns", () => {
    for (const column of DROPPED_COLUMNS) {
      expect(migration).toContain(
        `-- drops-column: brain.artifact_manifests.${column}`,
      );
    }
  });

  it("drops every substrate table with an existence guard", () => {
    for (const table of DROPPED_TABLES) {
      expect(migration).toContain(`DROP TABLE IF EXISTS brain.${table};`);
    }
  });

  it("drops the artifact_manifests columns before the tables they reference", () => {
    const firstColumnDrop = migration.indexOf(
      "ALTER TABLE brain.artifact_manifests DROP COLUMN IF EXISTS",
    );
    const firstTableDrop = migration.indexOf("DROP TABLE IF EXISTS brain.");
    expect(firstColumnDrop).toBeGreaterThan(-1);
    expect(firstTableDrop).toBeGreaterThan(-1);
    expect(firstColumnDrop).toBeLessThan(firstTableDrop);
  });

  it("runs inside a single guarded transaction", () => {
    expect(migration).toContain("\\set ON_ERROR_STOP on");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("SET LOCAL lock_timeout");
    expect(migration.trim().endsWith("COMMIT;")).toBe(true);
  });
});
