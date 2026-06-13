import { describe, expect, it } from "vitest";
import { resolveUserMcpPrincipal } from "./user-mcp-principal.js";
import type { TenantMembershipVerdict } from "./tenant-membership.js";

type Membership = Extract<TenantMembershipVerdict, { ok: true }>;

function membership(overrides: Partial<Membership>): Membership {
  return {
    ok: true,
    auth: {
      authType: "cognito",
      principalId: "principal-1",
      tenantId: "tenant-1",
      email: "member@example.com",
      emailVerified: true,
      agentId: null,
    },
    tenantId: "tenant-1",
    userId: "user-1",
    role: "member",
    ...overrides,
  } as Membership;
}

describe("resolveUserMcpPrincipal", () => {
  it("uses the resolved Cognito user when no principal header is supplied", () => {
    expect(resolveUserMcpPrincipal(membership({}), {})).toEqual({
      ok: true,
      userId: "user-1",
    });
  });

  it("rejects a member spoofing another user's principal id", () => {
    expect(
      resolveUserMcpPrincipal(membership({}), {
        "x-principal-id": "user-2",
      }),
    ).toEqual({
      ok: false,
      status: 403,
      reason: "Members may only manage their own MCP tokens",
    });
  });

  it("allows owners and admins to target another user's MCP auth state", () => {
    expect(
      resolveUserMcpPrincipal(membership({ role: "admin" }), {
        "x-principal-id": "user-2",
      }),
    ).toEqual({ ok: true, userId: "user-2" });

    expect(
      resolveUserMcpPrincipal(membership({ role: "owner" }), {
        "x-principal-id": "user-3",
      }),
    ).toEqual({ ok: true, userId: "user-3" });
  });

  it("keeps service/API-key compatibility by requiring an asserted principal", () => {
    expect(
      resolveUserMcpPrincipal(
        membership({
          auth: {
            authType: "apikey",
            principalId: null,
            tenantId: null,
            email: null,
            emailVerified: false,
            agentId: null,
          },
          userId: null,
          role: null,
        }),
        {},
      ),
    ).toEqual({
      ok: false,
      status: 400,
      reason: "x-principal-id header required",
    });

    expect(
      resolveUserMcpPrincipal(
        membership({
          auth: {
            authType: "service",
            principalId: null,
            tenantId: null,
            email: null,
            emailVerified: false,
            agentId: null,
          },
          userId: null,
          role: null,
        }),
        { "x-principal-id": "user-service-target" },
      ),
    ).toEqual({ ok: true, userId: "user-service-target" });
  });
});
