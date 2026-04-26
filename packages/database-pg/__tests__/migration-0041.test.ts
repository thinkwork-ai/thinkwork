import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0041 = readFileSync(
  join(HERE, "..", "drizzle", "0041_activation_automation_candidates.sql"),
  "utf-8",
);

describe("migration 0041 — activation automation candidates", () => {
  it("declares every drift-detected object", () => {
    const expectedCreates = [
      "public.activation_automation_candidates",
      "public.idx_activation_automation_candidates_session",
      "public.idx_activation_automation_candidates_user_status",
      "public.uq_activation_automation_candidates_active_duplicate",
    ];

    for (const name of expectedCreates) {
      expect(migration0041).toMatch(
        new RegExp(`--\\s*creates:\\s*${name.replace(/\./g, "\\.")}\\b`),
      );
    }
  });

  it("uses idempotent DDL for table, constraints, and indexes", () => {
    expect(migration0041).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.activation_automation_candidates/i,
    );
    expect(migration0041).toMatch(
      /conname = 'activation_automation_candidates_status_allowed'/,
    );
    expect(migration0041).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_activation_automation_candidates_active_duplicate/i,
    );
    expect(migration0041).not.toMatch(/\bDROP\b/i);
  });

  it("locks V1.1 to agent-target suggestions and active duplicate suppression", () => {
    expect(migration0041).toMatch(/CHECK \(target_type = 'agent'\)/);
    expect(migration0041).toMatch(/tenant_id, user_id, duplicate_key/);
    expect(migration0041).toMatch(/WHERE status = 'generated'/);
    expect(migration0041).not.toMatch(/'provisioned'/);
  });
});
