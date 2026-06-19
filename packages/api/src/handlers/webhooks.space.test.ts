import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectRows: unknown[][] = [];
  const insertValues: Record<string, unknown>[] = [];
  const updateValues: Record<string, unknown>[] = [];
  const startSpaceWebhookThread = vi.fn();

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => selectRows.shift() ?? []),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        insertValues.push(values);
        return {
          returning: vi.fn(async () =>
            values.source === "webhook" ? [{ id: "wakeup-1" }] : [],
          ),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updateValues.push(values);
        return {
          where: vi.fn(async () => []),
        };
      }),
    })),
  };

  return {
    db,
    selectRows,
    insertValues,
    updateValues,
    startSpaceWebhookThread,
  };
});

vi.mock("../lib/db.js", () => ({
  db: mocks.db,
}));

vi.mock("../lib/spaces/space-webhook-thread-start.js", () => ({
  startSpaceWebhookThread: mocks.startSpaceWebhookThread,
}));

const { handler } = await import("./webhooks.js");

describe("Space-scoped generic webhooks", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.selectRows.length = 0;
    mocks.insertValues.length = 0;
    mocks.updateValues.length = 0;
    mocks.startSpaceWebhookThread.mockReset();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("starts a durable Space thread before queueing the agent wakeup", async () => {
    mocks.selectRows.push([agentWebhook()]);
    mocks.startSpaceWebhookThread.mockResolvedValue(threadStartResult());

    const response = await handler(
      webhookEvent({
        event: "opportunity.stage.customer",
        opportunityId: "opp-1",
        companyName: "McPherson Oil",
      }),
    );
    const body = JSON.parse(response.body ?? "{}");

    expect(response.statusCode).toBe(201);
    expect(body).toMatchObject({
      ok: true,
      wakeupRequestId: "wakeup-1",
      threadId: "thread-1",
    });
    expect(mocks.startSpaceWebhookThread).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      agentId: "agent-1",
      spaceId: "space-1",
      webhookId: "webhook-1",
      webhookName: "Twenty Customer Stage",
      payload: {
        event: "opportunity.stage.customer",
        opportunityId: "opp-1",
        companyName: "McPherson Oil",
      },
    });

    const wakeup = mocks.insertValues.find(
      (values) => values.source === "webhook",
    );
    expect(wakeup).toMatchObject({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      trigger_detail: "webhook:webhook-1",
      requested_by_actor_type: "system",
      payload: expect.objectContaining({
        threadId: "thread-1",
        spaceId: "space-1",
        webhookId: "webhook-1",
        webhookName: "Twenty Customer Stage",
        openingMessageAlreadyPersisted: true,
        openingMessageContent: 'Webhook "Twenty Customer Stage" was triggered.',
        webhookPayload: {
          event: "opportunity.stage.customer",
          opportunityId: "opp-1",
          companyName: "McPherson Oil",
        },
      }),
    });
    const delivery = deliveryRecord();
    expect(delivery).toMatchObject({
      webhook_id: "webhook-1",
      tenant_id: "tenant-1",
      target_type: "agent",
      resolution_status: "ok",
      thread_id: "thread-1",
      thread_created: true,
      status_code: 201,
    });
  });

  it("returns accepted-with-warning when workflow initialization degrades after thread creation", async () => {
    mocks.selectRows.push([agentWebhook()]);
    mocks.startSpaceWebhookThread.mockResolvedValue(
      threadStartResult({
        warnings: [
          {
            code: "CUSTOMER_ONBOARDING_WORKFLOW_FAILED",
            message: "Customer Onboarding workflow could not be initialized.",
            workflowKey: "customer_onboarding",
          },
        ],
      }),
    );

    const response = await handler(
      webhookEvent({
        event: "opportunity.stage.customer",
        opportunityId: "opp-no-customer",
      }),
    );
    const body = JSON.parse(response.body ?? "{}");

    expect(response.statusCode).toBe(202);
    expect(body).toMatchObject({
      ok: true,
      wakeupRequestId: "wakeup-1",
      threadId: "thread-1",
      warning: "Customer Onboarding workflow could not be initialized.",
      warnings: [
        {
          code: "CUSTOMER_ONBOARDING_WORKFLOW_FAILED",
          workflowKey: "customer_onboarding",
        },
      ],
    });
    expect(deliveryRecord()).toMatchObject({
      resolution_status: "ok",
      thread_id: "thread-1",
      thread_created: true,
      status_code: 202,
      error_message: "Customer Onboarding workflow could not be initialized.",
    });
  });

  it("keeps pre-thread starter failures retryable as non-2xx responses", async () => {
    mocks.selectRows.push([agentWebhook()]);
    mocks.startSpaceWebhookThread.mockRejectedValue(
      new Error("Webhook opening message could not be created"),
    );

    const response = await handler(webhookEvent({ event: "broken" }));
    const body = JSON.parse(response.body ?? "{}");

    expect(response.statusCode).toBe(500);
    expect(body).toMatchObject({
      error: "Failed to start webhook thread",
    });
    expect(
      mocks.insertValues.some((values) => values.source === "webhook"),
    ).toBe(false);
    expect(deliveryRecord()).toMatchObject({
      resolution_status: "error",
      thread_id: undefined,
      thread_created: undefined,
      status_code: 500,
      error_message: "Webhook opening message could not be created",
    });
  });
});

function agentWebhook() {
  return {
    id: "webhook-1",
    tenant_id: "tenant-1",
    target_type: "agent",
    agent_id: "agent-1",
    routine_id: null,
    space_id: "space-1",
    name: "Twenty Customer Stage",
    prompt: "Summarize the customer-stage payload.",
    enabled: true,
    rate_limit: 60,
    created_by_type: "system",
    created_by_id: null,
  };
}

function threadStartResult(
  overrides: {
    warnings?: Array<{
      code: string;
      message: string;
      workflowKey?: string;
    }>;
  } = {},
) {
  return {
    threadId: "thread-1",
    identifier: "HOOK-42",
    number: 42,
    openingMessageId: "message-1",
    openingMessageContent: 'Webhook "Twenty Customer Stage" was triggered.',
    openingMessageAlreadyPersisted: true,
    warnings: overrides.warnings ?? [],
    workflow: null,
    agentContext: {
      webhookPayload: {
        event: "opportunity.stage.customer",
        opportunityId: "opp-1",
        companyName: "McPherson Oil",
      },
      webhookId: "webhook-1",
      webhookName: "Twenty Customer Stage",
      spaceId: "space-1",
      openingMessageId: "message-1",
      openingMessageAlreadyPersisted: true,
      workflowWarnings: overrides.warnings ?? [],
    },
  };
}

function webhookEvent(body: Record<string, unknown>): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "POST /webhooks/{token}",
    rawPath: "/webhooks/token-1",
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      "user-agent": "vitest",
    },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "example.test",
      domainPrefix: "example",
      http: {
        method: "POST",
        path: "/webhooks/token-1",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "request-1",
      routeKey: "POST /webhooks/{token}",
      stage: "$default",
      time: "19/Jun/2026:12:00:00 +0000",
      timeEpoch: 1781860800000,
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function deliveryRecord() {
  return mocks.insertValues.find((values) =>
    Object.prototype.hasOwnProperty.call(values, "signature_status"),
  );
}
