import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  evaluateOutboundPolicyMock,
  mockSesSend,
  insertedTokens,
  queueRows,
  requestFirstSendApprovalMock,
  resetMocks,
} = vi.hoisted(() => {
  process.env.EMAIL_HMAC_SECRET = "test-hmac";
  const rows: unknown[][] = [];
  const inserts: unknown[] = [];
  return {
    evaluateOutboundPolicyMock: vi.fn(),
    mockSesSend: vi.fn(),
    insertedTokens: inserts,
    requestFirstSendApprovalMock: vi.fn(),
    queueRows: rows,
    resetMocks: () => {
      rows.length = 0;
      inserts.length = 0;
    },
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  desc: (column: unknown) => ({ type: "desc", column }),
  eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
}));

vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: class {
    send = mockSesSend;
  },
  SendRawEmailCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    insert: () => ({
      values: (value: unknown) => {
        insertedTokens.push(value);
        return Promise.resolve();
      },
    }),
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: () => Promise.resolve(queueRows.shift() ?? []),
          }),
        }),
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(queueRows.shift() ?? []),
          }),
          limit: () => Promise.resolve(queueRows.shift() ?? []),
        }),
      }),
    }),
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  emailReplyTokens: {},
  messages: {
    thread_id: "messages.thread_id",
    role: "messages.role",
    metadata: "messages.metadata",
    created_at: "messages.created_at",
  },
  spaces: {
    id: "spaces.id",
    slug: "spaces.slug",
    tenant_id: "spaces.tenant_id",
  },
  tenants: {
    id: "tenants.id",
    slug: "tenants.slug",
  },
  threads: {
    id: "threads.id",
    space_id: "threads.space_id",
    metadata: "threads.metadata",
  },
}));

vi.mock("../email-channel/outbound-policy.js", () => ({
  evaluateOutboundEmailPolicy: evaluateOutboundPolicyMock,
}));

vi.mock("../email-channel/first-send-approval.js", () => ({
  requestFirstSendApproval: requestFirstSendApprovalMock,
}));

import { sendThreadReplyEmail } from "./thread-reply.js";

const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const THREAD_ID = "00000000-0000-4000-8000-000000000002";
const AGENT_ID = "00000000-0000-4000-8000-000000000003";

