import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import type {
  AssistantMessage,
  Message,
  TextContent,
  Usage,
} from "@mariozechner/pi-ai";
import { getModel, streamSimple } from "@mariozechner/pi-ai";
import { S3Client } from "@aws-sdk/client-s3";
import { bootstrapWorkspace } from "./bootstrap-workspace.js";
import { composeSystemPrompt } from "./system-prompt.js";
import type { RuntimeEnv } from "./env-snapshot.js";
import { buildPiTools } from "./tools/registry.js";
import { retainFullThread } from "./tools/hindsight.js";
import {
  discoverWorkspaceSkills,
  formatWorkspaceSkills,
} from "./tools/workspace-skills.js";
import {
  type PiInvocationPayload,
  type PiToolInvocation,
  type ToolRuntimeState,
} from "./tools/types.js";

const CONTEXT_ENGINE_TOOL_NAMES = new Set([
  "query_context",
  "query_memory_context",
  "query_wiki_context",
]);

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
  const userMessage =
    typeof payload.message === "string" ? payload.message : "";
  if (!userMessage.trim()) {
    throw new Error("Pi runtime invocation requires a non-empty message");
  }

  // Per docs/plans/2026-04-27-003: sync the agent's S3 prefix to local
  // disk on every invocation. The agent prefix is the only thing we
  // read — no overlay, no manifest comparison, just list + GET.
  const tenantSlug =
    typeof payload.tenant_slug === "string" ? payload.tenant_slug : "";
  const agentSlug =
    typeof payload.instance_id === "string" ? payload.instance_id : "";
  if (env.workspaceBucket && tenantSlug && agentSlug) {
    try {
      const s3 = new S3Client({ region: env.awsRegion });
      await bootstrapWorkspace(
        tenantSlug,
        agentSlug,
        env.workspaceDir,
        s3,
        env.workspaceBucket,
      );
    } catch (err) {
      console.warn(
        "[agentcore-pi] workspace bootstrap failed (continuing with stale local tree)",
        err,
      );
    }
  }
  const workspaceSkills = await discoverWorkspaceSkills(env.workspaceDir);
  const systemPrompt = composeSystemPrompt(
    payload,
    formatWorkspaceSkills(workspaceSkills),
  );

  const toolState: ToolRuntimeState = {
    toolInvocations: [],
    hindsightUsage: [],
    cleanup: [],
  };
  const tools = await buildPiTools({
    payload,
    env,
    state: toolState,
    workspaceSkills,
  });

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
            : event.toolName === "send_email"
              ? "builtin"
              : CONTEXT_ENGINE_TOOL_NAMES.has(event.toolName)
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
  } finally {
    for (const cleanup of toolState.cleanup.reverse()) {
      await cleanup();
    }
  }

  // Per-turn auto-retain — fire-and-forget. The Lambda fetches the
  // canonical transcript from the messages table and merges with this
  // tail (longest-suffix-prefix overlap) before calling retainConversation.
  // Best-effort: failures log and never block the response.
  //
  // Sub-agent-equivalent isolation (R6): Pi has no Strands-style
  // sub-agents today, but if runPiAgent is ever invoked from within a
  // delegate-style path, the call site here is the OUTER entry point —
  // same isolation principle as Strands' do_POST. Future delegate
  // integrations must NOT move this call.
  void retainFullThread(payload, content, env).then(
    (result) => {
      if (!result.retained && result.error) {
        console.warn(
          "[agentcore-pi] retainFullThread failed (non-blocking)",
          result.error,
        );
      }
    },
    (err) => {
      console.warn("[agentcore-pi] retainFullThread unexpected error", err);
    },
  );

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
