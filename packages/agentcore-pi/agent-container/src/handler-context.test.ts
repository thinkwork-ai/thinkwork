import { describe, expect, it } from "vitest";

import { snapshotIdentity } from "./handler-context.js";

describe("snapshotIdentity", () => {
  it("captures the Space id from turn_context for memory-scoped agent turns", () => {
    const identity = snapshotIdentity({
      tenant_id: "tenant-1",
      user_id: "user-1",
      assistant_id: "agent-1",
      thread_id: "thread-1",
      turn_context: {
        spaceId: "space-1",
        spaceSlug: "engineering",
      },
    });

    expect(identity).toMatchObject({
      tenantId: "tenant-1",
      userId: "user-1",
      agentId: "agent-1",
      threadId: "thread-1",
      spaceId: "space-1",
    });
  });
});
