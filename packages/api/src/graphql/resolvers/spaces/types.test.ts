import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect, resetMocks } = vi.hoisted(() => {
  const mockSelect = vi.fn();
  return {
    mockSelect,
    resetMocks: () => mockSelect.mockReset(),
  };
});

vi.mock("../../utils.js", () => ({
  agentToCamel: (row: Record<string, unknown>) => ({
    id: row.id,
    name: row.name,
    status: row.status,
  }),
  and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
  db: { select: mockSelect },
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  inArray: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  snakeToCamel: (row: Record<string, unknown>) => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      result[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = value;
    }
    return result;
  },
  agents: { id: "agents.id" },
  knowledgeBases: { id: "knowledge_bases.id" },
  spaceAgentAssignments: {
    tenant_id: "space_agent_assignments.tenant_id",
    space_id: "space_agent_assignments.space_id",
  },
  spaceChecklistItems: {
    tenant_id: "space_checklist_items.tenant_id",
    template_id: "space_checklist_items.template_id",
  },
  spaceChecklistTemplates: {
    tenant_id: "space_checklist_templates.tenant_id",
    space_id: "space_checklist_templates.space_id",
  },
  spaceIntegrations: {
    tenant_id: "space_integrations.tenant_id",
    space_id: "space_integrations.space_id",
  },
  spaceKnowledgeBases: {
    tenant_id: "space_knowledge_bases.tenant_id",
    space_id: "space_knowledge_bases.space_id",
  },
  spaceMembers: {
    tenant_id: "space_members.tenant_id",
    space_id: "space_members.space_id",
  },
  spaceMcpServers: {
    tenant_id: "space_mcp_servers.tenant_id",
    space_id: "space_mcp_servers.space_id",
  },
  tenantMcpServers: {
    tenant_id: "tenant_mcp_servers.tenant_id",
    id: "tenant_mcp_servers.id",
  },
  users: { id: "users.id" },
}));

let types: typeof import("./types.js");

beforeEach(async () => {
  vi.resetModules();
  resetMocks();
  types = await import("./types.js");
});

describe("spaceTypeResolvers", () => {
  it("resolves Space built-in tools from tool policy without leaking non-built-ins", async () => {
    const result = await types.spaceTypeResolvers.builtInTools({
      id: "space-1",
      tenantId: "tenant-1",
      toolPolicy: {
        builtInTools: [
          "web-search",
          "not-a-builtin",
          "query_crm_opportunity_context",
        ],
      },
    });

    expect(result).toEqual(["query_crm_opportunity_context", "web-search"]);
  });

  it("resolves selected Space knowledge-base details", async () => {
    mockSelect
      .mockReturnValueOnce(
        queryRows([
          {
            id: "space-kb-1",
            tenant_id: "tenant-1",
            space_id: "space-1",
            knowledge_base_id: "kb-1",
            enabled: true,
            search_config: { limit: 4 },
          },
          {
            id: "space-kb-2",
            tenant_id: "tenant-1",
            space_id: "space-1",
            knowledge_base_id: "kb-2",
            enabled: true,
            search_config: null,
          },
        ]),
      )
      .mockReturnValueOnce(
        queryRows([
          {
            id: "kb-1",
            tenant_id: "tenant-1",
            name: "Runbooks",
            status: "active",
          },
          {
            id: "kb-2",
            tenant_id: "tenant-1",
            name: "Customer Docs",
            status: "active",
          },
        ]),
      );

    const result = await types.spaceTypeResolvers.knowledgeBases({
      id: "space-1",
      tenantId: "tenant-1",
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: "space-kb-1",
        tenantId: "tenant-1",
        spaceId: "space-1",
        knowledgeBaseId: "kb-1",
        enabled: true,
        searchConfig: { limit: 4 },
        knowledgeBase: expect.objectContaining({
          id: "kb-1",
          name: "Runbooks",
          status: "active",
        }),
      }),
      expect.objectContaining({
        id: "space-kb-2",
        knowledgeBaseId: "kb-2",
        knowledgeBase: expect.objectContaining({
          id: "kb-2",
          name: "Customer Docs",
        }),
      }),
    ]);
  });
});

function queryRows(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => Promise.resolve(rows),
  };
  return chain;
}
