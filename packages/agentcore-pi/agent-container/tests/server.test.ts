import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InvokeCommand,
  type InvokeCommandInput,
  type LambdaClient,
} from "@aws-sdk/client-lambda";

import {
  CompletionCallbackAuthError,
  assembleTools,
  handleInvocation,
  postCompletion,
  postFinalizeCallback,
} from "../src/server.js";
import { HandleStore, type ConnectMcpServerFn } from "../src/mcp.js";
import { McpToolRegistry } from "../src/mcp-registry.js";
import type { AgentTool } from "@earendil-works/pi-agent-core";

// ---------------------------------------------------------------------------
// Test fixtures.
// ---------------------------------------------------------------------------

const VALID_PAYLOAD = (overrides: Record<string, unknown> = {}) => ({
  tenant_id: "tenant-1",
  user_id: "user-1",
  assistant_id: "agent-1",
  thread_id: "thread-1",
  tenant_slug: "tenant-1",
  instance_id: "agent-slug",
  trace_id: "trace-1",
  message: "Hello pi",
  thinkwork_api_url: "https://api.example.com",
  thinkwork_api_secret: "test-secret-do-not-leak",
  sandbox_interpreter_id: "thinkwork_dev_test_sandbox-AAA",
  ...overrides,
});

const noopConnect: ConnectMcpServerFn = async () => [];

function fakeAgentCoreClient(): unknown {
  return { send: vi.fn() };
}
function fakeS3Client(): unknown {
  return { send: vi.fn() };
}

