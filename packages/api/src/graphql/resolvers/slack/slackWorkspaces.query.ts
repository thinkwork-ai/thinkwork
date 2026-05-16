import type { GraphQLContext } from "../../context.js";
import {
  asc,
  db,
  eq,
  slackWorkspaces as slackWorkspacesTable,
} from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { slackWorkspaceToGraphql } from "./shared.js";

export async function slackWorkspaces(
  _parent: unknown,
  args: { tenantId: string },
  ctx: GraphQLContext,
): Promise<Record<string, unknown>[]> {
  await requireTenantAdmin(ctx, args.tenantId);
  const rows = await db
    .select()
    .from(slackWorkspacesTable)
    .where(eq(slackWorkspacesTable.tenant_id, args.tenantId))
    .orderBy(asc(slackWorkspacesTable.slack_team_name));
  return rows.map(slackWorkspaceToGraphql);
}
