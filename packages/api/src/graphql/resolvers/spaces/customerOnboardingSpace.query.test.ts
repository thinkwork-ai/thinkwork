import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect, mockCanReadTenantSpaces, mockToGraphqlSpace } = vi.hoisted(
  () => ({
    mockSelect: vi.fn(),
    mockCanReadTenantSpaces: vi.fn(),
    mockToGraphqlSpace: vi.fn((row: Record<string, unknown>) => ({
      id: row.id,
      tenantId: row.tenant_id,
      slug: row.slug,
      name: row.name,
      prompt: row.prompt,
      status: String(row.status).toUpperCase(),
      kind: String(row.kind).toUpperCase(),
      templateKey: row.template_key,
    })),
  }),
);

vi.mock("../../utils.js", () => ({
  agentToCamel: (row: Record<string, unknown>) => ({
    id: row.id,
    name: row.name,
    status: String(row.status).toUpperCase(),
  }),
  and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
  db: { select: mockSelect },
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  snakeToCamel: (row: Record<string, unknown>) => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      result[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = value;
    }
    return result;
  },
  agents: { id: "agents.id" },
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
  spaceMembers: {
    tenant_id: "space_members.tenant_id",
    space_id: "space_members.space_id",
  },
  spaces: {
    tenant_id: "spaces.tenant_id",
    template_key: "spaces.template_key",
    status: "spaces.status",
  },
  users: { id: "users.id" },
}));

vi.mock("./shared.js", async () => {
  const actual =
    await vi.importActual<typeof import("./shared.js")>("./shared.js");
  return {
    ...actual,
    canReadTenantSpaces: mockCanReadTenantSpaces,
    toGraphqlSpace: mockToGraphqlSpace,
  };
});

let resolver: typeof import("./customerOnboardingSpace.query.js");
let types: typeof import("./types.js");

beforeEach(async () => {
  vi.resetModules();
  mockSelect.mockReset();
  mockCanReadTenantSpaces.mockReset();
  mockToGraphqlSpace.mockClear();
  resolver = await import("./customerOnboardingSpace.query.js");
  types = await import("./types.js");
});

describe("customerOnboardingSpace", () => {
  it("returns the active customer onboarding Space with separate Space prompt", async () => {
    mockCanReadTenantSpaces.mockResolvedValueOnce(true);
    mockSelect.mockReturnValueOnce(
      queryRows([
        {
          id: "space-1",
          tenant_id: "tenant-1",
          slug: "customer-onboarding",
          name: "Customer Onboarding",
          prompt: "Coordinate the handoff and keep blockers visible.",
          status: "active",
          kind: "customer_onboarding",
          template_key: "customer_onboarding",
        },
      ]),
    );

    const result = await resolver.customerOnboardingSpace(
      null,
      { tenantId: "tenant-1" },
      { auth: { authType: "cognito" } } as any,
    );

    expect(result).toMatchObject({
      id: "space-1",
      tenantId: "tenant-1",
      prompt: "Coordinate the handoff and keep blockers visible.",
      kind: "CUSTOMER_ONBOARDING",
      templateKey: "customer_onboarding",
    });
  });

  it("exposes coordinator assignment metadata separately from the global Agent", async () => {
    mockSelect.mockReturnValueOnce(
      queryRows([
        {
          id: "assignment-1",
          tenant_id: "tenant-1",
          space_id: "space-1",
          agent_id: "agent-1",
          local_role: "onboarding_coordinator",
          local_instructions: "Nudge humans and summarize blockers.",
          auto_subscribe: true,
          allowed_capabilities: ["task_status"],
          allowed_tools: ["lastmile.tasks"],
          status: "active",
        },
      ]),
    );

    const assignments = await types.spaceTypeResolvers.agentAssignments({
      id: "space-1",
      tenantId: "tenant-1",
    });

    expect(assignments).toEqual([
      expect.objectContaining({
        id: "assignment-1",
        agentId: "agent-1",
        localRole: "onboarding_coordinator",
        localInstructions: "Nudge humans and summarize blockers.",
        autoSubscribe: true,
        status: "ACTIVE",
      }),
    ]);
  });

  it("returns null rather than leaking the seeded Space across tenants", async () => {
    mockCanReadTenantSpaces.mockResolvedValueOnce(false);

    const result = await resolver.customerOnboardingSpace(
      null,
      { tenantId: "tenant-2" },
      { auth: { authType: "cognito" } } as any,
    );

    expect(result).toBeNull();
    expect(mockSelect).not.toHaveBeenCalled();
  });
});

function queryRows(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => Promise.resolve(rows),
  };
  return chain;
}
