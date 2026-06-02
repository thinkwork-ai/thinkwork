import { describe, expect, it } from "vitest";

import { handler } from "./managed-delegation.js";

const PARENT_TURN_ID = "66666666-6666-6666-6666-666666666666";

function event(
  overrides: Record<string, unknown> = {},
): Parameters<typeof handler>[0] {
  return {
    requestContext: {
      http: {
        method:
          typeof overrides.method === "string" ? overrides.method : "POST",
        path: "/api/desktop/managed-delegation",
      },
    },
    headers:
      overrides.headers === undefined
        ? { authorization: "Bearer dps_secret" }
        : (overrides.headers as Record<string, string>),
    body:
      overrides.body === undefined
        ? JSON.stringify({
            parentThreadTurnId: PARENT_TURN_ID,
            task: "Run hosted work",
            visibility: "hidden",
          })
        : (overrides.body as string),
  } as unknown as Parameters<typeof handler>[0];
}

describe("managed-delegation handler", () => {
  it("tombstones desktop-local managed delegation", async () => {
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
    const res = await handler(
      event({
        body: "{ nope",
      }),
    );
    expect(res.statusCode).toBe(410);
  });

  it("keeps method gating for non-POST calls", async () => {
    const res = await handler(event({ method: "GET" }));
    expect(res.statusCode).toBe(405);
  });
});
