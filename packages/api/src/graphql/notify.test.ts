import { describe, it, expect, vi, beforeEach } from "vitest";

// notify.ts reads these at module load; set before the dynamic import below.
process.env.APPSYNC_ENDPOINT = "https://appsync.test/graphql";
process.env.APPSYNC_API_KEY = "test-key";

const fetchSpy = vi.fn(
  async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }),
);
vi.stubGlobal("fetch", fetchSpy);

const { notifyThreadActivity } = await import("./notify.js");

function lastBody() {
  const call = fetchSpy.mock.calls.at(-1)!;
  const init = call[1]!;
  return JSON.parse(init.body as string) as {
    query: string;
    variables: Record<string, unknown>;
  };
}

describe("notifyThreadActivity", () => {
  beforeEach(() => fetchSpy.mockClear());

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
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const { query, variables } = lastBody();
    expect(query).toContain("notifyThreadActivity");
    expect(query).toContain("$authorType: String!");
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
    });
  });
});
