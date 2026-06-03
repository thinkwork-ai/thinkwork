import { describe, it, expect, vi } from "vitest";
import {
  createActivityEmitter,
  readActivityCallbackConfig,
  type ActivityCallbackConfig,
} from "../src/activity-client.js";

const TURN_ID = "44444444-4444-4444-4444-444444444444";
const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const THREAD_ID = "33333333-3333-3333-3333-333333333333";

function config(
  overrides: Partial<ActivityCallbackConfig> = {},
): ActivityCallbackConfig {
  return {
    url: "https://api.thinkwork.ai/api/threads/" + THREAD_ID + "/activity",
    secret: "secret-xyz",
    threadTurnId: TURN_ID,
    tenantId: TENANT_ID,
    threadId: THREAD_ID,
    agentId: "22222222-2222-2222-2222-222222222222",
    apiUrl: "https://api.thinkwork.ai",
    ...overrides,
  };
}

function okFetch() {
  return vi.fn(async () => new Response("{}", { status: 200 }));
}

describe("readActivityCallbackConfig", () => {
  it("returns config when all fields present", () => {
    const cfg = readActivityCallbackConfig({
      activity_callback_url: "https://api.thinkwork.ai/x",
      activity_callback_secret: "s",
      thread_turn_id: TURN_ID,
      tenant_id: TENANT_ID,
      thread_id: THREAD_ID,
      agent_id: "a1",
      thinkwork_api_url: "https://api.thinkwork.ai",
    });
    expect(cfg).toMatchObject({
      url: "https://api.thinkwork.ai/x",
      secret: "s",
    });
  });

  it("returns null when the host did not opt in (no url/secret/turn)", () => {
    expect(
      readActivityCallbackConfig({
        tenant_id: TENANT_ID,
        thread_id: THREAD_ID,
      }),
    ).toBeNull();
  });
});

describe("createActivityEmitter", () => {
  it("POSTs the activity payload with bearer auth and step shape", async () => {
    const fetchImpl = okFetch();
    const emitter = createActivityEmitter(config(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    emitter.emit({
      eventType: "tool_invocation_started",
      message: "web_search",
      stream: "step",
      payload: { tool_name: "web_search" },
    });
    await emitter.drain();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/activity");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer secret-xyz",
    );
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      thread_turn_id: TURN_ID,
      tenant_id: TENANT_ID,
      thread_id: THREAD_ID,
    });
    expect(body.events[0]).toMatchObject({
      event_type: "tool_invocation_started",
      stream: "step",
      message: "web_search",
    });
  });

  it("is best-effort — a fetch rejection never throws from emit/drain (D1)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const emitter = createActivityEmitter(config(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(() => emitter.emit({ eventType: "x", message: "x" })).not.toThrow();
    await expect(emitter.drain()).resolves.toBeUndefined();
  });

  it("drain awaits in-flight POSTs", async () => {
    let resolveFetch: (() => void) | undefined;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = () => resolve(new Response("{}", { status: 200 }));
        }),
    );
    const emitter = createActivityEmitter(config(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    emitter.emit({ eventType: "x", message: "x" });
    let drained = false;
    const drainP = emitter.drain().then(() => {
      drained = true;
    });
    expect(drained).toBe(false);
    resolveFetch?.();
    await drainP;
    expect(drained).toBe(true);
  });

  it("no-ops when config is null", async () => {
    const fetchImpl = okFetch();
    const emitter = createActivityEmitter(null, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    emitter.emit({ eventType: "x", message: "x" });
    await emitter.drain();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("no-ops when the callback URL fails the same-origin/https guard", async () => {
    const fetchImpl = okFetch();
    // http (non-localhost) is rejected by the allowlist.
    const emitter = createActivityEmitter(
      config({ url: "http://evil.example/activity", apiUrl: "https://api.x" }),
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    emitter.emit({ eventType: "x", message: "x" });
    await emitter.drain();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin callback URL", async () => {
    const fetchImpl = okFetch();
    const emitter = createActivityEmitter(
      config({
        url: "https://other.example/activity",
        apiUrl: "https://api.thinkwork.ai",
      }),
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    emitter.emit({ eventType: "x", message: "x" });
    await emitter.drain();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
