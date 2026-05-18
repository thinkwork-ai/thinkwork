/**
 * Contract tests for `runScheduledJob`.
 *
 * Branches:
 *   1. Row missing → dispatched=false with diagnostic, no auth probe.
 *   2. Row present → auth gate against row.tenant_id, then Lambda invoke.
 *   3. Lambda FunctionError → dispatched=false with diagnostic; resolver
 *      does NOT throw (operator sees the error in the response).
 *   4. Happy path → dispatched=true with status code.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectFrom: vi.fn(),
  requireAdminOrServiceCaller: vi.fn(),
  lambdaSend: vi.fn(),
}));

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => mocks.selectFrom(),
      }),
    }),
  },
  scheduledJobs: {
    id: "scheduled_jobs.id",
    tenant_id: "scheduled_jobs.tenant_id",
    trigger_type: "scheduled_jobs.trigger_type",
    agent_id: "scheduled_jobs.agent_id",
    routine_id: "scheduled_jobs.routine_id",
    prompt: "scheduled_jobs.prompt",
    eb_schedule_name: "scheduled_jobs.eb_schedule_name",
  },
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mocks.requireAdminOrServiceCaller,
}));

vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: vi.fn().mockImplementation(() => ({
    send: (cmd: unknown) => mocks.lambdaSend(cmd),
  })),
  InvokeCommand: vi.fn().mockImplementation((args: unknown) => ({ args })),
}));

// eslint-disable-next-line import/first
import { runScheduledJob } from "./runScheduledJob.mutation.js";

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
  mocks.selectFrom.mockReset();
  mocks.requireAdminOrServiceCaller.mockReset();
  mocks.lambdaSend.mockReset();
  process.env.STAGE = "test";
  process.env.AWS_REGION = "us-east-1";
  process.env.AWS_ACCOUNT_ID = "111122223333";
});

describe("runScheduledJob", () => {
  it("returns dispatched=false with diagnostic when the row is missing", async () => {
    mocks.selectFrom.mockResolvedValue([]);

    const result = await runScheduledJob(null, { id: "sj-x" }, ctx());

    expect(result).toMatchObject({
      id: "sj-x",
      dispatched: false,
      errorMessage: "Scheduled job not found",
    });
    expect(mocks.requireAdminOrServiceCaller).not.toHaveBeenCalled();
    expect(mocks.lambdaSend).not.toHaveBeenCalled();
  });

  it("auth-gates by row.tenant_id before the Lambda invoke", async () => {
    mocks.selectFrom.mockResolvedValue([
      {
        id: "sj-1",
        tenant_id: "tenant-A",
        trigger_type: "agent_heartbeat",
        agent_id: "a1",
        routine_id: null,
        prompt: null,
        eb_schedule_name: "ebs-1",
      },
    ]);
    mocks.requireAdminOrServiceCaller.mockRejectedValue(
      Object.assign(new Error("Tenant admin role required"), {
        extensions: { code: "FORBIDDEN" },
      }),
    );

    await expect(
      runScheduledJob(null, { id: "sj-1" }, ctx()),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });

    expect(mocks.requireAdminOrServiceCaller).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-A",
      "run_scheduled_job",
    );
    expect(mocks.lambdaSend).not.toHaveBeenCalled();
  });

  it("invokes job-trigger with the row's payload and returns dispatched=true on success", async () => {
    mocks.selectFrom.mockResolvedValue([
      {
        id: "sj-2",
        tenant_id: "tenant-A",
        trigger_type: "routine_schedule",
        agent_id: null,
        routine_id: "r-1",
        prompt: "hello",
        eb_schedule_name: "ebs-2",
      },
    ]);
    mocks.requireAdminOrServiceCaller.mockResolvedValue(undefined);
    mocks.lambdaSend.mockResolvedValue({ StatusCode: 200, FunctionError: undefined });

    const result = await runScheduledJob(null, { id: "sj-2" }, ctx());

    expect(result).toEqual({
      id: "sj-2",
      dispatched: true,
      statusCode: 200,
      errorMessage: null,
    });

    expect(mocks.lambdaSend).toHaveBeenCalledTimes(1);
    const sentCmd = mocks.lambdaSend.mock.calls[0][0] as { args: any };
    expect(sentCmd.args.FunctionName).toBe(
      "arn:aws:lambda:us-east-1:111122223333:function:thinkwork-test-api-job-trigger",
    );
    expect(sentCmd.args.InvocationType).toBe("RequestResponse");
    const decoded = JSON.parse(new TextDecoder().decode(sentCmd.args.Payload));
    expect(decoded).toEqual({
      triggerId: "sj-2",
      triggerType: "routine_schedule",
      tenantId: "tenant-A",
      routineId: "r-1",
      prompt: "hello",
      scheduleName: "ebs-2",
    });
  });

  it("returns dispatched=false (does NOT throw) when the Lambda returns FunctionError", async () => {
    mocks.selectFrom.mockResolvedValue([
      {
        id: "sj-3",
        tenant_id: "tenant-A",
        trigger_type: "agent_scheduled",
        agent_id: "a1",
        routine_id: null,
        prompt: null,
        eb_schedule_name: null,
      },
    ]);
    mocks.requireAdminOrServiceCaller.mockResolvedValue(undefined);
    const payload = new TextEncoder().encode(
      JSON.stringify({ errorMessage: "AccessDenied" }),
    );
    mocks.lambdaSend.mockResolvedValue({
      StatusCode: 200,
      FunctionError: "Unhandled",
      Payload: payload,
    });

    const result = await runScheduledJob(null, { id: "sj-3" }, ctx());

    expect(result.dispatched).toBe(false);
    expect(result.errorMessage).toMatch(/Lambda error/);
    expect(result.errorMessage).toMatch(/AccessDenied/);
  });

  it("throws when STAGE / AWS_ACCOUNT_ID env are missing (config error, not a runtime miss)", async () => {
    mocks.selectFrom.mockResolvedValue([
      {
        id: "sj-4",
        tenant_id: "tenant-A",
        trigger_type: "agent_heartbeat",
        agent_id: null,
        routine_id: null,
        prompt: null,
        eb_schedule_name: null,
      },
    ]);
    mocks.requireAdminOrServiceCaller.mockResolvedValue(undefined);
    delete process.env.STAGE;

    await expect(
      runScheduledJob(null, { id: "sj-4" }, ctx()),
    ).rejects.toThrow(/STAGE and AWS_ACCOUNT_ID/);
  });
});
