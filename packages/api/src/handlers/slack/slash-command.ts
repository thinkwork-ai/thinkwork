import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { enqueueComputerTask } from "../../lib/computers/tasks.js";
import {
  slashCommandUsageResponse,
  slackLinkRequiredResponse,
} from "../../lib/slack/attribution.js";
import { buildSlackSlashCommandInput } from "../../lib/slack/envelope.js";
import {
  loadLinkedSlackComputer,
  type SlackLinkedComputer,
} from "../../lib/slack/linked-computer.js";
import { json } from "../../lib/response.js";
import { createSlackHandler, type SlackHandlerArgs } from "./_shared.js";

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
  loadLinkedComputer?: (input: {
    tenantId: string;
    slackTeamId: string;
    slackUserId: string;
  }) => Promise<SlackLinkedComputer | null>;
}

export function createSlackSlashCommandDispatcher(deps: SlashCommandDeps = {}) {
  const enqueueTask = deps.enqueueTask ?? enqueueComputerTask;
  const loadLinkedComputer =
    deps.loadLinkedComputer ?? ((input) => loadLinkedSlackComputer(input));

  return async function dispatchSlashCommand(
    args: SlackHandlerArgs,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const form = parseSlashCommandForm(args.rawBodyText);
    if (!form.text.trim()) {
      return json(slashCommandUsageResponse());
    }

    const link = await loadLinkedComputer({
      tenantId: args.workspace.tenantId,
      slackTeamId: form.teamId,
      slackUserId: form.userId,
    });
    if (!link) {
      return json(slackLinkRequiredResponse());
    }

    const taskInput = buildSlackSlashCommandInput({
      slackTeamId: form.teamId,
      slackUserId: form.userId,
      channelId: form.channelId,
      text: form.text,
      responseUrl: form.responseUrl,
      triggerId: form.triggerId,
      actorId: link.userId,
    });
    await enqueueTask({
      tenantId: args.workspace.tenantId,
      computerId: link.computerId,
      taskType: "thread_turn",
      taskInput,
      idempotencyKey: taskInput.eventId,
      createdByUserId: link.userId,
    });

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
