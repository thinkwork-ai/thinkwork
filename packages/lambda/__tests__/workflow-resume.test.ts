/**
 * workflow-resume tests (THINK-219 U6).
 *
 * Fake-db style: consumeTaskToken (real @thinkwork/database-pg adapter) runs
 * against an in-memory fake; the SFN client is mocked. Both approve and deny
 * resume via SendTaskSuccess — a deny is {approved:false}, NEVER
 * SendTaskFailure (the interpreter ApprovalStep only Catches States.Timeout).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSfnSend } = vi.hoisted(() => ({ mockSfnSend: vi.fn() }));

vi.mock("@aws-sdk/client-sfn", () => ({
  SFNClient: class {
    send = mockSfnSend;
  },
  SendTaskSuccessCommand: class {
    constructor(public input: unknown) {}
    static name = "SendTaskSuccessCommand";
  },
}));

import {
  resumeWorkflowApproval,
  type WorkflowResumeInput,
} from "../workflow-resume.js";

type Rows = Record<string, unknown>[];

interface FakeDb {
  db: unknown;
  selectQueue: Rows[];
  updateQueue: Rows[];
}

function makeDb(): FakeDb {
  const selectQueue: Rows[] = [];
  const updateQueue: Rows[] = [];

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectQueue.shift() ?? []),
        }),
      }),
    }),
    update: () => ({
      set: () => {
        const rows = updateQueue.shift() ?? [];
        return {
          where: () =>
            Object.assign(Promise.resolve(rows), {
              returning: () => Promise.resolve(rows),
            }),
        };
      },
    }),
  };

  return { db, selectQueue, updateQueue };
}

const APPROVE: WorkflowResumeInput = {
  tenantId: "t1",
  workflowRunId: "run-1",
  approved: true,
  note: "looks good",
};

function waitingRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    tenant_id: "t1",
    status: "waiting_for_human",
    ...overrides,
  };
}

let fake: FakeDb;
beforeEach(() => {
  fake = makeDb();
  mockSfnSend.mockReset();
  mockSfnSend.mockResolvedValue({});
});

describe("resumeWorkflowApproval — approve/deny both SendTaskSuccess", () => {
  it("approve resumes the token with {approved:true}", async () => {
    fake.selectQueue.push(
      [waitingRun()],
      [{ iteration: 3, step_id: "approval" }],
    );
    fake.updateQueue.push([{ token: "approval-token-1" }]);

    const result = await resumeWorkflowApproval(APPROVE, {
      db: fake.db as never,
    });

    expect(result).toEqual({ ok: true, status: "resumed", approved: true });
    expect(mockSfnSend).toHaveBeenCalledTimes(1);
    const command = mockSfnSend.mock.calls[0][0] as {
      constructor: { name: string };
      input: { taskToken: string; output: string };
    };
    expect(command.constructor.name).toBe("SendTaskSuccessCommand");
    expect(command.input.taskToken).toBe("approval-token-1");
    expect(JSON.parse(command.input.output)).toEqual({
      approved: true,
      note: "looks good",
    });
  });

  it("deny sends SendTaskSuccess {approved:false} — never SendTaskFailure", async () => {
    fake.selectQueue.push(
      [waitingRun()],
      [{ iteration: 1, step_id: "sign-off" }],
    );
    fake.updateQueue.push([{ token: "approval-token-2" }]);

    const result = await resumeWorkflowApproval(
      { tenantId: "t1", workflowRunId: "run-1", approved: false, note: "no" },
      { db: fake.db as never },
    );

    expect(result).toEqual({ ok: true, status: "resumed", approved: false });
    const command = mockSfnSend.mock.calls[0][0] as {
      constructor: { name: string };
      input: { output: string };
    };
    expect(command.constructor.name).toBe("SendTaskSuccessCommand");
    expect(JSON.parse(command.input.output)).toEqual({
      approved: false,
      note: "no",
    });
  });
});

describe("resumeWorkflowApproval — guards", () => {
  it("refuses a run that belongs to another tenant (KTD9)", async () => {
    fake.selectQueue.push([waitingRun({ tenant_id: "other-tenant" })]);
    await expect(
      resumeWorkflowApproval(APPROVE, { db: fake.db as never }),
    ).rejects.toThrow(/another tenant/);
    expect(mockSfnSend).not.toHaveBeenCalled();
  });

  it("errors cleanly when the run is not waiting for a human", async () => {
    fake.selectQueue.push([waitingRun({ status: "running" })]);
    await expect(
      resumeWorkflowApproval(APPROVE, { db: fake.db as never }),
    ).rejects.toThrow(/not waiting for a human decision/);
    expect(mockSfnSend).not.toHaveBeenCalled();
  });

  it("throws when the run does not exist", async () => {
    fake.selectQueue.push([]);
    await expect(
      resumeWorkflowApproval(APPROVE, { db: fake.db as never }),
    ).rejects.toThrow(/was not found/);
  });
});

describe("resumeWorkflowApproval — idempotency", () => {
  it("is a clean 'already resolved' when no pending approval token remains", async () => {
    fake.selectQueue.push([waitingRun()], []); // run waiting, no pending token
    const result = await resumeWorkflowApproval(APPROVE, {
      db: fake.db as never,
    });
    expect(result).toEqual({
      ok: true,
      status: "already_resolved",
      approved: true,
    });
    expect(mockSfnSend).not.toHaveBeenCalled();
  });

  it("is 'already resolved' when the CAS consume loses the race", async () => {
    fake.selectQueue.push(
      [waitingRun()],
      [{ iteration: 2, step_id: "approval" }],
    );
    fake.updateQueue.push([]); // consume returns null (already consumed)
    const result = await resumeWorkflowApproval(APPROVE, {
      db: fake.db as never,
    });
    expect(result).toEqual({
      ok: true,
      status: "already_resolved",
      approved: true,
    });
    expect(mockSfnSend).not.toHaveBeenCalled();
  });
});
