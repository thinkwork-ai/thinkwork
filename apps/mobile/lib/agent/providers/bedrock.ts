// Cloud AWS Bedrock model provider for the mobile harness.
//
// Implements the `ModelProvider` seam by POSTing each loop step to the platform's
// /api/model/converse proxy with the user's Cognito idToken — no AWS credentials live on
// the device. The wire shape is a near-identity serialization of the harness request, and
// the proxy's response maps straight onto `ModelResponse` (including the honest `modelId`).
// Model resolution / fail-loud behavior is authoritative server-side; this provider only
// surfaces the proxy's errors so the loop reports a clean `error` stop reason.

import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  StopReason,
  ToolCall,
} from "../types";

const DEFAULT_API_BASE = (process.env.EXPO_PUBLIC_GRAPHQL_URL ?? "").replace(
  /\/graphql$/,
  "",
);

export interface BedrockModelProviderOptions {
  /** Override the platform base URL (defaults to EXPO_PUBLIC_GRAPHQL_URL minus /graphql). */
  apiBase?: string;
  /**
   * Resolve the caller's Cognito idToken. Injected by the chat hook in production
   * (`getIdToken` from lib/auth); kept injectable so tests never load the Expo auth module.
   * Defaults to a lazy import of lib/auth so the provider is usable standalone.
   */
  getToken?: () => Promise<string | null>;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function argsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function textOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeToolCall(value: unknown, index: number): ToolCall | null {
  const outer = record(value);
  if (!outer) return null;

  const raw = record(outer.toolUse) ?? outer;
  const name = textOrEmpty(raw.name ?? raw.toolName ?? raw.tool_name);
  if (!name) return null;

  return {
    id: textOrEmpty(raw.id ?? raw.toolUseId ?? raw.tool_use_id) || `tool-${index + 1}`,
    name,
    arguments: argsRecord(raw.arguments ?? raw.input ?? raw.args ?? raw.params),
  };
}

function normalizeToolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((call, index) => normalizeToolCall(call, index))
    .filter((call): call is ToolCall => Boolean(call));
}

function normalizeStopReason(value: unknown): StopReason {
  switch (value) {
    case "end":
    case "tool_use":
    case "max_tokens":
    case "error":
      return value;
    case "stop":
    case "completed":
      return "end";
    default:
      return "error";
  }
}

export class BedrockModelProvider implements ModelProvider {
  readonly id = "bedrock-converse";
  private readonly apiBase: string;
  private readonly getToken: () => Promise<string | null>;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: BedrockModelProviderOptions = {}) {
    this.apiBase = opts.apiBase ?? DEFAULT_API_BASE;
    this.getToken =
      opts.getToken ?? (async () => (await import("../../auth")).getIdToken());
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async generate(
    request: ModelRequest,
    signal?: AbortSignal,
  ): Promise<ModelResponse> {
    const token = await this.getToken();
    if (!token) throw new Error("Not authenticated");

    const res = await this.fetchImpl(`${this.apiBase}/api/model/converse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: request.model,
        system: request.system,
        messages: request.messages,
        tools: request.tools,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
      }),
      signal,
    });

    const data = (await res.json().catch(() => ({}))) as {
      text?: string;
      toolCalls?: unknown;
      stopReason?: unknown;
      usage?: ModelResponse["usage"];
      modelId?: string;
      error?: string;
    };

    if (!res.ok) {
      throw new Error(
        `model proxy ${res.status}: ${data.error ?? "request failed"}`,
      );
    }

    return {
      text: data.text ?? "",
      toolCalls: normalizeToolCalls(data.toolCalls),
      stopReason: normalizeStopReason(data.stopReason),
      usage: data.usage,
      modelId: data.modelId,
    };
  }
}
