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
    text: "Usage: /thinkwork <computer> <prompt>",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Usage: `/thinkwork finance summarize this thread`",
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

export function publicSlackResponseText(
  text: string,
  slackUserId: string,
): string {
  const body = text.trim() || "ThinkWork response";
  return `${body}\n\n_Posted from ThinkWork by <@${slackUserId}>._`;
}

export function publicSlackResponseBlocks(
  text: string,
  slackUserId: string,
): Array<Record<string, unknown>> {
  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: text.trim() || "ThinkWork response" },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `_Posted from ThinkWork by <@${slackUserId}>._`,
        },
      ],
    },
  ];
}

export interface SlackComputerAttribution {
  computerName?: string;
  displayName: string;
  avatarUrl: string | null;
}

export function slackComputerUsername(displayName: string): string {
  return normalizeSlackDisplayName(displayName);
}

export function slackComputerFooter(displayName: string): string {
  return `Routed via @ThinkWork · ${slackComputerUsername(displayName)}`;
}

export function slackComputerResponseText(
  text: string,
  attribution: SlackComputerAttribution,
  options: { degraded?: boolean } = {},
): string {
  const body = text.trim() || "ThinkWork response";
  if (!options.degraded) return body;
  return `*${slackComputerUsername(attribution.computerName ?? attribution.displayName)}:*\n${body}`;
}

export function slackComputerResponseBlocks(
  text: string,
  attribution: SlackComputerAttribution,
  options: { degraded?: boolean } = {},
): Array<Record<string, unknown>> {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: slackComputerResponseText(text, attribution, options),
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: slackComputerFooter(
            attribution.computerName ?? attribution.displayName,
          ),
        },
      ],
    },
  ];
}

export function slackComputerEphemeralResponse(
  text: string,
  attribution: SlackComputerAttribution,
): SlackBlockKitResponse {
  return {
    response_type: "ephemeral",
    text: slackComputerResponseText(text, attribution),
    blocks: [
      ...slackComputerResponseBlocks(text, attribution),
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Post to channel" },
            action_id: "slack_promote_response",
            value: "completed_response",
          },
        ],
      },
    ],
  };
}

function normalizeSlackDisplayName(displayName: string): string {
  return displayName.trim() || "User";
}
