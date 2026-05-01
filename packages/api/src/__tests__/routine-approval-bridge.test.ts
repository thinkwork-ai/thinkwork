/**
 * routine-approval-bridge tests (Plan §U8).
 *
 * Test-first per the U8 execution note. The consume-once invariant on
 * routine_approval_tokens is the load-bearing safety property — a
 * double-decide MUST NOT call SendTaskSuccess twice. Each test below
 * pins one class of edge case (happy path, double-decide race,
 * already-cancelled token, alreadyDecided idempotency).
 *
 * Mocks: the Drizzle conditional UPDATE is mocked at the graphql/utils
 * boundary so each test pre-queues whether the consume-once update
 * affected 0 or 1 rows. The routine-resume Lambda invoke is mocked at
 * the @aws-sdk/client-lambda boundary so we can assert RequestResponse
 * + payload shape without the real round-trip.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDbReturning, mockLambdaSend } = vi.hoisted(() => ({
  mockDbReturning: vi.fn(),
  mockLambdaSend: vi.fn(),
}));

vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: class {
    send = mockLambdaSend;
  },
  InvokeCommand: class InvokeCommand {
    constructor(public input: unknown) {}
  },
}));

vi.mock("../graphql/utils.js", () => {
  // Mirror the U7 test mock pattern: chain mocks return thenables for
  // .where() and .returning() so the resolver's `await db.update(...).
  // set(...).where(...).returning()` flow walks through mockDbReturning.
  const chain = {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(mockDbReturning()),
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockDbReturning()),
      }),
    }),
  };
  return {
    db: chain,
    eq: (...a: unknown[]) => ({ _eq: a }),
    and: (...a: unknown[]) => ({ _and: a }),
  };
});

vi.mock("@thinkwork/database-pg/schema", () => ({
  routineApprovalTokens: {
    id: "routine_approval_tokens.id",
    tenant_id: "routine_approval_tokens.tenant_id",
    inbox_item_id: "routine_approval_tokens.inbox_item_id",
    execution_id: "routine_approval_tokens.execution_id",
    node_id: "routine_approval_tokens.node_id",
    task_token: "routine_approval_tokens.task_token",
    consumed: "routine_approval_tokens.consumed",
    decided_by_user_id: "routine_approval_tokens.decided_by_user_id",
    decision_value_json: "routine_approval_tokens.decision_value_json",
    decided_at: "routine_approval_tokens.decided_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (...a: unknown[]) => ({ _eq: a }),
  and: (...a: unknown[]) => ({ _and: a }),
}));

import {
  bridgeInboxDecisionToRoutineApproval,
} from "../graphql/resolvers/inbox/routine-approval-bridge.js";

const baseInboxItem = {
  id: "inbox-1",
  type: "routine_approval",
  tenant_id: "tenant-a",
  entity_id: null,
  entity_type: null,
};

beforeEach(() => {
  process.env.ROUTINE_RESUME_FUNCTION_NAME = "thinkwork-dev-routine-resume";
  mockDbReturning.mockReset();
  mockLambdaSend.mockReset();
  // Default Lambda happy path: routine-resume returns alreadyConsumed:false.
  mockLambdaSend.mockResolvedValue({
    StatusCode: 200,
    Payload: new TextEncoder().encode(
      JSON.stringify({ ok: true, alreadyConsumed: false }),
    ),
  });
});

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

describe("routine-approval-bridge — happy paths", () => {
  it("flips consumed=false→true and invokes routine-resume with success on accept", async () => {
    // First DB call: conditional UPDATE flips the row, returning the now-
    // consumed token row.
    mockDbReturning.mockReturnValueOnce([
      {
        id: "tok-1",
        task_token: "sfn-token-abc",
        execution_id: "exec-1",
        node_id: "ApprovePublish",
        consumed: true,
      },
    ]);

    const result = await bridgeInboxDecisionToRoutineApproval({
      inboxItem: baseInboxItem,
      decision: "approved",
      actorId: "user-1",
      decisionPayload: { reviewNotes: "lgtm" },
    });

    expect(result).toEqual({ dispatched: true, alreadyDecided: false });
    expect(mockLambdaSend).toHaveBeenCalledTimes(1);
    const call = mockLambdaSend.mock.calls[0][0] as {
      input: { FunctionName: string; InvocationType: string; Payload: Uint8Array };
    };
    expect(call.input.FunctionName).toBe("thinkwork-dev-routine-resume");
    expect(call.input.InvocationType).toBe("RequestResponse");
    const payload = JSON.parse(new TextDecoder().decode(call.input.Payload));
    expect(payload.taskToken).toBe("sfn-token-abc");
    expect(payload.decision).toBe("success");
    expect(payload.output).toEqual({
      decision: "approved",
      reviewNotes: "lgtm",
    });
  });

  it("calls routine-resume with failure + errorCode on reject", async () => {
    mockDbReturning.mockReturnValueOnce([
      {
        id: "tok-1",
        task_token: "sfn-token-xyz",
        execution_id: "exec-1",
        node_id: "ApprovePublish",
        consumed: true,
      },
    ]);

    await bridgeInboxDecisionToRoutineApproval({
      inboxItem: baseInboxItem,
      decision: "rejected",
      actorId: "user-1",
      decisionPayload: { reviewNotes: "blocked" },
    });

    const call = mockLambdaSend.mock.calls[0][0] as {
      input: { Payload: Uint8Array };
    };
    const payload = JSON.parse(new TextDecoder().decode(call.input.Payload));
    expect(payload.decision).toBe("failure");
    expect(payload.errorCode).toBe("RoutineApprovalRejected");
    expect(payload.errorMessage).toBe("blocked");
  });
});

// ---------------------------------------------------------------------------
// Consume-once invariant — the load-bearing safety property
// ---------------------------------------------------------------------------

describe("routine-approval-bridge — consume-once invariant", () => {
  it("returns alreadyDecided:true and SKIPS routine-resume when conditional UPDATE matches 0 rows", async () => {
    // Second decide on an already-consumed token: the partial unique index
    // (consumed=false) means the WHERE clause matches 0 rows; .returning()
    // returns an empty array.
    mockDbReturning.mockReturnValueOnce([]);

    const result = await bridgeInboxDecisionToRoutineApproval({
      inboxItem: baseInboxItem,
      decision: "approved",
      actorId: "user-2",
      decisionPayload: { reviewNotes: "racing decide" },
    });

    expect(result).toEqual({ dispatched: false, alreadyDecided: true });
    // Critical invariant: a second decide MUST NOT call SendTaskSuccess.
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });

  it("returns alreadyDecided:true when the inbox item has no token row (cancelled / never armed)", async () => {
    // Some inbox items of type=routine_approval may have been cancelled
    // before the SFN task ever fired the callback that armed the token —
    // surfacing decided-when-not-armed as alreadyDecided keeps the
    // bridge idempotent.
    mockDbReturning.mockReturnValueOnce([]);

    const result = await bridgeInboxDecisionToRoutineApproval({
      inboxItem: baseInboxItem,
      decision: "approved",
      actorId: "user-1",
      decisionPayload: {},
    });

    expect(result).toEqual({ dispatched: false, alreadyDecided: true });
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Type-discriminator — bridge is no-op for non-routine inbox items
// ---------------------------------------------------------------------------

describe("routine-approval-bridge — type discriminator", () => {
  it("returns dispatched:false on inbox items of unrelated type without touching the DB", async () => {
    const result = await bridgeInboxDecisionToRoutineApproval({
      inboxItem: {
        ...baseInboxItem,
        type: "workspace_review",
      },
      decision: "approved",
      actorId: "user-1",
      decisionPayload: {},
    });
    expect(result).toEqual({ dispatched: false, alreadyDecided: false });
    expect(mockDbReturning).not.toHaveBeenCalled();
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });

  it("isRoutineApprovalInboxItem narrows the type predicate", async () => {
    const { isRoutineApprovalInboxItem } = await import(
      "../graphql/resolvers/inbox/routine-approval-bridge.js"
    );
    expect(
      isRoutineApprovalInboxItem({ type: "routine_approval" }),
    ).toBe(true);
    expect(
      isRoutineApprovalInboxItem({ type: "workspace_review" }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SFN-side idempotency — the bridge survives Lambda's idempotency report
// ---------------------------------------------------------------------------

describe("routine-approval-bridge — SFN-side idempotency", () => {
  it("treats routine-resume's alreadyConsumed:true as success (DB+SFN race resolved)", async () => {
    // Bridge wins the DB conditional UPDATE; routine-resume reports the
    // SFN side already consumed the token (ResumeResult.alreadyConsumed).
    // This is the rare case where DB-flag and SFN-state diverge — we
    // still report dispatched:true because the bridge did its job.
    mockDbReturning.mockReturnValueOnce([
      {
        id: "tok-1",
        task_token: "sfn-token-abc",
        execution_id: "exec-1",
        node_id: "ApprovePublish",
        consumed: true,
      },
    ]);
    mockLambdaSend.mockResolvedValueOnce({
      StatusCode: 200,
      Payload: new TextEncoder().encode(
        JSON.stringify({ ok: true, alreadyConsumed: true }),
      ),
    });

    const result = await bridgeInboxDecisionToRoutineApproval({
      inboxItem: baseInboxItem,
      decision: "approved",
      actorId: "user-1",
      decisionPayload: {},
    });
    expect(result).toEqual({ dispatched: true, alreadyDecided: false });
  });

  it("re-throws when routine-resume Lambda invocation itself fails (caller surfaces error)", async () => {
    mockDbReturning.mockReturnValueOnce([
      {
        id: "tok-1",
        task_token: "sfn-token-abc",
        execution_id: "exec-1",
        node_id: "ApprovePublish",
        consumed: true,
      },
    ]);
    mockLambdaSend.mockRejectedValueOnce(new Error("network blew up"));

    await expect(
      bridgeInboxDecisionToRoutineApproval({
        inboxItem: baseInboxItem,
        decision: "approved",
        actorId: "user-1",
        decisionPayload: {},
      }),
    ).rejects.toThrow(/network blew up/);
  });
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

describe("routine-approval-bridge — configuration guard", () => {
  it("throws when ROUTINE_RESUME_FUNCTION_NAME env is not set", async () => {
    delete process.env.ROUTINE_RESUME_FUNCTION_NAME;
    mockDbReturning.mockReturnValueOnce([
      {
        id: "tok-1",
        task_token: "sfn-token-abc",
        execution_id: "exec-1",
        node_id: "ApprovePublish",
        consumed: true,
      },
    ]);
    await expect(
      bridgeInboxDecisionToRoutineApproval({
        inboxItem: baseInboxItem,
        decision: "approved",
        actorId: "user-1",
        decisionPayload: {},
      }),
    ).rejects.toThrow(/ROUTINE_RESUME_FUNCTION_NAME/);
  });
});
