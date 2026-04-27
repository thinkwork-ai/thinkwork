import { Agent } from "@mariozechner/pi-agent-core";
import type {
  AssistantMessage,
  Message,
  TextContent,
  Usage,
} from "@mariozechner/pi-ai";
import { getModel, streamSimple } from "@mariozechner/pi-ai";
import {
  composeSystemPrompt,
  type PiInvocationPayload,
} from "./system-prompt.js";
import type { RuntimeEnv } from "./env-snapshot.js";

export interface PiRuntimeResult {
  response: {
    role: "assistant";
    content: string;
    runtime: "pi";
    model: string;
    usage?: Usage;
  };
  pi_usage?: Usage;
  runtime: "pi";
}

interface HistoryMessage {
  role?: unknown;
  content?: unknown;
}

function textFromAssistant(message: AssistantMessage | undefined): string {
  if (!message) return "";
  return message.content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function normalizeHistory(history: unknown): Message[] {
  if (!Array.isArray(history)) return [];
  return history.flatMap((entry: HistoryMessage) => {
    if (
      (entry.role === "user" || entry.role === "assistant") &&
      typeof entry.content === "string" &&
      entry.content.trim()
    ) {
      return [
        {
          role: entry.role,
          content: entry.content,
          timestamp: Date.now(),
        } as Message,
      ];
    }
    return [];
  });
}

function resolveModel(modelId: unknown) {
  const id =
    typeof modelId === "string" && modelId.trim()
      ? modelId.trim()
      : "anthropic.claude-sonnet-4-5-20250929-v1:0";
  return getModel("amazon-bedrock", id as never);
}

export async function runPiAgent(
  payload: PiInvocationPayload & Record<string, unknown>,
  env: RuntimeEnv,
): Promise<PiRuntimeResult> {
  const model = resolveModel(payload.model);
  const systemPrompt = composeSystemPrompt(payload);
  const userMessage =
    typeof payload.message === "string" ? payload.message : "";
  if (!userMessage.trim()) {
    throw new Error("Pi runtime invocation requires a non-empty message");
  }

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      messages: normalizeHistory(payload.messages_history),
    },
    streamFn: streamSimple,
    sessionId:
      typeof payload.thread_id === "string" ? payload.thread_id : undefined,
    onPayload: (bedrockPayload) => ({
      ...(bedrockPayload as Record<string, unknown>),
      requestMetadata: {
        runtime: "pi",
        git_sha: env.gitSha,
      },
    }),
  });

  await agent.prompt(userMessage);
  const assistant = [...agent.state.messages]
    .reverse()
    .find(
      (message): message is AssistantMessage => message.role === "assistant",
    );
  const content = textFromAssistant(assistant);

  return {
    runtime: "pi",
    pi_usage: assistant?.usage,
    response: {
      role: "assistant",
      content,
      runtime: "pi",
      model: model.id,
      usage: assistant?.usage,
    },
  };
}
