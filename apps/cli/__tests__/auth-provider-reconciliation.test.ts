import { describe, expect, it, vi } from "vitest";
import {
  buildLocalAuthReconciliation,
  reconcileLocalNativeAuth,
} from "../src/lib/auth-provider-reconciliation.js";

const base = {
  stage: "dev",
  accountId: "123456789012",
  region: "us-east-1",
  userPoolId: "us-east-1_Example123",
  microsoftTenantId: "9d65869f-0798-433d-b4e6-8c20d113dfbc",
  routeClients: {
    "web:local": {
      client_id: "1234567890abcdefghijklmnop",
      route_key: "local",
      client_family: "web" as const,
      provider_names: ["COGNITO"],
      explicit_auth_flows: ["ALLOW_USER_PASSWORD_AUTH"],
      callback_urls: ["https://app.example.com/auth/callback"],
      logout_urls: ["https://app.example.com/sign-in"],
      lifecycle_state: "native" as const,
    },
    "web:microsoft": {
      client_id: "abcdefghijklmnop1234567890",
      route_key: "microsoft",
      client_family: "web" as const,
      provider_names: ["MicrosoftOrganizations"],
      explicit_auth_flows: ["ALLOW_REFRESH_TOKEN_AUTH"],
      callback_urls: ["https://app.example.com/auth/callback"],
      logout_urls: ["https://app.example.com/sign-in"],
      lifecycle_state: "native" as const,
    },
  },
};

describe("local auth-provider reconciliation", () => {
  it("builds exact tenant-bound Microsoft metadata and route clients", () => {
    const result = buildLocalAuthReconciliation(base);
    expect(result.payload).toMatchObject({
      revision: 1,
      expectedPreviousRevision: 0,
      connections: expect.arrayContaining([
        expect.objectContaining({
          connectionKey: "microsoft:organizations",
          issuerUrl:
            "https://login.microsoftonline.com/9d65869f-0798-433d-b4e6-8c20d113dfbc/v2.0",
        }),
      ]),
      routeClients: expect.arrayContaining([
        expect.objectContaining({
          routeKey: "microsoft",
          cognitoAppClientId: "abcdefghijklmnop1234567890",
        }),
      ]),
    });
    expect(result.payload?.manifestFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects the generic organizations issuer configuration", () => {
    expect(() =>
      buildLocalAuthReconciliation({
        ...base,
        microsoftTenantId: "organizations",
      }),
    ).toThrow(/exact microsoft_oauth_tenant GUID/);
  });

  it("posts the manifest before persisting its revision", async () => {
    const calls: string[][] = [];
    const awsExec = vi.fn((args: string[]) => {
      calls.push(args);
      if (args[1] === "get-parameter") {
        return { status: 1, stdout: "", stderr: "not found" };
      }
      return { status: 0, stdout: "{}", stderr: "" };
    });
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ status: "applied", revision: 1 }), {
        status: 200,
      }),
    );

    const result = await reconcileLocalNativeAuth(
      {
        ...base,
        apiEndpoint: "https://api.example.com/",
        apiAuthSecret: "service-secret",
      },
      { awsExec, fetchImpl },
    );

    expect(result).toMatchObject({ status: "applied", revision: 1 });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.com/api/auth/providers/reconcile",
      expect.objectContaining({ method: "POST" }),
    );
    expect(calls.at(-1)).toContain("put-parameter");
  });
});
