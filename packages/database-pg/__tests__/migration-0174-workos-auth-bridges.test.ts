import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  WORKOS_AUTH_BRIDGE_STATUSES,
  workosAuthBridges,
} from "../src/schema/plugins";
import * as schema from "../src/schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0174 = readFileSync(
  join(HERE, "..", "drizzle", "0174_workos_auth_bridges.sql"),
  "utf-8",
);

describe("migration 0174 — WorkOS auth bridges", () => {
  it("exports the bridge table and status vocabulary", () => {
    expect(schema.workosAuthBridges).toBe(workosAuthBridges);
    expect(schema.WORKOS_AUTH_BRIDGE_STATUSES).toBe(
      WORKOS_AUTH_BRIDGE_STATUSES,
    );
    expect(WORKOS_AUTH_BRIDGE_STATUSES).toEqual([
      "pending",
      "consumed",
      "expired",
    ]);
  });

  it("models short-lived WorkOS bridge records without raw one-time codes", () => {
    expect(getTableName(workosAuthBridges)).toBe("workos_auth_bridges");
    const columns = getTableColumns(workosAuthBridges);

    expect(columns.bridge_code_digest.notNull).toBe(true);
    expect(columns.workos_user_id.notNull).toBe(true);
    expect(columns.workos_session_id.notNull).toBe(true);
    expect(columns.workos_email.notNull).toBe(true);
    expect(columns.workos_profile.notNull).toBe(true);
    expect(columns.expires_at.notNull).toBe(true);
    expect(columns.status.default).toBe("pending");
    expect(Object.keys(columns)).not.toContain("bridge_code");

    const config = getTableConfig(workosAuthBridges);
    const indexes = config.indexes.map((index) => index.config.name);
    expect(indexes).toContain("uq_workos_auth_bridges_code_digest");
    expect(indexes).toContain("idx_workos_auth_bridges_tenant_status");
    expect(indexes).toContain("idx_workos_auth_bridges_reference");
    expect(config.foreignKeys.map((fk) => fk.onDelete)).toContain("cascade");
  });

  it("declares migration markers and status checks", () => {
    for (const marker of [
      "public.workos_auth_bridges",
      "public.uq_workos_auth_bridges_code_digest",
      "public.idx_workos_auth_bridges_tenant_status",
      "public.idx_workos_auth_bridges_reference",
    ]) {
      expect(migration0174).toContain(`-- creates: ${marker}`);
    }
    expect(migration0174).toContain(
      "CHECK (status IN ('pending', 'consumed', 'expired'))",
    );
    expect(migration0174).toContain("bridge_code_digest text NOT NULL");
    expect(migration0174).not.toContain("bridge_code text");
  });
});
