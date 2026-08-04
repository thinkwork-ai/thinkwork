import { describe, it, expect, vi, beforeEach } from "vitest";

const publishSpy = vi.hoisted(() =>
  vi.fn(async (_query: string, _variables: Record<string, unknown>) => true),
);
vi.mock("../lib/appsync-iam-publisher.js", () => ({
  publishAppSyncMutation: publishSpy,
}));

const { notifyThreadActivity, notifyThreadTurnStep } =
  await import("./notify.js");

function lastBody() {
  const call = publishSpy.mock.calls.at(-1)!;
  return { query: call[0], variables: call[1] };
}

describe("notifyThreadActivity", () => {
  beforeEach(() => publishSpy.mockClear());

  it("posts a notifyThreadActivity mutation carrying every payload field", async () => {
    await notifyThreadActivity({
      userId: "u1",
      tenantId: "t1",
      threadId: "th1",
      messageId: "m1",
      authorId: "a1",
      authorType: "user",
      snippet: "hello there",
      threadTitle: "General",
      createdAt: "2026-05-29T00:00:00.000Z",
      mentioned: true,
      shouldNotify: true,
    });

    expect(publishSpy).toHaveBeenCalledTimes(1);
    const { query, variables } = lastBody();
    expect(query).toContain("notifyThreadActivity");
    expect(query).toContain("$authorType: String!");
    expect(query).toContain("$mentioned: Boolean");
    expect(query).toContain("$shouldNotify: Boolean");
    expect(variables).toEqual({
      userId: "u1",
      tenantId: "t1",
      threadId: "th1",
      messageId: "m1",
      authorId: "a1",
      authorType: "user",
      snippet: "hello there",
      threadTitle: "General",
      createdAt: "2026-05-29T00:00:00.000Z",
      mentioned: true,
      shouldNotify: true,
    });
  });

  it("nulls optional fields when omitted (agent author, no snippet)", async () => {
    await notifyThreadActivity({
      userId: "u1",
      tenantId: "t1",
      threadId: "th1",
      messageId: "m1",
      authorType: "agent",
    });

    const { variables } = lastBody();
    expect(variables).toMatchObject({
      authorType: "agent",
      authorId: null,
      snippet: null,
      threadTitle: null,
      createdAt: null,
      mentioned: null,
      shouldNotify: null,
    });
  });
});

describe("notifyThreadTurnStep", () => {
  beforeEach(() => publishSpy.mockClear());

  it("posts a notifyThreadTurnStep mutation with JSON-stringified payload + int seq", async () => {
    await notifyThreadTurnStep({
      runId: "r1",
      threadId: "th1",
      tenantId: "t1",
      seq: 7,
      eventType: "tool_invocation_started",
      stream: "step",
      message: "Using browser automation",
      payload: { tool: "browser", args: { url: "https://x" } },
      createdAt: "2026-06-03T00:00:00.000Z",
    });

    expect(publishSpy).toHaveBeenCalledTimes(1);
    const { query, variables } = lastBody();
    expect(query).toContain("notifyThreadTurnStep");
    expect(query).toContain("$payload: AWSJSON");
    expect(query).toContain("$seq: Int!");
    expect(variables.seq).toBe(7);
    expect(variables.stream).toBe("step");
    // payload is serialized as an AWSJSON string, not a nested object.
    expect(typeof variables.payload).toBe("string");
    expect(JSON.parse(variables.payload as string)).toEqual({
      tool: "browser",
      args: { url: "https://x" },
    });
  });

  it("nulls optional fields and payload when omitted", async () => {
    await notifyThreadTurnStep({
      runId: "r1",
      threadId: "th1",
      tenantId: "t1",
      seq: 0,
      eventType: "phase",
      createdAt: "2026-06-03T00:00:00.000Z",
    });

    const { variables } = lastBody();
    expect(variables).toMatchObject({
      stream: null,
      level: null,
      color: null,
      message: null,
      payload: null,
    });
  });

  it("is best-effort — swallows an AppSync fetch failure", async () => {
    publishSpy.mockResolvedValueOnce(false);
    await expect(
      notifyThreadTurnStep({
        runId: "r1",
        threadId: "th1",
        tenantId: "t1",
        seq: 1,
        eventType: "tool_invocation_started",
        createdAt: "2026-06-03T00:00:00.000Z",
      }),
    ).resolves.toBeUndefined();
  });
});
