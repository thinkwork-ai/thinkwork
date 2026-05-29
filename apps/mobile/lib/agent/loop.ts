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
  signal?: AbortSignal;
  /** Observability / UI streaming hook. Thrown errors here are ignored. */
  onEvent?: (event: AgentEvent) => void;
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
    signal,
    onEvent,
  } = options;

  const emit = (event: AgentEvent): void => {
    if (!onEvent) return;
    try {
      onEvent(event);
    } catch {
      // Observability must never break the turn.
    }
  };

  const messages: Message[] = [...options.messages];
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const toolSpecs = tools.map(toToolSpec);
  let finalText = "";
  let steps = 0;

  while (true) {
    if (signal?.aborted) {
      emit({ type: "done", stopReason: "aborted", steps });
      return { messages, finalText, steps, stopReason: "aborted", usage };
    }

    if (steps >= maxSteps) {
      emit({ type: "done", stopReason: "max_steps", steps });
      return { messages, finalText, steps, stopReason: "max_steps", usage };
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
      emit({ type: "error", error: message });
      emit({ type: "done", stopReason: "error", steps });
      return { messages, finalText, steps, stopReason: "error", usage };
    }

    steps += 1;
    addUsage(usage, response.usage);

    if (response.stopReason === "error") {
      emit({
        type: "error",
        error: response.text || "model returned error stop reason",
      });
      emit({ type: "done", stopReason: "error", steps });
      return { messages, finalText, steps, stopReason: "error", usage };
    }

    if (response.text) {
      finalText = response.text;
      emit({ type: "assistant_text", text: response.text, step: steps });
    }

    messages.push({
      role: "assistant",
      content: response.text,
      toolCalls: response.toolCalls.length ? response.toolCalls : undefined,
    });

    if (response.toolCalls.length === 0) {
      emit({ type: "done", stopReason: "completed", steps });
      return { messages, finalText, steps, stopReason: "completed", usage };
    }

    for (const call of response.toolCalls) {
      emit({ type: "tool_call", call, step: steps });
      const result = await executeTool(tools, call.name, call.arguments, {
        signal,
        sessionId: undefined,
      });
      emit({
        type: "tool_result",
        toolCallId: call.id,
        name: call.name,
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
