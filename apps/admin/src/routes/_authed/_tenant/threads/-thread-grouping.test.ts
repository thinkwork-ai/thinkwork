import { describe, expect, it } from "vitest";
import {
  threadAssigneeGroupKey,
  threadAssigneeGroupLabel,
} from "./-thread-grouping";

describe("threadAssigneeGroupKey", () => {
  it("groups Computer-owned threads under __computer", () => {
    expect(
      threadAssigneeGroupKey({ computerId: "comp-1", agentId: null }),
    ).toBe("__computer");
  });

  it("groups Agent-assigned threads under their agentId", () => {
    expect(
      threadAssigneeGroupKey({ computerId: null, agentId: "agent-42" }),
    ).toBe("agent-42");
  });

  it("groups unowned threads under __unassigned", () => {
    expect(
      threadAssigneeGroupKey({ computerId: null, agentId: null }),
    ).toBe("__unassigned");
  });

  it("prefers Computer ownership when both fields are set", () => {
    expect(
      threadAssigneeGroupKey({ computerId: "comp-1", agentId: "agent-42" }),
    ).toBe("__computer");
  });

  it("treats an empty-string agentId as unassigned (defensive normalization)", () => {
    expect(
      threadAssigneeGroupKey({ computerId: null, agentId: "" }),
    ).toBe("__unassigned");
  });

  it("treats an empty-string computerId as unassigned (defensive normalization)", () => {
    expect(
      threadAssigneeGroupKey({ computerId: "", agentId: null }),
    ).toBe("__unassigned");
  });

  it("falls through empty-string computerId to a real agentId", () => {
    expect(
      threadAssigneeGroupKey({ computerId: "", agentId: "agent-42" }),
    ).toBe("agent-42");
  });
});

describe("threadAssigneeGroupLabel", () => {
  const resolveAgentName = (id: string) =>
    id === "agent-42" ? "Marco" : null;

  it("renders 'Computer' for the Computer bucket", () => {
    expect(threadAssigneeGroupLabel("__computer", resolveAgentName)).toBe("Computer");
  });

  it("renders 'Unassigned' for the unassigned bucket", () => {
    expect(threadAssigneeGroupLabel("__unassigned", resolveAgentName)).toBe("Unassigned");
  });

  it("resolves an agent name when one is known", () => {
    expect(threadAssigneeGroupLabel("agent-42", resolveAgentName)).toBe("Marco");
  });

  it("falls back to a short id when the agent name is unknown", () => {
    expect(threadAssigneeGroupLabel("agentXYZ12345", resolveAgentName)).toBe("agentXYZ");
  });
});
