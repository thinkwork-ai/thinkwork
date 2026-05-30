import { describe, expect, it, vi } from "vitest";
import { recordTurn } from "./persist-turn";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe("recordTurn", () => {
  it("POSTs the turn to the record-turn endpoint with the bearer token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        threadId: "thr_1",
        userMessageId: "um",
        assistantMessageId: "am",
      }),
    );
    const res = await recordTurn(
      {
        threadId: "thr_1",
        userText: "hi",
        assistantText: "hello",
        toolResults: [
          {
            type: "mobile_session",
            stopReason: "completed",
            transcript: [],
            events: [],
          },
        ],
        usage: { inputTokens: 3, outputTokens: 2 },
      },
      {
        apiBase: "https://api.test",
        getToken: async () => "tok-1",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );

    expect(res).toEqual({
      threadId: "thr_1",
      userMessageId: "um",
      assistantMessageId: "am",
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.test/api/threads/record-turn");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok-1",
    });
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.threadId).toBe("thr_1");
    expect(sent.assistantText).toBe("hello");
    expect(sent.toolResults[0]).toMatchObject({
      type: "mobile_session",
      stopReason: "completed",
    });
  });

  it("throws on a non-ok response", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: "Thread not found" }, false, 404),
      );
    await expect(
      recordTurn(
        { threadId: "x", userText: "a", assistantText: "b" },
        {
          apiBase: "https://api.test",
          getToken: async () => "tok-1",
          fetchImpl: fetchImpl as unknown as typeof fetch,
        },
      ),
    ).rejects.toThrow(/record-turn 404/);
  });

  it("throws when no token is available", async () => {
    await expect(
      recordTurn(
        { threadId: "x", userText: "a", assistantText: "b" },
        {
          getToken: async () => null,
          fetchImpl: vi.fn() as unknown as typeof fetch,
        },
      ),
    ).rejects.toThrow(/Not authenticated/);
  });
});
