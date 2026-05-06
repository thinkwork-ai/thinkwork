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
} from "../src/server.js";
import { HandleStore, type ConnectMcpServerFn } from "../src/mcp.js";
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
    expect(body.runtime).toBe("flue");
    expect((body.response as Record<string, unknown>).content).toBe(
      "stub response",
    );
    expect(fetchCalled).toBe(0);
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
        runResult: { content: "x", modelId: "m", toolsCalled: [], toolInvocations: [] },
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
        runResult: { content: "x", modelId: "m", toolsCalled: [], toolInvocations: [] },
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
        { role: "user", content: "Hello flue" },
        { role: "assistant", content: "stub response" },
      ],
    });
    // Surfaces retain status to callers (smoke gate, chat-agent-invoke).
    const body = result.body as Record<string, unknown>;
    expect(body.flue_retain).toEqual({ retained: true });
  });

  it("skips retain when use_memory is missing on the payload", async () => {
    process.env.MEMORY_RETAIN_FN_NAME = "thinkwork-test-api-memory-retain";
    const sendSpy = vi.fn();
    const stubLambda: LambdaClient = { send: sendSpy } as unknown as LambdaClient;

    const result = await handleInvocation({
      payload: VALID_PAYLOAD(),
      deps: makeDeps({ lambdaClientFactory: () => stubLambda }),
    });

    expect(result.statusCode).toBe(200);
    expect(sendSpy).not.toHaveBeenCalled();
    const body = result.body as Record<string, unknown>;
    expect(body.flue_retain).toEqual({ retained: false });
  });

  it("skips retain when MEMORY_RETAIN_FN_NAME env is unset", async () => {
    // env var deliberately not set — beforeEach already cleared it.
    const sendSpy = vi.fn();
    const stubLambda: LambdaClient = { send: sendSpy } as unknown as LambdaClient;

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
    expect(body.flue_retain).toEqual({
      retained: false,
      error: expect.stringContaining("simulated retain timeout"),
    });
  });

  it("does NOT fire retain when the agent loop itself fails (no partial transcripts)", async () => {
    process.env.MEMORY_RETAIN_FN_NAME = "thinkwork-test-api-memory-retain";
    const sendSpy = vi.fn();
    const stubLambda: LambdaClient = { send: sendSpy } as unknown as LambdaClient;

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
  fetchImpl?: typeof fetch;
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
