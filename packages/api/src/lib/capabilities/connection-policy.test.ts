/**
 * Connection sidecar policy tests (THINK-229 U3).
 *
 * The signed policy block is tamper-evident (any hand-edited budget
 * value breaks the sidecar signature), the shadow evaluator names every
 * divergence — a MISSING policy block is itself a parity failure — and
 * the enforcement flip is env-gated.
 */

import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  capabilitySignerFromKey,
  capabilityVerifierFromKey,
  signCapabilitySidecar,
  verifyCapabilitySidecar,
} from "./sidecar-signing.js";
import {
  evaluateConnectionPolicyParity,
  parseConnectionPolicyBlock,
  resolveAnalystPolicySource,
} from "./connection-policy.js";

const POLICY = {
  budgets: { maxQueriesPerRun: 12, maxQueriesPerTenantDay: 200 },
  retain_sql: false,
  role_tier: "reader",
};

describe("connection policy block (THINK-229 U3)", () => {
  it("a sidecar with a policy block signs and verifies; a hand-edited budget fails the signature", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const signer = capabilitySignerFromKey(privateKey);
    const verifier = capabilityVerifierFromKey(publicKey);
    const definitionBytes = "# CONNECTION.md fixture";

    const sidecar = {
      slug: "postgres-dev",
      class: "connection",
      enabled: true,
      permissions: { operations: ["query"] },
      config: { registryServerId: "srv-1" },
      policy: POLICY,
      updated_at: "2026-07-08T00:00:00.000Z",
    };
    const { signed_content_sha, signature } = signCapabilitySidecar({
      signer,
      sidecar,
      definitionBytes,
      signedBy: "operator:test",
    });
    const signed = { ...sidecar, signed_content_sha, signature };

    expect(
      verifyCapabilitySidecar({ verifier, sidecar: signed, definitionBytes }),
    ).toEqual({ ok: true });

    // Hand-edit the budget INSIDE the signed sidecar → invalid_signature
    // (fail-closed AND loud at manifest admission — the skill-trust-gate
    // lesson; the connection is withheld with a visible reason).
    const tampered = {
      ...signed,
      policy: {
        ...POLICY,
        budgets: { ...POLICY.budgets, maxQueriesPerTenantDay: 999999 },
      },
    };
    expect(
      verifyCapabilitySidecar({ verifier, sidecar: tampered, definitionBytes }),
    ).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("parseConnectionPolicyBlock: null on absent/malformed; drops non-positive budgets", () => {
    expect(parseConnectionPolicyBlock(undefined)).toBeNull();
    expect(parseConnectionPolicyBlock("nope")).toBeNull();
    expect(parseConnectionPolicyBlock([])).toBeNull();
    expect(parseConnectionPolicyBlock(POLICY)).toEqual(POLICY);
    expect(
      parseConnectionPolicyBlock({
        budgets: { maxQueriesPerRun: -1, maxQueriesPerTenantDay: "50" },
      }),
    ).toEqual({ budgets: {} });
  });

  it("THINK-232: costBudgetUsd is parsed when present and dropped when non-positive; absence is fine", () => {
    // Present + positive → carried through.
    expect(
      parseConnectionPolicyBlock({
        budgets: {
          maxQueriesPerRun: 12,
          maxQueriesPerTenantDay: 200,
          costBudgetUsd: 0.5,
        },
      }),
    ).toEqual({
      budgets: {
        maxQueriesPerRun: 12,
        maxQueriesPerTenantDay: 200,
        costBudgetUsd: 0.5,
      },
    });
    // Non-positive / non-numeric → dropped, other budgets survive.
    expect(
      parseConnectionPolicyBlock({
        budgets: { maxQueriesPerRun: 12, costBudgetUsd: 0 },
      }),
    ).toEqual({ budgets: { maxQueriesPerRun: 12 } });
    // Absent → block simply has no costBudgetUsd (additive, optional).
    expect(
      parseConnectionPolicyBlock({ budgets: { maxQueriesPerRun: 12 } }),
    ).toEqual({ budgets: { maxQueriesPerRun: 12 } });
  });

  it("THINK-232: a complete sidecar WITHOUT costBudgetUsd still passes parity (absence is not a fault)", () => {
    expect(
      evaluateConnectionPolicyParity({
        slug: "postgres-dev",
        sidecar: { enabled: true, operations: ["query"], policy: POLICY },
        row: { enabled: true, status: "approved" },
      }).parity,
    ).toBe("ok");
    // And a sidecar that DOES carry it also stays clean.
    expect(
      evaluateConnectionPolicyParity({
        slug: "postgres-dev",
        sidecar: {
          enabled: true,
          operations: ["query"],
          policy: {
            ...POLICY,
            budgets: { ...POLICY.budgets, costBudgetUsd: 0.5 },
          },
        },
        row: { enabled: true, status: "approved" },
      }).parity,
    ).toBe("ok");
  });

  it("shadow parity: matching sources → ok, no mismatches", () => {
    expect(
      evaluateConnectionPolicyParity({
        slug: "postgres-dev",
        sidecar: { enabled: true, operations: ["query"], policy: POLICY },
        row: { enabled: true, status: "approved" },
      }),
    ).toEqual({ slug: "postgres-dev", parity: "ok", mismatches: [] });
  });

  it("shadow parity: divergent enabled names BOTH values", () => {
    const record = evaluateConnectionPolicyParity({
      slug: "postgres-dev",
      sidecar: { enabled: true, operations: [], policy: POLICY },
      row: { enabled: false, status: "approved" },
    });
    expect(record.parity).toBe("fail");
    expect(record.mismatches).toContain(
      "enabled_divergence:sidecar=true,row=false",
    );
  });

  it("legacy sidecar without a policy block → parity FAIL (never a silent row-authoritative fallback)", () => {
    const record = evaluateConnectionPolicyParity({
      slug: "postgres-dev",
      sidecar: { enabled: true, operations: ["query"], policy: null },
      row: { enabled: true, status: "approved" },
    });
    expect(record).toEqual({
      slug: "postgres-dev",
      parity: "fail",
      mismatches: ["policy_block_missing"],
    });
  });

  it("incomplete budgets fail parity; role_tier=reader passes; anything else is named", () => {
    expect(
      evaluateConnectionPolicyParity({
        slug: "s",
        sidecar: {
          enabled: true,
          operations: [],
          policy: { budgets: { maxQueriesPerRun: 5 } },
        },
        row: { enabled: true, status: "approved" },
      }).mismatches,
    ).toContain("budgets_incomplete");

    expect(
      evaluateConnectionPolicyParity({
        slug: "s",
        sidecar: {
          enabled: true,
          operations: [],
          policy: { ...POLICY, role_tier: "writer" },
        },
        row: { enabled: true, status: "approved" },
      }).mismatches,
    ).toContain("role_tier_unrecognized:writer");
  });

  it("enforcement flip is env-gated: unset/other → row; 'sidecar' → sidecar", () => {
    expect(resolveAnalystPolicySource({} as NodeJS.ProcessEnv)).toBe("row");
    expect(
      resolveAnalystPolicySource({
        ANALYST_POLICY_SOURCE: "nonsense",
      } as unknown as NodeJS.ProcessEnv),
    ).toBe("row");
    expect(
      resolveAnalystPolicySource({
        ANALYST_POLICY_SOURCE: "sidecar",
      } as unknown as NodeJS.ProcessEnv),
    ).toBe("sidecar");
  });
});
