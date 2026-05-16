import { sql } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import {
  and,
  db,
  eq,
  slackUserLinks,
  slackWorkspaces as slackWorkspacesTable,
} from "../../utils.js";
import { deleteSlackBotToken } from "../../../lib/slack/workspace-store.js";
import { requireTenantAdmin } from "../core/authz.js";
import { slackWorkspaceToGraphql } from "./shared.js";

export async function uninstallSlackWorkspace(
  _parent: unknown,
  args: { id: string },
  ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
  const [current] = await db
    .select()
    .from(slackWorkspacesTable)
    .where(eq(slackWorkspacesTable.id, args.id))
    .limit(1);
  if (!current) throw new Error("Slack workspace not found");

  await requireTenantAdmin(ctx, current.tenant_id);

  const [updated] = await db
    .update(slackWorkspacesTable)
    .set({
      status: "uninstalled",
      uninstalled_at: sql`now()`,
      updated_at: sql`now()`,
    })
    .where(eq(slackWorkspacesTable.id, args.id))
    .returning();
  if (!updated) throw new Error("Slack workspace not found");

  await db
    .update(slackUserLinks)
    .set({
      status: "orphaned",
      updated_at: sql`now()`,
    })
    .where(
      and(
        eq(slackUserLinks.tenant_id, current.tenant_id),
        eq(slackUserLinks.slack_team_id, current.slack_team_id),
      ),
    );

  await deleteSlackBotToken(current.bot_token_secret_path);

  return slackWorkspaceToGraphql(updated);
}
