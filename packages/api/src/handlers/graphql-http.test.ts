import { describe, it, expect, vi, beforeEach } from "vitest";

const yogaFetch = vi.fn();
vi.mock("../graphql/server.js", () => ({
  yoga: { fetch: (...args: unknown[]) => yogaFetch(...args) },
}));

import {
  handler,
  MAX_RESPONSE_BYTES,
  escapedBodyBytes,
} from "./graphql-http.js";

function makeEvent(body: string) {
  return {
    requestContext: { http: { method: "POST" } },
    headers: { "content-type": "application/json" },
    body,
  } as unknown as Parameters<typeof handler>[0];
}

const requestBody = JSON.stringify({
  operationName: "ComputerThread",
  query: "query ComputerThread { thread { id } }",
});

describe("graphql-http handler response size guard", () => {
  beforeEach(() => {
    yogaFetch.mockReset();
  });

  it("passes normal responses through unchanged", async () => {
    const payload = JSON.stringify({ data: { thread: { id: "t1" } } });
    yogaFetch.mockResolvedValue(
      new Response(payload, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await handler(makeEvent(requestBody));
    expect(result.statusCode).toBe(200);
    expect(result.body).toBe(payload);
  });

  it("stays under Lambda's hard response limit", () => {
    expect(MAX_RESPONSE_BYTES).toBeLessThan(6_291_556);
  });

  it("guards on JSON-escaped size: quote-dense body under the raw cap still triggers", async () => {
    // Lambda's limit applies to the serialized {statusCode, headers, body}
    // envelope, where every quote in the body costs an escape byte. A body
    // whose RAW size is under MAX_RESPONSE_BYTES but whose escaped size is
    // over must still be intercepted, or the invocation dies anyway.
    const denseCell = '{"k":"v"},'; // escapes to 14 chars, re-escapes to 22
    const huge = JSON.stringify({
      data: {
        blob: denseCell.repeat(Math.floor((MAX_RESPONSE_BYTES - 50_000) / 14)),
      },
    });
    expect(Buffer.byteLength(huge, "utf8")).toBeLessThan(MAX_RESPONSE_BYTES);
    expect(escapedBodyBytes(huge)).toBeGreaterThan(MAX_RESPONSE_BYTES);
    yogaFetch.mockResolvedValue(
      new Response(huge, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await handler(makeEvent(requestBody));
    const parsed = JSON.parse(result.body!) as {
      errors: { extensions: { code: string } }[];
    };
    expect(parsed.errors[0].extensions.code).toBe("RESPONSE_TOO_LARGE");
  });

  it("replaces an oversized body with a GraphQL error envelope", async () => {
    const huge = JSON.stringify({
      data: { thread: { blob: "x".repeat(MAX_RESPONSE_BYTES + 1024) } },
    });
    yogaFetch.mockResolvedValue(
      new Response(huge, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(huge.length),
        },
      }),
    );
    const result = await handler(makeEvent(requestBody));
    expect(result.statusCode).toBe(200);
    expect(Buffer.byteLength(result.body!, "utf8")).toBeLessThan(
      MAX_RESPONSE_BYTES,
    );
    const parsed = JSON.parse(result.body!) as {
      errors: { message: string; extensions: { code: string } }[];
      data?: unknown;
    };
    expect(parsed.errors[0].extensions.code).toBe("RESPONSE_TOO_LARGE");
    expect(parsed.errors[0].message).toContain("ComputerThread");
    // Stale content-length from the original response must not survive.
    expect(result.headers?.["content-length"]).toBeUndefined();
  });
});
