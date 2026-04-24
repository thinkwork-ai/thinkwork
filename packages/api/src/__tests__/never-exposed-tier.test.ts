/**
 * Contract tests for the never-exposed tier guard.
 *
 * `requireNotFromAdminSkill(ctx)` allows Cognito callers through unchanged
 * and refuses every other authType — the "allow-list Cognito-only" posture
 * (stronger than an `x-skill-id` deny-list because no service principal
 * can reach catastrophic ops regardless of which credentials hold the
 * secret). Kept even after the thinkwork-admin skill directory was
 * deleted, because the guard applies to ANY service-auth path (agent
 * broker, peer skills, future integrations) reaching catastrophic
 * resolvers — the skill was only ever one example.
 */

import { describe, it, expect } from "vitest";

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

// The second describe block — `thinkwork-admin skill.yaml —
// catastrophic-op exclusion` — was removed when the skill directory was
// deleted. The catastrophic-op guarantee now rests on the admin-ops MCP
// tool definitions in packages/lambda/admin-ops-mcp.ts, which are a
// closed set enumerated in source and guarded by the typecheck + the
// tools/list must-have test in __tests__/admin-ops-mcp.test.ts. Any new
// tool has to go through a code review that would catch a catastrophic
// op name — same gate the yaml-regex test used to provide.
