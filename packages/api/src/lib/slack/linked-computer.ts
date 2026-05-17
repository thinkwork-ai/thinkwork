import { db } from "../db.js";
import {
  loadSlackTargetingContext,
  resolveSlackSharedComputerTarget,
  type SlackResolvedComputerTarget,
} from "./shared-computer-targeting.js";

export type SlackLinkedComputerDbClient = typeof db;

export type SlackLinkedComputer = Omit<
  SlackResolvedComputerTarget,
  "prompt" | "targetToken"
> & {
  prompt?: string;
  targetToken?: string | null;
};

export async function loadLinkedSlackComputer(
  input: {
    tenantId: string;
    slackTeamId: string;
    slackUserId: string;
    text?: string;
    botUserId?: string | null;
  },
  dbClient: SlackLinkedComputerDbClient = db,
): Promise<SlackLinkedComputer | null> {
  const result = await resolveSlackSharedComputerTarget(
    {
      tenantId: input.tenantId,
      slackTeamId: input.slackTeamId,
      slackUserId: input.slackUserId,
      text: input.text ?? "",
      botUserId: input.botUserId,
      allowSingleAssignedFallback: true,
    },
    {
      loadContext: (contextInput) =>
        loadSlackTargetingContext(contextInput, dbClient),
    },
  );
  if (result.status !== "resolved") return null;
  return result.target;
}
