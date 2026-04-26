import { describe, expect, it } from "vitest";
import { parseWorkspaceEventKey } from "../lib/workspace-events/key-parser.js";

describe("parseWorkspaceEventKey", () => {
  it("parses root inbox writes", () => {
    expect(
      parseWorkspaceEventKey(
        "tenants/acme/agents/marco/workspace/work/inbox/request.md",
      ),
    ).toMatchObject({
      tenantSlug: "acme",
      agentSlug: "marco",
      targetPath: "",
      eventfulKind: "work_inbox",
      fileName: "request.md",
    });
  });

  it("parses nested sub-agent inbox writes", () => {
    expect(
      parseWorkspaceEventKey(
        "tenants/acme/agents/marco/workspace/support/escalation/work/inbox/request.md",
      ),
    ).toMatchObject({
      targetPath: "support/escalation",
      eventfulKind: "work_inbox",
    });
  });

  it("parses run lifecycle event writes", () => {
    expect(
      parseWorkspaceEventKey(
        "tenants/acme/agents/marco/workspace/work/runs/run_123/events/completed.json",
      ),
    ).toMatchObject({
      eventfulKind: "run_event",
      runId: "run_123",
      fileName: "completed.json",
    });
  });

  it("drops non-eventful workspace paths", () => {
    expect(
      parseWorkspaceEventKey("tenants/acme/agents/marco/workspace/IDENTITY.md"),
    ).toBeNull();
  });
});

