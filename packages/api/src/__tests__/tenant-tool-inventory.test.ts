/**
 * tenantToolInventory resolver tests (Plan §U4).
 *
 * Mocks the graphql/utils.js module boundary so each select-chain returns
 * a queued row set. Drives every Promise.all branch in the resolver via
 * the order:
 *   agents → mcp servers → builtin tools → skills → routines → workflows.
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
        innerJoin: () => ({
          where: () => Promise.resolve(nextRows()),
        }),
        where: () => Promise.resolve(nextRows()),
      }),
    }),
  },
}));

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCaller: mockResolveCaller,
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  agentSkills: {
    agent_id: "agent_skills.agent_id",
    skill_id: "agent_skills.skill_id",
    enabled: "agent_skills.enabled",
  },
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
    status: "tenant_mcp_servers.status",
  },
  workflows: {
    id: "workflows.id",
    name: "workflows.name",
    description: "workflows.description",
    visibility: "workflows.visibility",
    owner_agent_id: "workflows.owner_agent_id",
    primary_trigger_family: "workflows.primary_trigger_family",
    readiness_state: "workflows.readiness_state",
    readiness_reasons: "workflows.readiness_reasons",
    capability_flags: "workflows.capability_flags",
    tenant_id: "workflows.tenant_id",
    lifecycle_status: "workflows.lifecycle_status",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (...a: unknown[]) => ({ _eq: a }),
  and: (...a: unknown[]) => ({ _and: a }),
  ne: (...a: unknown[]) => ({ _ne: a }),
}));

import { tenantToolInventory } from "../graphql/resolvers/routines/tenantToolInventory.query.js";

const ctx = { auth: {} } as unknown as Parameters<
  typeof tenantToolInventory
>[2];

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
    const out = await tenantToolInventory(null, { tenantId: "tenant-a" }, ctx);
    expect(out).toEqual({
      agents: [],
      tools: [],
      skills: [],
      routines: [],
      workflows: [],
    });
    // Should never have queried the DB.
    expect(mockSelectRows).not.toHaveBeenCalled();
  });

  it("returns empty arrays for a tenant with no agents/tools/skills/routines", async () => {
    mockResolveCaller.mockResolvedValue({
      userId: "u1",
      tenantId: "tenant-a",
    });
    queueResultsInOrder([], [], [], [], [], []);
    const out = await tenantToolInventory(null, { tenantId: "tenant-a" }, ctx);
    expect(out.agents).toEqual([]);
    expect(out.tools).toEqual([]);
    expect(out.skills).toEqual([]);
    expect(out.routines).toEqual([]);
    expect(out.workflows).toEqual([]);
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
      [
        { skill_id: "deep-research" },
        { skill_id: "deep-research" },
        { skill_id: "finance-audit-xls" },
      ],
      [],
      [],
    );
    const out = await tenantToolInventory(null, { tenantId: "tenant-a" }, ctx);

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
      { id: "deep-research", slug: "deep-research", description: null },
      {
        id: "finance-audit-xls",
        slug: "finance-audit-xls",
        description: null,
      },
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
      [],
    );
    const out = await tenantToolInventory(null, { tenantId: "tenant-a" }, ctx);
    expect(out.routines).toEqual([
      {
        id: "routine-tenant",
        name: "Nightly digest",
        description: "Sends a digest each night",
        visibility: "tenant",
      },
    ]);
  });

  it("surfaces tenant-shared workflows and agent-private workflows for the caller agent", async () => {
    mockResolveCaller.mockResolvedValue({
      userId: "u1",
      tenantId: "tenant-a",
    });
    const agentCtx = {
      auth: { agentId: "agent-1" },
    } as unknown as Parameters<typeof tenantToolInventory>[2];
    queueResultsInOrder(
      [],
      [],
      [],
      [],
      [],
      [
        {
          id: "workflow-tenant",
          name: "Nightly workflow",
          description: "Runs every night",
          visibility: "tenant_shared",
          owner_agent_id: null,
          primary_trigger_family: "schedule",
          readiness_state: "ready",
          readiness_reasons: [],
          capability_flags: { start: true, monitor: true },
        },
        {
          id: "workflow-private",
          name: "Private workflow",
          description: null,
          visibility: "agent_private",
          owner_agent_id: "agent-1",
          primary_trigger_family: "agent",
          readiness_state: "blocked_not_ready",
          readiness_reasons: [{ code: "missing_oauth" }],
          capability_flags: { start: true },
        },
        {
          id: "workflow-other-agent",
          name: "Other agent workflow",
          description: null,
          visibility: "agent_private",
          owner_agent_id: "agent-2",
          primary_trigger_family: "agent",
          readiness_state: "ready",
          readiness_reasons: [],
          capability_flags: { start: true },
        },
      ],
    );

    const out = await tenantToolInventory(
      null,
      { tenantId: "tenant-a" },
      agentCtx,
    );

    expect(out.workflows).toEqual([
      {
        id: "workflow-tenant",
        name: "Nightly workflow",
        description: "Runs every night",
        visibility: "tenant",
        triggerFamily: "schedule",
        readinessState: "ready",
        readinessReasons: [],
        capabilityFlags: { start: true, monitor: true },
        startCallable: true,
      },
      {
        id: "workflow-private",
        name: "Private workflow",
        description: null,
        visibility: "agent_private",
        triggerFamily: "agent",
        readinessState: "blocked_not_ready",
        readinessReasons: [{ code: "missing_oauth" }],
        capabilityFlags: { start: true },
        startCallable: false,
      },
    ]);
  });
});
