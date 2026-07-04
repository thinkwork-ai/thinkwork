import { describe, expect, it } from "vitest";

import {
  ApiCanvasProviderError,
  createApiCanvasProvider,
} from "../src/runtime/providers/canvas-provider.js";

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: { query: string; variables: Record<string, unknown> };
}

function fakeFetch(responseData: unknown, captured: Captured[]) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    captured.push({
      url: input.toString(),
      headers,
      body: JSON.parse(String(init?.body)),
    });
    return new Response(JSON.stringify({ data: responseData }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

const baseOptions = {
  apiUrl: "https://api.example.com",
  apiSecret: "svc-secret",
  tenantId: "tenant-1",
  threadId: "thread-1",
  actingUserId: "user-acting",
};

describe("createApiCanvasProvider (KTD8 identity header)", () => {
  it("throws when constructed without the acting user id", () => {
    expect(() =>
      createApiCanvasProvider({ ...baseOptions, actingUserId: "" }),
    ).toThrow(ApiCanvasProviderError);
  });

  it("sends x-principal-id + x-tenant-id + bearer on the context query", async () => {
    const captured: Captured[] = [];
    const provider = createApiCanvasProvider({
      ...baseOptions,
      fetchImpl: fakeFetch(
        {
          threadCanvasContext: {
            spaceId: "space-1",
            spaceName: "Growth",
            currentCanvas: null,
            savedCanvases: [
              {
                artifactId: "art-1",
                title: "Cost Dashboard",
                updatedAt: null,
                headVersion: 1,
                status: "final",
              },
            ],
            writableSpaces: [{ spaceId: "space-1", name: "Growth" }],
          },
        },
        captured,
      ),
    });

    const context = await provider.context();
    expect(context.savedCanvases).toHaveLength(1);
    expect(context.savedCanvases[0]!.artifactId).toBe("art-1");

    expect(captured).toHaveLength(1);
    const req = captured[0]!;
    expect(req.url).toBe("https://api.example.com/graphql");
    expect(req.headers["x-principal-id"]).toBe("user-acting");
    expect(req.headers["x-tenant-id"]).toBe("tenant-1");
    expect(req.headers["authorization"]).toBe("Bearer svc-secret");
    expect(req.body.variables).toEqual({ threadId: "thread-1" });
  });

  it("passes the closed-over thread id to checkout (agent cannot target another thread)", async () => {
    const captured: Captured[] = [];
    const provider = createApiCanvasProvider({
      ...baseOptions,
      fetchImpl: fakeFetch(
        { checkoutCanvas: { id: "art-1", title: "Cost Dashboard" } },
        captured,
      ),
    });
    const result = await provider.checkout("art-1");
    expect(result.artifactId).toBe("art-1");
    expect(captured[0]!.body.variables).toEqual({
      artifactId: "art-1",
      threadId: "thread-1",
    });
  });

  it("surfaces GraphQL errors as ApiCanvasProviderError", async () => {
    const captured: Captured[] = [];
    const errFetch = (async () =>
      new Response(JSON.stringify({ errors: [{ message: "FORBIDDEN" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const provider = createApiCanvasProvider({
      ...baseOptions,
      fetchImpl: errFetch,
    });
    await expect(provider.context()).rejects.toThrow(/FORBIDDEN/);
    expect(captured).toHaveLength(0);
  });

  it("maps refresh binding outcomes through", async () => {
    const provider = createApiCanvasProvider({
      ...baseOptions,
      fetchImpl: fakeFetch(
        {
          refreshCanvasData: {
            artifactId: "art-1",
            dispatched: true,
            errorMessage: null,
            bindings: [
              {
                bindingId: "b1",
                partId: "p1",
                elementId: "e1",
                outcome: "NEEDS_USER",
                quality: "STALE",
                reason: "refresh needs you",
              },
            ],
          },
        },
        [],
      ),
    });
    const result = await provider.refresh("art-1");
    expect(result.dispatched).toBe(true);
    expect(result.bindings[0]!.reason).toBe("refresh needs you");
  });
});
