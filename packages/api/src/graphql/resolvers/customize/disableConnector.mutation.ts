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
} from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import { requireTenantMember } from "../core/authz.js";
import { renderWorkspaceAfterCustomize } from "./render-workspace-after-customize.js";

export interface DisableConnectorArgs {
  input: { computerId: string; slug: string };
}

/**
 * Disable a connector binding for the caller's Computer. Idempotent — if
 * no binding exists, returns true without writing.
 *
 * Plan: docs/plans/2026-05-09-008-feat-customize-connectors-live-plan.md U4-2.
 */
export async function disableConnector(
  _parent: unknown,
  args: DisableConnectorArgs,
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

  await db
    .update(connectors)
    .set({
      enabled: false,
      status: "paused",
      updated_at: sql`now()`,
    })
    .where(
      and(
        eq(connectors.tenant_id, computer.tenant_id),
        eq(connectors.dispatch_target_type, "computer"),
        eq(connectors.dispatch_target_id, computer.id),
        eq(connectors.catalog_slug, slug),
      ),
    );

  const agentId =
    computer.primary_agent_id ?? computer.migrated_from_agent_id ?? null;
  await renderWorkspaceAfterCustomize("disableConnector", agentId, computer.id);

  return true;
}
