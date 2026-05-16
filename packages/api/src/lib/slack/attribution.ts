export interface SlackBlockKitResponse {
  response_type: "ephemeral" | "in_channel";
  text: string;
  blocks: Array<Record<string, unknown>>;
}

export function slashCommandQueuedResponse(
  text: string,
): SlackBlockKitResponse {
  return {
    response_type: "ephemeral",
    text,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Post to channel" },
            action_id: "slack_promote_response",
            value: "pending_response",
          },
        ],
      },
    ],
  };
}

export function slashCommandUsageResponse(): SlackBlockKitResponse {
  return {
    response_type: "ephemeral",
    text: "Usage: /thinkwork <prompt>",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Usage: `/thinkwork <prompt>`",
        },
      },
    ],
  };
}

export function slackLinkRequiredResponse(): SlackBlockKitResponse {
  const text = "Link your Slack identity to ThinkWork before using /thinkwork.";
  return {
    response_type: "ephemeral",
    text,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text },
      },
    ],
  };
}
