import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { getModel, streamSimple } from "@mariozechner/pi-ai";

import { textFromAssistant } from "./history.js";
import { collectToolCosts } from "./tool-costs.js";
import type { RunAgentLoopArgs, RunAgentLoopResult } from "./types.js";

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
        existing.finished_at = finished;
      } else {
        toolInvocations.push({
          id: event.toolCallId,
          name: event.toolName,
          tool_name: event.toolName,
          result: event.result,
          is_error: event.isError,
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
