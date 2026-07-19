import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { authIdentityEnrollments } from "../src/schema/auth";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(HERE, "..", "drizzle", "0266_auth_identity_recovery_grants.sql"),
  "utf8",
);

describe("migration 0266 — identity recovery enrollment grants", () => {
  it("allows recovery only through the existing enrollment table", () => {
    expect(migration).toContain("'identity_recovery'");
    const constraint = getTableConfig(authIdentityEnrollments).checks.find(
      (check) => check.name === "auth_identity_enrollments_grant_kind_allowed",
    );
    expect(constraint).toBeDefined();
    expect(new PgDialect().sqlToQuery(constraint!.value).sql).toContain(
      "identity_recovery",
    );
    expect(new PgDialect().sqlToQuery(constraint!.value).sql).toContain(
      "session_migration",
    );
    expect(migration).toContain("'session_migration'");
  });

  it("declares explicit constraint drift markers", () => {
    expect(migration).toContain(
      "-- drops-constraint: public.auth_identity_enrollments.auth_identity_enrollments_grant_kind_allowed",
    );
    expect(migration).toContain(
      "-- creates-constraint: public.auth_identity_enrollments.auth_identity_enrollments_grant_kind_allowed",
    );
  });
});
