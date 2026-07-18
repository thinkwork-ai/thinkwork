import { describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  createHarnessCodeInterpreterHandler,
  type HarnessCodeInterpreterDeps,
} from "./harness-code-interpreter-target.js";
import type { ToolExecutionEventInsert } from "../lib/harness/tool-execution-ledger.js";

const claims = {
  sub: "user-1",
  participant_id: "user-1",
  tenant_id: "tenant-1",
  space_id: "space-1",
  agent_id: "agent-1",
  thread_id: "thread-1",
  turn_id: "turn-1",
  session_generation: 1,
};

function event(
  body: Record<string, unknown>,
  headers: Record<string, string> = { authorization: "Bearer valid" },
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "POST /agentcore/capabilities/sandbox/execute",
    rawPath: "/agentcore/capabilities/sandbox/execute",
    rawQueryString: "",
    headers,
    requestContext: {
      accountId: "account",
      apiId: "api",
      domainName: "example.test",
      domainPrefix: "example",
      http: {
        method: "POST",
        path: "/agentcore/capabilities/sandbox/execute",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "gateway-tool-1",
      routeKey: "route",
      stage: "$default",
      time: "",
      timeEpoch: 0,
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function setup(overrides: Partial<HarnessCodeInterpreterDeps> = {}) {
  const rows: ToolExecutionEventInsert[] = [];
  let now = 1_000;
  const deps: HarnessCodeInterpreterDeps = {
    verifyAccessToken: vi.fn(() => claims),
    resolveCanonicalContext: vi.fn(async () => ({
      tenantId: "tenant-1",
      userId: "user-1",
      agentId: "agent-1",
      threadId: "thread-1",
      turnId: "turn-1",
      triggeringMessageId: "message-1",
      spaceId: "space-1",
    })),
    resolveInterpreterId: vi.fn(async () => "interpreter-internal"),
    execute: vi.fn(async () => ({
      sessionAlias: "sandbox:0123456789abcdef",
      result: {
        stdout: "42\n",
        stderr: "",
        exitCode: 0,
        executionTimeSeconds: 0.02,
        files: [{ path: "/tmp/thinkwork/result.txt", text: "42\n" }],
        truncated: false,
      },
    })),
    ledgerStore: {
      async append(row) {
        rows.push(row);
        return { id: rows.length };
      },
    },
    policyRevision: "sandbox-execute-v1",
    now: () => (now += 10),
    ...overrides,
  };
  return { handler: createHarnessCodeInterpreterHandler(deps), deps, rows };
}

const validBody = {
  tenant_id: "tenant-1",
  language: "python",
  code: "from pathlib import Path\nPath('/tmp/thinkwork').mkdir(exist_ok=True)\nprint(6 * 7)",
  output_files: ["/tmp/thinkwork/result.txt"],
};

describe("Harness Code Interpreter target", () => {
  it("executes as the canonical participant and records redacted lifecycle evidence", async () => {
    const { handler, deps, rows } = setup();
    const result = await handler(event(validBody));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body!)).toEqual({
      is_error: false,
      stdout: "42\n",
      stderr: "",
      exit_code: 0,
      execution_time_seconds: 0.02,
      files: [{ path: "/tmp/thinkwork/result.txt", text: "42\n" }],
      truncated: false,
    });
    expect(deps.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        interpreterId: "interpreter-internal",
        turnId: "turn-1",
        toolUseId: "gateway-tool-1",
      }),
    );
    expect(rows.map((row) => row.event_type)).toEqual(["started", "completed"]);
    expect(rows[0]?.input_preview).toEqual({
      language: "python",
      codeBytes: expect.any(Number),
      outputFileCount: 1,
    });
    expect(JSON.stringify(rows)).not.toContain("from pathlib");
    expect(rows[1]?.output_preview).toEqual({
      sessionAlias: "sandbox:0123456789abcdef",
      exitCode: 0,
      fileCount: 1,
      truncated: false,
    });
  });

  it("denies tenant and header identity overrides before touching canonical state", async () => {
    const { handler, deps, rows } = setup();
    const tenantMismatch = await handler(
      event({ ...validBody, tenant_id: "tenant-2" }),
    );
    const headerOverride = await handler(
      event(validBody, {
        authorization: "Bearer valid",
        "x-thinkwork-user-id": "user-2",
      }),
    );
    expect(tenantMismatch.statusCode).toBe(403);
    expect(headerOverride.statusCode).toBe(400);
    expect(deps.resolveCanonicalContext).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it("fails closed when the tenant has no internal interpreter", async () => {
    const { handler, deps, rows } = setup({
      resolveInterpreterId: vi.fn(async () => null),
    });
    const result = await handler(event(validBody));
    expect(result.statusCode).toBe(409);
    expect(deps.execute).not.toHaveBeenCalled();
    expect(rows.map((row) => row.event_type)).toEqual(["started", "failed"]);
    expect(rows[1]?.error_preview).toEqual({ code: "sandbox_not_configured" });
  });

  it("records an uncertain terminal event when the provider lifecycle throws", async () => {
    const { handler, rows } = setup({
      execute: vi.fn(async () => {
        throw new Error("provider included secret-value in its failure");
      }),
    });
    const result = await handler(event(validBody));
    expect(result.statusCode).toBe(502);
    expect(result.body).not.toContain("secret-value");
    expect(JSON.stringify(rows)).not.toContain("secret-value");
    expect(rows.map((row) => row.event_type)).toEqual(["started", "uncertain"]);
  });
});
