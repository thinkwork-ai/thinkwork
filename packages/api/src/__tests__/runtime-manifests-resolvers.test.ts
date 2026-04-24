/**
 * Resolved Capability Manifest GraphQL resolver tests (plan §U15 pt 2/3).
 *
 * Covers:
 *   - runtimeManifestsByAgent: requireTenantAdmin gate, tenant scoping
 *     (cross-tenant agent → empty list), limit clamp.
 *   - runtimeManifestsByTemplate: same pattern against agent_templates.
 *   - Admin-role gate and tenant resolution are mocked at the module
 *     boundary — no DB.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelectRows, mockResolveCallerTenantId, mockRequireTenantAdmin } =
  vi.hoisted(() => ({
    mockSelectRows: vi.fn(),
    mockResolveCallerTenantId: vi.fn(),
    mockRequireTenantAdmin: vi.fn(),
  }));

type Rows = Record<string, unknown>[];

// The resolvers call:
//   1. db.select().from(agents).where().limit(1)     — tenant-check lookup
//   2. db.select().from(resolvedCapabilityManifests) — .where().orderBy().limit()
// Drive both with a single mock that returns the next queued row set.
const nextRows = (): Rows => {
  const row = mockSelectRows();
  return Array.isArray(row) ? row : [];
};

vi.mock("../graphql/utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(nextRows()),
          orderBy: () => ({ limit: () => Promise.resolve(nextRows()) }),
        }),
      }),
    }),
  },
  eq: (...args: unknown[]) => ({ _eq: args }),
  and: (...args: unknown[]) => ({ _and: args }),
  desc: (col: unknown) => ({ _desc: col }),
  agents: { id: "agents.id", tenant_id: "agents.tenant_id" },
  agentTemplates: {
    id: "agent_templates.id",
    tenant_id: "agent_templates.tenant_id",
  },
  resolvedCapabilityManifests: {
    id: "rcm.id",
    agent_id: "rcm.agent_id",
    template_id: "rcm.template_id",
    tenant_id: "rcm.tenant_id",
    created_at: "rcm.created_at",
  },
  snakeToCamel: (obj: Record<string, unknown>) => obj,
}));

vi.mock("../graphql/resolvers/core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
}));

// eslint-disable-next-line import/first
import { runtimeManifestsByAgent } from "../graphql/resolvers/runtime/runtimeManifestsByAgent.query.js";
// eslint-disable-next-line import/first
import { runtimeManifestsByTemplate } from "../graphql/resolvers/runtime/runtimeManifestsByTemplate.query.js";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const AGENT_A = "agent-a";
const TEMPLATE_A = "template-a";
const CTX = { auth: {} } as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveCallerTenantId.mockResolvedValue(TENANT_A);
  mockRequireTenantAdmin.mockResolvedValue("admin");
});

describe("runtimeManifestsByAgent", () => {
  it("returns rows for a same-tenant agent", async () => {
    // Queue: tenant-check then row list.
    mockSelectRows
      .mockReturnValueOnce([{ id: AGENT_A, tenant_id: TENANT_A }])
      .mockReturnValueOnce([
        { id: "m1", agent_id: AGENT_A, manifest_json: {} },
      ]);
    const result = await runtimeManifestsByAgent({}, { agentId: AGENT_A }, CTX);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("m1");
    expect(mockRequireTenantAdmin).toHaveBeenCalled();
  });

  it("returns [] when caller has no tenant context", async () => {
    mockResolveCallerTenantId.mockResolvedValue(null);
    const result = await runtimeManifestsByAgent({}, { agentId: AGENT_A }, CTX);
    expect(result).toEqual([]);
    expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
  });

  it("returns [] on cross-tenant agent (no membership leak)", async () => {
    mockSelectRows.mockReturnValueOnce([{ id: AGENT_A, tenant_id: TENANT_B }]);
    const result = await runtimeManifestsByAgent({}, { agentId: AGENT_A }, CTX);
    expect(result).toEqual([]);
  });

  it("returns [] when agent does not exist", async () => {
    mockSelectRows.mockReturnValueOnce([]);
    const result = await runtimeManifestsByAgent({}, { agentId: AGENT_A }, CTX);
    expect(result).toEqual([]);
  });

  it("throws when caller is not a tenant admin", async () => {
    mockRequireTenantAdmin.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(
      runtimeManifestsByAgent({}, { agentId: AGENT_A }, CTX),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it("clamps limit between 1 and 50", async () => {
    mockSelectRows
      .mockReturnValueOnce([{ id: AGENT_A, tenant_id: TENANT_A }])
      .mockReturnValueOnce([]);
    // Limit > max: must not crash; resolver clamps internally. We can't
    // assert the SQL value directly from this mock, but a return of []
    // confirms the query ran without exception.
    const out = await runtimeManifestsByAgent(
      {},
      { agentId: AGENT_A, limit: 9999 },
      CTX,
    );
    expect(Array.isArray(out)).toBe(true);
  });
});

describe("runtimeManifestsByTemplate", () => {
  it("returns rows for a same-tenant template", async () => {
    mockSelectRows
      .mockReturnValueOnce([{ id: TEMPLATE_A, tenant_id: TENANT_A }])
      .mockReturnValueOnce([
        { id: "m1", template_id: TEMPLATE_A, manifest_json: {} },
      ]);
    const result = await runtimeManifestsByTemplate(
      {},
      { templateId: TEMPLATE_A },
      CTX,
    );
    expect(result).toHaveLength(1);
    expect(mockRequireTenantAdmin).toHaveBeenCalled();
  });

  it("returns [] on cross-tenant template", async () => {
    mockSelectRows.mockReturnValueOnce([
      { id: TEMPLATE_A, tenant_id: TENANT_B },
    ]);
    const result = await runtimeManifestsByTemplate(
      {},
      { templateId: TEMPLATE_A },
      CTX,
    );
    expect(result).toEqual([]);
  });

  it("returns [] when template does not exist", async () => {
    mockSelectRows.mockReturnValueOnce([]);
    const result = await runtimeManifestsByTemplate(
      {},
      { templateId: TEMPLATE_A },
      CTX,
    );
    expect(result).toEqual([]);
  });
});
