import { describe, expect, it, vi } from "vitest";
import { createMobileTurnLeaseClient } from "./turn-lease";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe("createMobileTurnLeaseClient", () => {
  it("POSTs lifecycle actions to the mobile turn-session endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        threadTurnId: "turn-1",
        threadId: "thread-1",
        userMessageId: "msg-1",
        status: "running",
        checkpointSeq: 0,
        idempotent: false,
      }),
    );
    const client = createMobileTurnLeaseClient({
      apiBase: "https://api.test",
      getToken: async () => "tok-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.start({
      clientTurnId: "client-1",
      threadId: "thread-1",
      agentId: "agent-1",
      userText: "hello",
    });

    expect(result.threadTurnId).toBe("turn-1");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.test/api/mobile/turn-session");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok-1",
    });
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      action: "start",
      clientTurnId: "client-1",
      threadId: "thread-1",
      agentId: "agent-1",
      userText: "hello",
    });
  });

  it("throws with action context on a non-ok response", async () => {
    const client = createMobileTurnLeaseClient({
      apiBase: "https://api.test",
      getToken: async () => "tok-1",
      fetchImpl: vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: "Thread turn not found" }, false, 404),
        ) as unknown as typeof fetch,
    });

    await expect(client.heartbeat({ threadTurnId: "missing" })).rejects.toThrow(
      /mobile-turn-session heartbeat 404/,
    );
  });

  it("throws when no token is available", async () => {
    const client = createMobileTurnLeaseClient({
      getToken: async () => null,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

    await expect(
      client.start({
        clientTurnId: "client-1",
        threadId: "thread-1",
        userText: "hello",
      }),
    ).rejects.toThrow(/Not authenticated/);
  });
});
