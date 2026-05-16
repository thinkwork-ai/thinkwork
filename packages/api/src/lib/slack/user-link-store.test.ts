import { describe, expect, it, vi } from "vitest";
import { upsertSlackUserLink } from "./user-link-store.js";

function fakeDb(
  workspaceRows: Array<Record<string, unknown>>,
  linkRows: Array<Record<string, unknown>>,
) {
  const insertValues = vi.fn();
  return {
    insertValues,
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(workspaceRows),
          }),
        }),
      }),
      insert: () => ({
        values: (value: Record<string, unknown>) => {
          insertValues(value);
          return {
            onConflictDoUpdate: () => ({
              returning: () => Promise.resolve(linkRows),
            }),
          };
        },
      }),
    },
  };
}

describe("Slack user link store", () => {
  it("rejects links for a Slack workspace installed to another tenant", async () => {
    const { db } = fakeDb([{ tenant_id: "tenant-2", status: "active" }], []);

    await expect(
      upsertSlackUserLink(
        {
          tenantId: "tenant-1",
          userId: "user-1",
          slackTeamId: "T-1",
          slackUserId: "U-1",
        },
        db as any,
      ),
    ).rejects.toThrow(/different ThinkWork tenant/);
  });

  it("creates or reactivates the workspace-scoped Slack user link", async () => {
    const { db, insertValues } = fakeDb(
      [{ tenant_id: "tenant-1", status: "active" }],
      [{ id: "link-1", status: "active" }],
    );

    const result = await upsertSlackUserLink(
      {
        tenantId: "tenant-1",
        userId: "user-1",
        slackTeamId: "T-1",
        slackTeamName: "Acme",
        slackUserId: "U-1",
        slackUserName: "eric",
        slackUserEmail: "eric@example.com",
      },
      db as any,
    );

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: "tenant-1",
        user_id: "user-1",
        slack_team_id: "T-1",
        slack_user_id: "U-1",
        status: "active",
      }),
    );
    expect(result).toMatchObject({ id: "link-1", status: "active" });
  });
});
