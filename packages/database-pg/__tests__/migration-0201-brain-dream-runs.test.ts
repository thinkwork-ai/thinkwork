import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(HERE, "..", "drizzle", "0201_brain_dream_runs.sql"),
  "utf-8",
);

describe("migration 0201 - brain dream runs ledger", () => {
  it("declares drift markers for both ledger tables, indexes, and constraints", () => {
    for (const marker of [
      "-- creates: public.brain_dream_runs",
      "-- creates: public.brain_dream_runs_dedupe_key_uidx",
      "-- creates: public.brain_dream_runs_tenant_bank_idx",
      "-- creates: public.brain_dream_runs_tenant_status_idx",
      "-- creates: public.brain_dream_actions",
      "-- creates: public.brain_dream_actions_run_ordinal_uidx",
      "-- creates: public.brain_dream_actions_run_status_idx",
      "-- creates-constraint: public.brain_dream_runs.brain_dream_runs_tenant_id_tenants_id_fk",
      "-- creates-constraint: public.brain_dream_runs.brain_dream_runs_status_check",
      "-- creates-constraint: public.brain_dream_actions.brain_dream_actions_run_id_brain_dream_runs_id_fk",
      "-- creates-constraint: public.brain_dream_actions.brain_dream_actions_type_check",
      "-- creates-constraint: public.brain_dream_actions.brain_dream_actions_status_check",
    ]) {
      expect(migration).toContain(marker);
    }
  });

  it("creates both tables idempotently with cascade cleanup", () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "brain_dream_runs"');
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS "brain_dream_actions"',
    );
    expect(migration.match(/ON DELETE cascade/g)?.length).toBe(2);
  });

  it("enforces the dedupe key uniqueness that guards idempotent runs", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "brain_dream_runs_dedupe_key_uidx"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "brain_dream_actions_run_ordinal_uidx"',
    );
  });
});
