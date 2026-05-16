import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  activityLog,
  db,
  eq,
  slackUserLinks,
  snakeToCamel,
  sql,
} from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";

export async function unlinkSlackIdentity(
  _parent: unknown,
  args: { id: string },
  ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
  const [current] = await db
    .select()
    .from(slackUserLinks)
    .where(eq(slackUserLinks.id, args.id))
    .limit(1);
  if (!current) throw new Error("Slack identity link not found");

  await requireTenantMember(ctx, current.tenant_id);
  const callerUserId = await resolveCallerUserId(ctx);
  if (!callerUserId || callerUserId !== current.user_id) {
    throw new GraphQLError("Cannot unlink another user's Slack identity", {
      extensions: { code: "FORBIDDEN" },
    });
  }

  const [updated] = await db
    .update(slackUserLinks)
    .set({
      status: "unlinked",
      unlinked_at: sql`now()`,
      updated_at: sql`now()`,
    })
    .where(eq(slackUserLinks.id, args.id))
    .returning();
  if (!updated) throw new Error("Slack identity link not found");

  await db.insert(activityLog).values({
    tenant_id: current.tenant_id,
    actor_type: "user",
    actor_id: callerUserId,
    action: "slack_identity_unlinked",
    entity_type: "slack_user_link",
    entity_id: current.id,
    changes: {
      before: { status: current.status },
      after: { status: "unlinked" },
    },
    metadata: {
      slackTeamId: current.slack_team_id,
      slackUserId: current.slack_user_id,
    },
  });

  return snakeToCamel(updated as Record<string, unknown>);
}
