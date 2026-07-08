/**
 * Routing tests for the `workflow` webhook target branch (THINK-216):
 * a webhook repointed from a migrated Automation starts a shared-interpreter
 * run with the caller payload and returns the run identifier (R13/R15).
 */
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectRows: unknown[][] = [];
  const insertValues: Record<string, unknown>[] = [];
  const startInterpreterRun = vi.fn();

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => selectRows.shift() ?? []),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        insertValues.push(values);
        return { returning: vi.fn(async () => []) };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(async () => []) })),
    })),
  };

  return { db, selectRows, insertValues, startInterpreterRun };
});

vi.mock("../lib/db.js", () => ({ db: mocks.db }));
vi.mock("../lib/spaces/space-webhook-thread-start.js", () => ({
  startSpaceWebhookThread: vi.fn(),
}));
vi.mock("../lib/workflows/start-interpreter-run.js", () => ({
  startInterpreterRun: mocks.startInterpreterRun,
}));

const { handler } = await import("./webhooks.js");

function workflowWebhook(overrides: Record<string, unknown> = {}) {
  return {
    id: "hook-w",
    tenant_id: "tenant-1",
    target_type: "workflow",
    workflow_id: "wf-1",
    agent_loop_id: "loop-1",
    space_id: null,
    created_by_type: "user",
    created_by_id: "user-1",
    name: "n8n inbound",
    enabled: true,
    rate_limit: 60,
    ...overrides,
  };
}

function webhookEvent(body: string): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "POST /webhooks/{token}",
    rawPath: "/webhooks/tok-w",
    rawQueryString: "",
    headers: { "content-type": "application/json" },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "example.test",
      domainPrefix: "example",
      http: {
        method: "POST",
        path: "/webhooks/tok-w",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "req-1",
      routeKey: "POST /webhooks/{token}",
      stage: "$default",
      time: "04/Jul/2026:00:00:00 +0000",
      timeEpoch: 1783123200000,
    },
    body,
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

beforeEach(() => {
  mocks.selectRows.length = 0;
  mocks.insertValues.length = 0;
  mocks.startInterpreterRun.mockReset();
});

describe("workflow webhook handler routing (THINK-216)", () => {
  it("starts an interpreter run with the caller payload and returns the run id", async () => {
    mocks.selectRows.push([workflowWebhook()]);
    mocks.startInterpreterRun.mockResolvedValue({
      ok: true,
      runId: "run-9",
      created: true,
    });

    const response = await handler(
      webhookEvent(JSON.stringify({ resumeUrl: "https://n8n.example/r/1" })),
    );

    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body ?? "{}")).toMatchObject({
      ok: true,
      runId: "run-9",
      deduplicated: false,
    });
    expect(mocks.startInterpreterRun).toHaveBeenCalledTimes(1);
    const input = mocks.startInterpreterRun.mock.calls[0][0];
    expect(input).toMatchObject({
      tenantId: "tenant-1",
      workflowId: "wf-1",
      triggerFamily: "webhook",
      actorType: "webhook",
      actorId: "hook-w",
      payload: { resumeUrl: "https://n8n.example/r/1" },
      requestedByUserId: "user-1",
    });
    expect(input.idempotencyKey).toMatch(/^webhook:hook-w:/);
  });

  it("dedupes an identical delivery to the same run", async () => {
    mocks.selectRows.push([workflowWebhook()]);
    mocks.startInterpreterRun.mockResolvedValue({
      ok: true,
      runId: "run-9",
      created: false,
    });
    const response = await handler(webhookEvent(JSON.stringify({ a: 1 })));
    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body ?? "{}")).toMatchObject({
      ok: true,
      runId: "run-9",
      deduplicated: true,
    });
  });

  it("maps a ThinkWork-level start refusal to a 409 with the reason", async () => {
    mocks.selectRows.push([workflowWebhook()]);
    mocks.startInterpreterRun.mockResolvedValue({
      ok: false,
      reason: "workflow_has_no_published_version",
    });
    const response = await handler(webhookEvent("{}"));
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body ?? "{}")).toMatchObject({
      ok: false,
      reason: "workflow_has_no_published_version",
    });
  });
});
