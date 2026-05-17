import { describe, expect, it } from "vitest";
import {
  parseSlackTargetedPrompt,
  resolveSlackSharedComputerTarget,
  slackTargetingGuidance,
  type SlackTargetingContext,
} from "./shared-computer-targeting.js";

const CONTEXT: SlackTargetingContext = {
  requester: {
    userId: "user-1",
    slackUserName: "Eric",
  },
  assignedComputers: [
    {
      computerId: "finance-computer-1",
      computerName: "Finance Computer",
      computerSlug: "finance-computer",
    },
    {
      computerId: "sales-computer-1",
      computerName: "Sales Computer",
      computerSlug: "sales-computer",
    },
  ],
};

describe("Slack shared Computer targeting", () => {
  it("parses an explicit slash-command target and prompt", () => {
    expect(parseSlackTargetedPrompt("finance summarize this thread")).toEqual({
      targetToken: "finance",
      prompt: "summarize this thread",
    });
  });

  it("removes a leading app mention before parsing the target", () => {
    expect(
      parseSlackTargetedPrompt("<@B123> finance summarize this", "B123"),
    ).toEqual({
      targetToken: "finance",
      prompt: "summarize this",
    });
  });

  it("resolves assigned shared Computers by slug, role shorthand, or name", async () => {
    const result = await resolveSlackSharedComputerTarget(
      {
        tenantId: "tenant-1",
        slackTeamId: "T123",
        slackUserId: "U123",
        text: "finance analyze Q3",
      },
      {
        loadContext: async () => CONTEXT,
      },
    );

    expect(result).toEqual({
      status: "resolved",
      target: {
        userId: "user-1",
        slackUserName: "Eric",
        computerId: "finance-computer-1",
        computerName: "Finance Computer",
        computerSlug: "finance-computer",
        prompt: "analyze Q3",
        targetToken: "finance",
      },
    });
  });

  it("fails closed when the Slack user is linked but has no assigned Computers", async () => {
    const result = await resolveSlackSharedComputerTarget(
      {
        tenantId: "tenant-1",
        slackTeamId: "T123",
        slackUserId: "U123",
        text: "finance analyze Q3",
      },
      {
        loadContext: async () => ({
          requester: CONTEXT.requester,
          assignedComputers: [],
        }),
      },
    );

    expect(result).toEqual({
      status: "no_assignments",
      requester: CONTEXT.requester,
    });
    if (result.status === "resolved") throw new Error("expected no assignment");
    expect(slackTargetingGuidance(result)).toContain(
      "do not have access to any shared Computers",
    );
  });

  it("does not silently route ambiguous Slack requests without a target", async () => {
    const result = await resolveSlackSharedComputerTarget(
      {
        tenantId: "tenant-1",
        slackTeamId: "T123",
        slackUserId: "U123",
        text: "summarize Q3 revenue",
      },
      {
        loadContext: async () => CONTEXT,
      },
    );

    expect(result).toMatchObject({
      status: "unknown_target",
      targetToken: "summarize",
      options: CONTEXT.assignedComputers,
    });
    if (result.status === "resolved") throw new Error("expected guidance");
    expect(slackTargetingGuidance(result)).toContain("`finance`");
  });

  it("can allow a single assigned Computer compatibility fallback without using ownership", async () => {
    const result = await resolveSlackSharedComputerTarget(
      {
        tenantId: "tenant-1",
        slackTeamId: "T123",
        slackUserId: "U123",
        text: "summarize Q3 revenue",
        allowSingleAssignedFallback: true,
      },
      {
        loadContext: async () => ({
          requester: CONTEXT.requester,
          assignedComputers: [CONTEXT.assignedComputers[0]!],
        }),
      },
    );

    expect(result).toMatchObject({
      status: "resolved",
      target: {
        computerId: "finance-computer-1",
        prompt: "summarize Q3 revenue",
        targetToken: null,
      },
    });
  });

  it("requires a prompt after the selected Computer name", async () => {
    const result = await resolveSlackSharedComputerTarget(
      {
        tenantId: "tenant-1",
        slackTeamId: "T123",
        slackUserId: "U123",
        text: "finance",
      },
      {
        loadContext: async () => CONTEXT,
      },
    );

    expect(result).toMatchObject({
      status: "missing_prompt",
      targetToken: "finance",
    });
    if (result.status === "resolved") throw new Error("expected guidance");
    expect(slackTargetingGuidance(result)).toContain(
      "/thinkwork finance summarize this thread",
    );
  });
});
