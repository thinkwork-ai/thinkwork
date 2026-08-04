import { describe, expect, it } from "vitest";
import { deriveAgentCoreSessionId } from "./agentcore-session-id.js";

const identity = {
  tenantId: "tenant-1",
  agentId: "agent-1",
  userId: "user-1",
  threadId: "thread-1",
};

describe("deriveAgentCoreSessionId (KTD1)", () => {
  it("is deterministic: same identity → same ID across calls", () => {
    expect(deriveAgentCoreSessionId(identity)).toBe(
      deriveAgentCoreSessionId({ ...identity }),
    );
  });

  it("is 64 lowercase hex chars (≥33-char AgentCore minimum)", () => {
    const id = deriveAgentCoreSessionId(identity);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id.length).toBeGreaterThanOrEqual(33);
  });

  it("differs per thread, user, agent, and tenant", () => {
    const base = deriveAgentCoreSessionId(identity);
    expect(
      deriveAgentCoreSessionId({ ...identity, threadId: "thread-2" }),
    ).not.toBe(base);
    expect(
      deriveAgentCoreSessionId({ ...identity, userId: "user-2" }),
    ).not.toBe(base);
    expect(
      deriveAgentCoreSessionId({ ...identity, agentId: "agent-2" }),
    ).not.toBe(base);
    expect(
      deriveAgentCoreSessionId({ ...identity, tenantId: "tenant-2" }),
    ).not.toBe(base);
  });

  it("matches the KTD1 preimage exactly", async () => {
    const { createHash } = await import("node:crypto");
    const expected = createHash("sha256")
      .update("session:tenant-1:agent-1:user-1:thread-1")
      .digest("hex");
    expect(deriveAgentCoreSessionId(identity)).toBe(expected);
  });

  it("rejects empty identity fields", () => {
    expect(() =>
      deriveAgentCoreSessionId({ ...identity, threadId: "" }),
    ).toThrow(/missing identity field threadId/);
  });

  it("rejects colon-bearing fields (preimage delimiter injection)", () => {
    expect(() =>
      deriveAgentCoreSessionId({ ...identity, userId: "a:b" }),
    ).toThrow(/must not contain ':'/);
  });
});
