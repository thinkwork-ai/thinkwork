import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import type {
  AssistantMessage,
  Message,
  TextContent,
  Usage,
} from "@mariozechner/pi-ai";
import { getModel, streamSimple } from "@mariozechner/pi-ai";
import { composeSystemPrompt } from "./system-prompt.js";
import type { RuntimeEnv } from "./env-snapshot.js";
import { buildPiTools } from "./tools/registry.js";
import {
  type PiInvocationPayload,
  type PiToolInvocation,
  type ToolRuntimeState,
} from "./tools/types.js";
import { retainHindsightTurn } from "./tools/hindsight.js";

export interface PiRuntimeResult {
  response: {
    role: "assistant";
    content: string;
    runtime: "pi";
    model: string;
    usage?: Usage;
    tools_called?: string[];
    tool_invocations?: PiToolInvocation[];
    hindsight_usage?: ToolRuntimeState["hindsightUsage"];
  };
  pi_usage?: Usage;
  tools_called?: string[];
  tool_invocations?: PiToolInvocation[];
  hindsight_usage?: ToolRuntimeState["hindsightUsage"];
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

  const toolState: ToolRuntimeState = {
    toolInvocations: [],
    hindsightUsage: [],
    cleanup: [],
  };
  const tools = await buildPiTools({ payload, env, state: toolState });

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      messages: normalizeHistory(payload.messages_history),
      tools,
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

  agent.subscribe((event: AgentEvent) => {
    if (event.type === "tool_execution_start") {
      toolState.toolInvocations.push({
        id: event.toolCallId,
        name: event.toolName,
        tool_name: event.toolName,
        args: event.args,
        started_at: new Date().toISOString(),
        runtime: "pi",
        source: event.toolName.startsWith("hindsight_")
          ? "hindsight"
          : event.toolName === "web_search"
            ? "builtin"
            : event.toolName === "execute_code"
              ? "sandbox"
              : "tool",
      });
    }
    if (event.type === "tool_execution_end") {
      const invocation =
        toolState.toolInvocations.find(
          (item) => item.id === event.toolCallId,
        ) ??
        ({
          id: event.toolCallId,
          name: event.toolName,
          tool_name: event.toolName,
          runtime: "pi",
        } as PiToolInvocation);
      invocation.result = event.result;
      invocation.is_error = event.isError;
      invocation.finished_at = new Date().toISOString();
      if (!toolState.toolInvocations.includes(invocation)) {
        toolState.toolInvocations.push(invocation);
      }
    }
  });

  let content = "";
  let assistant: AssistantMessage | undefined;
  try {
    await agent.prompt(userMessage);
    assistant = [...agent.state.messages]
      .reverse()
      .find(
        (message): message is AssistantMessage => message.role === "assistant",
      );
    content = textFromAssistant(assistant);

    const retainResult = await retainHindsightTurn(payload, content);
    if (retainResult.usage) toolState.hindsightUsage.push(retainResult.usage);
    if (retainResult.retained !== undefined || retainResult.error) {
      toolState.toolInvocations.push({
        id: `hindsight-retain-${Date.now()}`,
        name: "hindsight_retain",
        tool_name: "hindsight_retain",
        result: retainResult,
        is_error: Boolean(retainResult.error),
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        runtime: "pi",
        source: "hindsight",
      });
    }
  } finally {
    for (const cleanup of toolState.cleanup.reverse()) {
      await cleanup();
    }
  }

  const toolsCalled = [
    ...new Set(toolState.toolInvocations.map((invocation) => invocation.name)),
  ];

  return {
    runtime: "pi",
    pi_usage: assistant?.usage,
    tools_called: toolsCalled,
    tool_invocations: toolState.toolInvocations,
    hindsight_usage: toolState.hindsightUsage,
    response: {
      role: "assistant",
      content,
      runtime: "pi",
      model: model.id,
      usage: assistant?.usage,
      tools_called: toolsCalled,
      tool_invocations: toolState.toolInvocations,
      hindsight_usage: toolState.hindsightUsage,
    },
  };
}
