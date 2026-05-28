import { describe, expect, it, vi } from "vitest";
import { createManagedDelegationClient } from "../../src/sidecar/managed-delegation-client";

describe("createManagedDelegationClient", () => {
  it("posts sidecar-authenticated delegation requests", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(_url).toBe("https://api.test/api/desktop/managed-delegation");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer dps_secret",
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        parentThreadTurnId: "turn-1",
        task: "Run hosted work",
        visibility: "hidden",
      });
      return new Response(
        JSON.stringify({
          ok: true,
          delegationId: "delegation-1",
          parentThreadTurnId: "turn-1",
          childThreadTurnId: "turn-2",
          requestedVisibility: "hidden",
          effectiveVisibility: "hidden",
          status: "accepted",
        }),
        { status: 200 },
      );
    });

    const client = createManagedDelegationClient({
      apiUrl: "https://api.test",
      parentThreadTurnId: "turn-1",
      finalizeCallbackSecret: "dps_secret",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(
      client.delegate({ task: "Run hosted work", visibility: "hidden" }),
    ).resolves.toMatchObject({
      ok: true,
      childThreadTurnId: "turn-2",
      status: "accepted",
    });
  });
});
