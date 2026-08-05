import { describe, expect, it, vi } from "vitest";
import { emailLedgerEvents } from "@thinkwork/database-pg/schema";
import { withSendLedger } from "../ledger.js";

describe("withSendLedger", () => {
  it("writes send_attempted then send_succeeded around a provider send", async () => {
    // THINK-600: a send that skipped review through an already-approved
    // recipient set used to write nothing at all. Every outbound send is
    // audit evidence, not just the gated ones.
    const db = fakeLedgerDb();
    const result = await withSendLedger(
      {
        db,
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        spaceId: "space-1",
        threadId: "thread-1",
        providerInstallId: "provider-1",
        subject: "Pipeline follow-up",
        fromEmail: "sales@acme.thinkwork.ai",
        toEmails: ["buyer@example.com"],
        source: "approved_fast_path",
      },
      async () => ({
        provider: "ses",
        providerMessageId: "ses-fast-1",
        status: "sent",
      }),
    );

    expect(result.providerMessageId).toBe("ses-fast-1");
    expect(db.rows.map((row: Record<string, any>) => row.event_type)).toEqual([
      "send_attempted",
      "send_succeeded",
    ]);
    // Same tenant/thread/recipient shape as the gated path's rows.
    for (const row of db.rows) {
      expect(row).toMatchObject({
        tenant_id: "tenant-1",
        conversation_id: "conversation-1",
        space_id: "space-1",
        thread_id: "thread-1",
        provider_install_id: "provider-1",
        subject: "Pipeline follow-up",
        from_email: "sales@acme.thinkwork.ai",
        to_emails: ["buyer@example.com"],
      });
      expect(row.metadata).toMatchObject({ source: "approved_fast_path" });
    }
    expect(db.rows[1]).toMatchObject({
      provider_message_id: "ses-fast-1",
      metadata: { provider: "ses", status: "sent" },
    });
  });

  it("writes send_failed and rethrows when the provider send throws", async () => {
    const db = fakeLedgerDb();
    const send = vi.fn(async () => {
      throw new Error("SES throttled");
    });

    await expect(
      withSendLedger(
        {
          db,
          tenantId: "tenant-1",
          subject: "Pipeline follow-up",
          fromEmail: "sales@acme.thinkwork.ai",
          toEmails: ["buyer@example.com"],
          source: "approved_fast_path",
        },
        send,
      ),
    ).rejects.toThrow("SES throttled");

    expect(db.rows.map((row: Record<string, any>) => row.event_type)).toEqual([
      "send_attempted",
      "send_failed",
    ]);
    expect(db.rows[1]).toMatchObject({
      reason_code: "provider_send_failed",
      metadata: { message: "SES throttled", source: "approved_fast_path" },
      conversation_id: null,
      thread_id: null,
    });
  });
});

function fakeLedgerDb() {
  const rows: Array<Record<string, any>> = [];
  const api = {
    rows,
    insert(table: unknown) {
      return {
        values(values: Record<string, any>) {
          if (table === emailLedgerEvents) rows.push(values);
          return Promise.resolve([values]);
        },
      };
    },
  };
  return api as typeof api & any;
}
