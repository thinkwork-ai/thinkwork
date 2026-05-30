// createAgentSession + defineTool — the Pi-shaped public surface.
//
// Mirrors Pi's `Agent`: a stateful session that owns the transcript (`messages`) and
// `tools`, runs the loop on `prompt()`, and emits lifecycle events to `subscribe()`
// listeners. The loop engine (runAgentTurn) and the ModelProvider seam live underneath.
// This is the API the mobile app builds on — small and recognizable, like Pi.

import { runAgentTurn } from "./loop";
import { loadExtensions } from "./extensions/load-extensions";
import type { ExtensionFactory } from "./extensions/types";
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
  /**
   * Pi-style extensions, loaded once before the first prompt. Each contributes tools
   * (additive — built-ins/`tools` are never dropped) and may shape the system prompt via
   * a `before_agent_start` handler. Loading can be async (e.g. an extension that fetches
   * its tool list); `prompt()` awaits readiness, so `createAgentSession` stays synchronous.
   */
  extensions?: ExtensionFactory[];
  /** Display name woven into a `before_agent_start` event for extensions. */
  agentName?: string;
}

export interface AgentSession {
  /** Live transcript, including assistant + tool messages after each prompt. */
  readonly messages: Message[];
  /** Advertised tools. Reflects extension tools after `ready()` (or the first prompt). */
  readonly tools: Tool[];
  /** Composed system prompt. Reflects extension contributions after `ready()`. */
  readonly systemPrompt: string | undefined;
  /** Subscribe to lifecycle events (assistant text, tool calls/results, done, error). */
  subscribe(listener: (event: AgentEvent) => void): () => void;
  /** Run one turn from a user message (with optional images). Resolves when the turn ends. */
  prompt(input: string, images?: ImagePart[]): Promise<AgentRunResult>;
  /**
   * Await extension loading (tools + composed system prompt) without sending a turn.
   * `prompt()` awaits this implicitly; call it directly to pre-warm or to read the
   * post-load `tools`/`systemPrompt`. Resolves immediately when there are no extensions.
   */
  ready(): Promise<void>;
  /** Abort the in-flight turn, if any. */
  abort(): void;
}

export function createAgentSession(config: AgentSessionConfig): AgentSession {
  let messages: Message[] = [...(config.messages ?? [])];
  // Built-ins / directly-passed tools first; extension tools are appended (additive).
  const tools = [...(config.tools ?? [])];
  let systemPrompt = config.systemPrompt;
  const listeners = new Set<(event: AgentEvent) => void>();
  let controller: AbortController | null = null;

  // Extensions load once, lazily, before the first prompt. createAgentSession stays
  // synchronous (Pi's surface is sync) by deferring the async load to a memoized promise
  // that prompt()/ready() await. Loading appends extension tools and composes the system
  // prompt via the before_agent_start event.
  let readyPromise: Promise<void> | null = null;
  const ensureReady = (): Promise<void> => {
    if (readyPromise) return readyPromise;
    const factories = config.extensions ?? [];
    if (factories.length === 0) {
      readyPromise = Promise.resolve();
      return readyPromise;
    }
    readyPromise = (async () => {
      const loaded = await loadExtensions(factories);
      tools.push(...loaded.tools);
      const composed = await loaded.dispatch("before_agent_start", {
        systemPrompt: systemPrompt ?? "",
        agentName: config.agentName,
        toolNames: tools.map((tool) => tool.name),
      });
      systemPrompt = composed.systemPrompt;
    })();
    return readyPromise;
  };

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
    get systemPrompt() {
      return systemPrompt;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ready() {
      return ensureReady();
    },
    abort() {
      controller?.abort();
    },
    async prompt(input, images) {
      // Block the first turn on extension loading (tools + composed system prompt).
      await ensureReady();
      messages = [...messages, { role: "user", content: input, images }];
      controller = new AbortController();
      const result = await runAgentTurn({
        provider: config.modelProvider,
        tools,
        system: systemPrompt,
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
