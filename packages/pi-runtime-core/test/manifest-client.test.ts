/**
 * Capability manifest sink tests (capability-mapping plan U12).
 */

import { describe, expect, it, vi } from "vitest";
import {
  postCapabilityManifest,
  readCapabilityManifestSinkConfig,
} from "../src/manifest-client.js";

const BASE_PAYLOAD = {
  thinkwork_api_url: "https://api.example.test/",
  thinkwork_api_secret: "secret-1",
  tenant_id: "tenant-1",
  assistant_id: "agent-1",
  user_id: "user-1",
  thread_id: "thread-1",
  thread_turn_id: "turn-1",
  turn_context: { spaceId: "space-1" },
  config_fingerprint: "fp-abc",
};

describe("readCapabilityManifestSinkConfig", () => {
  it("reads the sink wiring off the payload (KTD-6 gate)", () => {
    const config = readCapabilityManifestSinkConfig(BASE_PAYLOAD);
    expect(config).toMatchObject({
      apiUrl: "https://api.example.test",
      secret: "secret-1",
      tenantId: "tenant-1",
      agentId: "agent-1",
      userId: "user-1",
      threadId: "thread-1",
      threadTurnId: "turn-1",
      spaceId: "space-1",
      configFingerprint: "fp-abc",
      sessionId: "turn-1",
    });
  });

  it("gates on api url + secret + tenant — NOT the finalize callback (wakeup parity)", () => {
    // A wakeup-style payload has no finalize_callback_url; the sink must
    // still resolve because it only needs the API wiring.
    const wakeupStyle = { ...BASE_PAYLOAD, session_key: "wakeup-cron" };
    expect(readCapabilityManifestSinkConfig(wakeupStyle)?.sessionId).toBe(
      "wakeup-cron",
    );

    expect(
      readCapabilityManifestSinkConfig({
        ...BASE_PAYLOAD,
        thinkwork_api_secret: "",
      }),
    ).toBeNull();
    expect(
      readCapabilityManifestSinkConfig({
        ...BASE_PAYLOAD,
        thinkwork_api_url: undefined,
      }),
    ).toBeNull();
    expect(
      readCapabilityManifestSinkConfig({
        ...BASE_PAYLOAD,
        tenant_id: undefined,
      }),
    ).toBeNull();
  });
});

describe("postCapabilityManifest", () => {
  const manifestJson = {
    schema_version: 2,
    resolved: { skills: ["a"] },
    loaded: { skills: ["a"] },
  };

  it("POSTs the manifest with bearer auth and the U11 body shape", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 201 }));
    const ok = await postCapabilityManifest({
      config: readCapabilityManifestSinkConfig(BASE_PAYLOAD)!,
      manifestJson,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.example.test/api/runtime/manifests");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer secret-1",
    );
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      session_id: "turn-1",
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      thread_turn_id: "turn-1",
      space_id: "space-1",
      config_fingerprint: "fp-abc",
      manifest_json: manifestJson,
    });
  });

  it("never throws: non-2xx and network failures return false", async () => {
    const non2xx = vi.fn(async () => new Response("no", { status: 500 }));
    expect(
      await postCapabilityManifest({
        config: readCapabilityManifestSinkConfig(BASE_PAYLOAD)!,
        manifestJson,
        fetchImpl: non2xx as unknown as typeof fetch,
      }),
    ).toBe(false);

    const network = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(
      await postCapabilityManifest({
        config: readCapabilityManifestSinkConfig(BASE_PAYLOAD)!,
        manifestJson,
        fetchImpl: network as unknown as typeof fetch,
      }),
    ).toBe(false);
  });
});