describe("sendThreadReplyEmail", () => {
  beforeEach(() => {
    mockSesSend.mockReset();
    mockSesSend.mockResolvedValue({ MessageId: "ses-out-123" });
    evaluateOutboundPolicyMock.mockReset();
    evaluateOutboundPolicyMock.mockResolvedValue({
      allowed: true,
      providerInstallId: "provider-1",
      provider: "ses",
      firstSendReviewRequired: true,
    });
    requestFirstSendApprovalMock.mockReset();
    requestFirstSendApprovalMock.mockResolvedValue({
      status: "send",
      conversationId: "conversation-approved",
    });
    resetMocks();
  });

  it("emails the response back when the thread started from email", async () => {
    queueRows.push(
      // threads
      [
        {
          id: THREAD_ID,
          space_id: "space-1",
          metadata: {
            emailColdContact: { senderEmail: "eric@thinkwork.ai" },
          },
        },
      ],
      // latest user message
      [
        {
          metadata: {
            source: "email_cold_contact",
            senderEmail: "eric@thinkwork.ai",
            subject: "Hello",
            originalMessageId: "<orig-1@thinkwork.ai>",
          },
        },
      ],
      // space + tenant join
      [{ spaceSlug: "default", tenantSlug: "sleek-squirrel-230" }],
    );

    const result = await sendThreadReplyEmail({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      agentId: AGENT_ID,
      body: "Here is **your** answer.",
    });

    expect(result).toEqual({ sent: true, sesMessageId: "ses-out-123" });
    expect(evaluateOutboundPolicyMock).toHaveBeenCalledWith({
      db: expect.anything(),
      tenantId: TENANT_ID,
      spaceId: "space-1",
    });
    expect(requestFirstSendApprovalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        providerInstallId: "provider-1",
        provider: "ses",
        agentId: AGENT_ID,
        spaceId: "space-1",
        threadId: THREAD_ID,
        from: "default@sleek-squirrel-230.thinkwork.ai",
        to: ["eric@thinkwork.ai"],
        subject: "Re: Hello",
        body: "Here is **your** answer.",
      }),
    );
    expect(mockSesSend).toHaveBeenCalledOnce();
    const command = mockSesSend.mock.calls[0][0];
    expect(command.input.Source).toBe(
      "default@sleek-squirrel-230.thinkwork.ai",
    );
    expect(command.input.Destinations).toEqual(["eric@thinkwork.ai"]);

    const rawMessage = Buffer.from(command.input.RawMessage.Data).toString(
      "utf8",
    );
    expect(rawMessage).toContain(
      "From: default@sleek-squirrel-230.thinkwork.ai",
    );
    expect(rawMessage).toContain("To: eric@thinkwork.ai");
    expect(rawMessage).toContain(
      "Reply-To: default@sleek-squirrel-230.thinkwork.ai",
    );
    expect(rawMessage).toContain("Subject: Re: Hello");
    expect(rawMessage).toContain("In-Reply-To: <orig-1@thinkwork.ai>");
    expect(rawMessage).toContain("References: <orig-1@thinkwork.ai>");
    expect(rawMessage).toContain("X-Thinkwork-Reply-Token: ");

    // multipart/alternative structure
    expect(rawMessage).toMatch(
      /Content-Type: multipart\/alternative; boundary="tw-boundary-[0-9a-f]{32}"/,
    );
    // both parts present
    expect(rawMessage).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(rawMessage).toContain("Content-Type: text/html; charset=UTF-8");
    expect(rawMessage).toContain("Content-Transfer-Encoding: quoted-printable");
    // raw markdown body shows up in the text part (verbatim per R5)
    expect(rawMessage).toContain("Here is **your** answer.");
    // rendered HTML body shows up in the html part. Quoted-printable passes
    // printable ASCII (including `<` and `>`) through unchanged; only `=` is
    // encoded as `=3D`. Soft line breaks (`=\r\n`) may appear at 76-col
    // boundaries, so collapse them before checking.
    const collapsed = rawMessage.replace(/=\r\n/g, "");
    expect(collapsed).toContain("<strong>your</strong>");

    expect(insertedTokens).toHaveLength(1);
    expect(insertedTokens[0]).toMatchObject({
      tenant_id: TENANT_ID,
      agent_id: AGENT_ID,
      context_id: THREAD_ID,
      context_type: "thread",
      recipient_email: "eric@thinkwork.ai",
      ses_message_id: "ses-out-123",
    });
  });

  it("strips CRLF from interpolated header values (prevents header injection)", async () => {
    queueRows.push(
      [
        {
          id: THREAD_ID,
          space_id: "space-1",
          metadata: {
            emailColdContact: { senderEmail: "eric@thinkwork.ai" },
          },
        },
      ],
      [
        {
          metadata: {
            source: "email_cold_contact",
            senderEmail: "eric@thinkwork.ai",
            // Attacker-crafted Subject + Message-ID with CRLF injection.
            subject: "Test\r\nBcc: attacker@evil.com\r\nX-Pwned: yes",
            originalMessageId: "<orig\r\nBcc: another@evil.com@x.com>",
          },
        },
      ],
      [{ spaceSlug: "default", tenantSlug: "sleek-squirrel-230" }],
    );

    const result = await sendThreadReplyEmail({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      agentId: AGENT_ID,
      body: "ok",
    });

    expect(result).toEqual({ sent: true, sesMessageId: "ses-out-123" });
    const rawMessage = Buffer.from(
      mockSesSend.mock.calls[0][0].input.RawMessage.Data,
    ).toString("utf8");

    // No injected Bcc header anywhere in the headers section.
    const headerSection = rawMessage.split("\r\n\r\n")[0];
    expect(headerSection).not.toMatch(/^Bcc:/im);
    expect(headerSection).not.toMatch(/^X-Pwned:/im);
    // The Subject line collapses CRLFs into a single line of literal text.
    expect(headerSection).toMatch(
      /^Subject: Re: TestBcc: attacker@evil\.comX-Pwned: yes$/m,
    );
    // In-Reply-To stays on a single line.
    expect(headerSection).toMatch(
      /^In-Reply-To: <origBcc: another@evil\.com@x\.com>$/m,
    );
  });

  it("encodes non-ASCII agent output as quoted-printable round-trip", async () => {
    queueRows.push(
      [
        {
          id: THREAD_ID,
          space_id: "space-1",
          metadata: {
            emailColdContact: { senderEmail: "eric@thinkwork.ai" },
          },
        },
      ],
      [
        {
          metadata: {
            source: "email_cold_contact",
            senderEmail: "eric@thinkwork.ai",
            subject: "Hello",
            originalMessageId: "<orig-3@thinkwork.ai>",
          },
        },
      ],
      [{ spaceSlug: "default", tenantSlug: "sleek-squirrel-230" }],
    );

    const result = await sendThreadReplyEmail({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      agentId: AGENT_ID,
      body: "Café résumé 🚀",
    });

    expect(result).toEqual({ sent: true, sesMessageId: "ses-out-123" });
    const rawMessage = Buffer.from(
      mockSesSend.mock.calls[0][0].input.RawMessage.Data,
    ).toString("utf8");

    // é = 0xC3 0xA9 in UTF-8 → =C3=A9 ; 🚀 = 0xF0 0x9F 0x9A 0x80 → =F0=9F=9A=80
    expect(rawMessage).toContain("Caf=C3=A9 r=C3=A9sum=C3=A9 =F0=9F=9A=80");
  });

  it("skips when the thread has no emailColdContact metadata", async () => {
    queueRows.push([{ id: THREAD_ID, space_id: "space-1", metadata: {} }]);

    const result = await sendThreadReplyEmail({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      agentId: AGENT_ID,
      body: "Here is your answer.",
    });

    expect(result).toEqual({ sent: false, reason: "not_email_thread" });
    expect(mockSesSend).not.toHaveBeenCalled();
    expect(insertedTokens).toHaveLength(0);
  });

  it("skips when the latest user message came from chat, not email", async () => {
    queueRows.push(
      [
        {
          id: THREAD_ID,
          space_id: "space-1",
          metadata: {
            emailColdContact: { senderEmail: "eric@thinkwork.ai" },
          },
        },
      ],
      [{ metadata: { source: "chat" } }],
    );

    const result = await sendThreadReplyEmail({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      agentId: AGENT_ID,
      body: "Here is your answer.",
    });

    expect(result).toEqual({
      sent: false,
      reason: "last_user_message_not_email",
    });
    expect(mockSesSend).not.toHaveBeenCalled();
    expect(insertedTokens).toHaveLength(0);
  });

  it("emails the reply continuation when the latest user message is email_reply", async () => {
    queueRows.push(
      [
        {
          id: THREAD_ID,
          space_id: "space-1",
          metadata: {
            emailColdContact: { senderEmail: "eric@thinkwork.ai" },
          },
        },
      ],
      [
        {
          metadata: {
            source: "email_reply",
            senderEmail: "eric@thinkwork.ai",
            subject: "Re: Hello",
            originalMessageId: "<orig-2@thinkwork.ai>",
          },
        },
      ],
      [{ spaceSlug: "default", tenantSlug: "sleek-squirrel-230" }],
    );

    const result = await sendThreadReplyEmail({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      agentId: AGENT_ID,
      body: "Sure, more details here.",
    });

    expect(result).toEqual({ sent: true, sesMessageId: "ses-out-123" });
    const rawMessage = Buffer.from(
      mockSesSend.mock.calls[0][0].input.RawMessage.Data,
    ).toString("utf8");
    // Already prefixed Re: — shouldn't double-prefix.
    expect(rawMessage).toContain("Subject: Re: Hello");
    expect(rawMessage).not.toContain("Subject: Re: Re: Hello");
    expect(rawMessage).toContain("In-Reply-To: <orig-2@thinkwork.ai>");
  });

  it("fails closed when outbound readiness is incomplete", async () => {
    evaluateOutboundPolicyMock.mockResolvedValueOnce({
      allowed: false,
      reasonCode: "email_readiness_incomplete",
      message: "Email provider readiness is incomplete.",
    });
    queueRows.push(
      [
        {
          id: THREAD_ID,
          space_id: "space-1",
          metadata: {
            emailColdContact: { senderEmail: "eric@thinkwork.ai" },
          },
        },
      ],
      [
        {
          metadata: {
            source: "email_reply",
            senderEmail: "eric@thinkwork.ai",
            subject: "Re: Hello",
          },
        },
      ],
      [{ spaceSlug: "default", tenantSlug: "sleek-squirrel-230" }],
    );

    const result = await sendThreadReplyEmail({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      agentId: AGENT_ID,
      body: "Sure, more details here.",
    });

    expect(result).toEqual({ sent: false, reason: "readiness_blocked" });
    expect(mockSesSend).not.toHaveBeenCalled();
  });

  it("requests review again when the email conversation is not approved", async () => {
    requestFirstSendApprovalMock.mockResolvedValueOnce({
      status: "pending_review",
      conversationId: "conversation-1",
      inboxItemId: "inbox-1",
    });
    queueRows.push(
      [
        {
          id: THREAD_ID,
          space_id: "space-1",
          metadata: {
            emailColdContact: { senderEmail: "eric@thinkwork.ai" },
          },
        },
      ],
      [
        {
          metadata: {
            source: "email_reply",
            senderEmail: "eric@thinkwork.ai",
            subject: "Re: Hello",
          },
        },
      ],
      [{ spaceSlug: "default", tenantSlug: "sleek-squirrel-230" }],
    );

    const result = await sendThreadReplyEmail({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      agentId: AGENT_ID,
      body: "Sure, more details here.",
    });

    expect(result).toEqual({ sent: false, reason: "pending_review" });
    expect(mockSesSend).not.toHaveBeenCalled();
    expect(insertedTokens).toHaveLength(0);
  });

  it("skips when the body is empty", async () => {
    const result = await sendThreadReplyEmail({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      agentId: AGENT_ID,
      body: "   ",
    });

    expect(result).toEqual({ sent: false, reason: "empty_body" });
    expect(mockSesSend).not.toHaveBeenCalled();
  });
});
