import { describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  createPublicAuthOptionsHandler,
  normalizeTrustedHost,
  resolvePublicAuthOptions,
  type PublicAuthOptionsDeps,
} from "./public-auth-options.js";

const snapshot = {
  scope: "deployment" as const,
  localPasswordEnabled: true,
  routes: [
    {
      routeKey: "local",
      clientFamily: "web",
      cognitoAppClientId: "local-client",
      providerNames: ["COGNITO"],
      lifecycleState: "native",
      validationStatus: "valid",
    },
    {
      routeKey: "google",
      clientFamily: "web",
      cognitoAppClientId: "google-client",
      providerNames: ["Google"],
      lifecycleState: "native",
      validationStatus: "valid",
    },
    {
      routeKey: "microsoft",
      clientFamily: "web",
      cognitoAppClientId: "microsoft-client",
      providerNames: ["MicrosoftOrganizations"],
      lifecycleState: "native",
      validationStatus: "valid",
    },
  ],
  connections: [
    {
      resourceId: "google-resource",
      connectionKey: "google",
      providerKind: "google",
      displayName: "Google",
      cognitoIdentityProviderName: "Google",
      cognitoAppClientIds: ["google-client"],
      lifecycleState: "native",
      validationStatus: "valid",
      publicOptionsPublished: true,
      diagnostics: { secret: "must-not-leak" },
    },
    {
      resourceId: "microsoft-resource",
      connectionKey: "microsoft:organizations",
      providerKind: "microsoft_organizations",
      displayName: "Microsoft",
      cognitoIdentityProviderName: "MicrosoftOrganizations",
      cognitoAppClientIds: ["microsoft-client"],
      lifecycleState: "native",
      validationStatus: "valid",
      publicOptionsPublished: true,
      clientSecretRef: "must-not-leak",
    },
  ],
};

function deps(): PublicAuthOptionsDeps {
  return { loadPolicy: vi.fn(async () => snapshot) };
}

describe("resolvePublicAuthOptions", () => {
  it("returns direct Cognito Google and Microsoft routes plus local password", async () => {
    const result = await resolvePublicAuthOptions({
      routingHost: "app.thinkwork.ai",
      deps: deps(),
    });

    expect(result.password).toEqual({
      enabled: true,
      clientId: "local-client",
    });
    expect(result.oauthOptions.map((option) => option.label)).toEqual([
      "Continue with Google",
      "Continue with Microsoft",
    ]);
    expect(
      result.oauthOptions.every(
        (option) => option.route.type === "cognitoHostedUi",
      ),
    ).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("workos");
    expect(serialized).not.toContain("must-not-leak");
    expect(serialized).not.toContain("resource");
  });
});

describe("createPublicAuthOptionsHandler", () => {
  it("uses the requested host only as public routing input and returns no-store", async () => {
    const d = deps();
    const handler = createPublicAuthOptionsHandler(d);
    const response = await handler(
      event({
        domainName: "api.execute-api.us-east-1.amazonaws.com",
        rawQueryString: "host=LOGIN.CUSTOMER.EXAMPLE.&platform=web",
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers?.["Cache-Control"]).toBe("no-store, max-age=0");
    expect(d.loadPolicy).toHaveBeenCalledWith("login.customer.example");
  });

  it("fails closed when catalog loading fails", async () => {
    const handler = createPublicAuthOptionsHandler({
      loadPolicy: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    });
    const response = await handler(event({ domainName: "api.example" }));
    expect(JSON.parse(response.body ?? "{}")).toEqual({
      password: { enabled: false },
      oauthOptions: [],
    });
  });
});

describe("normalizeTrustedHost", () => {
  it("normalizes case, punycode, trailing dots, and local ports", () => {
    expect(normalizeTrustedHost("BÜCHER.example.")).toBe(
      "xn--bcher-kva.example",
    );
    expect(normalizeTrustedHost("LOCALHOST:5180")).toBe("localhost");
  });
});

function event(args: {
  domainName: string;
  rawQueryString?: string;
}): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "GET /api/auth/options",
    rawPath: "/api/auth/options",
    rawQueryString: args.rawQueryString ?? "",
    headers: {},
    requestContext: {
      accountId: "123",
      apiId: "api",
      domainName: args.domainName,
      domainPrefix: args.domainName.split(".")[0],
      http: {
        method: "GET",
        path: "/api/auth/options",
        protocol: "HTTP/1.1",
        sourceIp: "203.0.113.10",
        userAgent: "vitest",
      },
      requestId: "req",
      routeKey: "GET /api/auth/options",
      stage: "$default",
      time: "18/Jul/2026:20:00:00 +0000",
      timeEpoch: 1784404800000,
    },
    isBase64Encoded: false,
  };
}
