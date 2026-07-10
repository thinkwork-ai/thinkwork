import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { createRequestIdentityExtension } from "../src/request-identity.js";

type Handler = (event: any, ctx: any) => unknown;

function makeFakeApi() {
  const handlers = new Map<string, Handler[]>();
  const api = {
    registerTool: () => {},
    on: (event: string, handler: Handler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
  } as unknown as ExtensionAPI;
  return { api, handlers };
}

function register(args: Parameters<typeof createRequestIdentityExtension>[0]) {
  const { api, handlers } = makeFakeApi();
  const extension = createRequestIdentityExtension(args);
  extension.register(api, {});
  return handlers;
}

const CONVERSE_PAYLOAD = {
  modelId: "us.anthropic.claude-sonnet-4-6-v1:0",
  messages: [],
  inferenceConfig: { maxTokens: 100 },
};

describe("request-identity extension", () => {
  it("stamps Bedrock Converse payloads with turn/trace requestMetadata", () => {
    const handlers = register({
      threadTurnId: "turn-1",
      traceId: "trace-9",
      onRequestId: () => {},
    });
    const [handler] = handlers.get("before_provider_request")!;
    const result = handler(
      { type: "before_provider_request", payload: CONVERSE_PAYLOAD },
      {},
    ) as Record<string, unknown>;
    expect(result.requestMetadata).toEqual({
      thread_turn_id: "turn-1",
      trace_id: "trace-9",
    });
    expect(result.modelId).toBe(CONVERSE_PAYLOAD.modelId);
  });

  it("preserves existing requestMetadata entries", () => {
    const handlers = register({
      threadTurnId: "turn-1",
      onRequestId: () => {},
    });
    const [handler] = handlers.get("before_provider_request")!;
    const result = handler(
      {
        type: "before_provider_request",
        payload: { ...CONVERSE_PAYLOAD, requestMetadata: { app: "x" } },
      },
      {},
    ) as Record<string, unknown>;
    expect(result.requestMetadata).toEqual({
      app: "x",
      thread_turn_id: "turn-1",
    });
  });

  it("leaves non-Bedrock payloads untouched", () => {
    const handlers = register({
      threadTurnId: "turn-1",
      onRequestId: () => {},
    });
    const [handler] = handlers.get("before_provider_request")!;
    const openAiPayload = { model: "gpt-x", messages: [] };
    expect(
      handler(
        { type: "before_provider_request", payload: openAiPayload },
        {},
      ),
    ).toBeUndefined();
  });

  it("registers no request hook when no identity values exist", () => {
    const handlers = register({ onRequestId: () => {} });
    expect(handlers.get("before_provider_request")).toBeUndefined();
    expect(handlers.get("after_provider_response")).toHaveLength(1);
  });

  it("collects x-amzn-requestid from provider responses", () => {
    const seen: string[] = [];
    const handlers = register({
      threadTurnId: "turn-1",
      onRequestId: (id) => seen.push(id),
    });
    const [handler] = handlers.get("after_provider_response")!;
    handler(
      {
        type: "after_provider_response",
        status: 200,
        headers: { "x-amzn-requestid": "req-abc" },
      },
      {},
    );
    handler(
      { type: "after_provider_response", status: 200, headers: {} },
      {},
    );
    expect(seen).toEqual(["req-abc"]);
  });
});
