/**
 * Deploy-time owner-tenant pre-provision (self-hosted first-owner path).
 * A fresh stack has no code path that creates the first tenant — deploy
 * binds the exact Cognito subject to the first owner without email claims.
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
      cognitoSub: "cognito-sub-1",
      cognitoUserPoolId: "us-east-1_pool",
      cognitoIssuer:
        "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_pool",
    });
    expect(sql).toContain("WHERE NOT EXISTS (SELECT 1 FROM tenants)");
    expect(sql).toContain("INSERT INTO user_auth_identities");
    expect(sql).toContain("deploy_exact_cognito_sub");
    expect(sql).toContain("provider_kind = 'local'");
    expect(sql).toContain("'service@homecareintel.com'");
    expect(sql).toContain("INSERT INTO tenant_settings (tenant_id)");
    expect(sql).not.toContain("pending_owner_email");
  });

  it("escapes single quotes", () => {
    const sql = buildEnsureOwnerTenantSql({
      name: "O'Brien's Workspace",
      slug: "obrien",
      email: "o'brien@example.com",
      cognitoSub: "sub'o",
      cognitoUserPoolId: "us-east-1_pool",
      cognitoIssuer:
        "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_pool",
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
    const { runner } = fakeRunner([
      { tenant_id: "tenant-id", local_connection_ready: true },
    ]);
    const result = await ensureOwnerTenant({
      stage: "hci",
      email: "Service@HomeCareIntel.com",
      cognitoSub: "cognito-sub-1",
      cognitoUserPoolId: "us-east-1_pool",
      region: "us-east-1",
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
    const { runner } = fakeRunner([
      { tenant_id: null, local_connection_ready: true },
    ]);
    const result = await ensureOwnerTenant({
      stage: "hci",
      email: "service@homecareintel.com",
      cognitoSub: "cognito-sub-1",
      cognitoUserPoolId: "us-east-1_pool",
      region: "us-east-1",
      connection,
      connect: async () => runner,
    });
    expect(result.created).toBe(false);
  });

  it("fails closed when native local route metadata is not reconciled", async () => {
    const { runner } = fakeRunner([
      { tenant_id: null, local_connection_ready: false },
    ]);
    await expect(
      ensureOwnerTenant({
        stage: "hci",
        email: "service@homecareintel.com",
        cognitoSub: "cognito-sub-1",
        cognitoUserPoolId: "us-east-1_pool",
        region: "us-east-1",
        connection,
        connect: async () => runner,
      }),
    ).rejects.toThrow(/metadata is not reconciled/);
  });
});
