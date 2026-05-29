// A React Native version of Pi.
//
// The primary surface mirrors Pi: `createAgentSession({ model, systemPrompt, tools,
// modelProvider })` → a stateful session with `messages`, `tools`, `prompt()`, and
// `subscribe()`, plus flat `defineTool` tools. Runs in Hermes (no Node runtime, no native
// addons); cloud Bedrock inference today via the ModelProvider seam, with a local on-device
// model (llama.rn / ExecuTorch / MLC / Apple Foundation Models) dropping into the same seam
// when phones can run agent-capable models. Tools are mobile-safe capabilities + network
// actions, never shell/filesystem mutation.

export * from "./types";

// Pi-shaped public surface.
export { createAgentSession, defineTool } from "./session";
export type { AgentSession, AgentSessionConfig } from "./session";

// Lower-level engine (advanced use; createAgentSession wraps it).
export { runAgentTurn } from "./loop";
export type { RunAgentTurnOptions } from "./loop";

// Model providers (the seam).
export {
  MockModelProvider,
  textResponse,
  toolResponse,
} from "./providers/mock";
export type { MockScript } from "./providers/mock";
export { BedrockModelProvider } from "./providers/bedrock";
export type { BedrockModelProviderOptions } from "./providers/bedrock";

// Tools.
export { createMcpTool } from "./tools/mcp-tool";
export type { McpToolDef, McpCall } from "./tools/mcp-tool";

// Image capture (pure mapper; the native expo launcher lives in tools/image-picker).
export { pickImage, mimeToImageFormat } from "./capture-image";
export type { LaunchPicker, PickerResult, PickedAsset } from "./capture-image";

// Turn assembly + session storage.
export { buildTurnContext } from "./turn-context";
export type { TurnContext, TurnContextInput } from "./turn-context";
export { InMemorySessionStore } from "./session-store";
export type { SessionStore, SessionRecord } from "./session-store";
export { recordTurn } from "./persist-turn";
export type {
  RecordTurnInput,
  RecordTurnResult,
  RecordTurnDeps,
} from "./persist-turn";
