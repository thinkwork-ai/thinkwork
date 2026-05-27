import type { SESEvent } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createColdContactThread,
  db,
  enqueueComputerThreadTurn,
  insertedRows,
  mockSesSend,
  parsedEmail,
  resetMocks,
  selectRows,
} = vi.hoisted(() => {
  const rows: unknown[][] = [];
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const coldContact = vi.fn();
  const enqueue = vi.fn();
  const sesSend = vi.fn();
  const parsed = {
    subject: "Space email",
    text: "Hello from email",
    messageId: "<source@example.com>",
    inReplyTo: "",
  };

  function resultBuilder() {
    const result = rows.shift() ?? [];
    return {
      limit: vi.fn(async () => result),
      then: Promise.resolve(result).then.bind(Promise.resolve(result)),
    };
  }

  return {
    createColdContactThread: coldContact,
    db: {
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((value: unknown) => {
          inserts.push({ table, values: value });
          return {
            returning: vi.fn(async () => [{ id: "message-email-1" }]),
          };
        }),
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(resultBuilder),
          })),
          where: vi.fn(resultBuilder),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => undefined),
        })),
      })),
    },
    enqueueComputerThreadTurn: enqueue,
    insertedRows: inserts,
    mockSesSend: sesSend,
    parsedEmail: parsed,
    resetMocks: () => {
      rows.length = 0;
      inserts.length = 0;
      coldContact.mockReset();
      coldContact.mockResolvedValue({ threadId: "thread-email-1" });
      enqueue.mockReset();
      sesSend.mockReset();
      sesSend.mockResolvedValue({ MessageId: "notice-1" });
      parsed.subject = "Space email";
      parsed.text = "Hello from email";
      parsed.messageId = "<source@example.com>";
      parsed.inReplyTo = "";
    },
    selectRows: rows,
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
  gte: (left: unknown, right: unknown) => ({ type: "gte", left, right }),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    sql: strings.join("?"),
    values,
  })),
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => db,
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  agentCapabilities: {
    agent_id: "agent_capabilities.agent_id",
    capability: "agent_capabilities.capability",
    config: "agent_capabilities.config",
  },
  agentWakeupRequests: {
    agent_id: "agent_wakeup_requests.agent_id",
    created_at: "agent_wakeup_requests.created_at",
    source: "agent_wakeup_requests.source",
    tenant_id: "agent_wakeup_requests.tenant_id",
  },
  agents: {
    id: "agents.id",
    name: "agents.name",
    send_email: "agents.send_email",
    slug: "agents.slug",
    tenant_id: "agents.tenant_id",
  },
  emailReplyTokens: {
    id: "email_reply_tokens.id",
    ses_message_id: "email_reply_tokens.ses_message_id",
    token_hash: "email_reply_tokens.token_hash",
    use_count: "email_reply_tokens.use_count",
  },
  messages: { id: "messages.id" },
  spaceMembers: {
    id: "space_members.id",
    space_id: "space_members.space_id",
    tenant_id: "space_members.tenant_id",
    user_id: "space_members.user_id",
  },
  spaces: {
    access_mode: "spaces.access_mode",
    email_trigger_status: "spaces.email_trigger_status",
    id: "spaces.id",
    slug: "spaces.slug",
    status: "spaces.status",
    tenant_id: "spaces.tenant_id",
  },
  tenants: { id: "tenants.id", slug: "tenants.slug" },
  threads: {
    computer_id: "threads.computer_id",
    id: "threads.id",
    space_id: "threads.space_id",
    tenant_id: "threads.tenant_id",
  },
  users: { email: "users.email", id: "users.id", tenant_id: "users.tenant_id" },
}));

vi.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: class {
    constructor(public input: unknown) {}
  },
  S3Client: class {
    async send() {
      return { Body: { transformToString: async () => "raw email" } };
    }
  },
}));

vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: class {
    send = mockSesSend;
  },
  SendEmailCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock("mailparser", () => ({
  simpleParser: vi.fn(async () => parsedEmail),
}));

vi.mock("../lib/email/cold-contact-trigger.js", () => ({
  createColdContactThread,
}));

import { handler } from "./email-inbound.js";

