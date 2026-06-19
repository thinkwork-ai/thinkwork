import { describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  createPublicAuthOptionsHandler,
  normalizeTrustedHost,
  resolvePublicAuthOptions,
  type PublicAuthOptionsDeps,
} from "./public-auth-options.js";

const validPublication = {
  displayName: "WorkOS Auth",
  publicOptionMode: "single_sso",
  providerOptions: [
    {
      key: "google",
      displayName: "Google",
      clientSecretRef: "secret-should-never-leak",
    },
  ],
  publicOptionLabel: "Continue with SSO",
  hostnames: ["login.customer.example"],
  componentHandlerRef: {
    status: "valid",
    publicOptionsPublished: true,
    diagnosticCode: null,
    authProviderResourceId: "resource-1",
    tenantAuthProviderReferenceId: "tenant-ref-1",
    clientSecretRef: "secret-should-never-leak",
  },
};

function deps(
  publication: typeof validPublication | null,
): PublicAuthOptionsDeps {
  return {
    loadPublicationForHost: vi.fn(async (host: string) =>
      host === "login.customer.example" ? publication : null,
    ),
    passwordSignInEnabled: () => true,
  };
}

describe("resolvePublicAuthOptions", () => {
  it("returns password availability and no OAuth options when no host matches", async () => {
    const d = deps(validPublication);

    const options = await resolvePublicAuthOptions({
      trustedDomainName: "shared.thinkwork.example",
      deps: d,
    });

    expect(options).toEqual({
      password: { enabled: true },
      oauthOptions: [],
    });
    expect(d.loadPublicationForHost).toHaveBeenCalledWith(
      "shared.thinkwork.example",
    );
  });

  it("fails closed before DB lookup when API Gateway does not provide a trusted domain", async () => {
    const d = deps(validPublication);

    const options = await resolvePublicAuthOptions({
      trustedDomainName: undefined,
      deps: d,
    });

    expect(options.oauthOptions).toEqual([]);
    expect(d.loadPublicationForHost).not.toHaveBeenCalled();
  });

  it("publishes the single WorkOS SSO fallback for a valid publication", async () => {
    const options = await resolvePublicAuthOptions({
      trustedDomainName: "LOGIN.CUSTOMER.EXAMPLE.",
      deps: deps(validPublication),
    });

    expect(options).toEqual({
      password: { enabled: true },
      oauthOptions: [
        {
          key: "workos-sso",
          label: "Continue with SSO",
          icon: "sso",
          provider: "workos",
          providerSpecific: false,
          route: {
            type: "workosAuthorize",
            authorizePath: "/api/auth/workos/authorize",
            prompt: "select_account",
          },
        },
      ],
    });
  });

  it("does not publish provider-specific options before route proof exists", async () => {
    const options = await resolvePublicAuthOptions({
      trustedDomainName: "login.customer.example",
      deps: deps({
        ...validPublication,
        publicOptionMode: "provider_specific",
      }),
    });

    expect(options.oauthOptions).toEqual([]);
  });

  it("does not publish when component validation is not valid", async () => {
    const options = await resolvePublicAuthOptions({
      trustedDomainName: "login.customer.example",
      deps: deps({
        ...validPublication,
        componentHandlerRef: {
          ...validPublication.componentHandlerRef,
          status: "invalid",
          publicOptionsPublished: true,
        },
      }),
    });

    expect(options.oauthOptions).toEqual([]);
  });

  it("keeps tenant ids, secret refs, diagnostics, and raw provider config out of the public payload", async () => {
    const options = await resolvePublicAuthOptions({
      trustedDomainName: "login.customer.example",
      deps: deps(validPublication),
    });

    const serialized = JSON.stringify(options);
    expect(serialized).not.toContain("tenant-ref-1");
    expect(serialized).not.toContain("resource-1");
    expect(serialized).not.toContain("secret-should-never-leak");
    expect(serialized).not.toContain("diagnosticCode");
    expect(serialized).not.toContain("providerOptions");
  });
});

describe("createPublicAuthOptionsHandler", () => {
  it("ignores spoofable Host and Origin headers during tenant resolution", async () => {
    const d = deps(validPublication);
    const handler = createPublicAuthOptionsHandler(d);

    const response = await handler(
      event({
        domainName: "shared.thinkwork.example",
        headers: {
          host: "login.customer.example",
          origin: "https://login.customer.example",
          "x-forwarded-host": "login.customer.example",
        },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}").oauthOptions).toEqual([]);
    expect(d.loadPublicationForHost).toHaveBeenCalledWith(
      "shared.thinkwork.example",
    );
  });

  it("returns no-store cache headers", async () => {
    const handler = createPublicAuthOptionsHandler(deps(validPublication));

    const response = await handler(
      event({ domainName: "login.customer.example" }),
    );

    expect(response.headers?.["Cache-Control"]).toBe("no-store, max-age=0");
  });
});

describe("normalizeTrustedHost", () => {
  it("normalizes case, punycode, and trailing dots", () => {
    expect(normalizeTrustedHost("BÜCHER.example.")).toBe(
      "xn--bcher-kva.example",
    );
  });
});

function event(args: {
  domainName: string;
  headers?: Record<string, string>;
}): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "GET /api/auth/options",
    rawPath: "/api/auth/options",
    rawQueryString: "",
    headers: args.headers ?? {},
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
      time: "18/Jun/2026:20:00:00 +0000",
      timeEpoch: 1781812800000,
    },
    isBase64Encoded: false,
  };
}
