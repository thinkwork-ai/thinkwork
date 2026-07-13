import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0247 = readFileSync(
  join(HERE, "..", "drizzle", "0247_capability_runtime.sql"),
  "utf-8",
);

const NEW_TABLES = [
  "tenant_service_principals",
  "capability_definitions",
  "capability_definition_versions",
  "capability_credential_bindings",
  "capability_external_clients",
  "capability_connection_proposals",
  "capability_routine_proposals",
  "capability_broker_sessions",
  "capability_broker_calls",
];

describe("migration 0247 — capability runtime", () => {
  it("declares a creates marker for every table it creates", () => {
    for (const table of NEW_TABLES) {
      expect(migration0247).toMatch(
        new RegExp(`-- creates: public\\.${table}\\b`),
      );
      expect(migration0247).toContain(
        `CREATE TABLE IF NOT EXISTS public.${table}`,
      );
    }
  });

  it("declares a creates-column marker for every additive column", () => {
    const columns = [
      "public.capability_catalog.definition_version_id",
      "public.routines.capability_dependencies",
      "public.routines.execution_principal",
      "public.agent_loops.execution_principal",
      "public.routine_executions.execution_principal",
      "public.routine_code_cache.capability_dependencies",
    ];
    for (const col of columns) {
      expect(migration0247).toContain(`-- creates-column: ${col}`);
    }
    expect(migration0247).toContain(
      "ADD COLUMN IF NOT EXISTS execution_principal jsonb",
    );
  });

  it("enforces admitted-version immutability with a trigger", () => {
    expect(migration0247).toContain(
      "CREATE OR REPLACE FUNCTION public.capability_definition_versions_immutable",
    );
    expect(migration0247).toContain(
      "trg_capability_definition_versions_immutable",
    );
    expect(migration0247).toContain(
      "admitted capability definition versions are immutable",
    );
    expect(migration0247).toContain("rows are append-only");
    // direct DELETEs are blocked but FK CASCADE deletes (RI trigger depth)
    // must pass — a blanket DELETE block would make tenant removal impossible
    expect(migration0247).toContain("pg_trigger_depth() <= 1");
    expect(migration0247).toContain("RETURN OLD");
  });

  it("fails closed on principal-mode/subject mismatches", () => {
    expect(migration0247).toContain(
      "capability_credential_bindings_subject_check",
    );
    expect(migration0247).toMatch(
      /principal_mode = 'service'\s+AND service_principal_id IS NOT NULL\s+AND subject_user_id IS NULL/,
    );
  });

  it("CHECK-constrains every closed status taxonomy", () => {
    expect(migration0247).toContain("CHECK (status IN ('active', 'revoked'))");
    expect(migration0247).toContain(
      "CHECK (lifecycle IN ('candidate', 'admitted', 'rejected', 'retired'))",
    );
    expect(migration0247).toContain(
      "CHECK (readiness IN ('pending_setup', 'verifying', 'ready', 'degraded', 'revoked'))",
    );
    expect(migration0247).toContain(
      "CHECK (status IN ('rejected', 'authorized', 'completed', 'accepted', 'failed', 'indeterminate'))",
    );
    expect(migration0247).toContain(
      "CHECK (approval_mode IS NULL OR approval_mode IN ('operator', 'repair'))",
    );
  });

  it("stores only secret hashes/references, never plaintext columns", () => {
    expect(migration0247).toContain("client_secret_hash text NOT NULL");
    expect(migration0247).toContain("credential_refs_json");
    expect(migration0247).not.toMatch(/client_secret text/);
    expect(migration0247).not.toMatch(/private_key/);
  });
});
