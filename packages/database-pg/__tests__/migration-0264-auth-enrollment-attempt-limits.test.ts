import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { authIdentityEnrollments } from "../src/schema/auth";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(HERE, "..", "drizzle", "0264_auth_enrollment_attempt_limits.sql"),
  "utf8",
);

describe("migration 0264 — auth enrollment attempt limits", () => {
  it("persists failed attempts and terminal lockout time", () => {
    const columns = getTableColumns(authIdentityEnrollments);
    expect(columns.failed_attempts.notNull).toBe(true);
    expect(columns.failed_attempts.hasDefault).toBe(true);
    expect(columns.locked_at.notNull).toBe(false);
    expect(
      getTableConfig(authIdentityEnrollments).checks.map(
        (constraint) => constraint.name,
      ),
    ).toContain("auth_identity_enrollments_failed_attempts_nonnegative");
  });

  it("declares drift markers and a safe default for existing grants", () => {
    expect(migration).toContain(
      "-- creates-column: public.auth_identity_enrollments.failed_attempts",
    );
    expect(migration).toContain(
      "-- creates-column: public.auth_identity_enrollments.locked_at",
    );
    expect(migration).toContain(
      "-- creates-constraint: public.auth_identity_enrollments.auth_identity_enrollments_failed_attempts_nonnegative",
    );
    expect(migration).toMatch(/failed_attempts integer NOT NULL DEFAULT 0/);
    expect(migration).toContain(
      "auth_identity_enrollments_failed_attempts_nonnegative",
    );
  });
});
