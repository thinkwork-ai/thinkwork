import type { slackWorkspaces } from "@thinkwork/database-pg/schema";
import { snakeToCamel } from "../../utils.js";

type SlackWorkspaceRow = typeof slackWorkspaces.$inferSelect;

export function slackWorkspaceToGraphql(
  row: SlackWorkspaceRow,
): Record<string, unknown> {
  const safe = { ...row };
  delete (safe as Partial<SlackWorkspaceRow>).bot_token_secret_path;
  return snakeToCamel(safe as Record<string, unknown>);
}
