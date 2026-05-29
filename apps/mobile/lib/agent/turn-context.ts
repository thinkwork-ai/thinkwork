// Assembles a harness turn's system prompt and tool set.
//
// v1 is deliberately lightweight: a base identity + mobile-safe-tools system prompt plus
// whatever tools the caller registers for the turn. Full platform agent-config / tool-
// policy parity (fetching the agent's configured tools, per-tenant policy narrowing) is
// deferred — `platformConfig` is the seam a later unit fills from the platform.

import { ToolRegistry } from "./tool-registry";
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
  registry: ToolRegistry;
}

const BASE_SYSTEM = [
  "You are {agentName}, a ThinkWork agent running on the user's mobile device.",
  "Be concise and direct — answers are read on a phone.",
  "You can call the tools provided to you. Tools are network actions and mobile-safe",
  "device capabilities (camera, files, calendar, contacts, location, voice); you have no",
  "shell, no arbitrary filesystem access, and no ability to run code. When a task needs",
  "a capability you don't have a tool for, say so plainly rather than pretending.",
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
  return { system, registry: new ToolRegistry(input.tools ?? []) };
}
