import { Agent, type AgentEvent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { getModel, streamSimple } from "@earendil-works/pi-ai";

import { textFromAssistant } from "./history.js";
import { collectToolCosts } from "./tool-costs.js";
import type { RunAgentLoopArgs, RunAgentLoopResult } from "./types.js";

/** Short, render-safe preview of a tool arg/result for the thread activity UI. */
function toolPreview(value: unknown, max = 600): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.slice(0, max);
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return String(value).slice(0, max);
  }
}

function resolveModel(modelId: unknown) {
  const id =
    typeof modelId === "string" && modelId.trim()
      ? modelId.trim()
      : "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
  return getModel("amazon-bedrock", id as never);
}

export async function runAgentLoop(
  args: RunAgentLoopArgs,
): Promise<RunAgentLoopResult> {
  const model = resolveModel(args.modelId);
  const toolsCalled = new Set<string>();
  const toolInvocations: RunAgentLoopResult["toolInvocations"] = [];

  const agent = new Agent({
    initialState: {
      systemPrompt: args.systemPrompt,
      model,
      messages: args.history,
      tools: args.tools,
    },
    streamFn: streamSimple,
    sessionId: args.threadId || undefined,
    onPayload: (bedrockPayload) => ({
      ...(bedrockPayload as Record<string, unknown>),
      requestMetadata: {
        runtime: "pi",
        git_sha: args.gitSha,
        thread_id: args.threadId,
      },
    }),
  });

  agent.subscribe((event: AgentEvent) => {
    if (event.type === "tool_execution_start") {
      toolsCalled.add(event.toolName);
      toolInvocations.push({
        id: event.toolCallId,
        name: event.toolName,
        tool_name: event.toolName,
        args: event.args,
        input_preview: toolPreview(event.args),
        status: "running",
        started_at: new Date().toISOString(),
        runtime: "pi",
      });
    }
    if (event.type === "tool_execution_end") {
      const existing = toolInvocations.find(
        (item) => item.id === event.toolCallId,
      );
      const finished = new Date().toISOString();
      if (existing) {
        existing.result = event.result;
        existing.is_error = event.isError;
        existing.output_preview = toolPreview(event.result);
        existing.status = event.isError ? "error" : "ok";
        existing.finished_at = finished;
      } else {
        toolInvocations.push({
          id: event.toolCallId,
          name: event.toolName,
          tool_name: event.toolName,
          result: event.result,
          is_error: event.isError,
          output_preview: toolPreview(event.result),
          status: event.isError ? "error" : "ok",
          finished_at: finished,
          runtime: "pi",
        });
      }
    }
  });

  await agent.prompt(args.message);
  const assistant = [...agent.state.messages]
    .reverse()
    .find(
      (message): message is AssistantMessage => message.role === "assistant",
    );

  return {
    content: textFromAssistant(assistant),
    usage: assistant?.usage,
    modelId: model.id,
    toolsCalled: [...toolsCalled],
    toolInvocations,
    toolCosts: toolInvocations.flatMap((invocation) =>
      collectToolCosts(invocation.result),
    ),
  };
}
