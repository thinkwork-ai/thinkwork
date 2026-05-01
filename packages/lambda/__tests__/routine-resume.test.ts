/**
 * routine-resume tests (Plan §U6).
 *
 * Test-first. The wrapper has two AWS calls (`SendTaskSuccess` and
 * `SendTaskFailure`) and one idempotency invariant (re-resume on a
 * consumed token returns alreadyConsumed:true).
 *
 * The bridge in U8 owns the database-side consume-once invariant on
 * `routine_approval_tokens`. routine-resume's idempotency is at the SFN
 * layer: AWS rejects sends against an unknown task token with
 * `TaskDoesNotExist`. We translate that to alreadyConsumed:true so the
 * caller (the bridge) can complete its turn cleanly even on a race.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSfnSend } = vi.hoisted(() => ({
  mockSfnSend: vi.fn(),
}));

vi.mock("@aws-sdk/client-sfn", () => ({
  SFNClient: class {
    send = mockSfnSend;
  },
  SendTaskSuccessCommand: class {
    constructor(public input: unknown) {}
    static name = "SendTaskSuccessCommand";
  },
  SendTaskFailureCommand: class {
    constructor(public input: unknown) {}
    static name = "SendTaskFailureCommand";
  },
  TaskDoesNotExist: class TaskDoesNotExist extends Error {
    name = "TaskDoesNotExist";
  },
}));

import {
  resumeRoutineExecution,
  type ResumeInput,
} from "../routine-resume.js";

const baseSuccessInput: ResumeInput = {
  taskToken: "token-abc",
  decision: "success",
  output: { approved: true, by: "user-1" },
};

const baseFailureInput: ResumeInput = {
  taskToken: "token-xyz",
  decision: "failure",
  errorCode: "OperatorRejected",
  errorMessage: "Rejected by operator",
};

beforeEach(() => {
  mockSfnSend.mockReset();
});

describe("resumeRoutineExecution — happy path", () => {
  it("calls SendTaskSuccessCommand with serialized output for decision='success'", async () => {
    mockSfnSend.mockResolvedValueOnce({});
    const result = await resumeRoutineExecution(baseSuccessInput);
    expect(result).toEqual({ ok: true, alreadyConsumed: false });
    expect(mockSfnSend).toHaveBeenCalledTimes(1);
    const call = mockSfnSend.mock.calls[0][0] as {
      constructor: { name: string };
      input: { taskToken: string; output: string };
    };
    expect(call.constructor.name).toBe("SendTaskSuccessCommand");
    expect(call.input.taskToken).toBe("token-abc");
    expect(JSON.parse(call.input.output)).toEqual({ approved: true, by: "user-1" });
  });

  it("calls SendTaskFailureCommand with errorCode + errorMessage for decision='failure'", async () => {
    mockSfnSend.mockResolvedValueOnce({});
    const result = await resumeRoutineExecution(baseFailureInput);
    expect(result).toEqual({ ok: true, alreadyConsumed: false });
    expect(mockSfnSend).toHaveBeenCalledTimes(1);
    const call = mockSfnSend.mock.calls[0][0] as {
      constructor: { name: string };
      input: {
        taskToken: string;
        error: string;
        cause: string;
      };
    };
    expect(call.constructor.name).toBe("SendTaskFailureCommand");
    expect(call.input.taskToken).toBe("token-xyz");
    expect(call.input.error).toBe("OperatorRejected");
    expect(call.input.cause).toBe("Rejected by operator");
  });

  it("defaults output to {} when decision='success' and output is omitted", async () => {
    mockSfnSend.mockResolvedValueOnce({});
    await resumeRoutineExecution({
      taskToken: "t",
      decision: "success",
    });
    const call = mockSfnSend.mock.calls[0][0] as {
      input: { output: string };
    };
    expect(call.input.output).toBe("{}");
  });
});

describe("resumeRoutineExecution — idempotency", () => {
  it("returns alreadyConsumed:true when SendTaskSuccess hits TaskDoesNotExist", async () => {
    const err = Object.assign(new Error("token consumed"), {
      name: "TaskDoesNotExist",
    });
    mockSfnSend.mockRejectedValueOnce(err);
    const result = await resumeRoutineExecution(baseSuccessInput);
    expect(result).toEqual({ ok: true, alreadyConsumed: true });
  });

  it("returns alreadyConsumed:true when SendTaskFailure hits TaskDoesNotExist", async () => {
    const err = Object.assign(new Error("token consumed"), {
      name: "TaskDoesNotExist",
    });
    mockSfnSend.mockRejectedValueOnce(err);
    const result = await resumeRoutineExecution(baseFailureInput);
    expect(result).toEqual({ ok: true, alreadyConsumed: true });
  });

  it("treats TaskTimedOut as alreadyConsumed:true (token expired)", async () => {
    const err = Object.assign(new Error("token expired"), {
      name: "TaskTimedOut",
    });
    mockSfnSend.mockRejectedValueOnce(err);
    const result = await resumeRoutineExecution(baseSuccessInput);
    expect(result).toEqual({ ok: true, alreadyConsumed: true });
  });
});

describe("resumeRoutineExecution — error paths", () => {
  it("re-throws unexpected SFN errors", async () => {
    mockSfnSend.mockRejectedValueOnce(new Error("network blew up"));
    await expect(resumeRoutineExecution(baseSuccessInput)).rejects.toThrow(
      "network blew up",
    );
  });

  it("rejects unknown decision values without calling SFN", async () => {
    await expect(
      resumeRoutineExecution({
        taskToken: "t",
        // @ts-expect-error — testing runtime guard
        decision: "maybe",
      }),
    ).rejects.toThrow();
    expect(mockSfnSend).not.toHaveBeenCalled();
  });

  it("rejects empty taskToken without calling SFN", async () => {
    await expect(
      resumeRoutineExecution({ taskToken: "", decision: "success" }),
    ).rejects.toThrow();
    expect(mockSfnSend).not.toHaveBeenCalled();
  });
});
