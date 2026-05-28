import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DESKTOP_PI_SDK_EMBEDDING_CONTRACT,
  type PreparedDesktopPiRuntimeSession,
} from "@thinkwork/pi-runtime-core";
import {
  runLocalDesktopTurn,
  validatePreparedSession,
  type PiSdkModuleLike,
} from "../../src/sidecar/local-turn-runner";
import type { WorkspaceObjectStore } from "../../src/sidecar/workspace-cache";

const BASE_INVOCATION = {
  pi_sdk: DESKTOP_PI_SDK_EMBEDDING_CONTRACT,
  tenant_id: "tenant-1",
  workspace_tenant_id: "tenant-1",
  assistant_id: "agent-1",
  thread_id: "thread-1",
  user_id: "user-1",
  current_user_email: "eric@example.com",
  trace_id: "trace-1",
  message: "Summarize the workspace",
  messages_history: [{ role: "user" as const, content: "Earlier" }],
  runtime_type: "pi",
  runtime_host: "desktop-local" as const,
  model: "anthropic.claude-sonnet-4-5-20250929-v1:0",
  trigger_channel: "desktop" as const,
  finalize_callback_secret: "dps_secret",
  thread_turn_id: "turn-1",
  tenant_slug: "acme",
  instance_id: "marco",
  workspace_bucket: "workspace-bucket",
  rendered_workspace_prefix: "tenants/acme/rendered/marco/sales/user-1/",
  thinkwork_api_url: "https://api.test",
  finalize_callback_url: "https://api.test/api/threads/thread-1/finalize",
};

class FakeStore implements WorkspaceObjectStore {
  listed = false;
  fetched: string[] = [];

  async listObjects(): Promise<Array<{ key: string }>> {
    this.listed = true;
    return [
      {
        key: "tenants/acme/rendered/marco/sales/user-1/AGENTS.md",
      },
    ];
  }

  async getObjectBytes(input: { key: string }): Promise<Uint8Array> {
    this.fetched.push(input.key);
    return new TextEncoder().encode("# Agent");
  }
}

function createPrepared(
  override: Partial<PreparedDesktopPiRuntimeSession> = {},
): PreparedDesktopPiRuntimeSession {
  return {
    threadTurnId: "turn-1",
    expiresAt: "2026-05-28T13:00:00.000Z",
    finalizeCallbackUrl: "https://api.test/api/threads/thread-1/finalize",
    finalizeCallbackSecret: "dps_secret",
    sidecarCredentials: {
      mode: "desktop-sidecar-session",
      expiresAt: "2026-05-28T13:00:00.000Z",
      workspace: {
        bucket: "workspace-bucket",
        renderedPrefix: "tenants/acme/rendered/marco/sales/user-1/",
      },
      aws: {
        mode: "server-brokered",
        accessKeyId: null,
        secretAccessKey: null,
        sessionToken: null,
      },
      hindsight: { endpoint: null },
      finalizer: {
        authScheme: "bearer",
        tokenType: "desktop-finalize-token",
        expiresAt: "2026-05-28T13:00:00.000Z",
      },
    },
    invocation: BASE_INVOCATION,
    ...override,
  };
}

