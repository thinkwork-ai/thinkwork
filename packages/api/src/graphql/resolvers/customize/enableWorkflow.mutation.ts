import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  and,
  db,
  eq,
  routines,
  sql,
  tenantWorkflowCatalog,
} from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import { requireTenantMember } from "../core/authz.js";
import { renderWorkspaceAfterCustomize } from "./render-workspace-after-customize.js";
import {
  PlatformAgentNotFoundError,
  resolveTenantPlatformAgent,
} from "../../../lib/agents/tenant-platform-agent.js";

export interface EnableWorkflowArgs {
  input: { agentId: string; slug: string };
}

function readScheduleFromConfig(config: unknown): string | null {
  if (typeof config !== "object" || config === null) return null;
  const candidate = (config as { schedule?: unknown }).schedule;
  return typeof candidate === "string" ? candidate : null;
}

/**
 * Enable a workflow template on the caller's tenant platform agent.
 * The compatibility row is still materialized in `routines` until the
 * Step Functions adapter is fully migrated behind first-class Workflows.
 */
export async function enableWorkflow(
  _parent: unknown,
  args: EnableWorkflowArgs,
  ctx: GraphQLContext,
) {
  const { agentId, slug } = args.input;
  const caller = await resolveCaller(ctx);
  if (!caller.userId || !caller.tenantId) {
    throw new GraphQLError("Authentication required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }

  await requireTenantMember(ctx, caller.tenantId);

  let resolvedAgentId: string;
  try {
    const agent = await resolveTenantPlatformAgent(caller.tenantId);
    if (agentId && agentId !== agent.id) {
      throw new GraphQLError(
        "agentId does not match the tenant platform agent",
        {
          extensions: { code: "CUSTOMIZE_AGENT_MISMATCH" },
        },
      );
    }
    resolvedAgentId = agent.id;
  } catch (err) {
    if (err instanceof PlatformAgentNotFoundError) {
      throw new GraphQLError(
        "Tenant has no platform agent — bootstrap your workspace first.",
        { extensions: { code: "CUSTOMIZE_PRIMARY_AGENT_NOT_FOUND" } },
      );
    }
    throw err;
  }

  const [catalog] = await db
    .select()
    .from(tenantWorkflowCatalog)
    .where(
      and(
        eq(tenantWorkflowCatalog.tenant_id, caller.tenantId),
        eq(tenantWorkflowCatalog.slug, slug),
      ),
    );
  if (!catalog) {
    throw new GraphQLError(
      `Customize catalog entry not found for workflow "${slug}"`,
      { extensions: { code: "CUSTOMIZE_CATALOG_NOT_FOUND" } },
    );
  }

  const schedule =
    catalog.default_schedule ?? readScheduleFromConfig(catalog.default_config);

  const [row] = await db
    .insert(routines)
    .values({
      tenant_id: caller.tenantId,
      agent_id: resolvedAgentId,
      name: catalog.display_name,
      description: catalog.description ?? null,
      type: "scheduled",
      status: "active",
      schedule,
      config: catalog.default_config ?? null,
      catalog_slug: catalog.slug,
    })
    .onConflictDoUpdate({
      target: [routines.agent_id, routines.catalog_slug],
      targetWhere: sql`${routines.agent_id} IS NOT NULL AND ${routines.catalog_slug} IS NOT NULL`,
      set: { status: "active", updated_at: sql`now()` },
    })
    .returning();

  if (!row) {
    throw new GraphQLError("Failed to enable workflow", {
      extensions: { code: "INTERNAL_ERROR" },
    });
  }

  await renderWorkspaceAfterCustomize("enableWorkflow", resolvedAgentId);

  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id ?? resolvedAgentId,
    catalogSlug: row.catalog_slug ?? slug,
    status: row.status,
    enabled: row.status === "active",
    updatedAt: row.updated_at,
  };
}
