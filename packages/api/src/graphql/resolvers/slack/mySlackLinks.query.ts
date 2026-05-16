import type { GraphQLContext } from "../../context.js";
import {
  and,
  asc,
  db,
  eq,
  slackUserLinks,
  slackWorkspaces,
  snakeToCamel,
} from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";

export async function mySlackLinks(
  _parent: unknown,
  args: { tenantId: string },
  ctx: GraphQLContext,
): Promise<Record<string, unknown>[]> {
  await requireTenantMember(ctx, args.tenantId);
  const callerUserId = await resolveCallerUserId(ctx);
  if (!callerUserId) return [];

  const rows = await db
    .select({
      id: slackUserLinks.id,
      tenant_id: slackUserLinks.tenant_id,
      slack_team_id: slackUserLinks.slack_team_id,
      slack_team_name: slackWorkspaces.slack_team_name,
      slack_user_id: slackUserLinks.slack_user_id,
      slack_user_name: slackUserLinks.slack_user_name,
      slack_user_email: slackUserLinks.slack_user_email,
      user_id: slackUserLinks.user_id,
      status: slackUserLinks.status,
      linked_at: slackUserLinks.linked_at,
      unlinked_at: slackUserLinks.unlinked_at,
      created_at: slackUserLinks.created_at,
      updated_at: slackUserLinks.updated_at,
    })
    .from(slackUserLinks)
    .innerJoin(
      slackWorkspaces,
      eq(slackWorkspaces.slack_team_id, slackUserLinks.slack_team_id),
    )
    .where(
      and(
        eq(slackUserLinks.tenant_id, args.tenantId),
        eq(slackUserLinks.user_id, callerUserId),
        eq(slackUserLinks.status, "active"),
      ),
    )
    .orderBy(asc(slackWorkspaces.slack_team_name));

  return rows.map((row) => snakeToCamel(row as Record<string, unknown>));
}
