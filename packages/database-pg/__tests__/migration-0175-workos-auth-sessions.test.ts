import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  WORKOS_AUTH_SESSION_STATUSES,
  workosAuthBridges,
  workosAuthSessions,
} from "../src/schema/plugins";
import * as schema from "../src/schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0175 = readFileSync(
  join(HERE, "..", "drizzle", "0175_workos_auth_sessions.sql"),
  "utf-8",
);

describe("migration 0175 — WorkOS auth sessions", () => {
  it("exports the session table and status vocabulary", () => {
    expect(schema.workosAuthSessions).toBe(workosAuthSessions);
    expect(schema.WORKOS_AUTH_SESSION_STATUSES).toBe(
      WORKOS_AUTH_SESSION_STATUSES,
    );
    expect(WORKOS_AUTH_SESSION_STATUSES).toEqual([
      "active",
      "logged_out",
      "expired",
    ]);
  });

  it("models durable WorkOS sessions keyed to Cognito principals", () => {
    expect(getTableName(workosAuthSessions)).toBe("workos_auth_sessions");
    const columns = getTableColumns(workosAuthSessions);

    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.user_id.notNull).toBe(true);
    expect(columns.cognito_principal_id.notNull).toBe(true);
    expect(columns.cognito_username.notNull).toBe(true);
    expect(columns.workos_session_id.notNull).toBe(true);
    expect(columns.expires_at.notNull).toBe(true);
    expect(columns.status.default).toBe("active");

    const bridgeColumns = getTableColumns(workosAuthBridges);
    expect(bridgeColumns.workos_session_expires_at.notNull).toBe(false);

    const config = getTableConfig(workosAuthSessions);
    const indexes = config.indexes.map((index) => index.config.name);
    expect(indexes).toContain("idx_workos_auth_sessions_cognito_active");
    expect(indexes).toContain("idx_workos_auth_sessions_user_active");
    expect(indexes).toContain("idx_workos_auth_sessions_workos_session");
    expect(config.foreignKeys.map((fk) => fk.onDelete)).toContain("cascade");
  });

  it("declares migration markers and status checks", () => {
    for (const marker of [
      "public.workos_auth_sessions",
      "public.idx_workos_auth_sessions_cognito_active",
      "public.idx_workos_auth_sessions_user_active",
      "public.idx_workos_auth_sessions_workos_session",
    ]) {
      expect(migration0175).toContain(`-- creates: ${marker}`);
    }
    expect(migration0175).toContain(
      "-- creates-column: public.workos_auth_bridges.workos_session_expires_at",
    );
    expect(migration0175).toContain(
      "CHECK (status IN ('active', 'logged_out', 'expired'))",
    );
    expect(migration0175).not.toContain("access_token");
    expect(migration0175).not.toContain("refresh_token");
  });
});
