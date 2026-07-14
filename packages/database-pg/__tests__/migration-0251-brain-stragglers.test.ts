import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  brainDreamActions,
  brainDreamRuns,
} from "../src/schema/brain-dream-runs";
import { brainRetainAttempts } from "../src/schema/memory-retain-attempts";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(HERE, "..", "drizzle", "0251_brain_stragglers.sql"),
  "utf-8",
);

const MOVES: Array<[oldName: string, newName: string]> = [
  ["brain_dream_runs", "dream_runs"],
  ["brain_dream_actions", "dream_actions"],
  ["memory_retain_attempts", "retain_attempts"],
];

const OLD_STEM: Record<string, string> = {
  dream_runs: "brain_dream_runs",
  dream_actions: "brain_dream_actions",
  retain_attempts: "memory_retain_attempts",
};

describe("migration 0251 — brain stragglers", () => {
  it("moves every table with symmetric pre-flight guards and a compat view", () => {
    for (const [oldName, newName] of MOVES) {
      expect(migration).toContain(`to_regclass('public.${oldName}')`);
      expect(migration).toContain(`to_regclass('brain.${newName}')`);
      expect(migration).toContain(
        `ALTER TABLE public.${oldName} SET SCHEMA brain;`,
      );
      expect(migration).toContain(
        `ALTER TABLE brain.${oldName} RENAME TO ${newName};`,
      );
      expect(migration).toContain(`CREATE VIEW public.${oldName} AS`);
      expect(migration).toMatch(
        new RegExp(`--\\s*creates:\\s*brain\\.${newName}\\b`),
      );
      expect(migration).toMatch(
        new RegExp(`--\\s*creates:\\s*public\\.${oldName}\\b`),
      );
    }
  });

  it("declares safety rails for unattended application", () => {
    expect(migration).toContain("\\set ON_ERROR_STOP on");
    expect(migration).toContain(
      "pg_advisory_xact_lock(hashtext('brain_stragglers_extraction'))",
    );
    expect(migration).toContain("current_database() != 'thinkwork'");
    expect(migration).toContain("SET LOCAL lock_timeout");
    expect(migration).toContain("SET LOCAL statement_timeout");
    expect(migration).toContain("to_regnamespace('brain')");
  });

  it("renames every index and CHECK constraint to the new stems with markers", () => {
    for (const table of [
      brainDreamRuns,
      brainDreamActions,
      brainRetainAttempts,
    ]) {
      const cfg = getTableConfig(table);
      expect(cfg.schema).toBe("brain");
      const oldStem = OLD_STEM[cfg.name];

      for (const idx of cfg.indexes) {
        const newName = idx.config.name!;
        const oldName = newName.replace(cfg.name, oldStem);
        expect(migration).toContain(`('${oldName}',`);
        expect(migration).toContain(`'${newName}')`);
        expect(migration).toMatch(
          new RegExp(`--\\s*creates:\\s*brain\\.${newName}\\b`),
        );
      }

      for (const check of cfg.checks) {
        const oldName = check.name.replace(cfg.name, oldStem);
        expect(migration).toContain(`'${oldName}',`);
        expect(migration).toMatch(
          new RegExp(
            `--\\s*creates-constraint:\\s*brain\\.${cfg.name}\\.${check.name}\\b`,
          ),
        );
      }
    }
  });

  it("enumerates every current column in each compat view", () => {
    for (const table of [
      brainDreamRuns,
      brainDreamActions,
      brainRetainAttempts,
    ]) {
      const cfg = getTableConfig(table);
      const oldStem = OLD_STEM[cfg.name];
      const viewMatch = migration.match(
        new RegExp(
          `CREATE VIEW public\\.${oldStem} AS\\s+SELECT ([\\s\\S]*?)\\s+FROM brain\\.${cfg.name};`,
        ),
      );
      expect(viewMatch, `view for brain.${cfg.name}`).toBeTruthy();
      const enumerated = viewMatch![1]
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      const columns = cfg.columns.map((c) => c.name);
      expect(enumerated.sort()).toEqual([...columns].sort());
    }
  });
});
