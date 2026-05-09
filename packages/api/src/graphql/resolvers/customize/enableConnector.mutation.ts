import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  and,
  computers,
  connectors,
  db,
  eq,
  ne,
  sql,
  tenantConnectorCatalog,
} from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import { requireTenantMember } from "../core/authz.js";

export interface EnableConnectorArgs {
  input: { computerId: string; slug: string };
}

/**
 * Enable a native connector for the caller's Computer. Looks up the
 * catalog row by `(tenant_id, slug)`, rejects MCP-kind catalog rows
 * (mobile OAuth owns those), and upserts a connectors row with
 * `dispatch_target_type='computer'` + `catalog_slug=<slug>`.
 *
 * Idempotent — re-enabling an already-connected slug returns the existing
 * row with `enabled=true, status='active'` and no duplicate insert.
 *
 * Plan: docs/plans/2026-05-09-008-feat-customize-connectors-live-plan.md U4-2.
 */
export async function enableConnector(
  _parent: unknown,
  args: EnableConnectorArgs,
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
      slug: computers.slug,
      tenant_id: computers.tenant_id,
      owner_user_id: computers.owner_user_id,
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

  const [catalog] = await db
    .select()
    .from(tenantConnectorCatalog)
    .where(
      and(
        eq(tenantConnectorCatalog.tenant_id, computer.tenant_id),
        eq(tenantConnectorCatalog.slug, slug),
      ),
    );
  if (!catalog) {
    throw new GraphQLError(
      `Customize catalog entry not found for slug "${slug}"`,
      { extensions: { code: "CUSTOMIZE_CATALOG_NOT_FOUND" } },
    );
  }
  if (catalog.kind === "mcp") {
    throw new GraphQLError(
      "MCP servers are connected via the mobile app's per-user OAuth flow, not the desktop Customize page.",
      { extensions: { code: "CUSTOMIZE_MCP_NOT_SUPPORTED" } },
    );
  }

  const description = catalog.description ?? null;
  const config = catalog.default_config ?? {};
  // Per-Computer name disambiguates the pre-existing
  // uq_connectors_tenant_name (tenant_id, name) constraint when two
  // Computers in the same tenant enable the same catalog slug.
  // computer.slug is unique per tenant via uq_computers_tenant_slug, so
  // appending it gives a per-tenant-unique connector name without
  // touching the legacy uniqueness invariant.
  const name = `${catalog.display_name} (${computer.slug})`;

  // Upsert keyed by the partial unique index on
  // (tenant_id, dispatch_target_id, catalog_slug) where
  // dispatch_target_type='computer' AND catalog_slug IS NOT NULL.
  const [row] = await db
    .insert(connectors)
    .values({
      tenant_id: computer.tenant_id,
      type: catalog.slug,
      name,
      description,
      catalog_slug: catalog.slug,
      status: "active",
      enabled: true,
      dispatch_target_type: "computer",
      dispatch_target_id: computer.id,
      config,
      created_by_type: "user",
      created_by_id: caller.userId,
    })
    .onConflictDoUpdate({
      target: [
        connectors.tenant_id,
        connectors.dispatch_target_id,
        connectors.catalog_slug,
      ],
      targetWhere: sql`${connectors.dispatch_target_type} = 'computer' AND ${connectors.catalog_slug} IS NOT NULL`,
      set: {
        enabled: true,
        status: "active",
        updated_at: sql`now()`,
      },
    })
    .returning();

  if (!row) {
    throw new GraphQLError("Failed to enable connector", {
      extensions: { code: "INTERNAL_ERROR" },
    });
  }

  return {
    id: row.id,
    tenantId: row.tenant_id,
    computerId: computer.id,
    catalogSlug: row.catalog_slug ?? slug,
    status: row.status,
    enabled: row.enabled,
    updatedAt: row.updated_at,
  };
}
