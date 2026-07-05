import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchEnvironmentRuntimeConfig } from "./runtime-config-fetch";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fetchEnvironmentRuntimeConfig", () => {
  it("maps the full viteEnv surface", async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        viteEnv: {
          VITE_API_URL: "https://api.example.com",
          VITE_GRAPHQL_HTTP_URL: "https://api.example.com/graphql",
          VITE_GRAPHQL_URL: "https://appsync.example.com/graphql",
          VITE_GRAPHQL_WS_URL: "wss://appsync.example.com/graphql",
          VITE_GRAPHQL_API_KEY: "vite-key",
          VITE_COGNITO_DOMAIN: "auth.example.com",
          VITE_COGNITO_USER_POOL_ID: "us-east-1_pool",
          VITE_COGNITO_CLIENT_ID: "client-id",
          VITE_DEPLOYMENT_ID: "deployment-1",
          VITE_DEPLOYMENT_DISPLAY_NAME: "Customer One",
          VITE_STAGE: "customer",
          VITE_AWS_REGION: "us-east-1",
        },
      }),
    );

    const result = await fetchEnvironmentRuntimeConfig(
      "https://customer.thinkwork.ai/settings",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://customer.thinkwork.ai/thinkwork-runtime-config.json",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result).toMatchObject({
      ok: true,
      host: "https://customer.thinkwork.ai",
      config: {
        apiUrl: "https://api.example.com",
        graphqlHttpUrl: "https://api.example.com/graphql",
        // Queries ride the HTTP API — never the subscription-only AppSync endpoint.
        graphqlUrl: "https://api.example.com/graphql",
        graphqlWsUrl: "wss://appsync.example.com/graphql",
        graphqlApiKey: "vite-key",
        cognitoDomain: "auth.example.com",
        cognitoUserPoolId: "us-east-1_pool",
        cognitoClientId: "client-id",
        deploymentId: "deployment-1",
        displayName: "Customer One",
        stage: "customer",
        region: "us-east-1",
      },
    });
  });

  it("falls back to outer fields when viteEnv fields are absent", async () => {
    mockFetch(
      jsonResponse({
        viteEnv: {
          VITE_API_URL: "https://vite-api.example.com",
        },
        apiEndpoint: "https://outer-api.example.com",
        graphqlHttpUrl: "https://outer-api.example.com/graphql",
        appsyncUrl: "https://outer-appsync.example.com/graphql",
        appsyncRealtimeUrl: "wss://outer-appsync.example.com/graphql",
        appsyncApiKey: "outer-key",
        cognitoDomain: "outer-auth.example.com",
        cognitoUserPoolId: "us-east-1_outer",
        cognitoClientId: "outer-client",
        deploymentId: "outer-deployment",
        displayName: "Outer Customer",
        stage: "outer",
        region: "us-west-2",
      }),
    );

    const result = await fetchEnvironmentRuntimeConfig(
      "outer.thinkwork.ai",
    );

    expect(result).toMatchObject({
      ok: true,
      config: {
        apiUrl: "https://vite-api.example.com",
        graphqlHttpUrl: "https://outer-api.example.com/graphql",
        graphqlUrl: "https://outer-api.example.com/graphql",
        graphqlWsUrl: "wss://outer-appsync.example.com/graphql",
        graphqlApiKey: "outer-key",
        cognitoDomain: "outer-auth.example.com",
        cognitoUserPoolId: "us-east-1_outer",
        cognitoClientId: "outer-client",
      },
    });
  });

  it("reports missing config when the JSON file is not published", async () => {
    mockFetch(textResponse("", { status: 404 }));

    const result = await fetchEnvironmentRuntimeConfig("missing.thinkwork.ai");

    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: "no-config-published",
        message: expect.stringContaining(
          "hasn't published mobile config; redeploy with a current CLI",
        ),
      },
    });
  });

  it("reports missing config for non-JSON 200 responses", async () => {
    mockFetch(
      textResponse("<html>not found</html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );

    const result = await fetchEnvironmentRuntimeConfig("html.thinkwork.ai");

    expect(result).toMatchObject({
      ok: false,
      error: { kind: "no-config-published" },
    });
  });

  it("reports unreachable when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("dns failed")),
    );

    const result = await fetchEnvironmentRuntimeConfig("down.thinkwork.ai");

    expect(result).toMatchObject({
      ok: false,
      error: { kind: "unreachable" },
    });
  });

  it("reports unreachable on timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));

    const promise = fetchEnvironmentRuntimeConfig("slow.thinkwork.ai");
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(promise).resolves.toMatchObject({
      ok: false,
      error: { kind: "unreachable" },
    });
  });

  it("reports malformed JSON that is missing required mapped fields", async () => {
    mockFetch(
      jsonResponse({
        viteEnv: {
          VITE_API_URL: "https://api.example.com",
          VITE_GRAPHQL_HTTP_URL: "https://api.example.com/graphql",
        },
      }),
    );

    const result = await fetchEnvironmentRuntimeConfig(
      "malformed.thinkwork.ai",
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: "malformed",
        message: expect.stringContaining("cognitoUserPoolId"),
      },
    });
  });
});

function mockFetch(response: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown) {
  return textResponse(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

function textResponse(
  body: string,
  options: {
    status?: number;
    headers?: Record<string, string>;
  } = {},
) {
  const status = options.status ?? 200;
  const headers = new Map(
    Object.entries(options.headers ?? { "content-type": "application/json" }),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string) {
        return headers.get(name.toLowerCase()) ?? null;
      },
    },
    async text() {
      return body;
    },
  };
}
