// Lightweight, Pi-inspired mobile agent harness — core types.
//
// This is NOT the Pi runtime (the @earendil-works framework requires Node >=22.19 and
// ships native addons, neither of which runs on iOS — see
// docs/solutions/spikes/2026-05-29-mobile-embedded-node-pi-spike.md). It is a small,
// bespoke harness that borrows Pi's shape: a JSON tool-calling loop behind a swappable
// ModelProvider seam. Today the provider calls a cloud model; when on-device LLMs become
// agent-capable, a local provider (llama.rn / ExecuTorch / MLC / Apple Foundation Models)
// drops in behind the same interface with no change to the loop or tools.

export type Role = "user" | "assistant" | "tool";

/** A single structured tool-call request emitted by the model. */
export interface ToolCall {
  /** Provider-assigned id, echoed back on the matching tool result. */
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** One message in the running transcript. */
export interface Message {
  role: Role;
  /** Natural-language content. Empty string is valid (e.g. an assistant turn that is purely tool calls). */
  content: string;
  /** Present on assistant messages that requested tools. */
  toolCalls?: ToolCall[];
  /** Present on tool messages: the id of the ToolCall this result answers. */
  toolCallId?: string;
  /** Present on tool messages: the tool name (for readability / model grounding). */
  name?: string;
  /** Present on tool messages: whether the tool failed (the model can recover). */
  isError?: boolean;
}

/** JSON-schema-ish parameter description sent to the model. Kept structurally loose on purpose. */
export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema | Record<string, unknown>>;
  items?: JsonSchema | Record<string, unknown>;
  required?: string[];
  description?: string;
  enum?: unknown[];
  [key: string]: unknown;
}

/** The model-facing description of a tool. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export type StopReason = "end" | "tool_use" | "max_tokens" | "error";

/** What a ModelProvider is asked to produce one assistant turn from. */
export interface ModelRequest {
  system?: string;
  messages: Message[];
  tools: ToolSpec[];
  /** Optional model id hint for providers that route across models. */
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/** One assistant turn returned by a ModelProvider. */
export interface ModelResponse {
  /** Assistant natural-language text for this turn (may be empty when only tools were requested). */
  text: string;
  /** Structured tool-call requests; empty when the model answered directly. */
  toolCalls: ToolCall[];
  stopReason: StopReason;
  usage?: Usage;
  /** The model that actually ran — reported honestly, never silently substituted. */
  modelId?: string;
}

/**
 * The swap point for cloud-now / local-later inference. The loop depends only on this
 * interface, never on a concrete Bedrock / llama.rn / Apple FM client.
 */
export interface ModelProvider {
  /** Stable identifier, e.g. "bedrock-converse", "llama-rn", "apple-fm", "mock". */
  readonly id: string;
  generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse>;
}

/** Raw result a tool handler returns. */
export interface ToolResult {
  content: string;
  isError?: boolean;
}

/** Context handed to every tool handler. */
export interface ToolContext {
  signal?: AbortSignal;
  /** Opaque id of the session/thread this turn belongs to, when known. */
  sessionId?: string;
}

/** A registered, executable tool. */
export interface Tool {
  spec: ToolSpec;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

/** Streaming/observability events emitted across a turn. */
export type AgentEvent =
  | { type: "assistant_text"; text: string; step: number }
  | { type: "tool_call"; call: ToolCall; step: number }
  | { type: "tool_result"; toolCallId: string; name: string; result: ToolResult; step: number }
  | { type: "done"; stopReason: AgentStopReason; steps: number }
  | { type: "error"; error: string };

export type AgentStopReason = "completed" | "max_steps" | "aborted" | "error";

/** The outcome of a single agent turn (which may span several model<->tool steps). */
export interface AgentRunResult {
  /** The full transcript including the seed messages, assistant turns, and tool results. */
  messages: Message[];
  /** The last assistant natural-language text produced. */
  finalText: string;
  /** Number of model calls made. */
  steps: number;
  stopReason: AgentStopReason;
  usage: Usage;
}
