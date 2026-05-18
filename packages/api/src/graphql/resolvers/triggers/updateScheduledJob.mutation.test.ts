/**
 * Contract tests for `updateScheduledJob`.
 *
 * Branches:
 *   1. Row missing → throws (no auth probe, no Lambda).
 *   2. Auth gate against row.tenant_id.
 *   3. Lambda failure → throws with diagnostic (resolver does not
 *      partial-write the DB row; the Lambda is the single writer).
 *   4. Happy path → Lambda gets `triggerId` + the supplied fields;
 *      config-as-string is JSON.parsed before forwarding; refreshed
 *      row is returned.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectFirst: vi.fn(),
  selectRefreshed: vi.fn(),
  invokeJobScheduleManager: vi.fn(),
  requireAdminOrServiceCaller: vi.fn(),
}));

let selectCallCount = 0;
vi.mock("../../utils.js", () => ({
  db: {
    select: (_proj?: unknown) => ({
      from: () => ({
        where: () => {
          selectCallCount += 1;
          return selectCallCount === 1
            ? mocks.selectFirst()
            : mocks.selectRefreshed();
        },
      }),
    }),
  },
  scheduledJobs: {
    id: "scheduled_jobs.id",
    tenant_id: "scheduled_jobs.tenant_id",
  },
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  snakeToCamel: (row: Record<string, unknown>) => ({
    id: row.id,
    tenantId: row.tenant_id,
    scheduleExpression: row.schedule_expression,
    enabled: row.enabled,
  }),
  invokeJobScheduleManager: mocks.invokeJobScheduleManager,
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mocks.requireAdminOrServiceCaller,
}));

// eslint-disable-next-line import/first
import { updateScheduledJob } from "./updateScheduledJob.mutation.js";

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
  selectCallCount = 0;
  mocks.selectFirst.mockReset();
  mocks.selectRefreshed.mockReset();
  mocks.invokeJobScheduleManager.mockReset();
  mocks.requireAdminOrServiceCaller.mockReset();
});

describe("updateScheduledJob", () => {
  it("throws when the row is missing — no auth probe, no Lambda", async () => {
    mocks.selectFirst.mockResolvedValue([]);

    await expect(
      updateScheduledJob(null, { id: "sj-x", input: { enabled: false } }, ctx()),
    ).rejects.toThrow(/not found/);

    expect(mocks.requireAdminOrServiceCaller).not.toHaveBeenCalled();
    expect(mocks.invokeJobScheduleManager).not.toHaveBeenCalled();
  });

  it("auth-gates by row.tenant_id before the Lambda invoke", async () => {
    mocks.selectFirst.mockResolvedValue([
      { id: "sj-1", tenant_id: "tenant-A" },
    ]);
    mocks.requireAdminOrServiceCaller.mockRejectedValue(
      Object.assign(new Error("FORBIDDEN"), {
        extensions: { code: "FORBIDDEN" },
      }),
    );

    await expect(
      updateScheduledJob(null, { id: "sj-1", input: { enabled: false } }, ctx()),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });

    expect(mocks.requireAdminOrServiceCaller).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-A",
      "update_scheduled_job",
    );
    expect(mocks.invokeJobScheduleManager).not.toHaveBeenCalled();
  });

  it("throws (preserves caller insight) when the Lambda PUT fails", async () => {
    mocks.selectFirst.mockResolvedValue([
      { id: "sj-2", tenant_id: "tenant-A" },
    ]);
    mocks.requireAdminOrServiceCaller.mockResolvedValue(undefined);
    mocks.invokeJobScheduleManager.mockResolvedValue({
      ok: false,
      error: "EventBridge schedule access denied",
    });

    await expect(
      updateScheduledJob(
        null,
        { id: "sj-2", input: { scheduleExpression: "rate(2 hours)" } },
        ctx(),
      ),
    ).rejects.toThrow(/EventBridge schedule access denied|update failed/);
  });

  it("forwards triggerId + supplied fields to the Lambda and returns refreshed row", async () => {
    mocks.selectFirst.mockResolvedValue([
      { id: "sj-3", tenant_id: "tenant-A" },
    ]);
    mocks.requireAdminOrServiceCaller.mockResolvedValue(undefined);
    mocks.invokeJobScheduleManager.mockResolvedValue({ ok: true });
    mocks.selectRefreshed.mockResolvedValue([
      {
        id: "sj-3",
        tenant_id: "tenant-A",
        schedule_expression: "rate(2 hours)",
        enabled: false,
      },
    ]);

    const result = await updateScheduledJob(
      null,
      {
        id: "sj-3",
        input: {
          scheduleExpression: "rate(2 hours)",
          enabled: false,
          name: "renamed",
        },
      },
      ctx(),
    );

    expect(result).toEqual({
      id: "sj-3",
      tenantId: "tenant-A",
      scheduleExpression: "rate(2 hours)",
      enabled: false,
    });

    expect(mocks.invokeJobScheduleManager).toHaveBeenCalledTimes(1);
    expect(mocks.invokeJobScheduleManager).toHaveBeenCalledWith("PUT", {
      triggerId: "sj-3",
      scheduleExpression: "rate(2 hours)",
      enabled: false,
      name: "renamed",
    });
  });

  it("parses string-encoded config before forwarding (AWSJSON arrives as a JSON string)", async () => {
    mocks.selectFirst.mockResolvedValue([
      { id: "sj-4", tenant_id: "tenant-A" },
    ]);
    mocks.requireAdminOrServiceCaller.mockResolvedValue(undefined);
    mocks.invokeJobScheduleManager.mockResolvedValue({ ok: true });
    mocks.selectRefreshed.mockResolvedValue([
      { id: "sj-4", tenant_id: "tenant-A" },
    ]);

    await updateScheduledJob(
      null,
      { id: "sj-4", input: { config: '{"foo":42}' } },
      ctx(),
    );

    expect(mocks.invokeJobScheduleManager).toHaveBeenCalledWith("PUT", {
      triggerId: "sj-4",
      config: { foo: 42 },
    });
  });
});
