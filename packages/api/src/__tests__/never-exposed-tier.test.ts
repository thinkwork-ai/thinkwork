/**
 * Contract tests for Unit 11's never-exposed tier guard.
 *
 * Two invariants:
 *
 * 1. `requireNotFromAdminSkill(ctx)` allows Cognito callers through
 *    unchanged and refuses every other authType — the "allow-list
 *    Cognito-only" posture the plan specifies (stronger than an
 *    `x-skill-id` deny-list because no service principal can reach
 *    catastrophic ops regardless of which skill holds the secret).
 *
 * 2. The `thinkwork-admin` skill manifest never declares an operation
 *    whose name matches a known catastrophic pattern. Prevents a
 *    future contributor from accidentally wiring `deleteTenant` or
 *    `transferTenantOwnership` into the manifest.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { requireNotFromAdminSkill } from "../graphql/resolvers/core/authz.js";

function cognitoCtx(): any {
  return {
    auth: {
      authType: "cognito",
      principalId: "admin-1",
      tenantId: "tenant-A",
      email: "caller@example.com",
      agentId: null,
    },
  };
}

function apikeyCtx(): any {
  return {
    auth: {
      authType: "apikey",
      principalId: "admin-1",
      tenantId: "tenant-A",
      email: null,
      agentId: "agent-1",
    },
  };
}

describe("requireNotFromAdminSkill — allow-list Cognito-only", () => {
  it("returns (passes) for Cognito callers — admin SPA + CLI path preserved", () => {
    expect(() => requireNotFromAdminSkill(cognitoCtx())).not.toThrow();
  });

  it("refuses apikey callers — the thinkwork-admin skill can never reach catastrophic ops", () => {
    expect(() => requireNotFromAdminSkill(apikeyCtx())).toThrowError(
      expect.objectContaining({ extensions: { code: "FORBIDDEN" } }),
    );
  });

  it("refuses any non-cognito authType (defensive against future auth types)", () => {
    const anon: any = { auth: { authType: "anonymous" } };
    expect(() => requireNotFromAdminSkill(anon)).toThrowError(
      expect.objectContaining({ extensions: { code: "FORBIDDEN" } }),
    );
  });
});

describe("thinkwork-admin skill.yaml — catastrophic-op exclusion", () => {
  // Names the plan explicitly marks as never-exposed tier. Adding any
  // of these to the thinkwork-admin manifest would flip the defense
  // from "cannot be called" to "cannot be called unless admin opts
  // an agent in" — a meaningfully weaker posture. Keep the list
  // exhaustive.
  const CATASTROPHIC_OP_NAMES = [
    // Tenant lifecycle.
    "delete_tenant",
    "deleteTenant",
    "transfer_tenant_ownership",
    "transferTenantOwnership",
    "transfer_ownership",
    "transferOwnership",
    // Billing / spend — none shipped today; future-proofing.
    "update_billing",
    "updateBilling",
    "charge_tenant",
    "chargeTenant",
    "refund_tenant",
    "refundTenant",
    // Bulk-purge.
    "bulk_purge",
    "bulkPurge",
    "purge_tenant",
    "purgeTenant",
    // Cross-tenant moves.
    "move_tenant",
    "moveTenant",
  ];

  it("declares no script with a catastrophic op name", () => {
    const manifestPath = resolve(
      __dirname,
      "../../../skill-catalog/thinkwork-admin/skill.yaml",
    );
    const yaml = readFileSync(manifestPath, "utf-8");

    for (const opName of CATASTROPHIC_OP_NAMES) {
      // Match `- name: op_name` (bare) and `- name: "op_name"` (quoted).
      const pattern = new RegExp(`^\\s*-\\s*name:\\s*"?${opName}"?\\s*$`, "m");
      expect(
        pattern.test(yaml),
        `skill.yaml must NOT declare catastrophic op '${opName}'`,
      ).toBe(false);
    }
  });

  it("has scripts: declared as an empty list or a list of non-catastrophic ops (Unit 6 shipped an empty list)", () => {
    const manifestPath = resolve(
      __dirname,
      "../../../skill-catalog/thinkwork-admin/skill.yaml",
    );
    const yaml = readFileSync(manifestPath, "utf-8");
    // Accept either `scripts: []` or a populated list (Units 7/8
    // will populate). The catastrophic-name assertion above is the
    // real invariant; this one just guards the field exists.
    expect(yaml).toMatch(/^scripts:/m);
  });
});
