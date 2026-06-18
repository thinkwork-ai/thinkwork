import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "graphql";
import {
  buildGraphqlAuthHeaders,
  buildAppSyncAuthHost,
  buildAppSyncRealtimeUrl,
  serializeGraphqlQuery,
  setAuthToken,
  setGraphqlTenantId,
  setTokenProvider,
  startTokenRefresh,
  stopTokenRefresh,
} from "./graphql-client";

function decodedHeader(url: string) {
  const encoded = new URL(url).searchParams.get("header");
  if (!encoded) throw new Error("missing AppSync realtime header");
  return JSON.parse(atob(encoded)) as Record<string, string>;
}

function jwtWithExp(exp: number): string {
  const encodedPayload = btoa(JSON.stringify({ exp }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${encodedPayload}.signature`;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-18T11:00:00Z"));
  setAuthToken(null);
  setGraphqlTenantId(null);
  setTokenProvider(null);
  stopTokenRefresh();
});

afterEach(() => {
  stopTokenRefresh();
  vi.useRealTimers();
});

describe("AppSync realtime URL wiring", () => {
  const graphqlUrl =
    "https://abc123.appsync-api.us-east-1.amazonaws.com/graphql";
  const realtimeUrl =
    "wss://abc123.appsync-realtime-api.us-east-1.amazonaws.com/graphql";

  it("uses the explicit realtime URL while authorizing against the GraphQL host", () => {
    const url = buildAppSyncRealtimeUrl(graphqlUrl, realtimeUrl, "test-key");

    expect(url).toContain(
      "abc123.appsync-realtime-api.us-east-1.amazonaws.com",
    );
    expect(decodedHeader(url)).toEqual({
      host: "abc123.appsync-api.us-east-1.amazonaws.com",
      "x-api-key": "test-key",
    });
  });

  it("derives the realtime endpoint when only the GraphQL URL is configured", () => {
    const url = buildAppSyncRealtimeUrl(graphqlUrl, "", "test-key");

    expect(url).toContain(
      "abc123.appsync-realtime-api.us-east-1.amazonaws.com",
    );
    expect(decodedHeader(url).host).toBe(
      "abc123.appsync-api.us-east-1.amazonaws.com",
    );
  });

  it("recovers the GraphQL auth host from a realtime-only configuration", () => {
    expect(buildAppSyncAuthHost("", realtimeUrl)).toBe(
      "abc123.appsync-api.us-east-1.amazonaws.com",
    );
  });

  it("serializes subscription DocumentNodes before sending them over AppSync", () => {
    const query = serializeGraphqlQuery(
      parse(`
        subscription ComputerThreadChunk($threadId: ID!) {
          onComputerThreadChunk(threadId: $threadId) {
            seq
          }
        }
      `),
    );

    expect(query).toContain("subscription ComputerThreadChunk");
    expect(query).toContain("onComputerThreadChunk");
  });
});

describe("GraphQL auth headers", () => {
  it("keeps sending a cached token inside the refresh-skew window", () => {
    const token = jwtWithExp(Math.floor(Date.now() / 1000) + 20);

    setAuthToken(token);

    expect(buildGraphqlAuthHeaders()).toMatchObject({
      Authorization: token,
    });
  });

  it("omits a cached token only after hard expiry", () => {
    const token = jwtWithExp(Math.floor(Date.now() / 1000) - 1);

    setAuthToken(token);

    expect(buildGraphqlAuthHeaders()).not.toHaveProperty("Authorization");
  });

  it("refreshes the cached token on the short background interval", async () => {
    const staleSoonToken = jwtWithExp(Math.floor(Date.now() / 1000) + 20);
    const freshToken = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
    const provider = vi.fn(async () => freshToken);

    setAuthToken(staleSoonToken);
    setTokenProvider(provider);
    startTokenRefresh();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(provider).toHaveBeenCalled();
    expect(buildGraphqlAuthHeaders()).toMatchObject({
      Authorization: freshToken,
    });
  });
});
