/**
 * Contract tests for `testWebhook`.
 *
 * Branches:
 *   1. Row missing → throws (no auth probe, no insert).
 *   2. Auth gate against row.tenant_id (not caller's claim).
 *   3. Happy path: inserts a webhook_deliveries row with
 *      `resolution_status: "test"`, no dispatch side effect.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  webhookSelect: vi.fn(),
  deliveryInsert: vi.fn(),
  insertedValues: undefined as Record<string, unknown> | undefined,
  requireAdminOrServiceCaller: vi.fn(),
}));

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => mocks.webhookSelect(),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        mocks.insertedValues = v;
        return {
          returning: () => mocks.deliveryInsert(),
        };
      },
    }),
  },
  webhooks: {
    id: "webhooks.id",
    tenant_id: "webhooks.tenant_id",
    target_type: "webhooks.target_type",
  },
  webhookDeliveries: {
    webhook_id: "webhook_deliveries.webhook_id",
    received_at: "webhook_deliveries.received_at",
  },
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  snakeToCamel: (row: Record<string, unknown>) => ({
    id: row.id,
    webhookId: row.webhook_id,
    resolutionStatus: row.resolution_status,
  }),
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mocks.requireAdminOrServiceCaller,
}));

// eslint-disable-next-line import/first
import { testWebhook } from "./testWebhook.mutation.js";

const ctx = () =>
  ({
    auth: {
      authType: "service" as const,
      principalId: null,
      tenantId: null,
      email: null,
      agentId: null,
    },
  }) as any;

beforeEach(() => {
  mocks.webhookSelect.mockReset();
  mocks.deliveryInsert.mockReset();
  mocks.insertedValues = undefined;
  mocks.requireAdminOrServiceCaller.mockReset();
});

describe("testWebhook", () => {
  it("throws when the webhook id resolves to nothing (no auth probe)", async () => {
    mocks.webhookSelect.mockResolvedValue([]);

    await expect(testWebhook(null, { id: "wh-x" }, ctx())).rejects.toThrow(
      /not found/,
    );

    expect(mocks.requireAdminOrServiceCaller).not.toHaveBeenCalled();
    expect(mocks.insertedValues).toBeUndefined();
  });

  it("auth-gates by row.tenant_id before any insert", async () => {
    mocks.webhookSelect.mockResolvedValue([
      { id: "wh-1", tenant_id: "tenant-A", target_type: "agent" },
    ]);
    mocks.requireAdminOrServiceCaller.mockRejectedValue(
      Object.assign(new Error("FORBIDDEN"), {
        extensions: { code: "FORBIDDEN" },
      }),
    );

    await expect(
      testWebhook(null, { id: "wh-1" }, ctx()),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });

    expect(mocks.requireAdminOrServiceCaller).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-A",
      "test_webhook",
    );
    expect(mocks.insertedValues).toBeUndefined();
  });

  it("inserts a webhook_deliveries row with resolution_status='test' and returns it", async () => {
    mocks.webhookSelect.mockResolvedValue([
      { id: "wh-2", tenant_id: "tenant-A", target_type: "routine" },
    ]);
    mocks.requireAdminOrServiceCaller.mockResolvedValue(undefined);
    mocks.deliveryInsert.mockResolvedValue([
      {
        id: "wd-test-1",
        webhook_id: "wh-2",
        resolution_status: "test",
      },
    ]);

    const result = await testWebhook(null, { id: "wh-2" }, ctx());

    expect(result).toEqual({
      id: "wd-test-1",
      webhookId: "wh-2",
      resolutionStatus: "test",
    });

    expect(mocks.insertedValues).toMatchObject({
      webhook_id: "wh-2",
      tenant_id: "tenant-A",
      target_type: "routine",
      resolution_status: "test",
      signature_status: "not_required",
      source_ip: "127.0.0.1",
      retry_count: 0,
      is_replay: false,
    });
    expect(mocks.insertedValues!.body_preview).toMatch(/_thinkwork_test/);
  });
});
