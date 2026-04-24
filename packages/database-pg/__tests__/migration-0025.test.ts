/**
 * Static invariants for drizzle/0025_v1_agent_architecture.sql.
 *
 * Live-database assertions (idempotent re-apply, preflight RAISE, column
 * defaults on real rows) are covered by `DATABASE_URL=... bash scripts/
 * db-migrate-manual.sh` and by the PR-time dev-apply evidence in the PR body.
 * This test is the cheap portion: make sure the hand-rolled file stays in the
 * shape the V1 plan and the drift reporter expect, so a future edit cannot
 * accidentally strip an `IF NOT EXISTS` or forget a `-- creates:` marker.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = join(
  HERE,
  "..",
  "drizzle",
  "0025_v1_agent_architecture.sql",
);
const SQL = readFileSync(MIGRATION_PATH, "utf-8");

describe("migration 0025 — header + marker invariants", () => {
  it("declares every object the V1 plan requires via `-- creates:` / `-- creates-column:` markers", () => {
    const expectedCreates = [
      "public.plugin_uploads",
      "public.idx_plugin_uploads_tenant",
      "public.idx_plugin_uploads_status",
    ];
    const expectedColumns = [
      "public.plugin_uploads.id",
      "public.tenant_mcp_servers.status",
      "public.tenant_mcp_servers.url_hash",
      "public.tenant_mcp_servers.approved_by",
      "public.tenant_mcp_servers.approved_at",
      "public.tenants.disabled_builtin_tools",
    ];
    for (const name of expectedCreates) {
      expect(SQL).toMatch(new RegExp(`--\\s*creates:\\s*${name}\\b`));
    }
    for (const name of expectedColumns) {
      expect(SQL).toMatch(
        new RegExp(`--\\s*creates-column:\\s*${name.replace(/\./g, "\\.")}`),
      );
    }
  });

  it("carries the 'Apply manually' header so operators know it is hand-rolled", () => {
    expect(SQL).toMatch(/Apply manually/);
    expect(SQL).toMatch(
      /psql\s+"\$DATABASE_URL"\s+-f\s+packages\/database-pg\/drizzle\/0025_/,
    );
  });

  it("references the pnpm db:migrate-manual drift-detection gate", () => {
    expect(SQL).toMatch(/pnpm db:migrate-manual/);
  });

  it("links back to the originating V1 agent-architecture plan", () => {
    expect(SQL).toMatch(
      /2026-04-23-007-feat-v1-agent-architecture-final-call-plan/,
    );
  });
});

describe("migration 0025 — preflight + idempotency", () => {
  it("guards every pre-state table with to_regclass + RAISE before mutating", () => {
    // The guard is what keeps a half-migrated DB from silently accepting us.
    // Without explicit RAISEs the migration would plow through on a shape
    // that drifted away from the expected baseline.
    expect(SQL).toMatch(/to_regclass\('public\.tenants'\)\s+IS\s+NULL/i);
    expect(SQL).toMatch(
      /to_regclass\('public\.tenant_mcp_servers'\)\s+IS\s+NULL/i,
    );
    expect(SQL).toMatch(/RAISE EXCEPTION\s+'0025:[^']*tenants/);
    expect(SQL).toMatch(/RAISE EXCEPTION\s+'0025:[^']*tenant_mcp_servers/);
  });

  it("uses IF NOT EXISTS on every ADD COLUMN and CREATE so re-apply is a no-op", () => {
    const addColumnLines = SQL.match(/^\s*ADD COLUMN\s.+$/gim) ?? [];
    expect(addColumnLines.length).toBeGreaterThan(0);
    for (const line of addColumnLines) {
      expect(line).toMatch(/IF NOT EXISTS/i);
    }

    const createTableLines = SQL.match(/^\s*CREATE TABLE\s.+$/gim) ?? [];
    for (const line of createTableLines) {
      expect(line).toMatch(/IF NOT EXISTS/i);
    }

    const createIndexLines =
      SQL.match(/^\s*CREATE (?:UNIQUE )?INDEX\s.+$/gim) ?? [];
    for (const line of createIndexLines) {
      expect(line).toMatch(/IF NOT EXISTS/i);
    }
  });

  it("guards each CHECK constraint with a pg_constraint lookup so re-apply does not error", () => {
    // Postgres lacks `ADD CONSTRAINT ... IF NOT EXISTS` for CHECK on 12–14,
    // so the file wraps them in DO blocks that look up pg_constraint first.
    // Losing that pattern would break the idempotency guarantee.
    const checkNames = [
      "tenant_mcp_servers_status_allowed",
      "plugin_uploads_status_allowed",
    ];
    for (const name of checkNames) {
      expect(SQL).toMatch(new RegExp(`conname\\s*=\\s*'${name}'`));
      expect(SQL).toMatch(new RegExp(`ADD CONSTRAINT\\s+"${name}"`));
    }
  });
});

describe("migration 0025 — scope guards", () => {
  it("is strictly additive — no DROP statements, no column removals", () => {
    // The V1 plan puts column drops in a separate migration 0026 (U6)
    // after the runtime cutover. If this file ever grows a DROP, that is
    // a scope violation that needs to move to its own migration first.
    expect(SQL).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(SQL).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(SQL).not.toMatch(/\bDROP\s+INDEX\b/i);
    expect(SQL).not.toMatch(/\bALTER\s+COLUMN\s+[^\s]+\s+DROP\s+NOT NULL\b/i);
  });

  it("defaults existing tenant_mcp_servers rows to 'approved' so rollout cannot revoke live integrations", () => {
    // The safety invariant: U3 never turns an approved MCP into a pending
    // one. Pre-existing rows inherit 'approved'; only newly uploaded rows
    // from U10 ship with 'pending'.
    expect(SQL).toMatch(
      /ADD COLUMN IF NOT EXISTS\s+"status"\s+text\s+NOT NULL\s+DEFAULT\s+'approved'/i,
    );
  });

  it("defaults tenants.disabled_builtin_tools to an empty JSONB array", () => {
    expect(SQL).toMatch(
      /ADD COLUMN IF NOT EXISTS\s+"disabled_builtin_tools"\s+jsonb\s+NOT NULL\s+DEFAULT\s+'\[\]'::jsonb/i,
    );
  });

  it("cascades plugin_uploads to tenants so tenant delete does not orphan rows", () => {
    expect(SQL).toMatch(
      /"tenant_id"\s+uuid\s+NOT NULL\s+REFERENCES\s+"tenants"\("id"\)\s+ON DELETE\s+CASCADE/i,
    );
  });
});
