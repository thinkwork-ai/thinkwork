import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  slackThreads,
  slackUserLinks,
  slackWorkspaces,
} from "../src/schema/slack";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0094 = readFileSync(
  join(HERE, "..", "drizzle", "0094_slack_workspace_app.sql"),
  "utf-8",
);

describe("Slack workspace app schema", () => {
  it("defines one workspace install row per Slack team", () => {
    const columns = getTableColumns(slackWorkspaces);

    expect(getTableName(slackWorkspaces)).toBe("slack_workspaces");
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.slack_team_id.notNull).toBe(true);
    expect(columns.bot_user_id.notNull).toBe(true);
    expect(columns.bot_token_secret_path.notNull).toBe(true);
    expect(columns.app_id.notNull).toBe(true);
    expect(columns.installed_by_user_id.notNull).toBe(false);
    expect(columns.status.default).toBe("active");
  });

  it("defines workspace-scoped Slack user links", () => {
    const columns = getTableColumns(slackUserLinks);

    expect(getTableName(slackUserLinks)).toBe("slack_user_links");
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.slack_team_id.notNull).toBe(true);
    expect(columns.slack_user_id.notNull).toBe(true);
    expect(columns.user_id.notNull).toBe(true);
    expect(columns.status.default).toBe("active");
  });

  it("defines Slack conversation to ThinkWork thread mapping", () => {
    const columns = getTableColumns(slackThreads);

    expect(getTableName(slackThreads)).toBe("slack_threads");
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.slack_team_id.notNull).toBe(true);
    expect(columns.channel_id.notNull).toBe(true);
    expect(columns.root_thread_ts.notNull).toBe(false);
    expect(columns.thread_id.notNull).toBe(true);
  });

  it("enforces the Slack uniqueness and restrict-delete invariants in SQL", () => {
    expect(migration0094).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_slack_workspaces_team\s+ON public\.slack_workspaces \(slack_team_id\)/,
    );
    expect(migration0094).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_slack_user_links_team_user\s+ON public\.slack_user_links \(slack_team_id, slack_user_id\)/,
    );
    expect(migration0094).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_slack_threads_team_channel_root[\s\S]*?NULLS NOT DISTINCT/,
    );
    expect(migration0094).toMatch(
      /REFERENCES public\.slack_workspaces\(slack_team_id\)\s+ON DELETE RESTRICT/,
    );
  });
});
