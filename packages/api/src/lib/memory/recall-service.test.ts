import { describe, expect, it, vi } from "vitest";
import { createRecallService } from "./recall-service.js";
import type { MemoryAdapter } from "./adapter.js";

const config = {
  enabled: true,
  recall: {
    defaultLimit: 10,
    tokenBudget: 1_000,
  },
} as any;

describe("createRecallService requester scope guards", () => {
  it("rejects user recall when requester context points at another user", async () => {
    const service = createRecallService(config, adapter());

    await expect(
      service.recall({
        tenantId: "tenant-1",
        ownerType: "user",
        ownerId: "user-eric",
        query: "launch brief",
        requestContext: {
          requesterUserId: "user-amy",
        },
      }),
    ).rejects.toThrow("Requester memory scope must match recall owner");
  });

  it("rejects user recall when credential subject points at another user", async () => {
    const service = createRecallService(config, adapter());

    await expect(
      service.recall({
        tenantId: "tenant-1",
        ownerType: "user",
        ownerId: "user-eric",
        query: "launch brief",
        requestContext: {
          requesterUserId: "user-eric",
          credentialSubject: {
            type: "user",
            userId: "user-amy",
          },
        },
      }),
    ).rejects.toThrow("Credential subject user must match recall owner");
  });
});

function adapter(): MemoryAdapter {
  return {
    recall: vi.fn().mockResolvedValue([]),
    retain: vi.fn(),
    inspect: vi.fn(),
    export: vi.fn(),
  } as unknown as MemoryAdapter;
}
