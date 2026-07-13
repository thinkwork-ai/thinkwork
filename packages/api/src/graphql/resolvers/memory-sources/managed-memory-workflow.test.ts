import { describe, expect, it } from "vitest";

import { toGraphqlManagedMemoryWorkflow } from "./managed-memory-workflow.js";

describe("toGraphqlManagedMemoryWorkflow", () => {
  it("is ready without optional external sources because Threads are baseline memory", () => {
    const result = toGraphqlManagedMemoryWorkflow({
      processor: {
        id: "processor-1",
        mode: "personal",
        target_scope: "user",
        target_id: "user-1",
        enabled: true,
        status: "active",
        budget: null,
        created_by_user_id: "user-1",
        created_at: new Date("2026-07-13T00:00:00Z"),
      },
      workflow: {
        id: "workflow-1",
        readiness_state: "ready",
      },
      sources: [],
      created: false,
    } as never);

    expect(result.readiness).toBe("ready");
    expect(result.readinessReasons).toEqual([]);
  });
});
