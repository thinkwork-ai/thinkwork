// createAgentSession + defineTool — the Pi-shaped public surface.
//
// Mirrors Pi's `Agent`: a stateful session that owns the transcript (`messages`) and
// `tools`, runs the loop on `prompt()`, and emits lifecycle events to `subscribe()`
// listeners. The loop engine (runAgentTurn) and the ModelProvider seam live underneath.
// This is the API the mobile app builds on — small and recognizable, like Pi.

import { runAgentTurn } from "./loop";
import { loadExtensions } from "./extensions/load-extensions";
import type { ExtensionFactory } from "./extensions/types";
import type { LoadedExtensions } from "./extensions/load-extensions";
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
  /** Opaque thread/session id passed through to tools for durable per-thread state. */
  sessionId?: string;
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
  /** Queue a follow-up after the current turn, preserving transcript order. */
  followUp(input: string, images?: ImagePart[]): Promise<AgentRunResult>;
  /** Mobile has no separate live steering UI yet; steer is modeled as a queued follow-up. */
  steer(input: string, images?: ImagePart[]): Promise<AgentRunResult>;
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
  let loadedExtensions: LoadedExtensions | null = null;
  let promptTail: Promise<void> = Promise.resolve();

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
      loadedExtensions = await loadExtensions(factories);
      tools.push(...loadedExtensions.tools);
      const composed = await loadedExtensions.dispatch("before_agent_start", {
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

  const dispatchExtensionEvent = async (event: AgentEvent): Promise<void> => {
    const loaded = loadedExtensions;
    if (!loaded) return;
    switch (event.type) {
      case "agent_start":
        await loaded.dispatch("agent_start", {
          agentName: config.agentName,
          toolNames: event.toolNames,
          model: event.model,
        });
        return;
      case "tool_call":
        await loaded.dispatch("tool_call", {
          name: event.call.name,
          arguments: event.call.arguments,
        });
        return;
      case "after_tool_call":
        await loaded.dispatch("after_tool_call", {
          name: event.call.name,
          isError: Boolean(event.result.isError),
        });
        return;
      case "agent_end":
        await loaded.dispatch("agent_end", {
          stopReason: event.stopReason,
          steps: event.steps,
        });
        return;
      default:
        return;
    }
  };

  const publish = async (event: AgentEvent): Promise<void> => {
    emit(event);
    await dispatchExtensionEvent(event);
  };

  const runPrompt = async (
    input: string,
    images?: ImagePart[],
  ): Promise<AgentRunResult> => {
    // Block the first turn on extension loading (tools + composed system prompt).
    await ensureReady();
    messages = [...messages, { role: "user", content: input, images }];
    controller = new AbortController();
    try {
      const result = await runAgentTurn({
        provider: config.modelProvider,
        tools,
        system: systemPrompt,
        model: config.model,
        maxSteps: config.maxSteps,
        sessionId: config.sessionId,
        messages,
        signal: controller.signal,
        onEvent: publish,
      });
      // result.messages includes the user turn plus the assistant + tool messages.
      messages = result.messages;
      return result;
    } finally {
      controller = null;
    }
  };

  const enqueuePrompt = (
    input: string,
    images?: ImagePart[],
  ): Promise<AgentRunResult> => {
    const run = promptTail.then(() => runPrompt(input, images));
    promptTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
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
    prompt(input, images) {
      return enqueuePrompt(input, images);
    },
    followUp(input, images) {
      return enqueuePrompt(input, images);
    },
    steer(input, images) {
      return enqueuePrompt(input, images);
    },
  };
}
