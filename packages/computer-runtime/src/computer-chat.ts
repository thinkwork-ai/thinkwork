import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConversationRole,
  type Message,
} from "@aws-sdk/client-bedrock-runtime";
import type { ThreadTurnContext } from "./api-client.js";
import { readWorkspaceSystemPrompt } from "./workspace.js";

export type ComputerChatResult = {
  content: string;
  model: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
};

export type ComputerChatRunner = (
  context: ThreadTurnContext,
  options: { workspaceRoot: string },
) => Promise<ComputerChatResult>;

const DEFAULT_COMPUTER_MODEL =
  process.env.COMPUTER_CHAT_MODEL_ID ||
  process.env.COMPUTER_CHAT_MODEL ||
  "us.anthropic.claude-haiku-4-5-20251001-v1:0";

const bedrock = new BedrockRuntimeClient({});

export const runComputerChatTurn: ComputerChatRunner = async (
  context,
  options,
) => {
  const model = context.model || DEFAULT_COMPUTER_MODEL;
  const systemPrompt = await buildSystemPrompt(context, options.workspaceRoot);
  const response = await bedrock.send(
    new ConverseCommand({
      modelId: model,
      system: [
        {
          text: systemPrompt,
        },
      ],
      messages: buildBedrockMessages(context.messagesHistory),
      inferenceConfig: {
        maxTokens: 1000,
        temperature: 0.2,
      },
    }),
  );

  const content = extractText(response.output?.message?.content);
  if (!content) {
    throw new Error("Computer chat model returned an empty response");
  }

  return {
    content,
    model,
    usage: response.usage
      ? {
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          totalTokens: response.usage.totalTokens,
        }
      : undefined,
  };
};

export async function buildSystemPrompt(
  context: ThreadTurnContext,
  workspaceRoot: string,
): Promise<string> {
  const basePrompt =
    context.systemPrompt || buildDefaultSystemPrompt(context, workspaceRoot);
  const requesterPrompt = buildRequesterContextPrompt(context.requesterContext);
  const attachmentPrompt = buildAttachmentPrompt(context.attachments ?? []);
  const workspacePrompt = await readWorkspaceSystemPrompt(workspaceRoot);
  return [basePrompt, requesterPrompt, attachmentPrompt, workspacePrompt]
    .filter(Boolean)
    .join("\n\n---\n\n");
}

function buildBedrockMessages(
  history: ThreadTurnContext["messagesHistory"],
): Message[] {
  const messages = history
    .filter(
      (message) => message.role === "user" || message.role === "assistant",
    )
    .map((message) => ({
      role: message.role as ConversationRole,
      content: [{ text: message.content || "" }],
    }))
    .filter((message) => message.content[0]?.text?.trim());

  if (messages.length === 0) {
    throw new Error("Thread turn context has no user message");
  }

  return messages;
}

function buildDefaultSystemPrompt(
  context: ThreadTurnContext,
  workspaceRoot: string,
) {
  return [
    `You are ${context.computer.name}, a ThinkWork Computer.`,
    "You are the always-on workspace for this user, not a delegated worker.",
    "Answer the user's thread message directly and keep the response useful, concise, and grounded in the conversation.",
    `Workspace root: ${context.computer.workspaceRoot || workspaceRoot}.`,
  ].join("\n");
}

function buildAttachmentPrompt(
  attachments: NonNullable<ThreadTurnContext["attachments"]>,
) {
  if (attachments.length === 0) return "";

  const lines = [
    "Files attached to the current user turn:",
    "These files are already attached to this request. Do not say that no file is attached.",
  ];
  for (const attachment of attachments) {
    const sizeKb = Math.max(1, Math.ceil((attachment.sizeBytes || 0) / 1024));
    lines.push(
      `- ${attachment.name} (${attachment.mimeType || "application/octet-stream"}, ~${sizeKb} KB)`,
    );
    if (attachment.readable && attachment.contentText) {
      const truncated = attachment.truncated
        ? "\n\n[attachment text truncated]"
        : "";
      lines.push(
        `  Content:\n${fenced(`${attachment.contentText}${truncated}`)}`,
      );
    } else {
      lines.push(
        `  Content is not available inline (${attachment.reason || "unreadable"}).`,
      );
    }
  }
  return lines.join("\n");
}

function buildRequesterContextPrompt(
  requesterContext: ThreadTurnContext["requesterContext"],
) {
  if (!requesterContext) return "";
  const lines = [
    "Requester context overlay:",
    `Context class: ${requesterContext.contextClass}`,
    `Requester user id: ${requesterContext.requester.userId ?? "unavailable"}`,
    `Memory provider: ${requesterContext.personalMemory.status.state}${
      requesterContext.personalMemory.status.reason
        ? ` (${requesterContext.personalMemory.status.reason})`
        : ""
    }`,
  ];
  if (requesterContext.credentialSubject) {
    lines.push(
      `Credential subject: ${requesterContext.credentialSubject.type}${
        requesterContext.credentialSubject.userId
          ? `:${requesterContext.credentialSubject.userId}`
          : ""
      }`,
    );
  }
  if (requesterContext.event) {
    lines.push(
      `Connector event: ${requesterContext.event.provider ?? "unknown"}:${
        requesterContext.event.eventType ?? "unknown"
      }`,
    );
  }
  if (requesterContext.personalMemory.hits.length > 0) {
    lines.push("Personal memory hits:");
    for (const hit of requesterContext.personalMemory.hits.slice(0, 5)) {
      lines.push(`- ${hit.title}: ${hit.text}`);
    }
  }
  return lines.join("\n");
}

function fenced(text: string) {
  return ["```", text, "```"].join("\n");
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part && typeof part === "object" && "text" in part) {
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}
