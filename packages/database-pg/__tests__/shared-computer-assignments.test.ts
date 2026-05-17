import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { computerAssignments, computers } from "../src/schema/computers";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0097 = readFileSync(
  join(HERE, "..", "drizzle", "0097_shared_computers.sql"),
  "utf-8",
);

describe("shared Computer assignments", () => {
  it("allows shared Computers without an active owner user", () => {
    const columns = getTableColumns(computers);

    expect(getTableName(computers)).toBe("computers");
    expect(columns.scope.default).toBe("shared");
    expect(columns.owner_user_id.notNull).toBe(false);
  });

  it("models direct user and Team assignment targets on one table", () => {
    const columns = getTableColumns(computerAssignments);

    expect(getTableName(computerAssignments)).toBe("computer_assignments");
    expect(columns.subject_type.notNull).toBe(true);
    expect(columns.user_id.notNull).toBe(false);
    expect(columns.team_id.notNull).toBe(false);
    expect(columns.role.default).toBe("member");
  });

  it("removes the one-active-Computer-per-owner SQL invariant", () => {
    expect(migration0097).toMatch(
      /DROP INDEX IF EXISTS public\.uq_computers_active_owner/,
    );
    expect(migration0097).not.toMatch(
      /CREATE UNIQUE INDEX[\s\S]*uq_computers_active_owner/,
    );
  });

  it("preserves existing personal rows as historical while defaulting new rows to shared", () => {
    expect(migration0097).toMatch(
      /ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'historical_personal'/,
    );
    expect(migration0097).toMatch(/ALTER COLUMN scope SET DEFAULT 'shared'/);
  });

  it("rejects duplicate and malformed assignment targets in SQL", () => {
    expect(migration0097).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_computer_assignments_user[\s\S]*WHERE user_id IS NOT NULL/,
    );
    expect(migration0097).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_computer_assignments_team[\s\S]*WHERE team_id IS NOT NULL/,
    );
    expect(migration0097).toMatch(
      /CONSTRAINT computer_assignments_subject_matches_target[\s\S]*subject_type = 'user'[\s\S]*subject_type = 'team'/,
    );
  });

  it("guards assignment rows against cross-tenant users, Teams, and Computers", () => {
    expect(migration0097).toMatch(
      /CREATE OR REPLACE FUNCTION public\.enforce_computer_assignment_tenant\(\)/,
    );
    expect(migration0097).toMatch(
      /CREATE TRIGGER computer_assignments_tenant_guard/,
    );
    expect(migration0097).toMatch(
      /computer assignment tenant mismatch for computer/,
    );
    expect(migration0097).toMatch(
      /computer assignment tenant mismatch for user/,
    );
    expect(migration0097).toMatch(
      /computer assignment tenant mismatch for team/,
    );
  });
});
