import { describe, expect, it } from "vitest";

import { handler } from "./desktop-runtime-session.js";

const AGENT_ID = "33333333-3333-3333-3333-333333333333";
const THREAD_ID = "44444444-4444-4444-4444-444444444444";

function event(
  overrides: Record<string, unknown> = {},
): Parameters<typeof handler>[0] {
  return {
    requestContext: {
      http: {
        method:
          typeof overrides.method === "string" ? overrides.method : "POST",
        path: "/api/desktop/runtime-session",
      },
    },
    headers: { authorization: "Bearer token" },
    body:
      overrides.body === undefined
        ? JSON.stringify({
            agentId: AGENT_ID,
            threadId: THREAD_ID,
            userMessage: "Help",
          })
        : (overrides.body as string),
  } as unknown as Parameters<typeof handler>[0];
}

describe("desktop-runtime-session handler", () => {
  it("tombstones desktop-local runtime preparation", async () => {
    const res = await handler(event());
    expect(res.statusCode).toBe(410);
    const body = JSON.parse(res.body as string);
    expect(body).toEqual(
      expect.objectContaining({
        ok: false,
        code: "DESKTOP_LOCAL_EXECUTION_RETIRED",
      }),
    );
  });

  it("does not parse request bodies before returning the tombstone", async () => {
    const res = await handler(event({ body: "{ nope" }));
    expect(res.statusCode).toBe(410);
  });

  it("keeps method gating for non-POST calls", async () => {
    const res = await handler(event({ method: "GET" }));
    expect(res.statusCode).toBe(405);
  });
});
