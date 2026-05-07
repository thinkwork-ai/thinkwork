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
  const workspacePrompt = await readWorkspaceSystemPrompt(workspaceRoot);
  return [basePrompt, workspacePrompt].filter(Boolean).join("\n\n---\n\n");
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
