import { describe, expect, it } from "vitest";
import {
  agentCoreOAuthPrincipalMatches,
  agentCoreOAuthSessionUri,
} from "./agentcore-oauth-callback.js";

describe("agentCoreOAuthSessionUri", () => {
  it("accepts AgentCore's documented session_id callback parameter", () => {
    expect(
      agentCoreOAuthSessionUri({ session_id: "urn:agentcore:session" }),
    ).toBe("urn:agentcore:session");
  });

  it("retains SDK and legacy aliases", () => {
    expect(agentCoreOAuthSessionUri({ sessionUri: "camel" })).toBe("camel");
    expect(agentCoreOAuthSessionUri({ session_uri: "snake" })).toBe("snake");
  });
});

describe("agentCoreOAuthPrincipalMatches", () => {
  const exact = {
    stateUserId: "user-a",
    stateTenantId: "tenant-a",
    principalUserId: "user-a",
    principalTenantId: "tenant-a",
  };

  it("accepts only the authenticated user and tenant that started the flow", () => {
    expect(agentCoreOAuthPrincipalMatches(exact)).toBe(true);
  });

  it("rejects a different active browser user", () => {
    expect(
      agentCoreOAuthPrincipalMatches({
        ...exact,
        principalUserId: "user-b",
      }),
    ).toBe(false);
  });

  it("rejects the same user crossing a tenant boundary", () => {
    expect(
      agentCoreOAuthPrincipalMatches({
        ...exact,
        principalTenantId: "tenant-b",
      }),
    ).toBe(false);
  });
});
