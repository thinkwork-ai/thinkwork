import { describe, expect, it } from "vitest";
import {
  buildAppSyncAuthHost,
  buildAppSyncRealtimeUrl,
} from "./graphql-client";

function decodedHeader(url: string) {
  const encoded = new URL(url).searchParams.get("header");
  if (!encoded) throw new Error("missing AppSync realtime header");
  return JSON.parse(atob(encoded)) as Record<string, string>;
}

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
});
