import { describe, expect, it } from "vitest";
import {
  deriveAgentCoreSessionId,
  deriveAgentCoreUserSessionId,
  resolveAgentCoreSessionScope,
} from "./agentcore-session-id.js";

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

describe("deriveAgentCoreUserSessionId (THINK-909 v2)", () => {
  const userIdentity = {
    tenantId: "tenant-1",
    agentId: "agent-1",
    userId: "user-1",
  };

  it("matches the v2 preimage exactly and is 64 lowercase hex chars", async () => {
    const { createHash } = await import("node:crypto");
    const expected = createHash("sha256")
      .update("session:v2:tenant-1:agent-1:user-1")
      .digest("hex");
    const id = deriveAgentCoreUserSessionId(userIdentity);
    expect(id).toBe(expected);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id.length).toBeGreaterThanOrEqual(33);
  });

  it("is thread-independent but still per tenant, agent, and user", () => {
    const base = deriveAgentCoreUserSessionId(userIdentity);
    expect(
      deriveAgentCoreUserSessionId({ ...userIdentity, userId: "user-2" }),
    ).not.toBe(base);
    expect(
      deriveAgentCoreUserSessionId({ ...userIdentity, agentId: "agent-2" }),
    ).not.toBe(base);
    expect(
      deriveAgentCoreUserSessionId({ ...userIdentity, tenantId: "tenant-2" }),
    ).not.toBe(base);
  });

  it("v1 is unchanged and domain-separated from v2", () => {
    // Two threads of one user share the v2 id but never the v1 id.
    expect(deriveAgentCoreUserSessionId(userIdentity)).toBe(
      deriveAgentCoreUserSessionId({ ...userIdentity }),
    );
    expect(deriveAgentCoreSessionId(identity)).not.toBe(
      deriveAgentCoreUserSessionId(userIdentity),
    );
    expect(
      deriveAgentCoreSessionId({ ...identity, threadId: "thread-2" }),
    ).not.toBe(deriveAgentCoreUserSessionId(userIdentity));
    // A "v2"-shaped tenant cannot forge the other domain's preimage.
    expect(() =>
      deriveAgentCoreUserSessionId({ ...userIdentity, tenantId: "v2:x" }),
    ).toThrow(/must not contain ':'/);
  });

  it("rejects empty identity fields", () => {
    expect(() =>
      deriveAgentCoreUserSessionId({ ...userIdentity, userId: "" }),
    ).toThrow(/missing identity field userId/);
  });
});

describe("resolveAgentCoreSessionScope (THINK-909)", () => {
  it("defaults to per-thread when unset or unrecognized", () => {
    expect(resolveAgentCoreSessionScope({})).toBe("thread");
    expect(resolveAgentCoreSessionScope({ AGENTCORE_SESSION_SCOPE: "" })).toBe(
      "thread",
    );
    expect(
      resolveAgentCoreSessionScope({ AGENTCORE_SESSION_SCOPE: "wat" }),
    ).toBe("thread");
    expect(
      resolveAgentCoreSessionScope({ AGENTCORE_SESSION_SCOPE: "thread" }),
    ).toBe("thread");
  });

  it("opts in to per-user scope case-insensitively", () => {
    expect(
      resolveAgentCoreSessionScope({ AGENTCORE_SESSION_SCOPE: "user" }),
    ).toBe("user");
    expect(
      resolveAgentCoreSessionScope({ AGENTCORE_SESSION_SCOPE: " User " }),
    ).toBe("user");
  });
});