// Stub out the env so MEMORY_ENGINE doesn't try to actually wire anything.
beforeEach(() => {
  delete process.env.MEMORY_ENGINE;
  delete process.env.AGENTCORE_MEMORY_ID;
  delete process.env.HINDSIGHT_ENDPOINT;
  delete process.env.MEMORY_RETAIN_FN_NAME;
  delete process.env.WORKSPACE_BUCKET;
  delete process.env.AGENTCORE_FILES_BUCKET;
  delete process.env.DB_CLUSTER_ARN;
  delete process.env.DB_SECRET_ARN;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// handleInvocation — identity + payload validation.
// ---------------------------------------------------------------------------

describe("handleInvocation — payload validation", () => {
  it("returns 400 when tenant_id is missing", async () => {
    const result = await handleInvocation({
      payload: VALID_PAYLOAD({ tenant_id: "" }),
      deps: makeDeps(),
    });
    expect(result.statusCode).toBe(400);
    expect(result.body.error).toMatch(/tenant_id/);
    expect(result.body.runtime).toBe("pi");
  });

  it("returns 400 when message is empty", async () => {
    const result = await handleInvocation({
      payload: VALID_PAYLOAD({ message: "" }),
      deps: makeDeps(),
    });
    expect(result.statusCode).toBe(400);
    expect(result.body.error).toMatch(/non-empty `message`/);
  });

  it("continues without execute_code when sandbox_interpreter_id is missing", async () => {
    let toolNames: string[] = [];
    const result = await handleInvocation({
      payload: VALID_PAYLOAD({ sandbox_interpreter_id: "" }),
      deps: makeDeps({
        runAgentLoop: async ({ tools }) => {
          toolNames = tools.map((tool) => tool.name);
          return {
            content: "stub response",
            modelId: "amazon-bedrock/test-model",
            toolsCalled: toolNames,
            toolInvocations: [],
          };
        },
      }),
    });
    expect(result.statusCode).toBe(200);
    expect(toolNames).not.toContain("execute_code");
  });
});

// ---------------------------------------------------------------------------
// handleInvocation — happy path.
// ---------------------------------------------------------------------------

describe("handleInvocation — happy path", () => {
  it("chat-turn invocation returns 200 and SKIPS the completion callback (chat-agent-invoke owns turn writeback)", async () => {
    let fetchCalled = 0;
    const fetchImpl: typeof fetch = (async () => {
      fetchCalled += 1;
      return new Response();
    }) as unknown as typeof fetch;

    const result = await handleInvocation({
      payload: VALID_PAYLOAD(),
      deps: makeDeps({ fetchImpl }),
    });

    expect(result.statusCode).toBe(200);
    const body = result.body as Record<string, unknown>;
    expect(body.runtime).toBe("pi");
    expect((body.response as Record<string, unknown>).content).toBe(
      "stub response",
    );
    expect(fetchCalled).toBe(0);
  });

  it("passes rendered_workspace_prefix through to workspace bootstrap", async () => {
    process.env.WORKSPACE_BUCKET = "thinkwork-files-test";

    const bootstrapCalls: unknown[][] = [];
    const result = await handleInvocation({
      payload: VALID_PAYLOAD({
        rendered_workspace_prefix:
          "tenants/tenant-1/rendered/agent-slug/sales/eric/",
      }),
      deps: makeDeps({
        bootstrapWorkspaceImpl: (async (...args: unknown[]) => {
          bootstrapCalls.push(args);
          return {
            synced: 0,
            deleted: 0,
            total: 0,
            prefix: "tenants/tenant-1/rendered/agent-slug/sales/eric/",
          };
        }) as never,
      }),
    });

    expect(result.statusCode).toBe(200);
    expect(bootstrapCalls).toHaveLength(1);
    expect(bootstrapCalls[0]?.[0]).toBe("tenant-1");
    expect(bootstrapCalls[0]?.[1]).toBe("agent-slug");
    expect(bootstrapCalls[0]?.[5]).toEqual({
      workspacePrefix: "tenants/tenant-1/rendered/agent-slug/sales/eric/",
    });
  });

  it("stages message attachments, feeds them to the system-prompt extension, and adds file_read", async () => {
    // U6: the system prompt is composed inside the session by the system-prompt
    // extension's before_agent_start hook, not prebuilt and passed to runLoop.
    // The attachment preamble is handed to that extension as its `suffix`. The
    // loop stub bypasses extension execution, so we capture the bundle and drive
    // the system-prompt extension's hook directly to verify the preamble lands.
    let seenSystemPrompt: string | undefined = "unset";
    let seenTools: AgentTool<any>[] = [];
    let capturedBundle:
      | import("../src/server.js").AssembledToolBundle
      | undefined;
    const result = await handleInvocation({
      payload: VALID_PAYLOAD({
        message: "Summarize the file attached in Slack.",
        message_attachments: [
          {
            attachment_id: "att-1",
            s3_key: "tenants/tenant-1/attachments/thread-1/att-1/brief.md",
            name: "brief.md",
            mime_type: "text/markdown",
            size_bytes: 128,
          },
        ],
      }),
      deps: makeDeps({
        stageMessageAttachmentsImpl: async () => ({
          turnDir: "/tmp/pi-turn-test/attachments",
          staged: [
            {
              attachmentId: "att-1",
              localPath: "/tmp/pi-turn-test/attachments/brief.md",
              name: "brief.md",
              mimeType: "text/markdown",
              sizeBytes: 128,
              textPreview: "# Brief\n\nRevenue grew 12%.",
            },
          ],
        }),
        onHandlerComplete: (bundle) => {
          capturedBundle = bundle;
        },
        runAgentLoop: async ({ systemPrompt, tools }) => {
          seenSystemPrompt = systemPrompt;
          seenTools = tools;
          return {
            content: "stub response",
            modelId: "amazon-bedrock/test-model",
            toolsCalled: tools.map((t) => t.name),
            toolInvocations: [],
          };
        },
      }),
    });

    expect(result.statusCode).toBe(200);
    // U6 contract: no prebuilt system prompt is passed to the loop.
    expect(seenSystemPrompt).toBeUndefined();
    expect(seenTools.some((tool) => tool.name === "file_read")).toBe(true);

    // Drive the system-prompt extension's before_agent_start to confirm the
    // attachment preamble was wired in as the composed prompt's suffix.
    const factories = capturedBundle?.extensionFactories ?? [];
    let composed = "";
    for (const factory of factories) {
      const handlers = new Map<string, (...a: unknown[]) => unknown>();
      const fakePi = {
        registerTool: () => {},
        on: (event: string, handler: (...a: unknown[]) => unknown) =>
          handlers.set(event, handler),
      } as never;
      await factory(fakePi);
      const hook = handlers.get("before_agent_start");
      if (hook) {
        const r = (await hook(
          {
            type: "before_agent_start",
            prompt: "",
            systemPrompt: "",
            systemPromptOptions: {},
          },
          undefined,
        )) as { systemPrompt?: string } | undefined;
        if (r?.systemPrompt) composed = r.systemPrompt;
      }
    }
    expect(composed).toContain("Files attached to this turn:");
    expect(composed).toContain("/tmp/pi-turn-test/attachments/brief.md");
    expect(composed).toContain("Revenue grew 12%.");
  });

  it("skill_run invocation fires the completion callback exactly once with the camelCase shape + HMAC header", async () => {
    const fetchCalls: Array<[unknown, RequestInit | undefined]> = [];
    const fetchImpl: typeof fetch = (async (
      url: unknown,
      init?: RequestInit,
    ) => {
      fetchCalls.push([url, init]);
      return {
        ok: true,
        status: 200,
        text: async () => "",
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const result = await handleInvocation({
      payload: VALID_PAYLOAD({
        skill_run_id: "run-uuid-1",
        completion_hmac_secret: "test-hmac-secret",
      }),
      deps: makeDeps({ fetchImpl }),
    });

    expect(result.statusCode).toBe(200);
    expect(fetchCalls).toHaveLength(1);

    const [callUrl, init] = fetchCalls[0]!;
    expect(callUrl).toBe("https://api.example.com/api/skills/complete");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^Bearer /);
    expect(headers["x-skill-run-signature"]).toMatch(/^sha256=[0-9a-f]+$/);

    const body2 = JSON.parse((init?.body ?? "") as string) as Record<
      string,
      unknown
    >;
    expect(body2).toMatchObject({
      runId: "run-uuid-1",
      tenantId: "tenant-1",
      status: "complete",
    });
    // snake_case keys must NOT appear — the endpoint silently drops them.
    expect(body2.skill_run_id).toBeUndefined();
    expect(body2.tenant_id).toBeUndefined();
  });

  it("skill_run failure path posts status='failed' with failureReason", async () => {
    const fetchCalls: Array<[unknown, RequestInit | undefined]> = [];
    const fetchImpl: typeof fetch = (async (
      url: unknown,
      init?: RequestInit,
    ) => {
      fetchCalls.push([url, init]);
      return { ok: true, status: 200 } as unknown as Response;
    }) as unknown as typeof fetch;

    const result = await handleInvocation({
      payload: VALID_PAYLOAD({
        skill_run_id: "run-uuid-2",
        completion_hmac_secret: "h",
      }),
      deps: makeDeps({
        fetchImpl,
        runAgentLoop: (async () => {
          throw new Error("agent boom");
        }) as unknown as typeof import("../src/server.js").runAgentLoop,
      }),
    });

    expect(result.statusCode).toBe(500);
    expect(fetchCalls).toHaveLength(1);
    const init = fetchCalls[0]?.[1];
    const body2 = JSON.parse((init?.body ?? "") as string);
    expect(body2.status).toBe("failed");
    expect(body2.failureReason).toContain("agent boom");
  });

  it("falls back to no callback when secrets are missing on skill_run invocation", async () => {
    let fetchCalled = 0;
    const fetchImpl: typeof fetch = (async () => {
      fetchCalled += 1;
      return new Response();
    }) as unknown as typeof fetch;
    const result = await handleInvocation({
      payload: VALID_PAYLOAD({
        skill_run_id: "run-uuid-3",
        completion_hmac_secret: "h",
        thinkwork_api_url: "",
        thinkwork_api_secret: "",
      }),
      deps: makeDeps({ fetchImpl }),
    });
    expect(result.statusCode).toBe(200);
    expect(fetchCalled).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// HandleStore lifecycle — `clear()` runs in finally even on agent-loop throw.
// ---------------------------------------------------------------------------

describe("handleInvocation — handle store lifecycle", () => {
  it("clears handles even when the agent loop throws", async () => {
    const fakeMcpConfigs = [
      {
        name: "demo-mcp",
        url: "https://mcp.example.com/",
        auth: { token: "fake-bearer-1" },
      },
    ];
    let capturedHandleStore: { size: number } | null = null;

    let fetchCalls = 0;
    const fetchImpl: typeof fetch = (async () => {
      fetchCalls += 1;
      return {
        ok: true,
        status: 200,
        text: async () => "",
      } as unknown as Response;
    }) as unknown as typeof fetch;

    let agentLoopCalled = 0;
    const runAgentLoopImpl: typeof import("../src/server.js").runAgentLoop =
      async () => {
        agentLoopCalled += 1;
        throw new Error("simulated agent failure");
      };

    const result = await handleInvocation({
      payload: VALID_PAYLOAD({
        mcp_configs: fakeMcpConfigs,
        // Skill-run identifiers so the error-path completion callback fires.
        skill_run_id: "run-uuid-handle-test",
        completion_hmac_secret: "h",
      }),
      deps: makeDeps({
        connectMcpServerFactory: async (args) => {
          // Capture the headers sent — must be handle-shaped, never bearer.
          expect(args.headers.Authorization).toMatch(/^Handle [0-9a-f-]+$/);
          expect(args.headers.Authorization).not.toContain("fake-bearer-1");
          return [];
        },
        runAgentLoop: runAgentLoopImpl,
        fetchImpl,
        onHandlerComplete: (bundle) => {
          capturedHandleStore = bundle.handleStore;
        },
      }),
    });

    expect(result.statusCode).toBe(500);
    expect(agentLoopCalled).toBe(1);
    expect(capturedHandleStore).not.toBeNull();
    expect(capturedHandleStore!.size).toBe(0);
    // Skill-run completion callback fired once on the error path.
    expect(fetchCalls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// MCP URL validation — IMDS / loopback / file:// rejected before mint.
// ---------------------------------------------------------------------------

describe("handleInvocation — MCP URL validator", () => {
  it("skips configs with non-https schemes BEFORE handle minting", async () => {
    const connectCalls: Array<{ serverName: string }> = [];
    const connectFactory: ConnectMcpServerFn = async (args) => {
      connectCalls.push({ serverName: args.serverName });
      return [];
    };
    const stdoutSpy = vi.spyOn(process.stdout, "write");

    await handleInvocation({
      payload: VALID_PAYLOAD({
        mcp_configs: [
          {
            name: "evil",
            url: "http://exfil.example.com/",
            auth: { token: "test-bearer" },
          },
          {
            name: "imds",
            url: "https://169.254.169.254/latest/meta-data",
            auth: { token: "test-bearer" },
          },
          {
            name: "good",
            url: "https://mcp.example.com/",
            auth: { token: "test-bearer" },
          },
        ],
      }),
      deps: makeDeps({
        connectMcpServerFactory: connectFactory,
      }),
    });

    expect(connectCalls).toHaveLength(1);
    expect(connectCalls[0]?.serverName).toBe("good");

    const writes = stdoutSpy.mock.calls.map((c) =>
      typeof c[0] === "string" ? c[0] : (c[0]?.toString() ?? ""),
    );
    const rejects = writes.filter((line) => line.includes("mcp_url_rejected"));
    expect(rejects).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// onConnectError — connect failure surfaces a structured log line.
// ---------------------------------------------------------------------------

describe("handleInvocation — onConnectError logging", () => {
  it("emits mcp_connect_failed when the factory throws", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write");

    await handleInvocation({
      payload: VALID_PAYLOAD({
        mcp_configs: [
          {
            name: "broken",
            url: "https://mcp.example.com/",
            auth: { token: "test-bearer" },
          },
        ],
      }),
      deps: makeDeps({
        connectMcpServerFactory: async () => {
          throw new Error("boom");
        },
      }),
    });

    const writes = stdoutSpy.mock.calls.map((c) =>
      typeof c[0] === "string" ? c[0] : (c[0]?.toString() ?? ""),
    );
    const fails = writes.filter((line) => line.includes("mcp_connect_failed"));
    expect(fails.length).toBeGreaterThan(0);
    const parsed = JSON.parse(fails[0]!.trim());
    expect(parsed).toMatchObject({
      level: "warn",
      event: "mcp_connect_failed",
      serverName: "broken",
      error: "boom",
    });
  });
});

// ---------------------------------------------------------------------------
// Completion callback — 401 throws, no bearer leak in logs.
// ---------------------------------------------------------------------------

describe("postCompletion", () => {
  const baseArgs = {
    secrets: {
      apiUrl: "https://api.example.com",
      apiAuthSecret: "test-secret-do-not-leak",
    },
    identity: {
      tenantId: "tenant-1",
      userId: "user-1",
      agentId: "agent-1",
      threadId: "thread-1",
      tenantSlug: "tenant-1",
      agentSlug: "agent-slug",
      traceId: "trace-1",
    },
    runContext: {
      runId: "run-1",
      hmacSecret: "hmac-secret-do-not-leak",
    },
  };

  it("includes Bearer header but NEVER logs the bearer value on 401", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write");
    const fetchCalls: Array<[unknown, RequestInit | undefined]> = [];
    const fetchImpl: typeof fetch = (async (
      url: unknown,
      init?: RequestInit,
    ) => {
      fetchCalls.push([url, init]);
      return {
        ok: false,
        status: 401,
        text: async () => "",
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await expect(
      postCompletion({
        ...baseArgs,
        result: {
          status: "ok",
          runResult: {
            content: "x",
            modelId: "m",
            toolsCalled: [],
            toolInvocations: [],
          },
          latencyMs: 100,
        },
        fetchImpl,
      }),
    ).rejects.toThrow(CompletionCallbackAuthError);

    const writes = stdoutSpy.mock.calls.map((c) =>
      typeof c[0] === "string" ? c[0] : (c[0]?.toString() ?? ""),
    );
    for (const line of writes) {
      expect(line).not.toContain("test-secret-do-not-leak");
    }
    expect(fetchCalls).toHaveLength(1);
    const init = fetchCalls[0]?.[1];
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^Bearer /);
  });

  it("retries on transient failure and succeeds eventually", async () => {
    let callCount = 0;
    const fetchImpl: typeof fetch = (async () => {
      callCount += 1;
      if (callCount === 1)
        return { ok: false, status: 503 } as unknown as Response;
      return { ok: true, status: 200 } as unknown as Response;
    }) as unknown as typeof fetch;

    await postCompletion({
      ...baseArgs,
      result: {
        status: "ok",
        runResult: {
          content: "x",
          modelId: "m",
          toolsCalled: [],
          toolInvocations: [],
        },
        latencyMs: 100,
      },
      fetchImpl,
    });

    expect(callCount).toBe(2);
  });

  it("does not call fetch when secrets are missing", async () => {
    let called = 0;
    const fetchImpl: typeof fetch = (async () => {
      called += 1;
      return new Response();
    }) as unknown as typeof fetch;
    await postCompletion({
      ...baseArgs,
      secrets: { apiUrl: "", apiAuthSecret: "" },
      result: {
        status: "ok",
        runResult: {
          content: "x",
          modelId: "m",
          toolsCalled: [],
          toolInvocations: [],
        },
        latencyMs: 100,
      },
      fetchImpl,
    });
    expect(called).toBe(0);
  });
});

describe("postFinalizeCallback", () => {
  it("posts the Pi runtime finalize payload with runtime_type", async () => {
    const fetchCalls: Array<[unknown, RequestInit | undefined]> = [];
    const fetchImpl: typeof fetch = (async (
      url: unknown,
      init?: RequestInit,
    ) => {
      fetchCalls.push([url, init]);
      return { ok: true, status: 200 } as unknown as Response;
    }) as unknown as typeof fetch;

    const ok = await postFinalizeCallback({
      payload: VALID_PAYLOAD({
        finalize_callback_url:
          "https://api.example.com/api/threads/thread-1/finalize",
        finalize_callback_secret: "secret",
        thread_turn_id: "turn-1",
      }),
      identity: {
        tenantId: "tenant-1",
        userId: "user-1",
        agentId: "agent-1",
        threadId: "thread-1",
        tenantSlug: "tenant-1",
        agentSlug: "agent-slug",
        traceId: "trace-1",
      },
      result: {
        status: "ok",
        runResult: {
          content: "done",
          modelId: "amazon-bedrock/test-model",
          toolsCalled: ["execute_code"],
          toolInvocations: [
            {
              id: "tool-1",
              name: "browser_automation",
              tool_name: "browser_automation",
              runtime: "pi",
              result: {
                details: {
                  tool_costs: [
                    {
                      provider: "agentcore_browser",
                      event_type: "agentcore_browser_session",
                      amount_usd: "0.000001",
                      duration_ms: 42,
                      metadata: { runtime: "pi" },
                    },
                  ],
                },
              },
            },
          ],
        },
        latencyMs: 42,
      },
      fetchImpl,
    });

    expect(ok).toBe(true);
    expect(fetchCalls).toHaveLength(1);
    const [, init] = fetchCalls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer secret");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      thread_turn_id: "turn-1",
      runtime_type: "pi",
      status: "completed",
      response: {
        runtime: "pi",
        tools_called: ["execute_code"],
        tool_costs: [
          expect.objectContaining({
            provider: "agentcore_browser",
            event_type: "agentcore_browser_session",
          }),
        ],
      },
    });
  });

  it("chat-turn invocations use finalize callback instead of returning a synchronous assistant body", async () => {
    const fetchCalls: Array<[unknown, RequestInit | undefined]> = [];
    const fetchImpl: typeof fetch = (async (
      url: unknown,
      init?: RequestInit,
    ) => {
      fetchCalls.push([url, init]);
      return { ok: true, status: 200 } as unknown as Response;
    }) as unknown as typeof fetch;

    const result = await handleInvocation({
      payload: VALID_PAYLOAD({
        finalize_callback_url:
          "https://api.example.com/api/threads/thread-1/finalize",
        finalize_callback_secret: "secret",
        thread_turn_id: "turn-1",
      }),
      deps: makeDeps({ fetchImpl }),
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      finalize_dispatched: true,
      runtime: "pi",
    });
    expect(fetchCalls).toHaveLength(1);
  });

  it("rejects origin-mismatched finalize URLs before sending the bearer", async () => {
    let fetchCalled = 0;
    const fetchImpl: typeof fetch = (async () => {
      fetchCalled += 1;
      return { ok: true, status: 200 } as unknown as Response;
    }) as unknown as typeof fetch;

    const ok = await postFinalizeCallback({
      payload: VALID_PAYLOAD({
        finalize_callback_url:
          "https://evil.example.com/api/threads/thread-1/finalize",
        finalize_callback_secret: "secret",
        thread_turn_id: "turn-1",
      }),
      identity: {
        tenantId: "tenant-1",
        userId: "user-1",
        agentId: "agent-1",
        threadId: "thread-1",
        tenantSlug: "tenant-1",
        agentSlug: "agent-slug",
        traceId: "trace-1",
      },
      result: {
        status: "ok",
        runResult: {
          content: "done",
          modelId: "amazon-bedrock/test-model",
          toolsCalled: [],
          toolInvocations: [],
        },
        latencyMs: 42,
      },
      fetchImpl,
    });

    expect(ok).toBe(false);
    expect(fetchCalled).toBe(0);
  });

  it.each([
    {
      name: "malformed finalize URL",
      overrides: { finalize_callback_url: "not-a-url" },
    },
    {
      name: "non-localhost HTTP finalize URL",
      overrides: {
        finalize_callback_url:
          "http://api.example.com/api/threads/thread-1/finalize",
      },
    },
    {
      name: "missing API URL",
      overrides: { thinkwork_api_url: "" },
    },
    {
      name: "malformed API URL",
      overrides: { thinkwork_api_url: "not-a-url" },
    },
    {
      name: "non-localhost HTTP API URL",
      overrides: { thinkwork_api_url: "http://api.example.com" },
    },
  ])(
    "rejects unsafe finalize callback config: $name",
    async ({ overrides }) => {
      let fetchCalled = 0;
      const fetchImpl: typeof fetch = (async () => {
        fetchCalled += 1;
        return { ok: true, status: 200 } as unknown as Response;
      }) as unknown as typeof fetch;

      const ok = await postFinalizeCallback({
        payload: VALID_PAYLOAD({
          finalize_callback_url:
            "https://api.example.com/api/threads/thread-1/finalize",
          finalize_callback_secret: "secret",
          thread_turn_id: "turn-1",
          ...overrides,
        }),
        identity: {
          tenantId: "tenant-1",
          userId: "user-1",
          agentId: "agent-1",
          threadId: "thread-1",
          tenantSlug: "tenant-1",
          agentSlug: "agent-slug",
          traceId: "trace-1",
        },
        result: {
          status: "ok",
          runResult: {
            content: "done",
            modelId: "amazon-bedrock/test-model",
            toolsCalled: [],
            toolInvocations: [],
          },
          latencyMs: 42,
        },
        fetchImpl,
      });

      expect(ok).toBe(false);
      expect(fetchCalled).toBe(0);
    },
  );

  it("allows localhost finalize callbacks for local runtime tests", async () => {
    const fetchCalls: Array<[unknown, RequestInit | undefined]> = [];
    const fetchImpl: typeof fetch = (async (
      url: unknown,
      init?: RequestInit,
    ) => {
      fetchCalls.push([url, init]);
      return { ok: true, status: 200 } as unknown as Response;
    }) as unknown as typeof fetch;

    const ok = await postFinalizeCallback({
      payload: VALID_PAYLOAD({
        thinkwork_api_url: "http://localhost:5174",
        finalize_callback_url:
          "http://localhost:5174/api/threads/thread-1/finalize",
        finalize_callback_secret: "secret",
        thread_turn_id: "turn-1",
      }),
      identity: {
        tenantId: "tenant-1",
        userId: "user-1",
        agentId: "agent-1",
        threadId: "thread-1",
        tenantSlug: "tenant-1",
        agentSlug: "agent-slug",
        traceId: "trace-1",
      },
      result: {
        status: "ok",
        runResult: {
          content: "done",
          modelId: "amazon-bedrock/test-model",
          toolsCalled: [],
          toolInvocations: [],
        },
        latencyMs: 42,
      },
      fetchImpl,
    });

    expect(ok).toBe(true);
    expect(fetchCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// MCP wire format — handle scheme is the only Authorization that crosses.
// ---------------------------------------------------------------------------

describe("assembleTools — bearer never reaches the connect factory", () => {
  it("Authorization is `Handle <uuid>` with no bearer substring", async () => {
    const captured: Array<Record<string, string>> = [];
    const connect: ConnectMcpServerFn = async (args) => {
      captured.push(args.headers);
      return [];
    };

    const bundle = await assembleTools({
      payload: {
        mcp_configs: [
          {
            name: "sample",
            url: "https://mcp.example.com/",
            auth: { token: "FakeJwt.PayloadOnly.SignaturePart_DoNotEcho" },
          },
        ],
      },
      identity: {
        tenantId: "tenant-1",
        userId: "user-1",
        agentId: "agent-1",
        threadId: "thread-1",
        tenantSlug: "",
        agentSlug: "",
        traceId: "",
      },
      env: {
        awsRegion: "us-east-1",
        agentCoreMemoryId: "",
        hindsightEndpoint: "",
        memoryEngine: "managed",
        memoryRetainFnName: "",
        dbClusterArn: "",
        dbSecretArn: "",
        dbName: "thinkwork",
        workspaceBucket: "",
        workspaceDir: "/tmp/workspace",
        gitSha: "test",
      },
      agentCoreClient: fakeAgentCoreClient() as never,
      workspaceSkills: [],
      connectMcpServer: connect,
      sessionStoreFactory: () => ({}) as never,
      cleanup: [],
      handleStore: new HandleStore(),
      mcpJsonConfig: { directTools: [] },
      mcpRegistry: new McpToolRegistry(),
    });

    expect(captured).toHaveLength(1);
    const headers = captured[0]!;
    expect(headers.Authorization).toMatch(/^Handle [0-9a-f-]+$/);
    const serialised = JSON.stringify(bundle.tools);
    expect(serialised).not.toContain("FakeJwt");
    expect(serialised).not.toContain("DoNotEcho");
    bundle.handleStore.clear();
  });
});

describe("assembleTools — Pi built-in tools", () => {
  it("registers execute_code when the sandbox interpreter id is present", async () => {
    const cleanup: Array<() => Promise<void>> = [];
    const bundle = await assembleTools({
      payload: {
        sandbox_interpreter_id: "thinkwork_test_sandbox-AAA",
      },
      identity: {
        tenantId: "tenant-1",
        userId: "user-1",
        agentId: "agent-1",
        threadId: "thread-1",
        tenantSlug: "",
        agentSlug: "",
        traceId: "",
      },
      env: {
        awsRegion: "us-east-1",
        agentCoreMemoryId: "",
        hindsightEndpoint: "",
        memoryEngine: "managed",
        memoryRetainFnName: "",
        dbClusterArn: "",
        dbSecretArn: "",
        dbName: "thinkwork",
        workspaceBucket: "",
        workspaceDir: "/tmp/workspace",
        gitSha: "test",
      },
      agentCoreClient: fakeAgentCoreClient() as never,
      workspaceSkills: [],
      connectMcpServer: noopConnect,
      sessionStoreFactory: () => ({}) as never,
      cleanup,
      handleStore: new HandleStore(),
      mcpJsonConfig: { directTools: [] },
      mcpRegistry: new McpToolRegistry(),
    });

    expect(bundle.tools.map((tool) => tool.name)).toContain("execute_code");
  });

  it("loads the memory extension (not hand-assembled tools) on the hindsight engine", async () => {
    const bundle = await assembleTools({
      payload: { message: "what do you remember about me?" },
      identity: {
        tenantId: "tenant-1",
        userId: "user-1",
        agentId: "agent-1",
        threadId: "thread-1",
        tenantSlug: "",
        agentSlug: "",
        traceId: "",
      },
      env: {
        awsRegion: "us-east-1",
        agentCoreMemoryId: "",
        hindsightEndpoint: "https://hindsight.dev.example.com",
        memoryEngine: "hindsight",
        memoryRetainFnName: "",
        dbClusterArn: "",
        dbSecretArn: "",
        dbName: "thinkwork",
        workspaceBucket: "",
        workspaceDir: "/tmp/workspace",
        gitSha: "test",
      },
      agentCoreClient: fakeAgentCoreClient() as never,
      workspaceSkills: [],
      connectMcpServer: noopConnect,
      sessionStoreFactory: () => ({}) as never,
      cleanup: [],
      handleStore: new HandleStore(),
      mcpJsonConfig: { directTools: [] },
      mcpRegistry: new McpToolRegistry(),
    });

    // Memory is loaded as an extension, not as hand-assembled recall/reflect
    // AgentTools (U5 retires the buildHindsightTools wiring on this path).
    expect(bundle.extensionFactories).toHaveLength(1);
    expect(bundle.tools.map((tool) => tool.name)).not.toContain("recall");
    expect(bundle.tools.map((tool) => tool.name)).not.toContain("reflect");
    expect(bundle.tools.map((tool) => tool.name)).not.toContain(
      "hindsight_recall",
    );
  });

  it("skips the memory extension in eval mode (user-less)", async () => {
    const bundle = await assembleTools({
      payload: { message: "hi", eval_mode: true },
      identity: {
        tenantId: "tenant-1",
        userId: "",
        agentId: "agent-1",
        threadId: "thread-1",
        tenantSlug: "",
        agentSlug: "",
        traceId: "",
      },
      env: {
        awsRegion: "us-east-1",
        agentCoreMemoryId: "",
        hindsightEndpoint: "https://hindsight.dev.example.com",
        memoryEngine: "hindsight",
        memoryRetainFnName: "",
        dbClusterArn: "",
        dbSecretArn: "",
        dbName: "thinkwork",
        workspaceBucket: "",
        workspaceDir: "/tmp/workspace",
        gitSha: "test",
      },
      agentCoreClient: fakeAgentCoreClient() as never,
      workspaceSkills: [],
      connectMcpServer: noopConnect,
      sessionStoreFactory: () => ({}) as never,
      cleanup: [],
      handleStore: new HandleStore(),
      mcpJsonConfig: { directTools: [] },
      mcpRegistry: new McpToolRegistry(),
    });

    expect(bundle.extensionFactories).toHaveLength(0);
  });

  it("registers browser_automation when browser automation is enabled", async () => {
    const bundle = await assembleTools({
      payload: {
        browser_automation_enabled: true,
        trace_id: "trace-1",
      },
      identity: {
        tenantId: "tenant-1",
        userId: "user-1",
        agentId: "agent-1",
        threadId: "thread-1",
        tenantSlug: "",
        agentSlug: "",
        traceId: "",
      },
      env: {
        awsRegion: "us-east-1",
        agentCoreMemoryId: "",
        hindsightEndpoint: "",
        memoryEngine: "managed",
        memoryRetainFnName: "",
        dbClusterArn: "",
        dbSecretArn: "",
        dbName: "thinkwork",
        workspaceBucket: "",
        workspaceDir: "/tmp/workspace",
        gitSha: "test",
      },
      agentCoreClient: fakeAgentCoreClient() as never,
      workspaceSkills: [],
      connectMcpServer: noopConnect,
      sessionStoreFactory: () => ({}) as never,
      cleanup: [],
      handleStore: new HandleStore(),
      mcpJsonConfig: { directTools: [] },
      mcpRegistry: new McpToolRegistry(),
    });

    expect(bundle.tools.map((tool) => tool.name)).toContain(
      "browser_automation",
    );
  });

  it("registers send_email when send email config is present", async () => {
    const bundle = await assembleTools({
      payload: {
        tenant_slug: "acme",
        send_email_config: {
          apiUrl: "https://api.example.com",
          apiSecret: "test-secret",
          agentId: "agent-1",
          tenantId: "tenant-1",
          threadId: "thread-1",
        },
        turn_context: { spaceSlug: "finance" },
      },
      identity: {
        tenantId: "tenant-1",
        userId: "user-1",
        agentId: "agent-1",
        threadId: "thread-1",
        tenantSlug: "",
        agentSlug: "",
        traceId: "",
      },
      env: {
        awsRegion: "us-east-1",
        agentCoreMemoryId: "",
        hindsightEndpoint: "",
        memoryEngine: "managed",
        memoryRetainFnName: "",
        dbClusterArn: "",
        dbSecretArn: "",
        dbName: "thinkwork",
        workspaceBucket: "",
        workspaceDir: "/tmp/workspace",
        gitSha: "test",
      },
      agentCoreClient: fakeAgentCoreClient() as never,
      workspaceSkills: [],
      connectMcpServer: noopConnect,
      sessionStoreFactory: () => ({}) as never,
      cleanup: [],
      handleStore: new HandleStore(),
      mcpJsonConfig: { directTools: [] },
      mcpRegistry: new McpToolRegistry(),
    });

    expect(bundle.tools.map((tool) => tool.name)).toContain("send_email");
  });
});

// ---------------------------------------------------------------------------
// Plan §006 U4 — mcp proxy registration + directTools validation.
// ---------------------------------------------------------------------------

describe("assembleTools — mcp proxy registration (Plan §006 U4)", () => {
  const baseIdentity = {
    tenantId: "tenant-1",
    userId: "user-1",
    agentId: "agent-1",
    threadId: "thread-1",
    tenantSlug: "",
    agentSlug: "",
    traceId: "",
  };

  const baseEnv = {
    awsRegion: "us-east-1",
    agentCoreMemoryId: "",
    hindsightEndpoint: "",
    memoryEngine: "managed" as const,
    memoryRetainFnName: "",
    dbClusterArn: "",
    dbSecretArn: "",
    dbName: "thinkwork",
    workspaceBucket: "",
    workspaceDir: "/tmp/workspace",
    gitSha: "test",
  };

  function popOneToolConnect(toolName: string): ConnectMcpServerFn {
    return async (args) => {
      args.registry?.register(args.serverName, {
        tool: toolName,
        description: `${toolName} description`,
        inputSchema: { type: "object" },
      });
      return [];
    };
  }

  it("registers the inert mcp proxy when MCP configs are present", async () => {
    const registry = new McpToolRegistry();
    const bundle = await assembleTools({
      payload: {
        mcp_configs: [
          {
            name: "slack",
            url: "https://mcp.slack.example/mcp",
            auth: { token: "FakeBearerForTestFixtureOnly_DoNotEcho" },
          },
        ],
      },
      identity: baseIdentity,
      env: baseEnv,
      agentCoreClient: fakeAgentCoreClient() as never,
      workspaceSkills: [],
      connectMcpServer: popOneToolConnect("search"),
      sessionStoreFactory: () => ({}) as never,
      cleanup: [],
      handleStore: new HandleStore(),
      mcpJsonConfig: { directTools: [] },
      mcpRegistry: registry,
    });
    const toolNames = bundle.tools.map((tool) => tool.name);
    expect(toolNames).toContain("mcp");
    expect(bundle.mcpProxyRegistered).toBe(true);
    expect(registry.size).toBe(1);
    bundle.handleStore.clear();
  });

  it("does not register the proxy when there are zero validated MCP configs", async () => {
    const registry = new McpToolRegistry();
    const bundle = await assembleTools({
      payload: {},
      identity: baseIdentity,
      env: baseEnv,
      agentCoreClient: fakeAgentCoreClient() as never,
      workspaceSkills: [],
      connectMcpServer: noopConnect,
      sessionStoreFactory: () => ({}) as never,
      cleanup: [],
      handleStore: new HandleStore(),
      mcpJsonConfig: { directTools: [] },
      mcpRegistry: registry,
    });
    expect(bundle.tools.map((tool) => tool.name)).not.toContain("mcp");
    expect(bundle.mcpProxyRegistered).toBe(false);
    bundle.handleStore.clear();
  });

  it("passes validation when every directTools entry resolves in the live registry", async () => {
    const registry = new McpToolRegistry();
    const bundle = await assembleTools({
      payload: {
        mcp_configs: [
          {
            name: "slack",
            url: "https://mcp.slack.example/mcp",
            auth: { token: "FakeBearerForTestFixtureOnly" },
          },
        ],
      },
      identity: baseIdentity,
      env: baseEnv,
      agentCoreClient: fakeAgentCoreClient() as never,
      workspaceSkills: [],
      connectMcpServer: popOneToolConnect("search"),
      sessionStoreFactory: () => ({}) as never,
      cleanup: [],
      handleStore: new HandleStore(),
      mcpJsonConfig: {
        directTools: [{ server: "slack", tool: "search" }],
      },
      mcpRegistry: registry,
    });
    expect(bundle.mcpProxyRegistered).toBe(true);
    bundle.handleStore.clear();
  });

  it("throws DirectToolsValidationError when a directTools entry references a missing tool", async () => {
    const registry = new McpToolRegistry();
    const { DirectToolsValidationError } = await import("../src/server.js");
    await expect(
      assembleTools({
        payload: {
          mcp_configs: [
            {
              name: "slack",
              url: "https://mcp.slack.example/mcp",
              auth: { token: "FakeBearerForTestFixtureOnly" },
            },
          ],
        },
        identity: baseIdentity,
        env: baseEnv,
        agentCoreClient: fakeAgentCoreClient() as never,
        workspaceSkills: [],
        connectMcpServer: popOneToolConnect("search"),
        sessionStoreFactory: () => ({}) as never,
        cleanup: [],
        handleStore: new HandleStore(),
        mcpJsonConfig: {
          directTools: [{ server: "slack", tool: "saerch" }],
        },
        mcpRegistry: registry,
      }),
    ).rejects.toThrow(DirectToolsValidationError);
  });

  it("throws when a directTools entry references an unconfigured server", async () => {
    const registry = new McpToolRegistry();
    const { DirectToolsValidationError } = await import("../src/server.js");
    await expect(
      assembleTools({
        payload: {
          mcp_configs: [
            {
              name: "slack",
              url: "https://mcp.slack.example/mcp",
              auth: { token: "FakeBearerForTestFixtureOnly" },
            },
          ],
        },
        identity: baseIdentity,
        env: baseEnv,
        agentCoreClient: fakeAgentCoreClient() as never,
        workspaceSkills: [],
        connectMcpServer: popOneToolConnect("search"),
        sessionStoreFactory: () => ({}) as never,
        cleanup: [],
        handleStore: new HandleStore(),
        mcpJsonConfig: {
          directTools: [{ server: "github", tool: "list_repos" }],
        },
        mcpRegistry: registry,
      }),
    ).rejects.toThrow(/directTools_validation_failed/);
  });

  it("the inert proxy tool's serialization contains no bearer fixtures", async () => {
    const registry = new McpToolRegistry();
    const bundle = await assembleTools({
      payload: {
        mcp_configs: [
          {
            name: "slack",
            url: "https://mcp.slack.example/mcp",
            auth: { token: "FakeBearerForTestFixtureOnly_DoNotEcho" },
          },
        ],
      },
      identity: baseIdentity,
      env: baseEnv,
      agentCoreClient: fakeAgentCoreClient() as never,
      workspaceSkills: [],
      connectMcpServer: popOneToolConnect("search"),
      sessionStoreFactory: () => ({}) as never,
      cleanup: [],
      handleStore: new HandleStore(),
      mcpJsonConfig: { directTools: [] },
      mcpRegistry: registry,
    });
    const serialised = JSON.stringify(bundle.tools);
    expect(serialised).not.toContain("FakeBearerForTestFixtureOnly");
    expect(serialised).not.toContain("DoNotEcho");
    bundle.handleStore.clear();
  });
});

// ---------------------------------------------------------------------------
// handleInvocation — end-of-turn auto-retain.
// ---------------------------------------------------------------------------

describe("handleInvocation — end-of-turn auto-retain", () => {
  it("body-swap safety: invokes memory-retain Lambda with InvocationType=Event and the canonical envelope", async () => {
    process.env.MEMORY_RETAIN_FN_NAME = "thinkwork-test-api-memory-retain";

    const sendCalls: { input: InvokeCommandInput; payload: unknown }[] = [];
    const stubLambda: LambdaClient = {
      send: vi.fn(async (command: InvokeCommand) => {
        const input = command.input as InvokeCommandInput;
        const payloadBytes = input.Payload;
        let decoded: unknown = null;
        if (payloadBytes instanceof Uint8Array) {
          decoded = JSON.parse(new TextDecoder().decode(payloadBytes));
        }
        sendCalls.push({ input, payload: decoded });
        return {} as never;
      }),
    } as unknown as LambdaClient;

    const result = await handleInvocation({
      payload: VALID_PAYLOAD({
        use_memory: true,
        messages_history: [
          { role: "user", content: "my favorite color is teal" },
          { role: "assistant", content: "Noted!" },
        ],
      }),
      deps: makeDeps({ lambdaClientFactory: () => stubLambda }),
    });

    expect(result.statusCode).toBe(200);
    expect(stubLambda.send).toHaveBeenCalledTimes(1);
    expect(sendCalls).toHaveLength(1);
    const call = sendCalls[0]!;
    expect(call.input.FunctionName).toBe("thinkwork-test-api-memory-retain");
    expect(call.input.InvocationType).toBe("Event");
    expect(call.payload).toEqual({
      tenantId: "tenant-1",
      userId: "user-1",
      threadId: "thread-1",
      transcript: [
        { role: "user", content: "my favorite color is teal" },
        { role: "assistant", content: "Noted!" },
        { role: "user", content: "Hello pi" },
        { role: "assistant", content: "stub response" },
      ],
    });
    // Surfaces retain status to callers (smoke gate, chat-agent-invoke).
    const body = result.body as Record<string, unknown>;
    expect(body.pi_retain).toEqual({ retained: true });
  });

  it("skips retain when use_memory is missing on the payload", async () => {
    process.env.MEMORY_RETAIN_FN_NAME = "thinkwork-test-api-memory-retain";
    const sendSpy = vi.fn();
    const stubLambda: LambdaClient = {
      send: sendSpy,
    } as unknown as LambdaClient;

    const result = await handleInvocation({
      payload: VALID_PAYLOAD(),
      deps: makeDeps({ lambdaClientFactory: () => stubLambda }),
    });

    expect(result.statusCode).toBe(200);
    expect(sendSpy).not.toHaveBeenCalled();
    const body = result.body as Record<string, unknown>;
    expect(body.pi_retain).toEqual({ retained: false });
  });

  it("skips retain when MEMORY_RETAIN_FN_NAME env is unset", async () => {
    // env var deliberately not set — beforeEach already cleared it.
    const sendSpy = vi.fn();
    const stubLambda: LambdaClient = {
      send: sendSpy,
    } as unknown as LambdaClient;

    const result = await handleInvocation({
      payload: VALID_PAYLOAD({ use_memory: true }),
      deps: makeDeps({ lambdaClientFactory: () => stubLambda }),
    });

    expect(result.statusCode).toBe(200);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("retain Lambda invoke failure does NOT affect the user-facing 200 response", async () => {
    process.env.MEMORY_RETAIN_FN_NAME = "thinkwork-test-api-memory-retain";
    const stubLambda: LambdaClient = {
      send: vi.fn(async () => {
        throw new Error("simulated retain timeout");
      }),
    } as unknown as LambdaClient;

    const result = await handleInvocation({
      payload: VALID_PAYLOAD({ use_memory: true }),
      deps: makeDeps({ lambdaClientFactory: () => stubLambda }),
    });

    expect(result.statusCode).toBe(200);
    const body = result.body as Record<string, unknown>;
    expect((body.response as Record<string, unknown>).content).toBe(
      "stub response",
    );
    // Retain failure surfaces in the response so operators (and the smoke
    // gate) can distinguish "did not attempt" from "attempted but failed".
    expect(body.pi_retain).toEqual({
      retained: false,
      error: expect.stringContaining("simulated retain timeout"),
    });
  });

  it("does NOT fire retain when the agent loop itself fails (no partial transcripts)", async () => {
    process.env.MEMORY_RETAIN_FN_NAME = "thinkwork-test-api-memory-retain";
    const sendSpy = vi.fn();
    const stubLambda: LambdaClient = {
      send: sendSpy,
    } as unknown as LambdaClient;

    const result = await handleInvocation({
      payload: VALID_PAYLOAD({ use_memory: true }),
      deps: makeDeps({
        lambdaClientFactory: () => stubLambda,
        runAgentLoop: (async () => {
          throw new Error("agent boom");
        }) as unknown as typeof import("../src/server.js").runAgentLoop,
      }),
    });

    expect(result.statusCode).toBe(500);
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test helpers.
// ---------------------------------------------------------------------------

interface MakeDepsOptions {
  connectMcpServerFactory?: ConnectMcpServerFn;
  runAgentLoop?: typeof import("../src/server.js").runAgentLoop;
  bootstrapWorkspaceImpl?: typeof import("../src/runtime/bootstrap-workspace.js").bootstrapWorkspace;
  fetchImpl?: typeof fetch;
  stageMessageAttachmentsImpl?: typeof import("../src/runtime/message-attachments.js").stageMessageAttachments;
  /** Hook fired after the agent loop finally block (before returning). */
  onHandlerComplete?: (
    bundle: import("../src/server.js").AssembledToolBundle,
  ) => void;
  /** Lambda client factory — overridden by retain integration tests. */
  lambdaClientFactory?: (region: string) => LambdaClient;
}

function fakeLambdaClient(): LambdaClient {
  return { send: vi.fn(async () => ({})) } as unknown as LambdaClient;
}

function makeDeps(opts: MakeDepsOptions = {}) {
  const stubAgentLoop: typeof import("../src/server.js").runAgentLoop = async ({
    tools,
  }) => ({
    content: "stub response",
    modelId: "amazon-bedrock/test-model",
    toolsCalled: (tools ?? []).map((t: AgentTool<any>) => t.name).slice(0, 1),
    toolInvocations: [],
  });

  return {
    agentCoreClientFactory: () => fakeAgentCoreClient() as never,
    s3ClientFactory: () => fakeS3Client() as never,
    lambdaClientFactory: opts.lambdaClientFactory ?? (() => fakeLambdaClient()),
    connectMcpServerFactory: opts.connectMcpServerFactory ?? noopConnect,
    sessionStoreFactory: () => ({}) as never,
    fetchImpl: opts.fetchImpl,
    runAgentLoop: opts.runAgentLoop ?? stubAgentLoop,
    bootstrapWorkspaceImpl:
      opts.bootstrapWorkspaceImpl ?? ((async () => {}) as never),
    stageMessageAttachmentsImpl: opts.stageMessageAttachmentsImpl,
    discoverWorkspaceSkillsImpl: (async () => []) as never,
    onHandlerComplete: opts.onHandlerComplete,
  };
}
