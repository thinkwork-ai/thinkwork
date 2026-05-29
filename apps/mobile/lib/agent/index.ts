// Lightweight, Pi-inspired mobile agent harness.
//
// A small JSON tool-calling loop behind a swappable ModelProvider seam. Runs in Hermes
// (no Node runtime, no native addons), uses cloud inference today, and is the substrate a
// local on-device model (llama.rn / ExecuTorch / MLC / Apple Foundation Models) drops into
// when phones can run agent-capable models. Tools are mobile-safe capabilities + network
// actions, never shell/filesystem mutation.

export * from "./types";
export { ToolRegistry } from "./tool-registry";
export { runAgentTurn } from "./loop";
export type { RunAgentTurnOptions } from "./loop";
export {
  InMemorySessionStore,
} from "./session-store";
export type { SessionStore, SessionRecord } from "./session-store";
export { MockModelProvider, textResponse, toolResponse } from "./providers/mock";
export type { MockScript } from "./providers/mock";
