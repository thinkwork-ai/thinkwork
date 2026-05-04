import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CompletionCallbackAuthError,
  assembleTools,
  handleInvocation,
  postCompletion,
} from "../src/server.js";
import type { ConnectMcpServerFn } from "../src/mcp.js";
import type { AgentTool } from "@mariozechner/pi-agent-core";

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
  message: "Hello flue",
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
    expect(result.body.runtime).toBe("flue");
  });

  it("returns 400 when message is empty", async () => {
    const result = await handleInvocation({
      payload: VALID_PAYLOAD({ message: "" }),
      deps: makeDeps(),
    });
    expect(result.statusCode).toBe(400);
    expect(result.body.error).toMatch(/non-empty `message`/);
  });

  it("returns 500 when sandbox_interpreter_id is missing (contract violation)", async () => {
    const result = await handleInvocation({
      payload: VALID_PAYLOAD({ sandbox_interpreter_id: "" }),
      deps: makeDeps(),
    });
    expect(result.statusCode).toBe(500);
    expect(result.body.error).toMatch(/sandbox_interpreter_id/);
  });
});

// ---------------------------------------------------------------------------
// handleInvocation — happy path.
// ---------------------------------------------------------------------------

describe("handleInvocation — happy path", () => {
  it("returns the agent loop's content + completion callback fires once", async () => {
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
      payload: VALID_PAYLOAD(),
      deps: makeDeps({ fetchImpl }),
    });

    expect(result.statusCode).toBe(200);
    const body = result.body as Record<string, unknown>;
    expect(body.runtime).toBe("flue");
    expect((body.response as Record<string, unknown>).content).toBe(
      "stub response",
    );
    expect(fetchCalls).toHaveLength(1);

    const [callUrl, init] = fetchCalls[0]!;
    expect(callUrl).toBe("https://api.example.com/api/skills/complete");
    expect(init?.method).toBe("POST");
    const body2 = JSON.parse((init?.body ?? "") as string);
    expect(body2).toMatchObject({
      skill_run_id: "thread-1",
      tenant_id: "tenant-1",
      user_id: "user-1",
      agent_id: "agent-1",
      runtime: "flue",
      status: "ok",
    });
    expect(typeof body2.latency_ms).toBe("number");
  });

  it("falls back to no callback when secrets are missing (warn, not error)", async () => {
    let fetchCalled = 0;
    const fetchImpl: typeof fetch = (async () => {
      fetchCalled += 1;
      return new Response();
    }) as unknown as typeof fetch;
    const result = await handleInvocation({
      payload: VALID_PAYLOAD({
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
      payload: VALID_PAYLOAD({ mcp_configs: fakeMcpConfigs }),
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
    // 401 wasn't surfaced — the fetch was for the error-path completion.
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
      typeof c[0] === "string" ? c[0] : c[0]?.toString() ?? "",
    );
    const rejects = writes.filter((line) =>
      line.includes("mcp_url_rejected"),
    );
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
      typeof c[0] === "string" ? c[0] : c[0]?.toString() ?? "",
    );
    const fails = writes.filter((line) =>
      line.includes("mcp_connect_failed"),
    );
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
          },
          latencyMs: 100,
        },
        fetchImpl,
      }),
    ).rejects.toThrow(CompletionCallbackAuthError);

    const writes = stdoutSpy.mock.calls.map((c) =>
      typeof c[0] === "string" ? c[0] : c[0]?.toString() ?? "",
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
        runResult: { content: "x", modelId: "m", toolsCalled: [] },
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
        runResult: { content: "x", modelId: "m", toolsCalled: [] },
        latencyMs: 100,
      },
      fetchImpl,
    });
    expect(called).toBe(0);
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

// ---------------------------------------------------------------------------
// Test helpers.
// ---------------------------------------------------------------------------

interface MakeDepsOptions {
  connectMcpServerFactory?: ConnectMcpServerFn;
  runAgentLoop?: typeof import("../src/server.js").runAgentLoop;
  fetchImpl?: typeof fetch;
  /** Hook fired after the agent loop finally block (before returning). */
  onHandlerComplete?: (
    bundle: import("../src/server.js").AssembledToolBundle,
  ) => void;
}

function makeDeps(opts: MakeDepsOptions = {}) {
  const stubAgentLoop: typeof import("../src/server.js").runAgentLoop = async ({
    tools,
  }) => ({
    content: "stub response",
    modelId: "amazon-bedrock/test-model",
    toolsCalled: (tools ?? []).map((t: AgentTool<any>) => t.name).slice(0, 1),
  });

  return {
    agentCoreClientFactory: () => fakeAgentCoreClient() as never,
    s3ClientFactory: () => fakeS3Client() as never,
    connectMcpServerFactory:
      opts.connectMcpServerFactory ?? noopConnect,
    sessionStoreFactory: () => ({}) as never,
    fetchImpl: opts.fetchImpl,
    runAgentLoop: opts.runAgentLoop ?? stubAgentLoop,
    bootstrapWorkspaceImpl: (async () => {}) as never,
    discoverWorkspaceSkillsImpl: (async () => []) as never,
    onHandlerComplete: opts.onHandlerComplete,
  };
}
