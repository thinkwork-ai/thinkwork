/**
 * GraphQL resolvers for the MCP replay tool overrides (Evaluations Trust
 * Core U13 → reworked U14).
 *
 * Replay now DEFAULT-ALLOWS read-shaped MCP tools (classified by a name
 * heuristic, classifyMcpToolAccess) and blocks write-shaped tools — read
 * tools run on replay with no operator setup. This per-tenant list is the
 * OPTIONAL OVERRIDE layer (consumed by the eval-worker via
 * buildEvalAgentCorePayload): a row force-allows a write the heuristic would
 * block, or force-blocks a read the heuristic would allow. The email/web
 * side-effect kill-list stays blocked regardless.
 *
 *   - Reads scope through resolveCallerTenantId (Google-federated callers
 *     have null ctx.auth.tenantId) and fail closed (empty list).
 *   - Mutations gate with requireTenantAdmin BEFORE any write; the add
 *     mutation's gate is arg-derived (no row yet), the remove mutation's
 *     gate is row-derived (entry → tenant admin).
 */

import { GraphQLError } from "graphql";
import { classifyMcpToolAccess } from "@thinkwork/evals-core";
import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  and,
  tenantMcpServers,
  evalReplayToolAllowlist,
} from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

/** Read-path tenant scoping — mirrors resolveReadTenantId in ./index.ts. */
async function resolveReadTenantId(
  ctx: GraphQLContext,
): Promise<string | null> {
  return ctx.auth?.tenantId ?? (await resolveCallerTenantId(ctx));
}

function badInput(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

function normalizeMode(value: unknown): "allow" | "block" {
  return value === "block" ? "block" : "allow";
}

function rowToGraphql(row: Record<string, unknown>) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    serverName: row.server_name,
    toolName: row.tool_name,
    mode: normalizeMode(row.mode),
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const evalReplayToolAllowlistQuery = async (
  _p: unknown,
  args: { tenantId: string },
  ctx: GraphQLContext,
) => {
  const tenantId = await resolveReadTenantId(ctx);
  if (!tenantId || tenantId !== args.tenantId) return [];
  const rows = await db
    .select()
    .from(evalReplayToolAllowlist)
    .where(eq(evalReplayToolAllowlist.tenant_id, tenantId))
    .orderBy(
      evalReplayToolAllowlist.server_name,
      evalReplayToolAllowlist.tool_name,
    );
  return rows.map((r) => rowToGraphql(r as Record<string, unknown>));
};

/**
 * The tenant's available MCP servers + discovered tools, each annotated with
 * its heuristic access classification (read = auto-allowed on replay, write =
 * blocked) so the UI can show what runs by default and where an override is
 * needed. Sourced from the cached tenant_mcp_servers.tools list (approved +
 * enabled servers) — no live MCP connection.
 */
const evalReplayAvailableMcpToolsQuery = async (
  _p: unknown,
  args: { tenantId: string },
  ctx: GraphQLContext,
) => {
  const tenantId = await resolveReadTenantId(ctx);
  if (!tenantId || tenantId !== args.tenantId) return [];
  const rows = await db
    .select({
      slug: tenantMcpServers.slug,
      name: tenantMcpServers.name,
      tools: tenantMcpServers.tools,
    })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.tenant_id, tenantId),
        eq(tenantMcpServers.status, "approved"),
        eq(tenantMcpServers.enabled, true),
      ),
    )
    .orderBy(tenantMcpServers.slug);

  return rows.map((row) => ({
    serverName: row.slug,
    displayName: row.name,
    tools: normalizeDiscoveredTools(row.tools),
  }));
};

function normalizeDiscoveredTools(
  value: unknown,
): Array<{ name: string; description: string | null; access: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{
    name: string;
    description: string | null;
    access: string;
  }> = [];
  for (const item of value) {
    if (typeof item === "string") {
      const name = item.trim();
      if (name) {
        out.push({
          name,
          description: null,
          access: classifyMcpToolAccess(name),
        });
      }
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (!name) continue;
    out.push({
      name,
      description: typeof rec.description === "string" ? rec.description : null,
      access: classifyMcpToolAccess(name),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

const addEvalReplayToolOverride = async (
  _p: unknown,
  args: {
    tenantId: string;
    serverName: string;
    toolName: string;
    mode: string;
  },
  ctx: GraphQLContext,
) => {
  // Arg-derived gate — no row exists yet. Must precede every side effect.
  await requireTenantAdmin(ctx, args.tenantId);
  const serverName = args.serverName?.trim();
  const toolName = args.toolName?.trim();
  if (!serverName) throw badInput("serverName must be non-empty.");
  if (!toolName) throw badInput("toolName must be non-empty.");
  if (args.mode !== "allow" && args.mode !== "block") {
    throw badInput("mode must be 'allow' or 'block'.");
  }
  const mode = args.mode;

  // Upsert on the unique (tenant, server, tool) key: re-adding with a new
  // mode updates the existing row rather than erroring.
  const [existing] = await db
    .select()
    .from(evalReplayToolAllowlist)
    .where(
      and(
        eq(evalReplayToolAllowlist.tenant_id, args.tenantId),
        eq(evalReplayToolAllowlist.server_name, serverName),
        eq(evalReplayToolAllowlist.tool_name, toolName),
      ),
    );
  if (existing) {
    const row = existing as Record<string, unknown>;
    if (normalizeMode(row.mode) === mode) return rowToGraphql(row);
    const [updated] = await db
      .update(evalReplayToolAllowlist)
      .set({ mode })
      .where(eq(evalReplayToolAllowlist.id, row.id as string))
      .returning();
    return rowToGraphql(updated as Record<string, unknown>);
  }

  const [inserted] = await db
    .insert(evalReplayToolAllowlist)
    .values({
      tenant_id: args.tenantId,
      server_name: serverName,
      tool_name: toolName,
      mode,
    })
    .returning();
  return rowToGraphql(inserted as Record<string, unknown>);
};

const removeEvalReplayToolOverride = async (
  _p: unknown,
  args: { id: string },
  ctx: GraphQLContext,
) => {
  // Row-derived gate: resolve the entry's tenant, then require admin of it.
  const [existing] = await db
    .select({ tenant_id: evalReplayToolAllowlist.tenant_id })
    .from(evalReplayToolAllowlist)
    .where(eq(evalReplayToolAllowlist.id, args.id));
  if (!existing) {
    // Not found is also returned for cross-tenant ids the caller can't see
    // (the gate below would forbid them anyway).
    throw new GraphQLError("Override entry not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  await requireTenantAdmin(ctx, existing.tenant_id);

  await db
    .delete(evalReplayToolAllowlist)
    .where(eq(evalReplayToolAllowlist.id, args.id));
  return true;
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const evalReplayAllowlistQueries = {
  evalReplayToolAllowlist: evalReplayToolAllowlistQuery,
  evalReplayAvailableMcpTools: evalReplayAvailableMcpToolsQuery,
};

export const evalReplayAllowlistMutations = {
  addEvalReplayToolOverride,
  removeEvalReplayToolOverride,
};
