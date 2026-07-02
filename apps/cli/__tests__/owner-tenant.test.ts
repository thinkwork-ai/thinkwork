/**
 * Deploy-time owner-tenant pre-provision (self-hosted first-owner path).
 * A fresh stack has no code path that creates the first tenant — deploy
 * seeds a pending tenant (pending_owner_email) that bootstrapUser's claim
 * path attaches on first sign-in.
 */

import { describe, expect, it } from "vitest";
import {
  buildEnsureOwnerTenantSql,
  deriveOwnerTenantName,
  deriveOwnerTenantSlug,
  ensureOwnerTenant,
} from "../src/lib/owner-tenant.js";
import type { SqlRunner } from "../src/lib/db-migrations.js";

describe("deriveOwnerTenantSlug", () => {
  it("uses the stage name when it is a valid slug", () => {
    expect(deriveOwnerTenantSlug("hci")).toBe("hci");
    expect(deriveOwnerTenantSlug("mcpherson")).toBe("mcpherson");
    expect(deriveOwnerTenantSlug("hp260702466")).toBe("hp260702466");
  });

  it("sanitizes stage names into slug shape", () => {
    expect(deriveOwnerTenantSlug("My_Stage")).toBe("my-stage");
    expect(deriveOwnerTenantSlug("acme.corp")).toBe("acme-corp");
  });

  it("falls back to a random slug for reserved stage names", () => {
    expect(deriveOwnerTenantSlug("dev", () => "abc123")).toBe(
      "workspace-abc123",
    );
    expect(deriveOwnerTenantSlug("prod", () => "abc123")).toBe(
      "workspace-abc123",
    );
  });

  it("falls back for shapes the slug pattern rejects", () => {
    expect(deriveOwnerTenantSlug("qa", () => "abc123")).toBe(
      "workspace-abc123",
    );
    expect(
      deriveOwnerTenantSlug(
        "a-very-long-stage-name-that-exceeds-thirty-characters",
        () => "abc123",
      ),
    ).toBe("workspace-abc123");
  });
});

describe("deriveOwnerTenantName", () => {
  it("title-cases the slug", () => {
    expect(deriveOwnerTenantName("hci")).toBe("Hci");
    expect(deriveOwnerTenantName("acme-corp")).toBe("Acme Corp");
  });
});

describe("buildEnsureOwnerTenantSql", () => {
  it("inserts only when the tenants table is empty and returns the settings row", () => {
    const sql = buildEnsureOwnerTenantSql({
      name: "HCI",
      slug: "hci",
      email: "Service@HomeCareIntel.com",
    });
    expect(sql).toContain("WHERE NOT EXISTS (SELECT 1 FROM tenants)");
    expect(sql).toContain("pending_owner_email");
    expect(sql).toContain("first_admin_claim_required");
    expect(sql).toContain("'service@homecareintel.com'");
    expect(sql).toContain("INSERT INTO tenant_settings (tenant_id)");
    expect(sql).toContain("RETURNING tenant_id");
  });

  it("escapes single quotes", () => {
    const sql = buildEnsureOwnerTenantSql({
      name: "O'Brien's Workspace",
      slug: "obrien",
      email: "o'brien@example.com",
    });
    expect(sql).toContain("'O''Brien''s Workspace'");
    expect(sql).toContain("'o''brien@example.com'");
  });
});

function fakeRunner(rows: unknown[]): { runner: SqlRunner; log: string[] } {
  const log: string[] = [];
  return {
    log,
    runner: {
      async query(sql: string) {
        log.push(sql);
        return { rows };
      },
      async end() {},
    },
  };
}

const connection = {
  host: "db.example",
  port: 5432,
  user: "thinkwork_admin",
  password: "pw",
  database: "thinkwork",
};

describe("ensureOwnerTenant", () => {
  it("reports created=true when the insert returned a row", async () => {
    const { runner } = fakeRunner([{ hash: "tenant-id" }]);
    const result = await ensureOwnerTenant({
      stage: "hci",
      email: "Service@HomeCareIntel.com",
      connection,
      connect: async () => runner,
    });
    expect(result).toEqual({
      created: true,
      slug: "hci",
      email: "service@homecareintel.com",
    });
  });

  it("reports created=false when tenants already exist (rerun / claimed)", async () => {
    const { runner } = fakeRunner([]);
    const result = await ensureOwnerTenant({
      stage: "hci",
      email: "service@homecareintel.com",
      connection,
      connect: async () => runner,
    });
    expect(result.created).toBe(false);
  });
});