describe("email-inbound routing", () => {
  beforeEach(() => resetMocks());

  it("routes cold-contact email for an enabled public Space", async () => {
    selectRows.push(
      [
        {
          tenantId: "tenant-acme",
          spaceId: "space-finance",
          accessMode: "public",
          status: "active",
          emailTriggerStatus: "enabled",
        },
      ],
      [{ id: "user-eric" }],
    );

    await handler(emailEvent("finance@acme.thinkwork.ai"));

    expect(createColdContactThread).toHaveBeenCalledWith({
      tenantId: "tenant-acme",
      spaceId: "space-finance",
      senderUserId: "user-eric",
      senderEmail: "eric@acme.com",
      emailSubject: "Space email",
      emailBody: "Hello from email",
      sesMessageId: "ses-inbound-1",
      originalMessageId: "<source@example.com>",
    });
    expect(insertedRows).toHaveLength(0);
  });

  it("rejects cold-contact email when the Space trigger is disabled", async () => {
    selectRows.push([
      {
        tenantId: "tenant-acme",
        spaceId: "space-finance",
        accessMode: "public",
        status: "active",
        emailTriggerStatus: "disabled",
      },
    ]);

    await handler(emailEvent("finance@acme.thinkwork.ai"));

    expect(createColdContactThread).not.toHaveBeenCalled();
    expect(insertedRows).toHaveLength(0);
  });

  it("rejects cold-contact email when the Space trigger is deleted", async () => {
    selectRows.push([
      {
        tenantId: "tenant-acme",
        spaceId: "space-finance",
        accessMode: "public",
        status: "active",
        emailTriggerStatus: "none",
      },
    ]);

    await handler(emailEvent("finance@acme.thinkwork.ai"));

    expect(createColdContactThread).not.toHaveBeenCalled();
    expect(insertedRows).toHaveLength(0);
  });

  it("rejects private Space cold-contact from non-members", async () => {
    selectRows.push(
      [
        {
          tenantId: "tenant-acme",
          spaceId: "space-finance",
          accessMode: "private",
          status: "active",
          emailTriggerStatus: "enabled",
        },
      ],
      [{ id: "user-eric" }],
      [],
    );

    await handler(emailEvent("finance@acme.thinkwork.ai"));

    expect(createColdContactThread).not.toHaveBeenCalled();
    expect(insertedRows).toHaveLength(0);
  });

  it("routes token-bearing Space replies before cold-contact handling", async () => {
    parsedEmail.inReplyTo = "<ses-outbound-1>";
    selectRows.push(
      [
        {
          id: "token-1",
          agent_id: "agent-finance",
          context_id: "thread-finance",
          context_type: "thread",
          recipient_email: "eric@acme.com",
          use_count: 0,
          max_uses: 3,
          expires_at: new Date(Date.now() + 60_000),
        },
      ],
      [
        {
          tenant_id: "tenant-acme",
          computer_id: "computer-finance",
          space_id: "space-finance",
        },
      ],
      [{ id: "user-eric" }],
    );

    await handler(emailEvent("finance@acme.thinkwork.ai"));

    expect(createColdContactThread).not.toHaveBeenCalled();
    expect(insertedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          values: expect.objectContaining({
            content: "Hello from email",
            role: "user",
            sender_id: "user-eric",
            thread_id: "thread-finance",
            metadata: expect.objectContaining({
              source: "email_reply",
              senderEmail: "eric@acme.com",
            }),
          }),
        }),
      ]),
    );
    expect(insertedRows).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          values: expect.objectContaining({
            agent_id: "agent-finance",
            source: "email_received",
          }),
        }),
      ]),
    );
  });

  it("enqueues non-thread reply wakeups without a legacy email_channel capability row", async () => {
    parsedEmail.inReplyTo = "<ses-outbound-1>";
    selectRows.push(
      [
        {
          id: "token-1",
          agent_id: "agent-finance",
          context_id: "agent-finance",
          context_type: "agent",
          recipient_email: "eric@acme.com",
          use_count: 0,
          max_uses: 3,
          expires_at: new Date(Date.now() + 60_000),
        },
      ],
      [
        {
          id: "agent-finance",
          tenant_id: "tenant-acme",
          name: "Finance Agent",
          slug: "finance-agent",
          send_email: { enabled: true },
        },
      ],
      [],
      [{ count: 0 }],
      [{ count: 0 }],
    );

    await handler(emailEvent("finance@acme.thinkwork.ai"));

    expect(createColdContactThread).not.toHaveBeenCalled();
    expect(insertedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          values: expect.objectContaining({
            agent_id: "agent-finance",
            source: "email_received",
            status: "queued",
            payload: expect.objectContaining({
              from: "eric@acme.com",
              replyTokenContextId: "agent-finance",
              replyTokenContextType: "agent",
            }),
          }),
        }),
      ]),
    );
  });

  it("rejects token-bearing Space replies when the sender does not match", async () => {
    parsedEmail.inReplyTo = "<ses-outbound-1>";
    selectRows.push([
      {
        id: "token-1",
        agent_id: "agent-finance",
        context_id: "thread-finance",
        context_type: "thread",
        recipient_email: "someone-else@acme.com",
        use_count: 0,
        max_uses: 3,
        expires_at: new Date(Date.now() + 60_000),
      },
    ]);

    await handler(emailEvent("finance@acme.thinkwork.ai"));

    expect(createColdContactThread).not.toHaveBeenCalled();
    expect(insertedRows).toHaveLength(0);
  });

  it("sends a retirement notice for legacy tenant-dot-space addresses", async () => {
    await handler(emailEvent("acme.finance@agents.thinkwork.ai"));

    expect(createColdContactThread).not.toHaveBeenCalled();
    expect(insertedRows).toHaveLength(0);
    expect(mockSesSend).toHaveBeenCalledOnce();
    const command = mockSesSend.mock.calls[0][0];
    expect(command.input.Message.Body.Text.Data).toContain(
      "Your email to acme.finance@agents.thinkwork.ai was not delivered.",
    );
    expect(command.input.Message.Body.Text.Data).toContain(
      "space-slug@tenant-slug.thinkwork.ai",
    );
  });

  it("sends a retirement notice for legacy per-agent addresses", async () => {
    await handler(emailEvent("marco@agents.thinkwork.ai"));

    expect(createColdContactThread).not.toHaveBeenCalled();
    expect(insertedRows).toHaveLength(0);
    expect(mockSesSend).toHaveBeenCalledOnce();
    const command = mockSesSend.mock.calls[0][0];
    expect(command.input).toMatchObject({
      Source: "noreply@agents.thinkwork.ai",
      Destination: { ToAddresses: ["eric@acme.com"] },
      Message: {
        Subject: {
          Data: "This Thinkwork agent email address has changed",
        },
      },
    });
    expect(command.input.Message.Body.Text.Data).toContain(
      "space-slug@tenant-slug.thinkwork.ai",
    );
  });
});

function emailEvent(recipient: string): SESEvent {
  return {
    Records: [
      {
        ses: {
          mail: {
            headers: [],
            messageId: "ses-inbound-1",
            source: "Eric <eric@acme.com>",
          },
          receipt: { recipients: [recipient] },
        },
      },
    ],
  } as unknown as SESEvent;
}
