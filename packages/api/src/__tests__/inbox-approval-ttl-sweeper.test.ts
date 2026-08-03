/**
 * inbox-approval-sweeper cancels computer_approval rows past expires_at (or
 * older than the TTL when expires_at predates the feature). Tests target the
 * UPDATE payload and the email-ledger side effect; the SQL predicate itself
 * is covered by the drizzle mocks' recorded shape.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUpdatePayload,
  mockUpdateReturning,
  mockWhereArgs,
  mockLedgerInsert,
} = vi.hoisted(() => ({
  mockUpdatePayload: vi.fn(),
  mockUpdateReturning: vi.fn(),
  mockWhereArgs: vi.fn(),
  mockLedgerInsert: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    update: () => ({
      set: (payload: Record<string, unknown>) => {
        mockUpdatePayload(payload);
        return {
          where: (pred: unknown) => {
            mockWhereArgs(pred);
            return {
              returning: () =>
                Promise.resolve((mockUpdateReturning() as unknown[]) ?? []),
            };
          },
        };
      },
    }),
    insert: () => ({
      values: (payload: Record<string, unknown>) => {
        mockLedgerInsert(payload);
        return Promise.resolve([]);
      },
    }),
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  inboxItems: {
    id: "id",
    tenant_id: "tenant_id",
    type: "type",
    status: "status",
    config: "config",
    expires_at: "expires_at",
    created_at: "created_at",
    updated_at: "updated_at",
    review_notes: "review_notes",
  },
  emailLedgerEvents: { id: "id" },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  or: (...args: unknown[]) => ({ _or: args }),
  eq: (col: unknown, val: unknown) => ({ _eq: [col, val] }),
  lt: (col: unknown, val: unknown) => ({ _lt: [col, val] }),
  isNull: (col: unknown) => ({ _isNull: col }),
}));

// eslint-disable-next-line import/first
import { handler } from "../handlers/inbox-approval-sweeper.js";

const emailRow = {
  id: "item-1",
  tenant_id: "tenant-1",
  type: "computer_approval",
  config: {
    actionType: "email_send",
    emailDraft: { subject: "Order export" },
    emailChannel: {
      conversationId: "conv-1",
      spaceId: "space-1",
      threadId: null,
      providerInstallId: null,
      from: "default@tenant.thinkwork.ai",
      to: ["buyer@example.com"],
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateReturning.mockReturnValue([]);
});

describe("inbox-approval-sweeper", () => {
  it("cancels stale approvals with an explanatory review note", async () => {
    await handler();
    const payload = mockUpdatePayload.mock.calls[0]?.[0];
    expect(payload).toMatchObject({ status: "cancelled" });
    expect(payload.review_notes).toMatch(/no decision within \d+ days/);
    expect(payload.updated_at).toBeInstanceOf(Date);
  });

  it("writes an expired ledger event for email approvals", async () => {
    mockUpdateReturning.mockReturnValue([emailRow]);
    const result = await handler();

    expect(result.cancelled).toBe(1);
    expect(result.emailLedgerEvents).toBe(1);
    expect(mockLedgerInsert).toHaveBeenCalledTimes(1);
    expect(mockLedgerInsert.mock.calls[0][0]).toMatchObject({
      tenant_id: "tenant-1",
      conversation_id: "conv-1",
      inbox_item_id: "item-1",
      event_type: "approval_denied",
      reason_code: "expired",
      from_email: "default@tenant.thinkwork.ai",
      to_emails: ["buyer@example.com"],
    });
  });

  it("skips the ledger for non-email approvals", async () => {
    mockUpdateReturning.mockReturnValue([
      {
        id: "item-2",
        tenant_id: "tenant-1",
        type: "computer_approval",
        config: { actionType: "task_run" },
      },
    ]);
    const result = await handler();

    expect(result.cancelled).toBe(1);
    expect(result.emailLedgerEvents).toBe(0);
    expect(mockLedgerInsert).not.toHaveBeenCalled();
  });

  it("retries without space/thread refs when they dangle", async () => {
    mockUpdateReturning.mockReturnValue([emailRow]);
    // A deleted thread leaves config pointing at a missing row; the first
    // insert trips the FK and the retry must still land the entry.
    mockLedgerInsert.mockImplementationOnce(() => {
      throw new Error("insert or update violates foreign key constraint");
    });
    const result = await handler();

    expect(result.cancelled).toBe(1);
    expect(result.emailLedgerEvents).toBe(1);
    expect(mockLedgerInsert).toHaveBeenCalledTimes(2);
    expect(mockLedgerInsert.mock.calls[1][0]).toMatchObject({
      conversation_id: "conv-1",
      space_id: null,
      thread_id: null,
      reason_code: "expired",
    });
  });

  it("keeps cancelling when the ledger is entirely unavailable", async () => {
    mockUpdateReturning.mockReturnValue([emailRow]);
    mockLedgerInsert.mockImplementation(() => {
      throw new Error("ledger unavailable");
    });
    const result = await handler();

    expect(result.cancelled).toBe(1);
    expect(result.emailLedgerEvents).toBe(0);
  });
});
