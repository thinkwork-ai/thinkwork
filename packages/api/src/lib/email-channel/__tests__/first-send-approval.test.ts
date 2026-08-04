import { describe, expect, it, vi } from "vitest";

const { sendComputerApprovalPushMock } = vi.hoisted(() => ({
  sendComputerApprovalPushMock: vi.fn(async () => undefined),
}));

vi.mock("../../push-notifications.js", () => ({
  sendComputerApprovalPush: sendComputerApprovalPushMock,
}));
import {
  emailBodyObjects,
  emailConversations,
  emailLedgerEvents,
  emailProviderInstalls,
  emailReadinessChecks,
  inboxItems,
} from "@thinkwork/database-pg/schema";
import {
  bridgeEmailApprovalDecision,
  isEmailSendApprovalInboxItem,
  requestFirstSendApproval,
} from "../first-send-approval.js";
import { evaluateOutboundEmailPolicy } from "../outbound-policy.js";

describe("first-send email approval", () => {
  it("fails closed when third-party production readiness is incomplete", async () => {
    // Built-in SES bypasses the readiness gate (see outbound-policy.test.ts),
    // so the fail-closed contract is exercised with a third-party provider.
    const db = fakeEmailDb({
      providerRows: [
        {
          id: "provider-1",
          tenant_id: "tenant-1",
          provider: "resend",
          status: "pending",
          active_for_production: true,
        },
      ],
      readinessRows: [
        readiness("credentials", "pass"),
        readiness("sending_domain", "pass"),
        readiness("inbound_receiving", "blocked"),
      ],
    });

    await expect(
      evaluateOutboundEmailPolicy({
        db,
        tenantId: "tenant-1",
        spaceId: "space-1",
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reasonCode: "email_readiness_incomplete",
    });
  });

  it("creates pending conversation, inbox review, body refs, and ledger evidence", async () => {
    const db = fakeEmailDb();

    await expect(
      requestFirstSendApproval({
        db,
        tenantId: "tenant-1",
        providerInstallId: "provider-1",
        provider: "ses",
        agentId: "agent-1",
        requestingUserId: "user-1",
        spaceId: "space-1",
        threadId: "thread-1",
        from: "sales@acme.thinkwork.ai",
        to: ["buyer@example.com"],
        subject: "Pipeline follow-up",
        body: "Original draft",
      }),
    ).resolves.toMatchObject({
      status: "pending_review",
      conversationId: "conversation-1",
      inboxItemId: "inbox-1",
    });

    expect(db.rowsFor(emailConversations)).toMatchObject([
      {
        id: "conversation-1",
        status: "pending_approval",
        tenant_id: "tenant-1",
        thread_id: "thread-1",
        provider_install_id: "provider-1",
      },
    ]);
    expect(db.rowsFor(inboxItems)).toMatchObject([
      {
        id: "inbox-1",
        type: "computer_approval",
        requester_type: "agent",
        requester_id: "agent-1",
        recipient_id: "user-1",
        entity_type: "email_conversation",
        entity_id: "conversation-1",
      },
    ]);
    expect(db.rowsFor(inboxItems)[0].config).toMatchObject({
      actionType: "email_send",
      emailDraft: {
        to: "buyer@example.com",
        subject: "Pipeline follow-up",
        body: "Original draft",
      },
      emailChannel: {
        conversationId: "conversation-1",
        providerInstallId: "provider-1",
        provider: "ses",
        from: "sales@acme.thinkwork.ai",
        to: ["buyer@example.com"],
      },
    });
    expect(db.rowsFor(emailBodyObjects)).toHaveLength(1);
    expect(
      db
        .rowsFor(emailLedgerEvents)
        .map((row: Record<string, any>) => row.event_type),
    ).toEqual(["draft_created", "approval_requested"]);
    expect(sendComputerApprovalPushMock).toHaveBeenCalledWith({
      userId: "user-1",
      tenantId: "tenant-1",
      approvalId: "inbox-1",
      question: "Review email to buyer@example.com",
    });
  });

  it("reuses a pending conversation instead of inserting a duplicate row", async () => {
    // Regression: uq_email_conversations_thread_participants forbids two
    // rows per (tenant, thread, participants). Asking the agent to send
    // again before the first review is decided must raise a fresh review
    // on the same conversation, not crash with a 23505 duplicate key.
    const db = fakeEmailDb();
    const request = {
      db,
      tenantId: "tenant-1",
      providerInstallId: "provider-1",
      provider: "ses" as const,
      agentId: "agent-1",
      spaceId: "space-1",
      threadId: "thread-1",
      from: "sales@acme.thinkwork.ai",
      to: ["buyer@example.com"],
      subject: "Pipeline follow-up",
      body: "Original draft",
    };

    await requestFirstSendApproval(request);
    await expect(
      requestFirstSendApproval({
        ...request,
        providerInstallId: "provider-2",
        subject: "Pipeline follow-up (v2)",
        body: "Revised draft",
      }),
    ).resolves.toMatchObject({
      status: "pending_review",
      conversationId: "conversation-1",
    });

    expect(db.rowsFor(emailConversations)).toHaveLength(1);
    expect(db.rowsFor(inboxItems)).toHaveLength(2);
    // The reuse refreshes every mutable field to the latest request —
    // a stale provider_install_id must not survive on the row.
    expect(db.updatedRowsFor(emailConversations)).toMatchObject([
      {
        subject: "Pipeline follow-up (v2)",
        status: "pending_approval",
        provider_install_id: "provider-2",
      },
    ]);
    // The prior undecided review is superseded so it can't send the old
    // draft alongside the new one.
    expect(db.updatedRowsFor(inboxItems)).toMatchObject([
      { status: "cancelled" },
    ]);
  });

  it("skips review when the recipient set was approved anywhere in the tenant", async () => {
    // Recipient-set approvals are tenant-scoped (2026-08-04): a NEW thread
    // emailing an already-approved recipient set must send without raising
    // another review — "approve an address once", not per-thread.
    const db = fakeEmailDb({
      conversationRows: [
        {
          id: "conversation-approved",
          tenant_id: "tenant-1",
          thread_id: "some-older-thread",
          participant_hash: "ignored-by-fake",
          status: "approved",
        },
      ],
    });

    await expect(
      requestFirstSendApproval({
        db,
        tenantId: "tenant-1",
        providerInstallId: "provider-1",
        provider: "ses" as const,
        agentId: "agent-1",
        spaceId: "space-1",
        threadId: "brand-new-thread",
        from: "sales@acme.thinkwork.ai",
        to: ["buyer@example.com"],
        subject: "Pipeline follow-up",
        body: "Draft",
      }),
    ).resolves.toMatchObject({
      status: "send",
      conversationId: "conversation-approved",
    });

    // No new review artifacts: no inbox item, no draft body, no refresh.
    expect(db.rowsFor(inboxItems)).toHaveLength(0);
    expect(db.rowsFor(emailBodyObjects)).toHaveLength(0);
  });

  it("sends the edited draft on approval and records the decision", async () => {
    const send = vi.fn(async () => ({
      provider: "ses" as const,
      providerMessageId: "ses-approved-1",
      status: "sent" as const,
      metadata: {},
    }));
    const db = fakeEmailDb({
      inboxRows: [
        {
          id: "inbox-1",
          tenant_id: "tenant-1",
          type: "computer_approval",
          config: {
            actionType: "email_send",
            emailDraft: {
              to: "buyer@example.com",
              subject: "Pipeline follow-up",
              body: "Original draft",
            },
            emailChannel: {
              conversationId: "conversation-1",
              providerInstallId: "provider-1",
              provider: "ses",
              from: "sales@acme.thinkwork.ai",
              to: ["buyer@example.com"],
              spaceId: "space-1",
              threadId: "thread-1",
            },
          },
        },
      ],
    });

    await expect(
      bridgeEmailApprovalDecision({
        db,
        inboxItem: db.rowsFor(inboxItems)[0],
        decision: "approved",
        actorId: "reviewer-1",
        decisionPayload: {
          values: {
            editedDraft: {
              to: "buyer@example.com",
              subject: "Updated follow-up",
              body: "Edited body",
            },
          },
        },
        send,
      }),
    ).resolves.toEqual({ sent: true, providerMessageId: "ses-approved-1" });

    expect(send).toHaveBeenCalledWith("ses", {
      tenantId: "tenant-1",
      from: "sales@acme.thinkwork.ai",
      to: ["buyer@example.com"],
      subject: "Updated follow-up",
      text: "Edited body",
    });
    expect(db.updatedRowsFor(emailConversations)).toMatchObject([
      {
        id: "conversation-1",
        status: "approved",
        approved_by_user_id: "reviewer-1",
      },
    ]);
    expect(
      db
        .rowsFor(emailLedgerEvents)
        .map((row: Record<string, any>) => row.event_type),
    ).toEqual(["approval_approved", "send_attempted", "send_succeeded"]);
    expect(db.rowsFor(emailLedgerEvents).at(-1)).toMatchObject({
      provider_message_id: "ses-approved-1",
    });
  });

  it("rejects recipient edits before provider send", async () => {
    const send = vi.fn();
    const db = fakeEmailDb({
      inboxRows: [
        {
          id: "inbox-1",
          tenant_id: "tenant-1",
          type: "computer_approval",
          config: {
            actionType: "email_send",
            emailDraft: {
              to: "buyer@example.com",
              subject: "Pipeline follow-up",
              body: "Original draft",
            },
            emailChannel: {
              conversationId: "conversation-1",
              providerInstallId: "provider-1",
              provider: "ses",
              from: "sales@acme.thinkwork.ai",
              to: ["buyer@example.com"],
            },
          },
        },
      ],
    });

    await expect(
      bridgeEmailApprovalDecision({
        db,
        inboxItem: db.rowsFor(inboxItems)[0],
        decision: "approved",
        actorId: "reviewer-1",
        decisionPayload: {
          values: {
            editedDraft: {
              to: "other@example.com",
              subject: "Pipeline follow-up",
              body: "Edited body",
            },
          },
        },
        send,
      }),
    ).rejects.toThrow("Recipient edits are not supported");

    expect(send).not.toHaveBeenCalled();
    expect(db.rowsFor(emailLedgerEvents)).toEqual([]);
  });

  it("records denial without sending", async () => {
    const send = vi.fn();
    const db = fakeEmailDb({
      inboxRows: [
        {
          id: "inbox-1",
          tenant_id: "tenant-1",
          type: "computer_approval",
          config: {
            actionType: "email_send",
            emailDraft: {
              to: "buyer@example.com",
              subject: "Pipeline follow-up",
              body: "Original draft",
            },
            emailChannel: {
              conversationId: "conversation-1",
              providerInstallId: "provider-1",
              provider: "ses",
              from: "sales@acme.thinkwork.ai",
              to: ["buyer@example.com"],
            },
          },
        },
      ],
    });

    await expect(
      bridgeEmailApprovalDecision({
        db,
        inboxItem: db.rowsFor(inboxItems)[0],
        decision: "rejected",
        actorId: "reviewer-1",
        decisionPayload: { reviewNotes: "Needs a rewrite" },
        send,
      }),
    ).resolves.toEqual({ sent: false, reason: "rejected" });

    expect(send).not.toHaveBeenCalled();
    expect(db.rowsFor(emailLedgerEvents)).toMatchObject([
      {
        event_type: "approval_denied",
        actor_user_id: "reviewer-1",
        reason_code: "reviewer_rejected",
      },
    ]);
  });

  it("identifies email send approval inbox items", () => {
    expect(
      isEmailSendApprovalInboxItem({
        type: "computer_approval",
        config: { actionType: "email_send", emailChannel: {} },
      }),
    ).toBe(true);
    expect(
      isEmailSendApprovalInboxItem({
        type: "computer_approval",
        config: { actionType: "crm_read" },
      }),
    ).toBe(false);
  });
});

function readiness(check_key: string, status: string) {
  return {
    id: `${check_key}-1`,
    tenant_id: "tenant-1",
    provider_install_id: "provider-1",
    check_key,
    status,
  };
}

function fakeEmailDb(
  seed: {
    providerRows?: Array<Record<string, any>>;
    readinessRows?: Array<Record<string, any>>;
    inboxRows?: Array<Record<string, any>>;
    conversationRows?: Array<Record<string, any>>;
  } = {},
) {
  const rows = new Map<unknown, Array<Record<string, any>>>([
    [emailProviderInstalls, [...(seed.providerRows ?? [])]],
    [emailReadinessChecks, [...(seed.readinessRows ?? [])]],
    [emailConversations, [...(seed.conversationRows ?? [])]],
    [emailBodyObjects, []],
    [emailLedgerEvents, []],
    [inboxItems, [...(seed.inboxRows ?? [])]],
  ]);
  const updated = new Map<unknown, Array<Record<string, any>>>();
  const nextId: Record<string, number> = {};
  const tableName = (table: unknown) => {
    switch (table) {
      case emailConversations:
        return "conversation";
      case emailBodyObjects:
        return "body";
      case emailLedgerEvents:
        return "ledger";
      case inboxItems:
        return "inbox";
      default:
        return "row";
    }
  };
  const api = {
    rowsFor(table: unknown) {
      return rows.get(table) ?? [];
    },
    updatedRowsFor(table: unknown) {
      return updated.get(table) ?? [];
    },
    select() {
      return {
        from(table: unknown) {
          return {
            where() {
              return {
                limit(count: number) {
                  return (rows.get(table) ?? []).slice(0, count);
                },
              };
            },
            limit(count: number) {
              return (rows.get(table) ?? []).slice(0, count);
            },
          };
        },
      };
    },
    insert(table: unknown) {
      return {
        values(values: Record<string, any>) {
          const name = tableName(table);
          nextId[name] = (nextId[name] ?? 0) + 1;
          const row = {
            ...values,
            id: values.id ?? `${name}-${nextId[name]}`,
          };
          rows.set(table, [...(rows.get(table) ?? []), row]);
          const result = {
            returning() {
              return [row];
            },
          };
          // The conversation insert chains .onConflictDoUpdate(); the fake
          // has no unique indexes so it behaves as a plain insert.
          return { ...result, onConflictDoUpdate: () => result };
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Record<string, any>) {
          return {
            where() {
              const row = {
                id:
                  table === emailConversations
                    ? "conversation-1"
                    : `${tableName(table)}-updated`,
                ...values,
              };
              updated.set(table, [...(updated.get(table) ?? []), row]);
              return {
                returning() {
                  return [row];
                },
              };
            },
          };
        },
      };
    },
  };
  return api as any;
}
