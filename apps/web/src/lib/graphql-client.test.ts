import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "graphql";
import {
  AppSyncSubscriptionClient,
  MAX_CONSECUTIVE_CONNECT_FAILURES,
  buildGraphqlAuthHeaders,
  buildAppSyncAuthHost,
  buildAppSyncRealtimeUrl,
  clearConnectTicketCache,
  isRealtimeEndpointConfigured,
  reconnectDelayMs,
  resetRealtimeConfigWarningForTest,
  serializeGraphqlQuery,
  setAuthToken,
  setGraphqlTenantId,
  setTokenProvider,
  startTokenRefresh,
  stopTokenRefresh,
} from "./graphql-client";
import { setRuntimeConfigForTest } from "./runtime-config";

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
  setRuntimeConfigForTest({});
  stopTokenRefresh();
  clearConnectTicketCache();
  resetRealtimeConfigWarningForTest();
});

afterEach(() => {
  stopTokenRefresh();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AppSync realtime URL wiring", () => {
  const graphqlUrl =
    "https://abc123.appsync-api.us-east-1.amazonaws.com/graphql";
  const realtimeUrl =
    "wss://abc123.appsync-realtime-api.us-east-1.amazonaws.com/graphql";

  it("uses the explicit realtime URL while authorizing against the GraphQL host", () => {
    const url = buildAppSyncRealtimeUrl(
      graphqlUrl,
      realtimeUrl,
      "twsub1_connect",
    );

    expect(url).toContain(
      "abc123.appsync-realtime-api.us-east-1.amazonaws.com",
    );
    expect(decodedHeader(url)).toEqual({
      host: "abc123.appsync-api.us-east-1.amazonaws.com",
      Authorization: "twsub1_connect",
    });
  });

  it("derives the realtime endpoint when only the GraphQL URL is configured", () => {
    const url = buildAppSyncRealtimeUrl(graphqlUrl, "", "twsub1_connect");

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
  it("does not send the public AppSync API key on HTTP GraphQL requests", () => {
    expect(buildGraphqlAuthHeaders()).not.toHaveProperty("x-api-key");
  });

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

describe("realtime reconnect backoff schedule", () => {
  it("doubles from 3s to a hard 60s ceiling", () => {
    const noJitter = 0.5;
    expect(
      [1, 2, 3, 4, 5, 6, 7].map((n) => reconnectDelayMs(n, noJitter)),
    ).toEqual([3_000, 6_000, 12_000, 24_000, 48_000, 60_000, 60_000]);
  });

  it("applies bounded jitter and never exceeds the ceiling", () => {
    expect(reconnectDelayMs(1, 0)).toBe(2_550);
    expect(reconnectDelayMs(1, 1)).toBe(3_450);
    expect(reconnectDelayMs(20, 1)).toBe(60_000);
  });
});

describe("realtime endpoint configuration gate", () => {
  it("is false when neither the GraphQL nor the websocket URL is configured", () => {
    expect(isRealtimeEndpointConfigured("", "")).toBe(false);
  });

  it("is false for a malformed URL rather than throwing", () => {
    expect(isRealtimeEndpointConfigured("not-a-url", "")).toBe(false);
  });

  it("is true once the AppSync GraphQL URL is present", () => {
    expect(
      isRealtimeEndpointConfigured(
        "https://abc123.appsync-api.us-east-1.amazonaws.com/graphql",
        "",
      ),
    ).toBe(true);
  });
});

describe("AppSyncSubscriptionClient ticket minting", () => {
  const configured = {
    VITE_GRAPHQL_HTTP_URL: "https://api.example.com/graphql",
    VITE_GRAPHQL_URL:
      "https://abc123.appsync-api.us-east-1.amazonaws.com/graphql",
    VITE_GRAPHQL_WS_URL:
      "wss://abc123.appsync-realtime-api.us-east-1.amazonaws.com/graphql",
  };

  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    static instances: FakeWebSocket[] = [];
    // Reported as CLOSED so repeat connect() calls are not short-circuited by
    // the "already open" guard; tests drive lifecycle callbacks by hand.
    readyState = 3;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    send = vi.fn();
    close = vi.fn();
    constructor() {
      FakeWebSocket.instances.push(this);
    }
  }

  const originalWebSocket = globalThis.WebSocket;
  let clients: AppSyncSubscriptionClient[] = [];

  function newClient() {
    const client = new AppSyncSubscriptionClient();
    clients.push(client);
    return client;
  }

  /** Simulate the socket opening so `connecting` clears, as onopen does live. */
  function openLastSocket() {
    FakeWebSocket.instances.at(-1)?.onopen?.();
  }

  function sink() {
    return { next: vi.fn(), error: vi.fn(), complete: vi.fn() };
  }

  function mockTicketFetch(ok: boolean) {
    const fetchMock = vi.fn(async () => ({
      ok,
      json: async () => ({ token: `twsub1_${fetchMock.mock.calls.length}` }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  beforeEach(() => {
    clients = [];
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    setAuthToken(jwtWithExp(Math.floor(Date.now() / 1000) + 3600));
    setGraphqlTenantId("tenant-1");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    for (const client of clients) client.dispose();
    clients = [];
    globalThis.WebSocket = originalWebSocket;
    vi.unstubAllGlobals();
  });

  it("never mints a ticket when the realtime endpoint is unconfigured", async () => {
    setRuntimeConfigForTest({
      VITE_GRAPHQL_HTTP_URL: configured.VITE_GRAPHQL_HTTP_URL,
    });
    const fetchMock = mockTicketFetch(true);
    const client = newClient();
    const subscriber = sink();

    client.subscribe("subscription A { a }", {}, subscriber);
    await vi.advanceTimersByTimeAsync(120_000);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.state.dormant).toBe(true);
    expect(client.state.reconnectScheduled).toBe(false);
    expect(subscriber.error).toHaveBeenCalledTimes(1);
    // One console.error for the unconfigured endpoint, and only one.
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("re-mints at most once, then goes dormant after the failure cap", async () => {
    setRuntimeConfigForTest(configured);
    const fetchMock = mockTicketFetch(false);
    const client = newClient();
    const subscriber = sink();

    client.subscribe("subscription A { a }", {}, subscriber);
    // 3+6+12+24+48+60*4 = 333s of backoff; 400s covers the whole ladder.
    await vi.advanceTimersByTimeAsync(400_000);

    expect(fetchMock).toHaveBeenCalledTimes(MAX_CONSECUTIVE_CONNECT_FAILURES);
    expect(client.state.dormant).toBe(true);
    expect(client.state.reconnectScheduled).toBe(false);
    expect(subscriber.error).toHaveBeenCalledTimes(1);

    // Dormant means dormant: no further minting no matter how long we wait.
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_CONSECUTIVE_CONNECT_FAILURES);
  });

  it("does not schedule a reconnect once every subscription is gone", async () => {
    setRuntimeConfigForTest(configured);
    const fetchMock = mockTicketFetch(false);
    const client = newClient();

    const unsubscribe = client.subscribe("subscription A { a }", {}, sink());
    unsubscribe();
    await vi.advanceTimersByTimeAsync(400_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.state.reconnectScheduled).toBe(false);
    expect(client.state.dormant).toBe(false);
  });

  it("reuses a connect ticket inside the 45s window and re-mints after it", async () => {
    setRuntimeConfigForTest(configured);
    const fetchMock = mockTicketFetch(true);
    const client = newClient();

    await client.connect();
    openLastSocket();
    await client.connect();
    openLastSocket();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(Date.now() + 44_000));
    await client.connect();
    openLastSocket();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(Date.now() + 2_000));
    await client.connect();
    openLastSocket();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("drops the cached ticket when the access token identity changes", async () => {
    setRuntimeConfigForTest(configured);
    const fetchMock = mockTicketFetch(true);
    const client = newClient();

    await client.connect();
    openLastSocket();
    setAuthToken(jwtWithExp(Math.floor(Date.now() / 1000) + 7200));
    await client.connect();
    openLastSocket();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("wakes from dormancy when a new subscription arrives", async () => {
    setRuntimeConfigForTest({
      VITE_GRAPHQL_HTTP_URL: configured.VITE_GRAPHQL_HTTP_URL,
    });
    const fetchMock = mockTicketFetch(true);
    const client = newClient();

    client.subscribe("subscription A { a }", {}, sink());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.state.dormant).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    setRuntimeConfigForTest(configured);
    client.subscribe("subscription B { b }", {}, sink());
    await vi.advanceTimersByTimeAsync(0);

    expect(client.state.dormant).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("wakes from dormancy on the window online event", async () => {
    setRuntimeConfigForTest({
      VITE_GRAPHQL_HTTP_URL: configured.VITE_GRAPHQL_HTTP_URL,
    });
    const fetchMock = mockTicketFetch(true);
    const client = newClient();

    client.subscribe("subscription A { a }", {}, sink());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.state.dormant).toBe(true);

    setRuntimeConfigForTest(configured);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);

    expect(client.state.dormant).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
