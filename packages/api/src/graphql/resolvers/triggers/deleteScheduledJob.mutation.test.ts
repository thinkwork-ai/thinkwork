/**
 * Contract tests for `deleteScheduledJob`.
 *
 * The resolver has three branches that matter:
 *   1. row missing → return {ok:false}, no auth check, no Lambda call.
 *   2. row present, eb_schedule_name null → auth check + DB delete only.
 *   3. row present, eb_schedule_name set → auth + Lambda DELETE first
 *      (rollback on failure), then DB delete.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectFrom: vi.fn(),
  deleteWhere: vi.fn(),
  invokeJobScheduleManager: vi.fn(),
  requireAdminOrServiceCaller: vi.fn(),
}));

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => mocks.selectFrom(),
      }),
    }),
    delete: () => ({
      where: (...args: unknown[]) => mocks.deleteWhere(...args),
    }),
  },
  scheduledJobs: {
    id: "scheduled_jobs.id",
    tenant_id: "scheduled_jobs.tenant_id",
    eb_schedule_name: "scheduled_jobs.eb_schedule_name",
  },
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  invokeJobScheduleManager: mocks.invokeJobScheduleManager,
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mocks.requireAdminOrServiceCaller,
}));

// eslint-disable-next-line import/first
import { deleteScheduledJob } from "./deleteScheduledJob.mutation.js";

const cognitoCtx = () =>
  ({
    auth: {
      authType: "cognito" as const,
      principalId: "u1",
      tenantId: "t1",
      email: "x@y.z",
      agentId: null,
    },
  }) as any;

beforeEach(() => {
  mocks.selectFrom.mockReset();
  mocks.deleteWhere.mockReset();
  mocks.invokeJobScheduleManager.mockReset();
  mocks.requireAdminOrServiceCaller.mockReset();
});

describe("deleteScheduledJob", () => {
  it("returns {ok:false} when no row matches (idempotent no-op)", async () => {
    mocks.selectFrom.mockResolvedValue([]);

    const result = await deleteScheduledJob(null, { id: "sj-missing" }, cognitoCtx());

    expect(result).toEqual({ id: "sj-missing", ok: false });
    // No auth check, no Lambda, no DB delete should have fired.
    expect(mocks.requireAdminOrServiceCaller).not.toHaveBeenCalled();
    expect(mocks.invokeJobScheduleManager).not.toHaveBeenCalled();
    expect(mocks.deleteWhere).not.toHaveBeenCalled();
  });

  it("auth-gates by row.tenant_id before any side effect", async () => {
    mocks.selectFrom.mockResolvedValue([
      { id: "sj-1", tenant_id: "tenant-A", eb_schedule_name: null },
    ]);
    mocks.requireAdminOrServiceCaller.mockRejectedValue(
      Object.assign(new Error("Tenant admin role required"), {
        extensions: { code: "FORBIDDEN" },
      }),
    );

    await expect(
      deleteScheduledJob(null, { id: "sj-1" }, cognitoCtx()),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });

    // Authz call should have received the row's tenant id, not whatever
    // the caller might have asserted in headers.
    expect(mocks.requireAdminOrServiceCaller).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-A",
      "delete_scheduled_job",
    );
    expect(mocks.invokeJobScheduleManager).not.toHaveBeenCalled();
    expect(mocks.deleteWhere).not.toHaveBeenCalled();
  });

  it("when eb_schedule_name is null, skips the Lambda and only deletes the row", async () => {
    mocks.selectFrom.mockResolvedValue([
      { id: "sj-2", tenant_id: "tenant-A", eb_schedule_name: null },
    ]);
    mocks.requireAdminOrServiceCaller.mockResolvedValue(undefined);
    mocks.deleteWhere.mockResolvedValue(undefined);

    const result = await deleteScheduledJob(null, { id: "sj-2" }, cognitoCtx());

    expect(result).toEqual({ id: "sj-2", ok: true });
    expect(mocks.invokeJobScheduleManager).not.toHaveBeenCalled();
    expect(mocks.deleteWhere).toHaveBeenCalledTimes(1);
  });

  it("when eb_schedule_name is set, deprovisions via Lambda BEFORE deleting the row", async () => {
    mocks.selectFrom.mockResolvedValue([
      { id: "sj-3", tenant_id: "tenant-A", eb_schedule_name: "tw-sj-3" },
    ]);
    mocks.requireAdminOrServiceCaller.mockResolvedValue(undefined);
    mocks.invokeJobScheduleManager.mockResolvedValue({ ok: true });

    const callOrder: string[] = [];
    mocks.invokeJobScheduleManager.mockImplementation(() => {
      callOrder.push("lambda");
      return { ok: true } as any;
    });
    mocks.deleteWhere.mockImplementation(() => {
      callOrder.push("db");
      return undefined as any;
    });

    const result = await deleteScheduledJob(null, { id: "sj-3" }, cognitoCtx());

    expect(result).toEqual({ id: "sj-3", ok: true });
    expect(callOrder).toEqual(["lambda", "db"]);
    expect(mocks.invokeJobScheduleManager).toHaveBeenCalledWith("DELETE", {
      triggerId: "sj-3",
      tenantId: "tenant-A",
    });
  });

  it("rolls back (preserves DB row) when the EventBridge deprovision Lambda fails", async () => {
    mocks.selectFrom.mockResolvedValue([
      { id: "sj-4", tenant_id: "tenant-A", eb_schedule_name: "tw-sj-4" },
    ]);
    mocks.requireAdminOrServiceCaller.mockResolvedValue(undefined);
    mocks.invokeJobScheduleManager.mockResolvedValue({
      ok: false,
      error: "EB schedule access denied",
    });

    await expect(
      deleteScheduledJob(null, { id: "sj-4" }, cognitoCtx()),
    ).rejects.toThrow(/EB schedule access denied|deprovision failed/);

    // Critical invariant: row preserved when Lambda fails.
    expect(mocks.deleteWhere).not.toHaveBeenCalled();
  });
});
