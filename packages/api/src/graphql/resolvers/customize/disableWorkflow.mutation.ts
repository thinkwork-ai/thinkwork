import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { and, db, eq, routines, sql } from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import { requireTenantMember } from "../core/authz.js";
import { renderWorkspaceAfterCustomize } from "./render-workspace-after-customize.js";
import {
  PlatformAgentNotFoundError,
  resolveTenantPlatformAgent,
} from "../../../lib/agents/tenant-platform-agent.js";

export interface DisableWorkflowArgs {
  input: { agentId: string; slug: string };
}

/**
 * Disable a workflow template on the caller's tenant platform agent. The
 * backing compatibility row remains a Routine until the Step Functions adapter
 * stops using routine catalog slugs.
 */
export async function disableWorkflow(
  _parent: unknown,
  args: DisableWorkflowArgs,
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
    if (err instanceof PlatformAgentNotFoundError) return true;
    throw err;
  }

  await db
    .update(routines)
    .set({ status: "inactive", updated_at: sql`now()` })
    .where(
      and(
        eq(routines.tenant_id, caller.tenantId),
        eq(routines.agent_id, resolvedAgentId),
        eq(routines.catalog_slug, slug),
      ),
    );

  await renderWorkspaceAfterCustomize("disableWorkflow", resolvedAgentId);

  return true;
}
