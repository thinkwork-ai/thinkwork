import { describe, expect, it } from "vitest";
import { canonicalizeWorkspaceEvent } from "../lib/workspace-events/canonicalize.js";
import { parseWorkspaceEventKey } from "../lib/workspace-events/key-parser.js";

describe("canonicalizeWorkspaceEvent", () => {
  it("maps inbox writes to work.requested", () => {
    const parsed = parseWorkspaceEventKey(
      "tenants/acme/agents/marco/workspace/work/inbox/request.md",
    );
    expect(parsed).not.toBeNull();
    const event = canonicalizeWorkspaceEvent(parsed!, "key", "001");
    expect(event.eventType).toBe("work.requested");
    expect(event.idempotencyKey).toHaveLength(64);
  });

  it("maps memory writes to memory.changed", () => {
    const parsed = parseWorkspaceEventKey(
      "tenants/acme/agents/marco/workspace/memory/lessons.md",
    );
    expect(canonicalizeWorkspaceEvent(parsed!, "key", "001").eventType).toBe(
      "memory.changed",
    );
  });

  it("infers lifecycle event type from run event file names", () => {
    const parsed = parseWorkspaceEventKey(
      "tenants/acme/agents/marco/workspace/work/runs/run_123/events/blocked.json",
    );
    const event = canonicalizeWorkspaceEvent(parsed!, "key", "001");
    expect(event.eventType).toBe("run.blocked");
    expect(event.runId).toBe("run_123");
  });
});

