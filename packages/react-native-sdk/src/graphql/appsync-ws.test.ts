import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThinkworkConfig } from "../types";
import { createAppSyncSubscriptionTransport } from "./appsync-ws";
import { setAuthToken } from "./token";

vi.mock("expo-crypto", () => ({ randomUUID: () => "subscription-1" }));

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

const config: ThinkworkConfig = {
  apiBaseUrl: "https://api.example.test",
  graphqlUrl: "https://graphql.example.test/graphql",
  graphqlWsUrl:
    "wss://example.appsync-realtime-api.us-east-1.amazonaws.com/graphql",
  cognito: {
    userPoolId: "us-east-1_example",
    userPoolClientId: "client-id",
    region: "us-east-1",
  },
};

afterEach(() => {
  setAuthToken(null);
  TestWebSocket.instances = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AppSync realtime connection setup", () => {
  it("errors a pending subscription when the socket closes before acknowledgement", async () => {
    setAuthToken("cognito-id-token");
    vi.stubGlobal("WebSocket", TestWebSocket);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ token: "twsub1_connect-ticket" }),
      }),
    );
    const sink = {
      next: vi.fn(),
      error: vi.fn(),
      complete: vi.fn(),
    };

    createAppSyncSubscriptionTransport(config)
      .forward({ query: "subscription ThreadUpdated { threadUpdated { id } }" })
      .subscribe(sink);

    await vi.waitFor(() => expect(TestWebSocket.instances).toHaveLength(1));
    TestWebSocket.instances[0]!.onclose?.();

    await vi.waitFor(() => expect(sink.error).toHaveBeenCalledOnce());
    expect(sink.error).toHaveBeenCalledWith(
      new Error("Realtime connection closed before acknowledgement"),
    );
    expect(sink.complete).not.toHaveBeenCalled();
  });

  it("discards a stale ticket response after reconnect", async () => {
    setAuthToken("old-cognito-token");
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
    const sink = {
      next: vi.fn(),
      error: vi.fn(),
      complete: vi.fn(),
    };
    const transport = createAppSyncSubscriptionTransport(config);

    transport
      .forward({ query: "subscription ThreadUpdated { threadUpdated { id } }" })
      .subscribe(sink);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    setAuthToken("new-cognito-token");
    transport.reconnect();
    oldTicket.resolve({
      ok: true,
      json: async () => ({ token: "twsub1_stale-connect-ticket" }),
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(TestWebSocket.instances).toHaveLength(1));
    const encodedHeader = new URL(
      TestWebSocket.instances[0]!.url,
    ).searchParams.get("header");
    expect(JSON.parse(atob(encodedHeader!))).toEqual({
      Authorization: "twsub1_fresh-connect-ticket",
      host: "example.appsync-api.us-east-1.amazonaws.com",
    });

    TestWebSocket.instances[0]!.onopen?.();
    TestWebSocket.instances[0]!.onmessage?.({
      data: JSON.stringify({ type: "connection_ack" }),
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await vi.waitFor(() =>
      expect(TestWebSocket.instances[0]!.sent).toHaveLength(2),
    );
    expect(sink.error).not.toHaveBeenCalled();
  });

  it("retries when reconnect supersedes a socket before acknowledgement", async () => {
    setAuthToken("cognito-id-token");
    vi.stubGlobal("WebSocket", TestWebSocket);
    vi.stubGlobal(
      "fetch",
      vi
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
        }),
    );
    const sink = {
      next: vi.fn(),
      error: vi.fn(),
      complete: vi.fn(),
    };
    const transport = createAppSyncSubscriptionTransport(config);

    transport
      .forward({ query: "subscription ThreadUpdated { threadUpdated { id } }" })
      .subscribe(sink);
    await vi.waitFor(() => expect(TestWebSocket.instances).toHaveLength(1));
    const firstSocket = TestWebSocket.instances[0]!;

    transport.reconnect();
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
  });

  it("ignores an old socket close after a replacement is installed", async () => {
    setAuthToken("cognito-id-token");
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
    const transport = createAppSyncSubscriptionTransport(config);

    transport
      .forward({ query: "subscription First { first { id } }" })
      .subscribe(firstSink);
    await vi.waitFor(() => expect(TestWebSocket.instances).toHaveLength(1));
    const firstSocket = TestWebSocket.instances[0]!;
    firstSocket.onopen?.();
    firstSocket.onmessage?.({
      data: JSON.stringify({ type: "connection_ack" }),
    });
    await vi.waitFor(() => expect(firstSocket.sent).toHaveLength(2));

    transport.reconnect();
    expect(firstSink.complete).toHaveBeenCalledOnce();
    transport
      .forward({ query: "subscription Second { second { id } }" })
      .subscribe(secondSink);
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
  });
});
