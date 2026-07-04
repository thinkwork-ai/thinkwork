import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Sequential-select mock db (mirrors webhooks.space.test.ts). The automation
// branch delegates dispatch to a mocked module, so the db here only serves the
// token lookup + delivery-audit insert.
const mocks = vi.hoisted(() => {
  const selectRows: unknown[][] = [];
  const insertValues: Record<string, unknown>[] = [];
  const updateValues: Record<string, unknown>[] = [];
  const dispatchAutomationWebhook = vi.fn();

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
      set: vi.fn((values: Record<string, unknown>) => {
        updateValues.push(values);
        return { where: vi.fn(async () => []) };
      }),
    })),
  };

  return {
    db,
    selectRows,
    insertValues,
    updateValues,
    dispatchAutomationWebhook,
  };
});

vi.mock("../lib/db.js", () => ({ db: mocks.db }));
vi.mock("../lib/spaces/space-webhook-thread-start.js", () => ({
  startSpaceWebhookThread: vi.fn(),
}));
vi.mock("../lib/webhooks/automation-webhook-dispatch.js", () => ({
  dispatchAutomationWebhook: mocks.dispatchAutomationWebhook,
}));

const { handler } = await import("./webhooks.js");

function automationWebhook(overrides: Record<string, unknown> = {}) {
  return {
    id: "hook-a",
    tenant_id: "tenant-1",
    target_type: "automation",
    agent_loop_id: "loop-1",
    name: "Twenty CRM",
    enabled: true,
    rate_limit: 60,
    ...overrides,
  };
}

function webhookEvent(
  body: string,
  headers: Record<string, string> = {},
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "POST /webhooks/{token}",
    rawPath: "/webhooks/tok-a",
    rawQueryString: "",
    headers: { "content-type": "application/json", ...headers },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "example.test",
      domainPrefix: "example",
      http: {
        method: "POST",
        path: "/webhooks/tok-a",
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

function deliveryRecord() {
  return mocks.insertValues.find((values) =>
    Object.prototype.hasOwnProperty.call(values, "signature_status"),
  );
}

describe("automation webhook handler routing", () => {
  beforeEach(() => {
    mocks.selectRows.length = 0;
    mocks.insertValues.length = 0;
    mocks.updateValues.length = 0;
    mocks.dispatchAutomationWebhook.mockReset();
  });

  it("routes an automation delivery to the shared dispatcher and mirrors its outcome", async () => {
    mocks.selectRows.push([automationWebhook()]);
    mocks.dispatchAutomationWebhook.mockResolvedValue({
      response: {
        statusCode: 201,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true, runId: "run-1" }),
      },
      delivery: {
        resolution_status: "ok",
        status_code: 201,
        thread_id: "thread-1",
        thread_created: true,
      },
    });

    const body = JSON.stringify({ event: "opportunity.created" });
    const response = await handler(
      webhookEvent(body, { "x-idempotency-key": "hdr-1" }),
    );

    expect(response.statusCode).toBe(201);
    expect(mocks.dispatchAutomationWebhook).toHaveBeenCalledWith({
      webhook: expect.objectContaining({
        id: "hook-a",
        target_type: "automation",
      }),
      parsedBody: { event: "opportunity.created" },
      rawBody: body,
      headerIdempotencyKey: "hdr-1",
    });
    expect(deliveryRecord()).toMatchObject({
      webhook_id: "hook-a",
      tenant_id: "tenant-1",
      target_type: "automation",
      resolution_status: "ok",
      status_code: 201,
      thread_id: "thread-1",
      thread_created: true,
    });
  });

  it("mirrors a 429 guard skip from the dispatcher and logs the delivery", async () => {
    mocks.selectRows.push([automationWebhook()]);
    mocks.dispatchAutomationWebhook.mockResolvedValue({
      response: {
        statusCode: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "60" },
        body: JSON.stringify({ error: "concurrency cap" }),
      },
      delivery: {
        resolution_status: "rate_limited",
        status_code: 429,
        error_message: "concurrency cap",
      },
    });

    const response = await handler(webhookEvent(JSON.stringify({ a: 1 })));
    expect(response.statusCode).toBe(429);
    expect(response.headers?.["Retry-After"]).toBe("60");
    expect(deliveryRecord()).toMatchObject({
      resolution_status: "rate_limited",
      status_code: 429,
    });
  });

  it("rejects malformed JSON with 400, logs the delivery, and never dispatches", async () => {
    mocks.selectRows.push([automationWebhook()]);

    const response = await handler(webhookEvent("{not json"));

    expect(response.statusCode).toBe(400);
    expect(mocks.dispatchAutomationWebhook).not.toHaveBeenCalled();
    expect(deliveryRecord()).toMatchObject({
      resolution_status: "invalid_body",
      status_code: 400,
    });
  });

  it("enforces the rate limit before dispatching", async () => {
    // rate_limit: 1 — second delivery in the window is rejected.
    mocks.selectRows.push([
      automationWebhook({ id: "hook-rl", rate_limit: 1 }),
    ]);
    mocks.selectRows.push([
      automationWebhook({ id: "hook-rl", rate_limit: 1 }),
    ]);
    mocks.dispatchAutomationWebhook.mockResolvedValue({
      response: { statusCode: 201, headers: {}, body: "{}" },
      delivery: { resolution_status: "ok", status_code: 201 },
    });

    const first = await handler(webhookEvent(JSON.stringify({ a: 1 })));
    const second = await handler(webhookEvent(JSON.stringify({ a: 2 })));

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(429);
    expect(mocks.dispatchAutomationWebhook).toHaveBeenCalledTimes(1);
  });
});
