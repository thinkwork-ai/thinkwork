import { and, eq, sql } from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";
import { db } from "../db.js";

const { slackWorkspaces, slackUserLinks } = schema;

export interface SlackUserIdentity {
  slackTeamId: string;
  slackTeamName?: string | null;
  slackUserId: string;
  slackUserName?: string | null;
  slackUserEmail?: string | null;
}

export interface SlackUserLinkInput extends SlackUserIdentity {
  tenantId: string;
  userId: string;
}

type DbClient = typeof db;

export async function upsertSlackUserLink(
  input: SlackUserLinkInput,
  dbClient: DbClient = db,
) {
  const [workspace] = await dbClient
    .select({
      tenant_id: slackWorkspaces.tenant_id,
      status: slackWorkspaces.status,
    })
    .from(slackWorkspaces)
    .where(eq(slackWorkspaces.slack_team_id, input.slackTeamId))
    .limit(1);

  if (!workspace) {
    throw new Error(
      "Slack workspace is not installed for this ThinkWork tenant",
    );
  }
  if (workspace.tenant_id !== input.tenantId) {
    throw new Error(
      "Slack workspace is installed for a different ThinkWork tenant",
    );
  }
  if (workspace.status !== "active") {
    throw new Error("Slack workspace install is not active");
  }

  const [row] = await dbClient
    .insert(slackUserLinks)
    .values({
      tenant_id: input.tenantId,
      slack_team_id: input.slackTeamId,
      slack_user_id: input.slackUserId,
      user_id: input.userId,
      slack_user_name: input.slackUserName || null,
      slack_user_email: input.slackUserEmail || null,
      status: "active",
      linked_at: sql`now()`,
      unlinked_at: null,
      updated_at: sql`now()`,
    })
    .onConflictDoUpdate({
      target: [slackUserLinks.slack_team_id, slackUserLinks.slack_user_id],
      set: {
        tenant_id: input.tenantId,
        user_id: input.userId,
        slack_user_name: input.slackUserName || null,
        slack_user_email: input.slackUserEmail || null,
        status: "active",
        linked_at: sql`now()`,
        unlinked_at: null,
        updated_at: sql`now()`,
      },
      where: and(
        eq(slackUserLinks.slack_team_id, input.slackTeamId),
        eq(slackUserLinks.slack_user_id, input.slackUserId),
        eq(slackUserLinks.tenant_id, input.tenantId),
      ),
    })
    .returning();

  if (!row) {
    throw new Error("Slack identity link could not be persisted");
  }
  return row;
}
