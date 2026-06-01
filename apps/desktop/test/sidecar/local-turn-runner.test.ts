import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DESKTOP_PI_SDK_EMBEDDING_CONTRACT,
  type PreparedDesktopPiRuntimeSession,
} from "@thinkwork/pi-runtime-core";
import {
  DESKTOP_JUST_BASH_TOOL_NAMES,
  DESKTOP_LOCAL_PI_BUILTIN_TOOL_NAMES,
} from "../../src/sidecar/just-bash-tool";
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
  model: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
  trigger_channel: "desktop" as const,
  finalize_callback_secret: "dps_secret",
  thread_turn_id: "turn-1",
  tenant_slug: "acme",
  instance_id: "marco",
  workspace_bucket: "workspace-bucket",
  rendered_workspace_prefix: "tenants/acme/threads/customer-kickoff/",
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
        key: "tenants/acme/threads/customer-kickoff/.hydrate_manifest.json",
      },
    ];
  }

  async getObjectBytes(input: { key: string }): Promise<Uint8Array> {
    this.fetched.push(input.key);
    if (input.key.endsWith(".hydrate_manifest.json")) {
      return new TextEncoder().encode(
        JSON.stringify({
          version: 1,
          renderedPrefix: BASE_INVOCATION.rendered_workspace_prefix,
          generatedAt: "2026-05-28T12:00:00.000Z",
          sources: [{ owner: "agent", prefix: "tenants/acme/agents/marco/" }],
          files: [
            {
              path: "Agent/AGENTS.md",
              owner: "agent",
              sourceKey: "tenants/acme/agents/marco/AGENTS.md",
              sourcePrefix: "tenants/acme/agents/marco/",
              sourcePath: "AGENTS.md",
              etag: '"etag-agents"',
              readOnly: false,
            },
          ],
          statusMounts: [],
        }),
      );
    }
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
        renderedPrefix: "tenants/acme/threads/customer-kickoff/",
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
        expect(options?.cwd).toBe(root);
        expect(options?.tools).toEqual([
          ...DESKTOP_LOCAL_PI_BUILTIN_TOOL_NAMES,
          ...DESKTOP_JUST_BASH_TOOL_NAMES,
        ]);
        expect(options?.customTools).toEqual([
          expect.objectContaining({ name: "bash" }),
        ]);
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
      "tenants/acme/threads/customer-kickoff/.hydrate_manifest.json",
      "tenants/acme/agents/marco/AGENTS.md",
    ]);
  });

  it("uses the desktop just-bash custom tool instead of native SDK bash", async () => {
    const sdk: PiSdkModuleLike = {
      defineTool: vi.fn((definition) => definition),
      createAgentSession: vi.fn(async () => ({
        session: {
          messages: [{ role: "assistant", content: "Done" }],
          prompt: vi.fn(async () => {}),
        },
      })),
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

    const optionsSeen = vi.mocked(sdk.createAgentSession).mock.calls[0]?.[0];
    expect(optionsSeen?.tools).toEqual([
      ...DESKTOP_LOCAL_PI_BUILTIN_TOOL_NAMES,
      ...DESKTOP_JUST_BASH_TOOL_NAMES,
      "set_task_status",
      "delegate_to_managed_agent",
    ]);
    expect(
      (optionsSeen?.tools as string[]).filter((name) => name === "bash"),
    ).toHaveLength(1);
    const customTools = optionsSeen?.customTools as Array<{
      name?: string;
      description?: string;
      execute?: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal?: AbortSignal,
      ) => Promise<{ content?: Array<{ text?: string }>; isError?: boolean }>;
    }>;
    const bashTool = customTools.find((tool) => tool.name === "bash");
    expect(bashTool?.description).toContain("just-bash /workspace sandbox");
    expect(bashTool?.description).not.toContain("native macOS shell access");

    const result = await bashTool!.execute!("call-1", {
      command: "test -f AGENTS.md && test ! -e Agent && cat AGENTS.md",
    });

    expect(result.isError).toBe(false);
    expect(result.content?.[0]?.text).toBe("# Agent");
  });

  it("hydrates desktop just-bash as Agent root, User root, and singular Space", async () => {
    const manifest = {
      version: 1,
      renderedPrefix: BASE_INVOCATION.rendered_workspace_prefix,
      generatedAt: "2026-06-01T12:00:00.000Z",
      sources: [
        { owner: "agent", prefix: "tenants/acme/agents/marco/" },
        { owner: "space", prefix: "tenants/acme/spaces/default/" },
        { owner: "user", prefix: "tenants/acme/users/eric/" },
      ],
      files: [
        {
          path: "Agent/workspace/AGENTS.md",
          owner: "agent",
          sourceKey: "tenants/acme/agents/marco/workspace/AGENTS.md",
          sourcePrefix: "tenants/acme/agents/marco/",
          sourcePath: "AGENTS.md",
          etag: '"agent"',
          readOnly: false,
        },
        {
          path: "User/USER.md",
          owner: "user",
          sourceKey: "tenants/acme/users/eric/USER.md",
          sourcePrefix: "tenants/acme/users/eric/",
          sourcePath: "USER.md",
          etag: '"user"',
          readOnly: false,
        },
        {
          path: "Spaces/default/source/CONTEXT.md",
          owner: "space",
          sourceKey: "tenants/acme/spaces/default/source/CONTEXT.md",
          sourcePrefix: "tenants/acme/spaces/default/",
          sourcePath: "CONTEXT.md",
          etag: '"space"',
          readOnly: false,
        },
      ],
      statusMounts: [],
    };
    const store: WorkspaceObjectStore = {
      async listObjects() {
        return [
          {
            key: `${BASE_INVOCATION.rendered_workspace_prefix}.hydrate_manifest.json`,
          },
        ];
      },
      async getObjectBytes(input) {
        if (input.key.endsWith(".hydrate_manifest.json")) {
          return new TextEncoder().encode(`${JSON.stringify(manifest)}\n`);
        }
        const contentByKey: Record<string, string> = {
          "tenants/acme/agents/marco/workspace/AGENTS.md": "# Agent",
          "tenants/acme/users/eric/USER.md": "Name: Eric",
          "tenants/acme/spaces/default/source/CONTEXT.md": "# Space",
        };
        return new TextEncoder().encode(contentByKey[input.key] ?? "");
      },
    };
    const sdk: PiSdkModuleLike = {
      defineTool: vi.fn((definition) => definition),
      createAgentSession: vi.fn(async () => ({
        session: {
          messages: [{ role: "assistant", content: "Done" }],
          prompt: vi.fn(async () => {}),
        },
      })),
    };

    await runLocalDesktopTurn(
      { session: createPrepared(), workspaceCacheRoot: root },
      {
        now: () => new Date("2026-05-28T12:00:00.000Z"),
        loadPiSdk: async () => sdk,
        workspaceStore: store,
        fetchImpl: vi.fn(async () =>
          Response.json({ ok: true }, { status: 200 }),
        ) as typeof fetch,
      },
    );

    const optionsSeen = vi.mocked(sdk.createAgentSession).mock.calls[0]?.[0];
    const bashTool = (
      optionsSeen?.customTools as Array<{
        name?: string;
        execute?: (
          toolCallId: string,
          params: Record<string, unknown>,
          signal?: AbortSignal,
        ) => Promise<{ content?: Array<{ text?: string }>; isError?: boolean }>;
      }>
    ).find((tool) => tool.name === "bash");
    const result = await bashTool!.execute!("call-1", {
      command:
        "pwd; find . -maxdepth 1 -mindepth 1 -type d -print | sort; test -f AGENTS.md; test -f USER.md; test -f Space/CONTEXT.md; test ! -e Agent; test ! -e Spaces; test ! -e User; test ! -e workspace; test ! -e source; cat AGENTS.md; cat USER.md; cat Space/CONTEXT.md",
    });

    expect(result.isError).toBe(false);
    expect(result.content?.[0]?.text).toContain("/workspace");
    expect(result.content?.[0]?.text).toContain("./Space");
    expect(result.content?.[0]?.text).toContain("# Agent");
    expect(result.content?.[0]?.text).toContain("Name: Eric");
    expect(result.content?.[0]?.text).toContain("# Space");
  });

  it("sends just-bash workspace modifications as finalize changed_files", async () => {
    const manifest = {
      version: 1,
      renderedPrefix: BASE_INVOCATION.rendered_workspace_prefix,
      generatedAt: "2026-05-28T12:00:00.000Z",
      sources: [{ owner: "agent", prefix: "tenants/acme/agents/marco/" }],
      files: [
        {
          path: "Agent/AGENTS.md",
          owner: "agent",
          sourceKey: "tenants/acme/agents/marco/AGENTS.md",
          sourcePrefix: "tenants/acme/agents/marco/",
          sourcePath: "AGENTS.md",
          etag: '"etag-agents"',
          readOnly: false,
        },
      ],
      statusMounts: [],
    };
    const store: WorkspaceObjectStore = {
      async listObjects() {
        return [
          {
            key: `${BASE_INVOCATION.rendered_workspace_prefix}.hydrate_manifest.json`,
            eTag: '"manifest"',
          },
        ];
      },
      async getObjectBytes(input) {
        return new TextEncoder().encode(
          input.key.endsWith(".hydrate_manifest.json")
            ? `${JSON.stringify(manifest)}\n`
            : "# Agent",
        );
      },
    };
    const sdk: PiSdkModuleLike = {
      defineTool: vi.fn((definition) => definition),
      createAgentSession: vi.fn(async (options) => {
        const bashTool = (
          options?.customTools as Array<{
            name?: string;
            execute?: (
              toolCallId: string,
              params: Record<string, unknown>,
            ) => Promise<unknown>;
          }>
        ).find((tool) => tool.name === "bash");
        return {
          session: {
            messages: [{ role: "assistant", content: "Done" }],
            prompt: vi.fn(async () => {
              await bashTool?.execute?.("call-1", {
                command: "printf '# Agent v2' > AGENTS.md",
              });
            }),
          },
        };
      }),
    };
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.changed_files).toEqual([
        {
          path: "Agent/AGENTS.md",
          op: "modify",
          content: "# Agent v2",
          base_etag: '"etag-agents"',
        },
      ]);
      return Response.json({ ok: true }, { status: 200 });
    });

    await runLocalDesktopTurn(
      { session: createPrepared(), workspaceCacheRoot: root },
      {
        now: () => new Date("2026-05-28T12:00:00.000Z"),
        loadPiSdk: async () => sdk,
        workspaceStore: store,
        fetchImpl: fetchImpl as typeof fetch,
      },
    );
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
    expect(optionsSeen?.customTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "bash" }),
        expect.objectContaining({ name: "delegate_to_managed_agent" }),
      ]),
    );
    expect(sdk.defineTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "delegate_to_managed_agent" }),
    );
  });

  it("routes unsupported hosted models through the Bedrock SDK model fallback", async () => {
    let optionsSeen: Record<string, unknown> | undefined;
    let finalizeBody: Record<string, unknown> | undefined;
    const authStorage = { setRuntimeApiKey: vi.fn() };
    const sdk: PiSdkModuleLike = {
      AuthStorage: { create: vi.fn(() => authStorage) },
      ModelRegistry: {
        create: vi.fn(() => ({
          find: vi.fn((provider: string, modelId: string) =>
            provider === "amazon-bedrock"
              ? { provider, id: modelId }
              : undefined,
          ),
        })),
      },
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

    await runLocalDesktopTurn(
      {
        session: createPrepared({
          invocation: {
            ...BASE_INVOCATION,
            model: "moonshotai.kimi-k2.5",
          },
        }),
        workspaceCacheRoot: root,
      },
      {
        now: () => new Date("2026-05-28T12:00:00.000Z"),
        loadPiSdk: async () => sdk,
        workspaceStore: new FakeStore(),
        fetchImpl: vi.fn(async (_url, init) => {
          finalizeBody = JSON.parse(String(init?.body)) as Record<
            string,
            unknown
          >;
          return Response.json({ ok: true });
        }) as typeof fetch,
      },
    );

    expect(optionsSeen?.model).toEqual({
      provider: "amazon-bedrock",
      id: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    });
    expect(optionsSeen?.authStorage).toBeTruthy();
    expect(optionsSeen?.modelRegistry).toBeTruthy();
    expect(authStorage.setRuntimeApiKey).toHaveBeenCalledWith(
      "amazon-bedrock",
      "aws-sdk-default-credential-chain",
    );
    expect(finalizeBody?.agent_model).toBe(
      "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    );
    expect((finalizeBody?.response as { model?: string })?.model).toBe(
      "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    );
  });

  it("registers web_search from the prepared Exa config and executes it locally", async () => {
    let optionsSeen: Record<string, unknown> | undefined;
    const sdk: PiSdkModuleLike = {
      defineTool: vi.fn((definition) => definition),
      createAgentSession: vi.fn(async (options) => {
        optionsSeen = options;
        return {
          session: {
            messages: [{ role: "assistant", content: "Searched." }],
            prompt: vi.fn(async () => {}),
          },
        };
      }),
    };
    const fetchImpl = vi.fn(async (url) => {
      if (String(url) === "https://api.exa.ai/search") {
        return Response.json({
          results: [
            {
              id: "exa-1",
              title: "Austin weather",
              url: "https://example.com/austin",
              summary: "Current weather in Austin is warm.",
              score: 0.91,
            },
          ],
        });
      }
      return Response.json({ ok: true }, { status: 200 });
    });

    await runLocalDesktopTurn(
      {
        session: createPrepared({
          invocation: {
            ...BASE_INVOCATION,
            web_search_config: { provider: "exa", apiKey: "exa_key" },
          },
        }),
        workspaceCacheRoot: root,
      },
      {
        now: () => new Date("2026-05-28T12:00:00.000Z"),
        loadPiSdk: async () => sdk,
        workspaceStore: new FakeStore(),
        fetchImpl: fetchImpl as typeof fetch,
      },
    );

    expect(optionsSeen?.tools).toContain("web_search");
    const webSearchTool = (
      optionsSeen?.customTools as Array<{
        name?: string;
        execute?: (
          toolCallId: string,
          params: Record<string, unknown>,
        ) => Promise<unknown>;
      }>
    ).find((tool) => tool.name === "web_search");
    expect(webSearchTool).toBeTruthy();

    const result = await webSearchTool!.execute!("call-1", {
      query: "weather in Austin",
      limit: 1,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.exa.ai/search",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-api-key": "exa_key" }),
      }),
    );
    expect(JSON.stringify(result)).toContain("Austin weather");
  });

  it("mirrors prompt source files into the Pi SDK agent directory", async () => {
    let agentDir = "";
    const sdk: PiSdkModuleLike = {
      DefaultResourceLoader: class {
        constructor(options: Record<string, unknown>) {
          agentDir = String(options.agentDir);
        }

        async reload() {
          expect(await readFile(join(agentDir, "AGENTS.md"), "utf8")).toBe(
            "# Agent",
          );
          expect(
            await readFile(join(agentDir, "PROMPT_SOURCES.md"), "utf8"),
          ).toContain("AGENTS.md");
        }
      },
      createAgentSession: vi.fn(async () => ({
        session: {
          messages: [{ role: "assistant", content: "Done" }],
          prompt: vi.fn(async () => {}),
        },
      })),
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

    expect(agentDir).toContain(".thinkwork-pi");
  });

  it("loads shared Thinkwork extensions through the Pi resource loader when available", async () => {
    let loaderOptions: Record<string, unknown> | undefined;
    let optionsSeen: Record<string, unknown> | undefined;
    const sdk: PiSdkModuleLike = {
      DefaultResourceLoader: class {
        constructor(options: Record<string, unknown>) {
          loaderOptions = options;
        }

        async reload() {}
      },
      createAgentSession: vi.fn(async (options) => {
        optionsSeen = options;
        return {
          session: {
            messages: [{ role: "assistant", content: "Ready." }],
            prompt: vi.fn(async () => {}),
          },
        };
      }),
    };

    await runLocalDesktopTurn(
      {
        session: createPrepared({
          invocation: {
            ...BASE_INVOCATION,
            web_search_config: { provider: "exa", apiKey: "exa_key" },
          },
        }),
        workspaceCacheRoot: root,
      },
      {
        now: () => new Date("2026-05-28T12:00:00.000Z"),
        loadPiSdk: async () => sdk,
        workspaceStore: new FakeStore(),
        fetchImpl: vi.fn(async () =>
          Response.json({ ok: true }),
        ) as typeof fetch,
      },
    );

    expect(optionsSeen?.tools).toEqual(
      expect.arrayContaining([
        "web_search",
        "set_task_status",
        "delegate_to_managed_agent",
      ]),
    );
    expect(optionsSeen?.customTools).toEqual([
      expect.objectContaining({ name: "bash" }),
    ]);
    const factories = loaderOptions?.extensionFactories as Array<
      (pi: { registerTool: (tool: { name?: string }) => void }) => void
    >;
    expect(factories).toHaveLength(3);
    const registered: Array<{ name?: string }> = [];
    for (const factory of factories) {
      factory({ registerTool: (tool) => registered.push(tool) });
    }
    expect(registered.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "web_search",
        "set_task_status",
        "delegate_to_managed_agent",
      ]),
    );
  });

  it("adapts prepared MCP configs into desktop local Pi tools", async () => {
    let optionsSeen: Record<string, unknown> | undefined;
    const sdk: PiSdkModuleLike = {
      defineTool: vi.fn((definition) => definition),
      DefaultResourceLoader: class {
        async reload() {}
      },
      createAgentSession: vi.fn(async (options) => {
        optionsSeen = options;
        return {
          session: {
            messages: [{ role: "assistant", content: "CRM checked." }],
            prompt: vi.fn(async () => {}),
          },
        };
      }),
    };
    const connectMcpServer = vi.fn(async (args) => {
      expect(args.url).toBe("https://mcp.example.com/crm");
      expect(args.serverName).toBe("crm");
      expect(args.toolWhitelist).toEqual(["opportunities_list"]);
      expect(args.headers.Authorization).toMatch(/^Handle /);
      expect(args.headers.Authorization).not.toContain("mcp_secret");
      return [
        {
          name: "mcp_crm_opportunities_list",
          label: "crm: opportunities_list",
          description: "List CRM opportunities.",
          parameters: { type: "object", properties: {} },
          executionMode: "sequential" as const,
          execute: vi.fn(async () => ({
            content: [{ type: "text", text: "opportunity-1" }],
          })),
        },
      ];
    });

    await runLocalDesktopTurn(
      {
        session: createPrepared({
          invocation: {
            ...BASE_INVOCATION,
            mcp_configs: [
              {
                name: "crm",
                url: "https://mcp.example.com/crm",
                transport: "streamable-http",
                auth: { type: "bearer", token: "mcp_secret" },
                tools: ["opportunities_list"],
              },
            ],
          },
        }),
        workspaceCacheRoot: root,
      },
      {
        now: () => new Date("2026-05-28T12:00:00.000Z"),
        loadPiSdk: async () => sdk,
        workspaceStore: new FakeStore(),
        fetchImpl: vi.fn(async () =>
          Response.json({ ok: true }),
        ) as typeof fetch,
        connectMcpServer,
      },
    );

    expect(connectMcpServer).toHaveBeenCalledOnce();
    expect(optionsSeen?.tools).toEqual(
      expect.arrayContaining([
        "delegate_to_managed_agent",
        "mcp_crm_opportunities_list",
      ]),
    );
    expect(optionsSeen?.customTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "bash" }),
        expect.objectContaining({ name: "mcp_crm_opportunities_list" }),
      ]),
    );
    expect(sdk.defineTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "mcp_crm_opportunities_list" }),
    );
  });

  it("loads pi-mcp-adapter through a no-secret resource-loader wrapper", async () => {
    let loaderOptions: Record<string, unknown> | undefined;
    let optionsSeen: Record<string, unknown> | undefined;
    let adapterConfigText = "";
    let adapterWrapperText = "";
    let envKey = "";
    const bindExtensions = vi.fn(async () => {});
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    const sdk: PiSdkModuleLike = {
      DefaultResourceLoader: class {
        constructor(options: Record<string, unknown>) {
          loaderOptions = options;
        }

        async reload() {
          const agentDir = String(loaderOptions?.agentDir ?? "");
          adapterConfigText = await readFile(
            join(agentDir, "mcp.json"),
            "utf8",
          );
          const extensionPaths = loaderOptions?.additionalExtensionPaths as
            | string[]
            | undefined;
          expect(extensionPaths).toHaveLength(1);
          adapterWrapperText = await readFile(extensionPaths![0], "utf8");
        }
      },
      createAgentSession: vi.fn(async (options) => {
        optionsSeen = options;
        return {
          session: {
            bindExtensions,
            messages: [{ role: "assistant", content: "CRM checked." }],
            prompt: vi.fn(async () => {}),
          },
        };
      }),
    };

    await runLocalDesktopTurn(
      {
        session: createPrepared({
          invocation: {
            ...BASE_INVOCATION,
            mcp_configs: [
              {
                name: "lastmile-crm",
                url: "https://mcp.example.com/crm",
                transport: "streamable-http",
                auth: { type: "bearer", token: "mcp_secret" },
                tools: ["opportunities_list"],
                availableTools: ["opportunities_list", "accounts_list"],
              },
            ],
          },
        }),
        workspaceCacheRoot: root,
      },
      {
        now: () => new Date("2026-05-28T12:00:00.000Z"),
        loadPiSdk: async () => sdk,
        workspaceStore: new FakeStore(),
        fetchImpl: vi.fn(async () =>
          Response.json({ ok: true }),
        ) as typeof fetch,
      },
    );

    const parsed = JSON.parse(adapterConfigText) as {
      mcpServers: Record<
        string,
        {
          bearerTokenEnv?: string;
          bearerToken?: string;
          excludeTools?: string[];
        }
      >;
    };
    const server = parsed.mcpServers["lastmile-crm"];
    envKey = server.bearerTokenEnv ?? "";
    expect(server.bearerToken).toBeUndefined();
    expect(server.excludeTools).toEqual(["accounts_list"]);
    expect(adapterConfigText).not.toContain("mcp_secret");
    expect(adapterWrapperText).toContain("pi-mcp-adapter");
    expect(adapterWrapperText).toContain("index.ts");
    expect(optionsSeen?.tools).toEqual(
      expect.arrayContaining(["delegate_to_managed_agent", "mcp"]),
    );
    expect(optionsSeen?.sessionStartEvent).toEqual(
      expect.objectContaining({
        type: "session_start",
        reason: "startup",
        source: "thinkwork-desktop-local-pi",
      }),
    );
    expect(optionsSeen?.customTools).toEqual([
      expect.objectContaining({ name: "bash" }),
    ]);
    expect(bindExtensions).toHaveBeenCalledWith(
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    expect(process.env[envKey]).toBeUndefined();
    expect(process.env.PI_CODING_AGENT_DIR).toBe(previousAgentDir);
  });

  it("registers shared memory tools through the desktop Hindsight provider", async () => {
    let optionsSeen: Record<string, unknown> | undefined;
    const sdk: PiSdkModuleLike = {
      defineTool: vi.fn((definition) => definition),
      createAgentSession: vi.fn(async (options) => {
        optionsSeen = options;
        return {
          session: {
            messages: [{ role: "assistant", content: "Remembered." }],
            prompt: vi.fn(async () => {}),
          },
        };
      }),
    };
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes("/memories/recall")) {
        return Response.json({
          memory_units: [{ id: "mem-1", text: "Eric prefers concise PRs." }],
        });
      }
      return Response.json({ ok: true }, { status: 200 });
    });

    await runLocalDesktopTurn(
      {
        session: createPrepared({
          invocation: {
            ...BASE_INVOCATION,
            hindsight_endpoint: "https://hindsight.example.com",
          },
        }),
        workspaceCacheRoot: root,
      },
      {
        now: () => new Date("2026-05-28T12:00:00.000Z"),
        loadPiSdk: async () => sdk,
        workspaceStore: new FakeStore(),
        fetchImpl: fetchImpl as typeof fetch,
      },
    );

    expect(optionsSeen?.tools).toEqual(
      expect.arrayContaining(["recall", "reflect"]),
    );
    const recallTool = (
      optionsSeen?.customTools as Array<{
        name?: string;
        execute?: (
          toolCallId: string,
          params: Record<string, unknown>,
        ) => Promise<unknown>;
      }>
    ).find((tool) => tool.name === "recall");
    expect(recallTool).toBeTruthy();

    const result = await recallTool!.execute!("call-1", {
      query: "PR preferences",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://hindsight.example.com/v1/default/banks/user_user-1/memories/recall",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.stringify(result)).toContain("concise PRs");
  });

  it("registers browser_automation when enabled and executes it locally", async () => {
    let optionsSeen: Record<string, unknown> | undefined;
    const sdk: PiSdkModuleLike = {
      defineTool: vi.fn((definition) => definition),
      createAgentSession: vi.fn(async (options) => {
        optionsSeen = options;
        return {
          session: {
            messages: [{ role: "assistant", content: "Browsed." }],
            prompt: vi.fn(async () => {}),
          },
        };
      }),
    };
    const fetchImpl = vi.fn(async (url) => {
      if (String(url) === "https://example.com") {
        return new Response(
          "<html><head><title>Example Domain</title></head><body><h1>Example Domain</h1><p>This domain is for examples.</p></body></html>",
          { headers: { "content-type": "text/html" } },
        );
      }
      return Response.json({ ok: true }, { status: 200 });
    });

    await runLocalDesktopTurn(
      {
        session: createPrepared({
          invocation: {
            ...BASE_INVOCATION,
            browser_automation_enabled: true,
          },
        }),
        workspaceCacheRoot: root,
      },
      {
        now: () => new Date("2026-05-28T12:00:00.000Z"),
        loadPiSdk: async () => sdk,
        workspaceStore: new FakeStore(),
        fetchImpl: fetchImpl as typeof fetch,
      },
    );

    expect(optionsSeen?.tools).toContain("browser_automation");
    const browserTool = (
      optionsSeen?.customTools as Array<{
        name?: string;
        execute?: (
          toolCallId: string,
          params: Record<string, unknown>,
        ) => Promise<unknown>;
      }>
    ).find((tool) => tool.name === "browser_automation");
    expect(browserTool).toBeTruthy();

    const result = await browserTool!.execute!("call-1", {
      url: "https://example.com",
      task: "Read the title",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        headers: expect.objectContaining({ "User-Agent": "Thinkwork/1.0" }),
      }),
    );
    expect(JSON.stringify(result)).toContain("Example Domain");
  });

  it("writes a local debug bundle with the composed prompt and prompt source files", async () => {
    const sdk: PiSdkModuleLike = {
      createAgentSession: vi.fn(async () => ({
        session: {
          messages: [{ role: "assistant", content: "Done" }],
          prompt: vi.fn(async () => {}),
        },
      })),
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
        debug: true,
      },
    );

    const bundle = await readFile(
      join(root, "debug", "turn-1", "system-prompt.md"),
      "utf8",
    );
    expect(bundle).toContain("## Composed System Prompt");
    expect(bundle).toContain("You are running inside the ThinkWork desktop");
    expect(bundle).toContain("Use bash for shell commands");
    expect(bundle).toContain("backed by just-bash");
    expect(bundle).not.toContain("shell out");
    expect(bundle).toContain("### Agent/AGENTS.md");
    expect(bundle).toContain("# Agent");
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
