import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  and,
  computers,
  db,
  eq,
  ne,
  routines,
  sql,
  tenantWorkflowCatalog,
} from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import { requireTenantMember } from "../core/authz.js";

export interface EnableWorkflowArgs {
  input: { computerId: string; slug: string };
}

interface CatalogConfig {
  schedule?: unknown;
}

/**
 * Enable a workflow for the caller's Computer. Looks up the catalog row
 * by `(tenant_id, slug)` in `tenant_workflow_catalog`, resolves the
 * Computer's primary agent, and upserts a `routines` row keyed by the
 * partial unique index `uq_routines_catalog_slug_per_agent (agent_id,
 * catalog_slug)`.
 *
 * Idempotent — re-enabling an already-active workflow flips status back
 * to 'active' on the existing row (no duplicate insert). Re-enabling
 * after disable revives the same row, preserving last_run_at /
 * next_run_at / any associated trigger run history.
 *
 * Plan: docs/plans/2026-05-09-010-feat-customize-workflows-live-plan.md U6-2.
 */
export async function enableWorkflow(
  _parent: unknown,
  args: EnableWorkflowArgs,
  ctx: GraphQLContext,
) {
  const { computerId, slug } = args.input;
  const caller = await resolveCaller(ctx);
  if (!caller.userId || !caller.tenantId) {
    throw new GraphQLError("Authentication required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }

  const [computer] = await db
    .select({
      id: computers.id,
      tenant_id: computers.tenant_id,
      owner_user_id: computers.owner_user_id,
      primary_agent_id: computers.primary_agent_id,
      migrated_from_agent_id: computers.migrated_from_agent_id,
    })
    .from(computers)
    .where(
      and(
        eq(computers.id, computerId),
        eq(computers.owner_user_id, caller.userId),
        ne(computers.status, "archived"),
      ),
    );
  if (!computer) {
    throw new GraphQLError("Computer not found or not accessible", {
      extensions: { code: "COMPUTER_NOT_FOUND" },
    });
  }

  await requireTenantMember(ctx, computer.tenant_id);

  const agentId =
    computer.primary_agent_id ?? computer.migrated_from_agent_id ?? null;
  if (!agentId) {
    throw new GraphQLError(
      "This Computer has no primary agent — open the workbench once to provision one.",
      { extensions: { code: "CUSTOMIZE_PRIMARY_AGENT_NOT_FOUND" } },
    );
  }

  const [catalog] = await db
    .select()
    .from(tenantWorkflowCatalog)
    .where(
      and(
        eq(tenantWorkflowCatalog.tenant_id, computer.tenant_id),
        eq(tenantWorkflowCatalog.slug, slug),
      ),
    );
  if (!catalog) {
    throw new GraphQLError(
      `Customize catalog entry not found for workflow "${slug}"`,
      { extensions: { code: "CUSTOMIZE_CATALOG_NOT_FOUND" } },
    );
  }

  const config = (catalog.default_config ?? {}) as CatalogConfig;
  const schedule =
    typeof config.schedule === "string" ? config.schedule : null;

  // Upsert keyed by the partial unique index on
  // (agent_id, catalog_slug) WHERE both non-null. ON CONFLICT flips the
  // existing row's status back to 'active' so re-enabling after a
  // disable revives history rather than duplicating.
  const [row] = await db
    .insert(routines)
    .values({
      tenant_id: computer.tenant_id,
      agent_id: agentId,
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
      set: {
        status: "active",
        updated_at: sql`now()`,
      },
    })
    .returning();

  if (!row) {
    throw new GraphQLError("Failed to enable workflow", {
      extensions: { code: "INTERNAL_ERROR" },
    });
  }

  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id ?? agentId,
    catalogSlug: row.catalog_slug ?? slug,
    status: row.status,
    updatedAt: row.updated_at,
  };
}
