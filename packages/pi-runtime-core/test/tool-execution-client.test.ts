/**
 * tool-execution-client tests (THINK-324 Wave-3 C17): config parsing off the
 * invoke payload, URL derivation + same-origin guard, started/terminal POST
 * shapes, never-throws contract, drain.
 */

import { describe, expect, it, vi } from "vitest";
import {
  createToolExecutionEmitter,
  readToolExecutionCallbackConfig,
} from "../src/tool-execution-client.js";

const PAYLOAD = {
  turn_assertion: "twta1.payload.sig",
  activity_callback_secret: "s3cret",
  thread_turn_id: "turn-1",
  tenant_id: "tenant-1",
  thread_id: "thread-1",
  thinkwork_api_url: "https://api.example.com",
  user_id: "user-1",
};

describe("readToolExecutionCallbackConfig", () => {
  it("derives the endpoint from thinkwork_api_url and maps the principal", () => {
    const config = readToolExecutionCallbackConfig(PAYLOAD);
    expect(config).toMatchObject({
      url: "https://api.example.com/api/runtime/tool-executions",
      secret: "s3cret",
      threadTurnId: "turn-1",
      principalType: "user",
      principalId: "user-1",
    });
  });

  it("falls back to a service principal without user_id", () => {
    const { user_id: _drop, ...rest } = PAYLOAD;
    expect(readToolExecutionCallbackConfig(rest)).toMatchObject({
      principalType: "service",
      principalId: "pi-runtime",
    });
  });

  it("returns null when any required field is missing", () => {
    for (const key of [
      "activity_callback_secret",
      "thread_turn_id",
      "tenant_id",
      "thread_id",
      "thinkwork_api_url",
    ]) {
      const partial: Record<string, unknown> = { ...PAYLOAD };
      delete partial[key];
      expect(readToolExecutionCallbackConfig(partial)).toBeNull();
    }
  });
});

describe("createToolExecutionEmitter", () => {
  it("POSTs started and terminal events with the paired idempotency key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}"));
    const emitter = createToolExecutionEmitter(
      readToolExecutionCallbackConfig(PAYLOAD),
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    emitter.emit({
      eventType: "started",
      toolUseId: "toolu_1",
      operation: "web_search",
      inputPreview: { preview: "q" },
    });
    emitter.emit({
      eventType: "completed",
      toolUseId: "toolu_1",
      operation: "web_search",
      outputPreview: { preview: "ok" },
      durationMs: 42,
      providerCostUsd: 0.01,
    });
    await emitter.drain();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const started = JSON.parse(fetchImpl.mock.calls[0]![1].body as string);
    expect(started.turn_id).toBe("turn-1");
    expect(started.events[0]).toMatchObject({
      event_type: "started",
      idempotency_key: "pi:turn-1:toolu_1",
      input_preview: { preview: "q" },
    });
    const terminal = JSON.parse(fetchImpl.mock.calls[1]![1].body as string);
    expect(terminal.events[0]).toMatchObject({
      event_type: "completed",
      idempotency_key: "pi:turn-1:toolu_1",
      output_preview: { preview: "ok" },
      duration_ms: 42,
      provider_cost_usd: 0.01,
    });
    expect(terminal.events[0].input_preview).toBeUndefined();
    const headers = fetchImpl.mock.calls[0]![1].headers as Record<
      string,
      string
    >;
    expect(headers.authorization).toBe("Bearer s3cret");
    expect(headers["x-thinkwork-turn-assertion"]).toBe("twta1.payload.sig");
  });

  it("omits the assertion header when dispatch minted none", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}"));
    const { turn_assertion: _drop, ...rest } = PAYLOAD;
    const emitter = createToolExecutionEmitter(
      readToolExecutionCallbackConfig(rest),
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    emitter.emit({ eventType: "started", toolUseId: "t", operation: "op" });
    await emitter.drain();
    const headers = fetchImpl.mock.calls[0]![1].headers as Record<
      string,
      string
    >;
    expect(headers["x-thinkwork-turn-assertion"]).toBeUndefined();
  });

  it("is a no-op for null config or a cross-origin URL", () => {
    const fetchImpl = vi.fn();
    createToolExecutionEmitter(null, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).emit({
      eventType: "started",
      toolUseId: "t",
      operation: "op",
    });
    const crossOrigin = readToolExecutionCallbackConfig(PAYLOAD)!;
    createToolExecutionEmitter(
      { ...crossOrigin, url: "https://evil.example.net/api/runtime/tool-executions" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    ).emit({ eventType: "started", toolUseId: "t", operation: "op" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("serializes a terminal POST behind its own started POST", async () => {
    let resolveStarted: (r: Response) => void = () => {};
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => (resolveStarted = resolve)),
      )
      .mockResolvedValue(new Response("{}"));
    const emitter = createToolExecutionEmitter(
      readToolExecutionCallbackConfig(PAYLOAD),
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    emitter.emit({
      eventType: "started",
      toolUseId: "toolu_fast",
      operation: "read",
    });
    emitter.emit({
      eventType: "completed",
      toolUseId: "toolu_fast",
      operation: "read",
      durationMs: 8,
    });
    await Promise.resolve();
    // started POST still pending → terminal must not have fired yet.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    resolveStarted(new Response("{}"));
    await emitter.drain();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const second = JSON.parse(fetchImpl.mock.calls[1]![1].body as string);
    expect(second.events[0].event_type).toBe("completed");
  });

  it("swallows fetch failures (never throws into the turn)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("boom"));
    const logger = vi.fn();
    const emitter = createToolExecutionEmitter(
      readToolExecutionCallbackConfig(PAYLOAD),
      { fetchImpl: fetchImpl as unknown as typeof fetch, logger },
    );
    expect(() =>
      emitter.emit({ eventType: "started", toolUseId: "t", operation: "op" }),
    ).not.toThrow();
    await emitter.drain();
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({ event: "tool_execution_callback_failed" }),
    );
  });
});
