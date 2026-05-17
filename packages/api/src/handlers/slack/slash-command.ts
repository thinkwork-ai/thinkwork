import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { enqueueComputerTask } from "../../lib/computers/tasks.js";
import {
  slashCommandUsageResponse,
  slackLinkRequiredResponse,
} from "../../lib/slack/attribution.js";
import { buildSlackSlashCommandInput } from "../../lib/slack/envelope.js";
import { slackMetrics, type SlackMetrics } from "../../lib/slack/metrics.js";
import {
  resolveSlackSharedComputerTarget,
  slackTargetingGuidance,
  type SlackComputerTargetResult,
} from "../../lib/slack/shared-computer-targeting.js";
import {
  resolveOrCreateSlackThread,
  type SlackThreadMappingResult,
} from "../../lib/slack/thread-mapping.js";
import { json } from "../../lib/response.js";
import { createSlackHandler, type SlackHandlerArgs } from "./_shared.js";
import { withSlackThreadMapping } from "../../lib/slack/envelope.js";

type EnqueueTaskInput = Parameters<typeof enqueueComputerTask>[0];
type EnqueueTask = (
  input: EnqueueTaskInput,
) => Promise<{ id: string; input?: unknown; wasCreated?: boolean }>;

export interface SlashCommandForm {
  teamId: string;
  userId: string;
  channelId: string;
  text: string;
  responseUrl: string;
  triggerId: string;
}

export interface SlashCommandDeps {
  enqueueTask?: EnqueueTask;
  resolveTarget?: (input: {
    tenantId: string;
    slackTeamId: string;
    slackUserId: string;
    text: string;
  }) => Promise<SlackComputerTargetResult>;
  resolveSlackThread?: (input: {
    tenantId: string;
    computerId: string;
    actorId: string;
    envelope: ReturnType<typeof buildSlackSlashCommandInput>;
  }) => Promise<SlackThreadMappingResult>;
  metrics?: Pick<SlackMetrics, "dedupeHit">;
}

export function createSlackSlashCommandDispatcher(deps: SlashCommandDeps = {}) {
  const enqueueTask = deps.enqueueTask ?? enqueueComputerTask;
  const resolveTarget =
    deps.resolveTarget ?? ((input) => resolveSlackSharedComputerTarget(input));
  const resolveSlackThread =
    deps.resolveSlackThread ?? ((input) => resolveOrCreateSlackThread(input));
  const metrics = deps.metrics ?? slackMetrics;

  return async function dispatchSlashCommand(
    args: SlackHandlerArgs,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const form = parseSlashCommandForm(args.rawBodyText);
    if (!form.text.trim()) {
      return json(slashCommandUsageResponse());
    }

    const targetResult = await resolveTarget({
      tenantId: args.workspace.tenantId,
      slackTeamId: form.teamId,
      slackUserId: form.userId,
      text: form.text,
    });
    if (targetResult.status !== "resolved") {
      if (targetResult.status === "unlinked") {
        return json(slackLinkRequiredResponse());
      }
      return json({
        response_type: "ephemeral",
        text: slackTargetingGuidance(targetResult),
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: slackTargetingGuidance(targetResult),
            },
          },
        ],
      });
    }
    const target = targetResult.target;

    const taskInput = buildSlackSlashCommandInput({
      slackTeamId: form.teamId,
      slackUserId: form.userId,
      slackWorkspaceRowId: args.workspace.id,
      channelId: form.channelId,
      text: target.prompt,
      responseUrl: form.responseUrl,
      triggerId: form.triggerId,
      actorId: target.userId,
    });
    const mapping = await resolveSlackThread({
      tenantId: args.workspace.tenantId,
      computerId: target.computerId,
      actorId: target.userId,
      envelope: taskInput,
    });
    const task = await enqueueTask({
      tenantId: args.workspace.tenantId,
      computerId: target.computerId,
      taskType: "thread_turn",
      taskInput: withSlackThreadMapping(taskInput, mapping),
      idempotencyKey: taskInput.eventId,
      createdByUserId: target.userId,
    });
    if ((task as { wasCreated?: boolean }).wasCreated === false) {
      metrics.dedupeHit({ surface: "slash_command" });
    }

    return { statusCode: 200, body: "" };
  };
}

export function extractSlashTeamId(rawBodyText: string): string | null {
  return new URLSearchParams(rawBodyText).get("team_id");
}

export function parseSlashCommandForm(rawBodyText: string): SlashCommandForm {
  const params = new URLSearchParams(rawBodyText);
  return {
    teamId: requiredFormValue(params, "team_id"),
    userId: requiredFormValue(params, "user_id"),
    channelId: requiredFormValue(params, "channel_id"),
    text: params.get("text") ?? "",
    responseUrl: requiredFormValue(params, "response_url"),
    triggerId: requiredFormValue(params, "trigger_id"),
  };
}

function requiredFormValue(params: URLSearchParams, name: string): string {
  const value = params.get(name);
  if (!value || !value.trim()) {
    throw new Error(`Slack slash command missing ${name}`);
  }
  return value.trim();
}

export const handler = createSlackHandler({
  name: "slash-command",
  extractTeamId: ({ rawBodyText }) => extractSlashTeamId(rawBodyText),
  dispatch: createSlackSlashCommandDispatcher(),
});
