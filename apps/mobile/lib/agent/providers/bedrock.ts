// Cloud AWS Bedrock model provider for the mobile harness.
//
// Implements the `ModelProvider` seam by POSTing each loop step to the platform's
// /api/model/converse proxy with the user's Cognito idToken — no AWS credentials live on
// the device. The wire shape is a near-identity serialization of the harness request, and
// the proxy's response maps straight onto `ModelResponse` (including the honest `modelId`).
// Model resolution / fail-loud behavior is authoritative server-side; this provider only
// surfaces the proxy's errors so the loop reports a clean `error` stop reason.

import type { ModelProvider, ModelRequest, ModelResponse } from "../types";

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
      toolCalls?: ModelResponse["toolCalls"];
      stopReason?: ModelResponse["stopReason"];
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
      toolCalls: data.toolCalls ?? [],
      stopReason: data.stopReason ?? "error",
      usage: data.usage,
      modelId: data.modelId,
    };
  }
}
