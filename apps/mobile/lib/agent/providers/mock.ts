// Scripted ModelProvider for tests and offline UI development.
//
// Drives the loop deterministically without any network or model. Construct it with either
// a fixed list of responses (consumed in order) or a function of the request. This is the
// stand-in that proves the loop/registry without a live model — the real cloud and local
// providers implement the same ModelProvider interface.

import type { ModelProvider, ModelRequest, ModelResponse } from "../types";

export type MockScript = ModelResponse[] | ((req: ModelRequest, call: number) => ModelResponse);

/** Convenience: a plain text answer with no tool calls. */
export function textResponse(text: string, modelId = "mock"): ModelResponse {
  return {
    text,
    toolCalls: [],
    stopReason: "end",
    usage: { inputTokens: 0, outputTokens: 0 },
    modelId,
  };
}

/** Convenience: an assistant turn that requests one tool. */
export function toolResponse(
  id: string,
  name: string,
  args: Record<string, unknown>,
  text = "",
): ModelResponse {
  return {
    text,
    toolCalls: [{ id, name, arguments: args }],
    stopReason: "tool_use",
    usage: { inputTokens: 0, outputTokens: 0 },
    modelId: "mock",
  };
}

export class MockModelProvider implements ModelProvider {
  readonly id = "mock";
  private callCount = 0;
  /** Requests captured for assertions. */
  readonly requests: ModelRequest[] = [];

  constructor(private readonly script: MockScript) {}

  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const index = this.callCount;
    this.callCount += 1;

    if (typeof this.script === "function") {
      return this.script(request, index);
    }
    const next = this.script[index];
    if (!next) {
      throw new Error(`MockModelProvider: no scripted response for call #${index}`);
    }
    return next;
  }
}
