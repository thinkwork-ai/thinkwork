import { describe, expect, it } from "vitest";
import { handleWorkspaceAccessRevoked } from "./workspace-revocation";

describe("handleWorkspaceAccessRevoked", () => {
  it("wipes the revoked user's Space cache partition", async () => {
    const calls: unknown[] = [];
    const cache = {
      async wipeRevokedSpace(input: unknown) {
        calls.push(input);
        return { deleted: 1 };
      },
    };

    const result = await handleWorkspaceAccessRevoked(
      {
        tenantId: "tenant-1",
        spaceId: "space-1",
        userId: "user-1",
        revokedAt: "2026-05-31T12:00:00.000Z",
      },
      { cache, stage: "prod" },
    );

    expect(result).toEqual({ deleted: 1 });
    expect(calls).toEqual([
      {
        stage: "prod",
        tenantId: "tenant-1",
        spaceId: "space-1",
        userId: "user-1",
      },
    ]);
  });
});
