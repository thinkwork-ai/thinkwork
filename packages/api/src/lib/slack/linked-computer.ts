import { and, eq, ne } from "drizzle-orm";
import { computers, slackUserLinks } from "@thinkwork/database-pg/schema";
import { db } from "../db.js";

export type SlackLinkedComputerDbClient = typeof db;

export interface SlackLinkedComputer {
  userId: string;
  slackUserName: string | null;
  computerId: string;
  computerName: string;
}

export async function loadLinkedSlackComputer(
  input: {
    tenantId: string;
    slackTeamId: string;
    slackUserId: string;
  },
  dbClient: SlackLinkedComputerDbClient = db,
): Promise<SlackLinkedComputer | null> {
  const [row] = await dbClient
    .select({
      userId: slackUserLinks.user_id,
      slackUserName: slackUserLinks.slack_user_name,
      computerId: computers.id,
      computerName: computers.name,
    })
    .from(slackUserLinks)
    .innerJoin(
      computers,
      and(
        eq(computers.tenant_id, slackUserLinks.tenant_id),
        eq(computers.owner_user_id, slackUserLinks.user_id),
        ne(computers.status, "archived"),
      ),
    )
    .where(
      and(
        eq(slackUserLinks.tenant_id, input.tenantId),
        eq(slackUserLinks.slack_team_id, input.slackTeamId),
        eq(slackUserLinks.slack_user_id, input.slackUserId),
        eq(slackUserLinks.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}
