// The agent loop — the small core, mirroring Pi.
//
// One turn = repeated (model -> tools -> model) steps until the model answers without
// requesting tools, a step budget is hit, or the caller aborts. The loop depends only on
// the ModelProvider interface and a flat list of tools; it knows nothing about Bedrock,
// llama.rn, or any concrete model/tool. `createAgentSession` (session.ts) wraps this engine
// in Pi's stateful prompt/subscribe surface — this function is the stateless turn-runner.

import type {
  AgentEvent,
  AgentRunResult,
  AgentStopReason,
  Message,
  ModelProvider,
  Tool,
  ToolContext,
  ToolResult,
  Usage,
} from "./types";
import { toToolSpec } from "./types";

export interface RunAgentTurnOptions {
  provider: ModelProvider;
  /** Tools advertised to the model and dispatched on tool calls. */
  tools: Tool[];
  /** Seed transcript — typically prior thread messages plus the new user message. */
  messages: Message[];
  system?: string;
  model?: string;
  /** Max model calls before stopping with `max_steps`. Guards runaway tool loops. */
  maxSteps?: number;
  maxTokens?: number;
  temperature?: number;
  /** Opaque id of the thread/session this turn belongs to, passed to tools. */
  sessionId?: string;
  signal?: AbortSignal;
  /** Observability / UI streaming hook. Thrown errors here are ignored. */
  onEvent?: (event: AgentEvent) => void | Promise<void>;
}

const DEFAULT_MAX_STEPS = 8;

function addUsage(into: Usage, add?: Usage): void {
  if (!add) return;
  into.inputTokens += add.inputTokens;
  into.outputTokens += add.outputTokens;
}

/** Dispatch a tool call by name; unknown tools and thrown handlers become error results. */
async function executeTool(
  tools: Tool[],
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { content: `Unknown tool: ${name}`, isError: true };
  if (ctx.signal?.aborted) {
    return { content: `Aborted before tool "${name}" ran`, isError: true };
  }
  try {
    return await tool.execute(args, ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Tool "${name}" failed: ${message}`, isError: true };
  }
}

export async function runAgentTurn(
  options: RunAgentTurnOptions,
): Promise<AgentRunResult> {
  const {
    provider,
    tools,
    system,
    model,
    maxSteps = DEFAULT_MAX_STEPS,
    maxTokens,
    temperature,
    sessionId,
    signal,
    onEvent,
  } = options;

  const emit = async (event: AgentEvent): Promise<void> => {
    if (!onEvent) return;
    try {
      await onEvent(event);
    } catch {
      // Observability must never break the turn.
    }
  };

  const messages: Message[] = [...options.messages];
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const toolSpecs = tools.map(toToolSpec);
  let finalText = "";
  let steps = 0;

  const finish = async (
    stopReason: AgentStopReason,
  ): Promise<AgentRunResult> => {
    await emit({ type: "agent_end", stopReason, steps, usage: { ...usage } });
    await emit({ type: "done", stopReason, steps });
    return { messages, finalText, steps, stopReason, usage };
  };

  await emit({
    type: "agent_start",
    step: 0,
    toolNames: tools.map((tool) => tool.name),
    model,
  });

  while (true) {
    if (signal?.aborted) {
      return finish("aborted");
    }

    if (steps >= maxSteps) {
      return finish("max_steps");
    }

    let response;
    try {
      response = await provider.generate(
        // Snapshot the transcript so a provider that retains the reference never sees the
        // loop's later mutations, and can't mutate the loop's working array.
        {
          system,
          messages: [...messages],
          tools: toolSpecs,
          model,
          maxTokens,
          temperature,
        },
        signal,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await emit({ type: "error", error: message });
      return finish("error");
    }

    steps += 1;
    addUsage(usage, response.usage);

    if (response.stopReason === "error") {
      await emit({
        type: "error",
        error: response.text || "model returned error stop reason",
      });
      return finish("error");
    }

    if (response.text) {
      finalText = response.text;
      await emit({ type: "assistant_text", text: response.text, step: steps });
    }

    messages.push({
      role: "assistant",
      content: response.text,
      toolCalls: response.toolCalls.length ? response.toolCalls : undefined,
    });

    if (response.toolCalls.length === 0) {
      return finish("completed");
    }

    for (const call of response.toolCalls) {
      await emit({ type: "tool_call", call, step: steps });
      const result = await executeTool(tools, call.name, call.arguments, {
        signal,
        sessionId,
      });
      await emit({
        type: "tool_result",
        toolCallId: call.id,
        name: call.name,
        result,
        step: steps,
      });
      await emit({
        type: "after_tool_call",
        call,
        result,
        step: steps,
      });
      messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: result.content,
        isError: result.isError,
      });
    }
  }
}
