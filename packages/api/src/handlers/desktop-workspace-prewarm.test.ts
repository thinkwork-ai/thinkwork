import { describe, expect, it } from "vitest";

import { handler } from "./desktop-workspace-prewarm.js";

const AGENT_ID = "33333333-3333-3333-3333-333333333333";
const SPACE_ID = "55555555-5555-5555-5555-555555555555";

function event(
  overrides: Record<string, unknown> = {},
): Parameters<typeof handler>[0] {
  return {
    requestContext: {
      http: {
        method:
          typeof overrides.method === "string" ? overrides.method : "POST",
        path: "/api/desktop/workspace-prewarm",
      },
    },
    headers: { authorization: "Bearer token" },
    body:
      overrides.body === undefined
        ? JSON.stringify({
            agentId: AGENT_ID,
            spaceId: SPACE_ID,
          })
        : (overrides.body as string),
  } as unknown as Parameters<typeof handler>[0];
}

describe("desktop-workspace-prewarm handler", () => {
  it("tombstones desktop-local workspace prewarm", async () => {
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
