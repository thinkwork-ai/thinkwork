import { describe, expect, it } from "vitest";
import { handler } from "./desktop-eval-runs.js";

function event(
  path: string,
  overrides: {
    body?: unknown;
    headers?: Record<string, string>;
    method?: string;
    pathParameters?: Record<string, string>;
  } = {},
): Parameters<typeof handler>[0] {
  return {
    rawPath: path,
    requestContext: {
      domainName: "api.example.com",
      http: {
        method: overrides.method ?? "POST",
        path,
      },
    },
    pathParameters: overrides.pathParameters ?? {},
    headers: overrides.headers ?? { authorization: "Bearer id-token" },
    body:
      typeof overrides.body === "string"
        ? overrides.body
        : JSON.stringify(overrides.body ?? {}),
  } as unknown as Parameters<typeof handler>[0];
}

describe("desktop eval runs handler", () => {
  it("tombstones desktop-local eval run start", async () => {
    const res = await handler(event("/api/desktop/eval-runs"));
    expect(res.statusCode).toBe(410);
    expect(JSON.parse(res.body as string)).toEqual(
      expect.objectContaining({
        ok: false,
        code: "DESKTOP_LOCAL_EXECUTION_RETIRED",
      }),
    );
  });

  it("tombstones desktop-local eval session preparation", async () => {
    const res = await handler(
      event("/api/desktop/eval-runs/run-1/sessions", {
        pathParameters: { runId: "run-1" },
      }),
    );
    expect(res.statusCode).toBe(410);
  });

  it("tombstones desktop-local eval result callbacks", async () => {
    const res = await handler(
      event("/api/desktop/eval-runs/run-1/results", {
        pathParameters: { runId: "run-1" },
      }),
    );
    expect(res.statusCode).toBe(410);
  });

  it("does not parse request bodies before returning the tombstone", async () => {
    const res = await handler(
      event("/api/desktop/eval-runs", {
        body: "{ nope",
      }),
    );
    expect(res.statusCode).toBe(410);
  });

  it("keeps method gating for non-POST calls", async () => {
    const res = await handler(
      event("/api/desktop/eval-runs", {
        method: "GET",
      }),
    );
    expect(res.statusCode).toBe(405);
  });
});
