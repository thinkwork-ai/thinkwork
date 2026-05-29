/**
 * Wire contract + Bedrock Converse mapping for the mobile agent harness model proxy.
 *
 * The mobile harness runs its agent loop on the device and calls this proxy once per loop
 * step with the full transcript. The proxy is stateless: map a provider-neutral request to
 * a single Bedrock `ConverseCommand`, run it, map the response back. The wire shapes mirror
 * the harness's own `ModelRequest`/`ModelResponse`/`Message`/`ToolSpec`/`ToolCall` so the
 * device-side `BedrockModelProvider` is a near-identity adapter.
 *
 * Pure functions only — no AWS client, no I/O — so the mapping is unit-testable in isolation.
 * The Converse call + auth live in the handler.
 */

import type {
  ContentBlock,
  ConverseCommandOutput,
  Message as ConverseMessage,
  SystemContentBlock,
  Tool as ConverseTool,
  ToolConfiguration,
} from "@aws-sdk/client-bedrock-runtime";

export type WireRole = "user" | "assistant" | "tool";

export interface WireToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Mirrors the harness `Message`. `content` is a string in v1; image parts arrive in U3. */
export interface WireMessage {
  role: WireRole;
  content: string;
  toolCalls?: WireToolCall[];
  toolCallId?: string;
  name?: string;
  isError?: boolean;
}

export interface WireToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProxyRequest {
  model?: string;
  system?: string;
  messages: WireMessage[];
  tools?: WireToolSpec[];
  maxTokens?: number;
  temperature?: number;
}

export type WireStopReason = "end" | "tool_use" | "max_tokens" | "error";

export interface ProxyResponse {
  text: string;
  toolCalls: WireToolCall[];
  stopReason: WireStopReason;
  usage: { inputTokens: number; outputTokens: number };
  /** The model that actually ran — reported honestly, never silently substituted. */
  modelId: string;
}

/** Thrown when a requested model id is not an allowlisted inference-profile id. */
export class ModelResolutionError extends Error {
  override readonly name = "ModelResolutionError";
}

/**
 * Default + allowlist of Bedrock inference-profile model ids. On-demand `Converse` rejects
 * newer Anthropic models without the `us.`/`eu.`/`apac.` inference-profile prefix
 * (ValidationException), and an unrecognized id otherwise risks a silent Sonnet fallback.
 * Verify these against live Bedrock before relying on them — they drift.
 */
const DEFAULT_ALLOWLIST = [
  "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "us.anthropic.claude-haiku-4-5-20251001-v1:0",
];
const INFERENCE_PROFILE_PREFIX = /^(us|eu|apac)\./;

export function modelAllowlist(): string[] {
  const raw = process.env.MOBILE_BEDROCK_MODEL_ALLOWLIST;
  if (raw) {
    const ids = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length) return ids;
  }
  return DEFAULT_ALLOWLIST;
}

export function defaultModelId(): string {
  return process.env.MOBILE_BEDROCK_DEFAULT_MODEL_ID || modelAllowlist()[0];
}

/**
 * Resolve the model id to run — fail loud, never silently substitute.
 * - missing id → the configured default (this is a default, not a substitution of a
 *   *different requested* model, so it is honest).
 * - present id → must be inference-profile-prefixed AND in the allowlist, else throw.
 */
export function resolveModelId(
  requested: string | undefined,
  allowlist = modelAllowlist(),
): string {
  const id = (requested ?? "").trim();
  if (!id) return defaultModelId();
  if (!INFERENCE_PROFILE_PREFIX.test(id)) {
    throw new ModelResolutionError(
      `Model "${id}" is missing an inference-profile prefix (us./eu./apac.). On-demand Converse rejects it.`,
    );
  }
  if (!allowlist.includes(id)) {
    throw new ModelResolutionError(
      `Model "${id}" is not in the allowlist. Allowed: ${allowlist.join(", ")}`,
    );
  }
  return id;
}

export function mapStopReason(raw: string | undefined): WireStopReason {
  switch (raw) {
    case "end_turn":
    case "stop_sequence":
      return "end";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    default:
      return "error";
  }
}

export function toToolConfig(
  tools: WireToolSpec[] | undefined,
): ToolConfiguration | undefined {
  if (!tools || tools.length === 0) return undefined;
  return {
    tools: tools.map(
      (t) =>
        ({
          toolSpec: {
            name: t.name,
            description: t.description,
            // Bedrock's inputSchema.json is the SDK DocumentType (JSON-shaped); our
            // parameters are an already-valid JSON Schema object.
            inputSchema: { json: t.parameters },
          },
        }) as unknown as ConverseTool,
    ),
  };
}

/**
 * Map harness wire messages to Converse messages.
 *
 * - user (string) → user message with a text block
 * - assistant (text + toolCalls) → assistant message with optional text block + toolUse blocks
 * - tool result → a `toolResult` block carried on a *user* message; Bedrock requires
 *   consecutive tool results to coalesce into a single user message, so runs of tool
 *   messages are merged.
 */
export function toConverseMessages(messages: WireMessage[]): ConverseMessage[] {
  const out: ConverseMessage[] = [];
  let pendingToolResults: ContentBlock[] = [];

  const flushToolResults = (): void => {
    if (pendingToolResults.length) {
      out.push({ role: "user", content: pendingToolResults });
      pendingToolResults = [];
    }
  };

  for (const msg of messages) {
    if (msg.role === "tool") {
      pendingToolResults.push({
        toolResult: {
          toolUseId: msg.toolCallId ?? "",
          content: [{ text: msg.content }],
          status: msg.isError ? "error" : "success",
        },
      } as ContentBlock);
      continue;
    }

    flushToolResults();

    if (msg.role === "user") {
      out.push({
        role: "user",
        content: [{ text: msg.content } as ContentBlock],
      });
      continue;
    }

    // assistant
    const blocks: ContentBlock[] = [];
    if (msg.content) blocks.push({ text: msg.content } as ContentBlock);
    for (const call of msg.toolCalls ?? []) {
      blocks.push({
        toolUse: { toolUseId: call.id, name: call.name, input: call.arguments },
      } as unknown as ContentBlock);
    }
    out.push({ role: "assistant", content: blocks });
  }

  flushToolResults();
  return out;
}

export function toSystem(
  system: string | undefined,
): SystemContentBlock[] | undefined {
  return system ? [{ text: system } as SystemContentBlock] : undefined;
}

/** Parse a Converse response into the provider-neutral wire response (minus modelId). */
export function parseConverseOutput(
  output: ConverseCommandOutput,
): Omit<ProxyResponse, "modelId"> {
  const blocks = output.output?.message?.content ?? [];
  const text = blocks
    .map((b) => (typeof b.text === "string" ? b.text : ""))
    .join("");
  const toolCalls: WireToolCall[] = [];
  for (const b of blocks) {
    if (b.toolUse) {
      toolCalls.push({
        id: b.toolUse.toolUseId ?? "",
        name: b.toolUse.name ?? "",
        arguments: (b.toolUse.input ?? {}) as Record<string, unknown>,
      });
    }
  }
  return {
    text,
    toolCalls,
    stopReason: mapStopReason(output.stopReason),
    usage: {
      inputTokens: output.usage?.inputTokens ?? 0,
      outputTokens: output.usage?.outputTokens ?? 0,
    },
  };
}
