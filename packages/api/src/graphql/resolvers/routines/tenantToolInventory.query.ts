/**
 * tenantToolInventory query (Plan §U4).
 *
 * Aggregates the fragmented tool/agent/skill/routine inventory the chat
 * builder agent + the `tool_invoke` recipe consume during routine
 * composition. Origin R7: invocation recipes need a single read to expose
 * everything a tenant can call.
 *
 * Sources:
 *   - agents              (one row per non-archived agent)
 *   - tenant_mcp_servers  (each server.tools[] entry → one tool row,
 *                          source: "mcp")
 *   - tenant_builtin_tools (one row per enabled, source: "builtin")
 *   - tenant_skills       (one row per installed)
 *   - routines            (only engine='step_functions'; visibility per R21)
 *
 * Visibility (R21): agent-stamped routines (agent_id IS NOT NULL) are
 * private-by-default until promoted. The visibility column itself is a
 * future schema change; for Phase A we surface a derived `visibility`
 * field — `agent_private` when agent_id is set, `tenant` otherwise — so
 * downstream consumers can route correctly while the explicit column is
 * pending.
 */

import { and, eq, ne } from "drizzle-orm";
import {
  agents,
  routines,
  tenantBuiltinTools,
  tenantMcpServers,
  tenantSkills,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";

interface ToolInventoryAgent {
  id: string;
  name: string;
  description: string | null;
}

interface ToolInventoryTool {
  id: string;
  source: "mcp" | "builtin";
  name: string;
  description: string | null;
  argSchemaJson: unknown;
}

interface ToolInventorySkill {
  id: string;
  slug: string;
  description: string | null;
}

interface ToolInventoryRoutine {
  id: string;
  name: string;
  description: string | null;
  visibility: "tenant" | "agent_private";
}

export interface TenantToolInventoryResult {
  agents: ToolInventoryAgent[];
  tools: ToolInventoryTool[];
  skills: ToolInventorySkill[];
  routines: ToolInventoryRoutine[];
}

/** Shape of a single MCP server tools[] entry, as cached on
 * tenant_mcp_servers.tools after discovery. */
interface McpToolDescriptor {
  name?: unknown;
  description?: unknown;
  inputSchema?: unknown;
  argSchema?: unknown;
}

export async function tenantToolInventory(
  _parent: unknown,
  args: { tenantId: string },
  ctx: GraphQLContext,
): Promise<TenantToolInventoryResult> {
  // Fail closed: the caller must belong to the requested tenant. Google
  // OAuth callers get tenantId resolved via DB lookup (see resolveCaller);
  // service-to-service callers carry it on auth directly.
  const caller = await resolveCaller(ctx);
  if (!caller.tenantId || caller.tenantId !== args.tenantId) {
    return { agents: [], tools: [], skills: [], routines: [] };
  }

  const [agentRows, mcpRows, builtinRows, skillRows, routineRows] =
    await Promise.all([
      db
        .select({
          id: agents.id,
          name: agents.name,
        })
        .from(agents)
        .where(
          and(
            eq(agents.tenant_id, args.tenantId),
            ne(agents.status, "archived"),
          ),
        ),
      db
        .select({
          id: tenantMcpServers.id,
          name: tenantMcpServers.name,
          slug: tenantMcpServers.slug,
          tools: tenantMcpServers.tools,
        })
        .from(tenantMcpServers)
        .where(
          and(
            eq(tenantMcpServers.tenant_id, args.tenantId),
            eq(tenantMcpServers.enabled, true),
            // Plugin-installed MCP servers land enabled but pending; only
            // approved servers are surfaced to the chat builder so it can't
            // compose tool_invoke steps that downstream dispatch refuses.
            // Mirrors the pattern in packages/api/src/lib/mcp-configs.ts.
            eq(tenantMcpServers.status, "approved"),
          ),
        ),
      db
        .select({
          id: tenantBuiltinTools.id,
          tool_slug: tenantBuiltinTools.tool_slug,
          provider: tenantBuiltinTools.provider,
        })
        .from(tenantBuiltinTools)
        .where(
          and(
            eq(tenantBuiltinTools.tenant_id, args.tenantId),
            eq(tenantBuiltinTools.enabled, true),
          ),
        ),
      db
        .select({
          id: tenantSkills.id,
          skill_id: tenantSkills.skill_id,
        })
        .from(tenantSkills)
        .where(
          and(
            eq(tenantSkills.tenant_id, args.tenantId),
            eq(tenantSkills.enabled, true),
          ),
        ),
      // Only step_functions routines are inventory-eligible. Legacy Python
      // rows are not callable from a routine_invoke step.
      db
        .select({
          id: routines.id,
          name: routines.name,
          description: routines.description,
          agent_id: routines.agent_id,
        })
        .from(routines)
        .where(
          and(
            eq(routines.tenant_id, args.tenantId),
            eq(routines.engine, "step_functions"),
            eq(routines.status, "active"),
          ),
        ),
    ]);

  const agentInventory: ToolInventoryAgent[] = agentRows.map((r) => ({
    id: r.id,
    name: r.name,
    // agents table has no description column; surface as null until a
    // dedicated description/blurb field lands.
    description: null,
  }));

  // Flatten cached MCP server tools[] arrays. Each tool becomes one
  // inventory row keyed by `<server_id>:<tool_name>` so the chat builder
  // can address it unambiguously.
  const toolInventory: ToolInventoryTool[] = [];
  for (const server of mcpRows) {
    const list = Array.isArray(server.tools)
      ? (server.tools as McpToolDescriptor[])
      : [];
    for (const tool of list) {
      const name = typeof tool?.name === "string" ? tool.name : null;
      if (!name) continue;
      const description =
        typeof tool?.description === "string" ? tool.description : null;
      const schema = tool?.inputSchema ?? tool?.argSchema ?? null;
      toolInventory.push({
        id: `${server.id}:${name}`,
        source: "mcp",
        name: `${server.slug}.${name}`,
        description,
        argSchemaJson: schema,
      });
    }
  }
  for (const builtin of builtinRows) {
    toolInventory.push({
      id: builtin.id,
      source: "builtin",
      name: builtin.provider
        ? `${builtin.tool_slug}:${builtin.provider}`
        : builtin.tool_slug,
      description: null,
      argSchemaJson: null,
    });
  }

  const skillInventory: ToolInventorySkill[] = skillRows.map((r) => ({
    id: r.id,
    slug: r.skill_id,
    description: null,
  }));

  const routineInventory: ToolInventoryRoutine[] = routineRows
    .map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? null,
      visibility:
        r.agent_id === null
          ? ("tenant" as const)
          : ("agent_private" as const),
      agent_id: r.agent_id,
    }))
    // R21: agent-stamped routines are private until promoted. Without a
    // `visibility` column or caller-agent identity in Phase A, exclude
    // them from operator-facing inventory; they will return once the
    // visibility column lands and the caller can be reconciled with the
    // owning agent.
    .filter((r) => r.agent_id === null)
    .map(({ agent_id: _agentId, ...rest }) => rest);

  return {
    agents: agentInventory,
    tools: toolInventory,
    skills: skillInventory,
    routines: routineInventory,
  };
}

