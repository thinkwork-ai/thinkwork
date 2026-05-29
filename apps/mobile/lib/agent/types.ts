// A React Native version of Pi — core types.
//
// This deliberately mirrors Pi's shape (a stateful agent session with `messages`/`tools`,
// `prompt()`, and `subscribe()`, plus flat `defineTool` tools) rather than inventing a new
// harness — Pi's appeal is its simplicity, and we keep that. It is NOT the Pi runtime
// itself: the @earendil-works framework needs Node >=22.19 + native addons that don't run
// on iOS (docs/solutions/spikes/2026-05-29-mobile-embedded-node-pi-spike.md), so this is a
// faithful Hermes-native re-implementation of the same small loop behind a swappable
// ModelProvider seam. Cloud Bedrock today; a local provider (llama.rn / ExecuTorch / MLC /
// Apple Foundation Models) drops in behind the same seam when phones can run agent models.

export type Role = "user" | "assistant" | "tool";

/** A single structured tool-call request emitted by the model. */
export interface ToolCall {
  /** Provider-assigned id, echoed back on the matching tool result. */
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ImageFormat = "png" | "jpeg" | "gif" | "webp";

/** An image on a user message — the substrate for capture tools (e.g. business cards). */
export interface ImagePart {
  format: ImageFormat;
  /** Base64-encoded image bytes. */
  data: string;
}

/** One message in the running transcript. */
export interface Message {
  role: Role;
  /** Natural-language content. Empty string is valid (e.g. an assistant turn that is purely tool calls). */
  content: string;
  /** Optional images on a user message. Additive — text-only messages omit it. */
  images?: ImagePart[];
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

/**
 * An executable tool — flat, like Pi's `AgentTool`: the model-facing fields
 * (name/description/parameters) sit directly on the tool alongside `execute`.
 * Create with `defineTool`.
 */
export interface Tool {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

/** The model-facing projection of a tool (name/description/parameters, no executor). */
export function toToolSpec(tool: Tool): ToolSpec {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

/** Streaming/observability events emitted across a turn. */
export type AgentEvent =
  | { type: "assistant_text"; text: string; step: number }
  | { type: "tool_call"; call: ToolCall; step: number }
  | {
      type: "tool_result";
      toolCallId: string;
      name: string;
      result: ToolResult;
      step: number;
    }
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
