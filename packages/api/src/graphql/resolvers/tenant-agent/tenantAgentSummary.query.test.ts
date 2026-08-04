import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireTenantMember: vi.fn(),
  loadTenantAgentForGraphql: vi.fn(),
}));

vi.mock("../core/authz.js", () => ({
  requireTenantMember: mocks.requireTenantMember,
}));
vi.mock("./shared.js", () => ({
  loadTenantAgentForGraphql: mocks.loadTenantAgentForGraphql,
}));

// eslint-disable-next-line import/first
import { tenantAgentSummary } from "./tenantAgentSummary.query.js";

const FULL_AGENT = {
  id: "agent-1",
  tenantId: "tenant-1",
  name: "Analyst",
  slug: "analyst",
  role: "analyst",
  type: "PLATFORM",
  status: "active",
  runtime: "AGENTCORE",
  avatarUrl: null,
  // Admin-only fields that must never leak through the summary:
  systemPrompt: "secret prompt",
  adapterConfig: { key: "secret" },
  runtimeConfig: { region: "us-east-1" },
  budgetMonthlyCents: 100000,
  capabilities: [{ id: "cap-1" }],
  budgetPolicy: { id: "bp-1" },
};

beforeEach(() => {
  mocks.requireTenantMember.mockReset().mockResolvedValue("member");
  mocks.loadTenantAgentForGraphql.mockReset().mockResolvedValue(FULL_AGENT);
});

describe("tenantAgentSummary", () => {
  it("allows any tenant member and returns display fields only", async () => {
    const result = await tenantAgentSummary(
      null,
      { tenantId: "tenant-1" },
      { auth: { authType: "cognito" } } as any,
    );

    expect(mocks.requireTenantMember).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
    );
    expect(result).toEqual({
      id: "agent-1",
      tenantId: "tenant-1",
      name: "Analyst",
      slug: "analyst",
      role: "analyst",
      type: "PLATFORM",
      status: "active",
      runtime: "AGENTCORE",
      avatarUrl: null,
    });
    expect(result).not.toHaveProperty("systemPrompt");
    expect(result).not.toHaveProperty("adapterConfig");
    expect(result).not.toHaveProperty("budgetMonthlyCents");
  });

  it("propagates the membership failure for non-members", async () => {
    mocks.requireTenantMember.mockRejectedValue(new Error("Forbidden"));

    await expect(
      tenantAgentSummary(
        null,
        { tenantId: "tenant-1" },
        { auth: { authType: "cognito" } } as any,
      ),
    ).rejects.toThrow("Forbidden");
    expect(mocks.loadTenantAgentForGraphql).not.toHaveBeenCalled();
  });
});
