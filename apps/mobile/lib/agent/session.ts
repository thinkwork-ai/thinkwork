// createAgentSession + defineTool — the Pi-shaped public surface.
//
// Mirrors Pi's `Agent`: a stateful session that owns the transcript (`messages`) and
// `tools`, runs the loop on `prompt()`, and emits lifecycle events to `subscribe()`
// listeners. The loop engine (runAgentTurn) and the ModelProvider seam live underneath.
// This is the API the mobile app builds on — small and recognizable, like Pi.

import { runAgentTurn } from "./loop";
import type {
  AgentEvent,
  AgentRunResult,
  ImagePart,
  Message,
  ModelProvider,
  Tool,
} from "./types";

/** Ergonomic, Pi-style tool constructor. Flat tool object in, same object out. */
export function defineTool(tool: Tool): Tool {
  return tool;
}

export interface AgentSessionConfig {
  /** The model transport — cloud Bedrock today, a local model later, behind one seam. */
  modelProvider: ModelProvider;
  /** Inference-profile model id hint (provider-resolved). */
  model?: string;
  systemPrompt?: string;
  tools?: Tool[];
  /** Seed transcript (prior turns). */
  messages?: Message[];
  maxSteps?: number;
}

export interface AgentSession {
  /** Live transcript, including assistant + tool messages after each prompt. */
  readonly messages: Message[];
  readonly tools: Tool[];
  /** Subscribe to lifecycle events (assistant text, tool calls/results, done, error). */
  subscribe(listener: (event: AgentEvent) => void): () => void;
  /** Run one turn from a user message (with optional images). Resolves when the turn ends. */
  prompt(input: string, images?: ImagePart[]): Promise<AgentRunResult>;
  /** Abort the in-flight turn, if any. */
  abort(): void;
}

export function createAgentSession(config: AgentSessionConfig): AgentSession {
  let messages: Message[] = [...(config.messages ?? [])];
  const tools = [...(config.tools ?? [])];
  const listeners = new Set<(event: AgentEvent) => void>();
  let controller: AbortController | null = null;

  const emit = (event: AgentEvent): void => {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // A listener must never break the turn.
      }
    }
  };

  return {
    get messages() {
      return messages;
    },
    get tools() {
      return tools;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    abort() {
      controller?.abort();
    },
    async prompt(input, images) {
      messages = [...messages, { role: "user", content: input, images }];
      controller = new AbortController();
      const result = await runAgentTurn({
        provider: config.modelProvider,
        tools,
        system: config.systemPrompt,
        model: config.model,
        maxSteps: config.maxSteps,
        messages,
        signal: controller.signal,
        onEvent: emit,
      });
      // result.messages includes the user turn plus the assistant + tool messages.
      messages = result.messages;
      return result;
    },
  };
}
