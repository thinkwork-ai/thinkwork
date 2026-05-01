/**
 * tenantToolInventory resolver tests (Plan §U4).
 *
 * Mocks the graphql/utils.js module boundary so each select-chain returns
 * a queued row set. Drives every Promise.all branch in the resolver via
 * the order:
 *   agents → mcp servers → builtin tools → skills → routines.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelectRows, mockResolveCaller } = vi.hoisted(() => ({
  mockSelectRows: vi.fn(),
  mockResolveCaller: vi.fn(),
}));

type Rows = Record<string, unknown>[];

const nextRows = (): Rows => {
  const row = mockSelectRows();
  return Array.isArray(row) ? row : [];
};

vi.mock("../graphql/utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(nextRows()),
      }),
    }),
  },
}));

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCaller: mockResolveCaller,
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  agents: {
    id: "agents.id",
    name: "agents.name",
    status: "agents.status",
    tenant_id: "agents.tenant_id",
  },
  routines: {
    id: "routines.id",
    name: "routines.name",
    description: "routines.description",
    agent_id: "routines.agent_id",
    tenant_id: "routines.tenant_id",
    engine: "routines.engine",
    status: "routines.status",
  },
  tenantBuiltinTools: {
    id: "tenant_builtin_tools.id",
    tool_slug: "tenant_builtin_tools.tool_slug",
    provider: "tenant_builtin_tools.provider",
    tenant_id: "tenant_builtin_tools.tenant_id",
    enabled: "tenant_builtin_tools.enabled",
  },
  tenantMcpServers: {
    id: "tenant_mcp_servers.id",
    name: "tenant_mcp_servers.name",
    slug: "tenant_mcp_servers.slug",
    tools: "tenant_mcp_servers.tools",
    tenant_id: "tenant_mcp_servers.tenant_id",
    enabled: "tenant_mcp_servers.enabled",
  },
  tenantSkills: {
    id: "tenant_skills.id",
    skill_id: "tenant_skills.skill_id",
    tenant_id: "tenant_skills.tenant_id",
    enabled: "tenant_skills.enabled",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (...a: unknown[]) => ({ _eq: a }),
  and: (...a: unknown[]) => ({ _and: a }),
  ne: (...a: unknown[]) => ({ _ne: a }),
}));

import { tenantToolInventory } from "../graphql/resolvers/routines/tenantToolInventory.query.js";

const ctx = { auth: {} } as unknown as Parameters<typeof tenantToolInventory>[2];

beforeEach(() => {
  mockSelectRows.mockReset();
  mockResolveCaller.mockReset();
});

function queueResultsInOrder(...sets: Rows[]) {
  for (const set of sets) mockSelectRows.mockReturnValueOnce(set);
}

describe("tenantToolInventory", () => {
  it("returns empty result when caller's tenant differs from requested tenant", async () => {
    mockResolveCaller.mockResolvedValue({
      userId: "u1",
      tenantId: "other-tenant",
    });
    const out = await tenantToolInventory(
      null,
      { tenantId: "tenant-a" },
      ctx,
    );
    expect(out).toEqual({
      agents: [],
      tools: [],
      skills: [],
      routines: [],
    });
    // Should never have queried the DB.
    expect(mockSelectRows).not.toHaveBeenCalled();
  });

  it("returns empty arrays for a tenant with no agents/tools/skills/routines", async () => {
    mockResolveCaller.mockResolvedValue({
      userId: "u1",
      tenantId: "tenant-a",
    });
    queueResultsInOrder([], [], [], [], []);
    const out = await tenantToolInventory(
      null,
      { tenantId: "tenant-a" },
      ctx,
    );
    expect(out.agents).toEqual([]);
    expect(out.tools).toEqual([]);
    expect(out.skills).toEqual([]);
    expect(out.routines).toEqual([]);
  });

  it("flattens cached MCP server tools[] into individual tool rows and combines builtins", async () => {
    mockResolveCaller.mockResolvedValue({
      userId: "u1",
      tenantId: "tenant-a",
    });
    queueResultsInOrder(
      [{ id: "agent-1", name: "Researcher" }],
      [
        {
          id: "mcp-1",
          name: "Slack MCP",
          slug: "slack",
          tools: [
            {
              name: "search_messages",
              description: "search a channel",
              inputSchema: { type: "object" },
            },
            { name: "post_message" },
          ],
        },
      ],
      [{ id: "builtin-1", tool_slug: "web_search", provider: "exa" }],
      [{ id: "skill-1", skill_id: "deep-research" }],
      [],
    );
    const out = await tenantToolInventory(
      null,
      { tenantId: "tenant-a" },
      ctx,
    );

    expect(out.agents).toEqual([
      { id: "agent-1", name: "Researcher", description: null },
    ]);
    expect(out.tools).toHaveLength(3);
    expect(out.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "mcp-1:search_messages",
          source: "mcp",
          name: "slack.search_messages",
          description: "search a channel",
          argSchemaJson: { type: "object" },
        }),
        expect.objectContaining({
          id: "mcp-1:post_message",
          source: "mcp",
          name: "slack.post_message",
        }),
        expect.objectContaining({
          id: "builtin-1",
          source: "builtin",
          name: "web_search:exa",
        }),
      ]),
    );
    expect(out.skills).toEqual([
      { id: "skill-1", slug: "deep-research", description: null },
    ]);
  });

  it("excludes agent-stamped routines (R21 visibility) and surfaces tenant-scoped step_functions routines", async () => {
    mockResolveCaller.mockResolvedValue({
      userId: "u1",
      tenantId: "tenant-a",
    });
    queueResultsInOrder(
      [],
      [],
      [],
      [],
      [
        {
          id: "routine-tenant",
          name: "Nightly digest",
          description: "Sends a digest each night",
          agent_id: null,
        },
        {
          id: "routine-agent-private",
          name: "Triage email",
          description: null,
          agent_id: "agent-1",
        },
      ],
    );
    const out = await tenantToolInventory(
      null,
      { tenantId: "tenant-a" },
      ctx,
    );
    expect(out.routines).toEqual([
      {
        id: "routine-tenant",
        name: "Nightly digest",
        description: "Sends a digest each night",
        visibility: "tenant",
      },
    ]);
  });
});