describe("runLocalDesktopTurn", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "thinkwork-local-turn-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("runs a prepared desktop turn through the Pi SDK and finalizes success", async () => {
    const store = new FakeStore();
    let promptText = "";
    const sdk: PiSdkModuleLike = {
      createAgentSession: vi.fn(async (options) => {
        expect(options?.cwd).toContain("acme");
        expect(options?.tools).toEqual(["read", "grep", "find", "ls"]);
        return {
          session: {
            messages: [
              {
                role: "assistant",
                model: "bedrock-model",
                usage: { input: 12, output: 5, cacheRead: 0 },
                content: [{ type: "text", text: "Workspace looks healthy." }],
              },
            ],
            prompt: vi.fn(async (text: string) => {
              promptText = text;
            }),
            dispose: vi.fn(),
          },
        };
      }),
    };
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(init?.headers).toMatchObject({
        authorization: "Bearer dps_secret",
      });
      expect(body).toMatchObject({
        thread_turn_id: "turn-1",
        runtime_type: "pi",
        status: "completed",
      });
      expect(body.response).toMatchObject({
        content: "Workspace looks healthy.",
        runtime: "pi",
        runtime_host: "desktop-local",
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const result = await runLocalDesktopTurn(
      { session: createPrepared(), workspaceCacheRoot: root },
      {
        now: () => new Date("2026-05-28T12:00:00.000Z"),
        loadPiSdk: async () => sdk,
        workspaceStore: store,
        fetchImpl: fetchImpl as typeof fetch,
      },
    );

    expect(result).toMatchObject({
      finalized: true,
      status: "completed",
      fallbackEligible: false,
    });
    expect(promptText).toContain("Prior conversation:");
    expect(promptText).toContain("Current user message:");
    expect(store.listed).toBe(true);
    expect(store.fetched).toEqual([
      "tenants/acme/rendered/marco/sales/user-1/AGENTS.md",
    ]);
  });

  it("fails expired sessions before invoking the Pi SDK and finalizes failure", async () => {
    const sdk: PiSdkModuleLike = {
      createAgentSession: vi.fn(),
    };
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        thread_turn_id: "turn-1",
        status: "failed",
      });
      expect(String(body.error_message)).toContain("expired");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const result = await runLocalDesktopTurn(
      {
        session: createPrepared({
          expiresAt: "2026-05-28T11:00:00.000Z",
        }),
        workspaceCacheRoot: root,
      },
      {
        now: () => new Date("2026-05-28T12:00:00.000Z"),
        loadPiSdk: async () => sdk,
        fetchImpl: fetchImpl as typeof fetch,
      },
    );

    expect(result.status).toBe("failed");
    expect(sdk.createAgentSession).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("aborts the active Pi SDK session when a local turn is cancelled", async () => {
    const abortController = new AbortController();
    const abort = vi.fn(async () => {});
    const sdk: PiSdkModuleLike = {
      createAgentSession: vi.fn(async () => ({
        session: {
          messages: [],
          abort,
          prompt: vi.fn(async () => {
            abortController.abort();
          }),
          dispose: vi.fn(),
        },
      })),
    };
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        thread_turn_id: "turn-1",
        status: "failed",
      });
      expect(String(body.error_message)).toContain("cancelled");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const result = await runLocalDesktopTurn(
      { session: createPrepared(), workspaceCacheRoot: root },
      {
        now: () => new Date("2026-05-28T12:00:00.000Z"),
        loadPiSdk: async () => sdk,
        fetchImpl: fetchImpl as typeof fetch,
        workspaceStore: new FakeStore(),
        signal: abortController.signal,
      },
    );

    expect(result.status).toBe("failed");
    expect(abort).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("registers the managed delegation custom tool when the Pi SDK supports custom tools", async () => {
    let optionsSeen: Record<string, unknown> | undefined;
    const sdk: PiSdkModuleLike = {
      defineTool: vi.fn((definition) => definition),
      createAgentSession: vi.fn(async (options) => {
        optionsSeen = options;
        return {
          session: {
            messages: [{ role: "assistant", content: "Done" }],
            prompt: vi.fn(async () => {}),
          },
        };
      }),
    };
    const fetchImpl = vi.fn(async () =>
      Response.json({ ok: true }, { status: 200 }),
    );

    await runLocalDesktopTurn(
      { session: createPrepared(), workspaceCacheRoot: root },
      {
        now: () => new Date("2026-05-28T12:00:00.000Z"),
        loadPiSdk: async () => sdk,
        workspaceStore: new FakeStore(),
        fetchImpl: fetchImpl as typeof fetch,
      },
    );

    expect(optionsSeen?.tools).toContain("delegate_to_managed_agent");
    expect(optionsSeen?.customTools).toHaveLength(1);
    expect(sdk.defineTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "delegate_to_managed_agent" }),
    );
  });

  it("rejects unsupported Pi SDK contracts", () => {
    expect(() =>
      validatePreparedSession({
        ...createPrepared(),
        invocation: {
          ...BASE_INVOCATION,
          pi_sdk: {
            ...DESKTOP_PI_SDK_EMBEDDING_CONTRACT,
            packageName: "@example/not-pi" as never,
          },
        },
      }),
    ).toThrow("unsupported Pi SDK");
  });
});
