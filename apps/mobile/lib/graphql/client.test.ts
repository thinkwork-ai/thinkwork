import { afterEach, describe, expect, it, vi } from "vitest";

const urqlState = vi.hoisted(() => ({
  forwardSubscription: null as
    | null
    | ((request: { query?: string; variables?: Record<string, unknown> }) => {
        subscribe(sink: unknown): unknown;
      }),
}));

vi.mock("urql", () => ({
  Client: class TestClient {
    constructor(_options: unknown) {}
  },
  cacheExchange: {},
  fetchExchange: {},
  subscriptionExchange: vi.fn(
    (options: {
      forwardSubscription: typeof urqlState.forwardSubscription;
    }) => {
      urqlState.forwardSubscription = options.forwardSubscription;
      return {};
    },
  ),
}));

vi.mock("expo-crypto", () => ({ randomUUID: () => "subscription-1" }));
vi.mock("@thinkwork/react-native-sdk", () => ({ setAuthToken: vi.fn() }));
vi.mock("@/lib/platform-config", () => ({
  getPlatformConfig: () => ({
    apiUrl: "https://api.example.test",
    graphqlHttpUrl: "https://api.example.test/graphql",
    graphqlUrl: "https://api.example.test/graphql",
    graphqlWsUrl:
      "wss://example.appsync-realtime-api.us-east-1.amazonaws.com/graphql",
  }),
}));

class TestWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static instances: TestWebSocket[] = [];

  readonly readyState = TestWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    TestWebSocket.instances.push(this);
  }

  send(value: string) {
    this.sent.push(value);
  }
  close() {}
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  TestWebSocket.instances = [];
  urqlState.forwardSubscription = null;
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("mobile AppSync tenant reconnect", () => {
  it("discards an old-tenant ticket response after tenant selection changes", async () => {
    vi.stubGlobal("WebSocket", TestWebSocket);
    const oldTicket = deferred<{
      ok: true;
      json(): Promise<{ token: string }>;
    }>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(oldTicket.promise)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "twsub1_fresh-connect-ticket" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "twsub1_registration-ticket" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const client = await import("./client");
    client.setAuthToken("cognito-token");
    client.setActiveTenantId("tenant-a");
    const sink = {
      next: vi.fn(),
      error: vi.fn(),
      complete: vi.fn(),
    };

    urqlState.forwardSubscription!({
      query: "subscription ThreadUpdated { threadUpdated { id } }",
      variables: {},
    }).subscribe(sink);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    client.setActiveTenantId("tenant-b");
    oldTicket.resolve({
      ok: true,
      json: async () => ({ token: "twsub1_stale-connect-ticket" }),
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({
      tenantId: "tenant-a",
    });
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toMatchObject({
      tenantId: "tenant-b",
    });
    await vi.waitFor(() => expect(TestWebSocket.instances).toHaveLength(1));
    expect(TestWebSocket.instances[0]!.url).not.toContain(
      "stale-connect-ticket",
    );

    TestWebSocket.instances[0]!.onopen?.();
    TestWebSocket.instances[0]!.onmessage?.({
      data: JSON.stringify({ type: "connection_ack" }),
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body)).toMatchObject({
      tenantId: "tenant-b",
    });
    await vi.waitFor(() =>
      expect(TestWebSocket.instances[0]!.sent).toHaveLength(2),
    );
    expect(sink.error).not.toHaveBeenCalled();
  });

  it("retries when a tenant change supersedes a socket before acknowledgement", async () => {
    vi.stubGlobal("WebSocket", TestWebSocket);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "twsub1_first-connect" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "twsub1_second-connect" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "twsub1_registration" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const client = await import("./client");
    client.setAuthToken("cognito-token");
    client.setActiveTenantId("tenant-a");
    const sink = {
      next: vi.fn(),
      error: vi.fn(),
      complete: vi.fn(),
    };

    urqlState.forwardSubscription!({
      query: "subscription ThreadUpdated { threadUpdated { id } }",
      variables: {},
    }).subscribe(sink);
    await vi.waitFor(() => expect(TestWebSocket.instances).toHaveLength(1));
    const firstSocket = TestWebSocket.instances[0]!;

    client.setActiveTenantId("tenant-b");
    await vi.waitFor(() => expect(TestWebSocket.instances).toHaveLength(2));
    const secondSocket = TestWebSocket.instances[1]!;
    firstSocket.onclose?.();
    secondSocket.onopen?.();
    secondSocket.onmessage?.({
      data: JSON.stringify({ type: "connection_ack" }),
    });

    await vi.waitFor(() => expect(secondSocket.sent).toHaveLength(2));
    expect(sink.error).not.toHaveBeenCalled();
    expect(sink.complete).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body)).toMatchObject({
      tenantId: "tenant-b",
    });
  });

  it("ignores an old socket close after a new tenant socket is installed", async () => {
    vi.stubGlobal("WebSocket", TestWebSocket);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "twsub1_first-connect" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "twsub1_first-registration" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "twsub1_second-connect" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "twsub1_second-registration" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const client = await import("./client");
    client.setAuthToken("cognito-token");
    client.setActiveTenantId("tenant-a");
    const firstSink = {
      next: vi.fn(),
      error: vi.fn(),
      complete: vi.fn(),
    };
    const secondSink = {
      next: vi.fn(),
      error: vi.fn(),
      complete: vi.fn(),
    };

    urqlState.forwardSubscription!({
      query: "subscription First { first { id } }",
      variables: {},
    }).subscribe(firstSink);
    await vi.waitFor(() => expect(TestWebSocket.instances).toHaveLength(1));
    const firstSocket = TestWebSocket.instances[0]!;
    firstSocket.onopen?.();
    firstSocket.onmessage?.({
      data: JSON.stringify({ type: "connection_ack" }),
    });
    await vi.waitFor(() => expect(firstSocket.sent).toHaveLength(2));

    client.setActiveTenantId("tenant-b");
    expect(firstSink.complete).toHaveBeenCalledOnce();
    urqlState.forwardSubscription!({
      query: "subscription Second { second { id } }",
      variables: {},
    }).subscribe(secondSink);
    await vi.waitFor(() => expect(TestWebSocket.instances).toHaveLength(2));
    const secondSocket = TestWebSocket.instances[1]!;

    firstSocket.onclose?.();
    secondSocket.onopen?.();
    secondSocket.onmessage?.({
      data: JSON.stringify({ type: "connection_ack" }),
    });

    await vi.waitFor(() => expect(secondSocket.sent).toHaveLength(2));
    expect(secondSink.error).not.toHaveBeenCalled();
    expect(secondSink.complete).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[3]![1].body)).toMatchObject({
      tenantId: "tenant-b",
    });
  });
});
