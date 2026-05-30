// Pi-style extension surface for the mobile harness (Hermes-pure).
//
// Mirrors the real Pi `ExtensionAPI` (@earendil-works/pi-coding-agent
// dist/core/extensions/types.d.ts): an event bus (`on(event, handler) => off`) plus
// `registerTool(tool) => off` and a `logger`. We own these types rather than importing
// Pi's — Pi's package is Node/native and can't run in Hermes — but keep the SHAPE and
// the event NAMES identical so authoring an extension feels the same on cloud and mobile.
//
// Deliberately dropped vs Pi (host-specific, meaningless on a phone): registerCommand
// (CLI slash commands), registerShortcut/keybindings, ui, exec, session-tree actions.
//
// Capabilities are authored with `defineExtension` (define-extension.ts) and loaded by
// `createAgentSession({ extensions })` (session.ts via load-extensions.ts). The event bus
// is a small typed Map<event, handler[]> — NOT a config/policy engine; keeping it tiny is
// the guardrail against drifting away from Pi's simplicity.

import type { Tool } from "../types";

/** Minimal logger handed to extensions. Maps onto console in v1. */
export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

// ── Lifecycle events (Pi-named) ──────────────────────────────────────────────
// v1 dispatches `before_agent_start` (system-prompt composition) from the session.
// The remaining events are part of the typed surface and the bus dispatches to any
// registered handler, but the loop does not yet emit them — they gain loop wiring as
// real consumers arrive (a tool-activity hook is the obvious next one).

/** Fires once before the first model call so extensions can shape the system prompt. */
export interface BeforeAgentStartEvent {
  /** The system prompt composed so far (base identity + prior extensions' fragments). */
  systemPrompt: string;
  /** The active agent's display name, when known. */
  agentName?: string;
}

/** A `before_agent_start` handler returns a replacement system prompt (or nothing). */
export interface BeforeAgentStartResult {
  systemPrompt?: string;
}

/** Fires when the agent turn starts. */
export interface AgentStartEvent {
  agentName?: string;
}

/** Fires when the agent turn ends. */
export interface AgentEndEvent {
  stopReason: string;
  steps: number;
}

/** Fires when the model requests a tool call. */
export interface ToolCallEvent {
  name: string;
  arguments: Record<string, unknown>;
}

/** Fires after a tool call resolves. */
export interface AfterToolCallEvent {
  name: string;
  isError: boolean;
}

/**
 * The typed event map: each event name maps to its handler payload and the result a
 * handler may return. `void`-result events are fire-and-forget; `before_agent_start`
 * threads its result back into the payload for the next handler (see load-extensions).
 */
export interface ExtensionEvents {
  before_agent_start: {
    payload: BeforeAgentStartEvent;
    result: BeforeAgentStartResult;
  };
  agent_start: { payload: AgentStartEvent; result: void };
  agent_end: { payload: AgentEndEvent; result: void };
  tool_call: { payload: ToolCallEvent; result: void };
  after_tool_call: { payload: AfterToolCallEvent; result: void };
}

export type ExtensionEventName = keyof ExtensionEvents;

/** An event handler — may be sync or async; may return its event's result or nothing. */
export type ExtensionHandler<E extends ExtensionEventName> = (
  event: ExtensionEvents[E]["payload"],
) =>
  | ExtensionEvents[E]["result"]
  | void
  | Promise<ExtensionEvents[E]["result"] | void>;

/**
 * The live API handed to an extension's `register`. Mirrors Pi's `ExtensionAPI`
 * portable subset. `registerTool` and `on` both return an unregister fn, like Pi.
 */
export interface ExtensionAPI {
  /** Register a tool the model can call. Returns a fn that unregisters it. */
  registerTool(tool: Tool): () => void;
  /** Subscribe to a lifecycle event. Returns a fn that removes the handler. */
  on<E extends ExtensionEventName>(
    type: E,
    handler: ExtensionHandler<E>,
  ): () => void;
  readonly logger: Logger;
}

/**
 * A capability authored as an extension. `register(pi)` receives the live ExtensionAPI
 * and wires up tools + event handlers. Mirrors `@thinkwork/pi-extensions`'s
 * `defineExtension({ name, register(pi, providers) })`, minus the provider bundle —
 * mobile v1 has no host provider seam yet (deferred).
 */
export interface Extension {
  /** Authoring-time identifier (kebab-case). Surfaced in validation/log messages. */
  name: string;
  description?: string;
  register(pi: ExtensionAPI): void | Promise<void>;
}

/** A validated extension ready to load. (Branding hook for future divergence from Extension.) */
export type ExtensionFactory = Extension;
