// Assembles a harness turn's system prompt and tool set.
//
// v1 is deliberately lightweight: a base identity + mobile-safe-tools system prompt plus
// whatever tools the caller provides. Full platform agent-config / tool-policy parity
// (fetching the agent's configured tools, per-tenant policy narrowing) is deferred —
// `platformConfig` is the seam a later unit fills from the platform. The result feeds
// straight into `createAgentSession({ systemPrompt, tools })`.

import type { Tool } from "./types";

export interface TurnContextInput {
  /** Display name of the active agent, woven into the system prompt. */
  agentName?: string;
  /** Tools to advertise this turn (network/MCP + mobile-native capability tools). */
  tools?: Tool[];
  /** Extra system-prompt guidance appended after the base prompt. */
  extraGuidance?: string;
  /**
   * Seam for a later unit: a platform-provided agent config (system prompt override,
   * configured tool policy). Unused in v1 beyond an optional systemPrompt override.
   */
  platformConfig?: { systemPrompt?: string };
}

export interface TurnContext {
  system: string;
  tools: Tool[];
}

const BASE_SYSTEM = [
  "You are {agentName}, a ThinkWork agent running on the user's mobile device.",
  "Be concise and direct — answers are read on a phone.",
  "You can call the tools provided to you. Tools may include network actions,",
  "connected MCP services, code/shell sandboxes, or mobile-safe device capabilities",
  "(camera, files, calendar, contacts, location, voice). Use those tools when they",
  "help complete the user's request.",
  "Never claim that code ran, a command produced output, a file was read, or an",
  "external system was queried unless that fact came from a tool result in this turn.",
  "When a task needs a capability you do not have a tool for, say so plainly rather",
  "than pretending.",
].join("\n");

export function buildTurnContext(input: TurnContextInput = {}): TurnContext {
  const agentName = input.agentName?.trim() || "your ThinkWork agent";
  const base = (input.platformConfig?.systemPrompt ?? BASE_SYSTEM).replace(
    /\{agentName\}/g,
    agentName,
  );
  const system = input.extraGuidance?.trim()
    ? `${base}\n\n${input.extraGuidance.trim()}`
    : base;
  return { system, tools: input.tools ?? [] };
}
