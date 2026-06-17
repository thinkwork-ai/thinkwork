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

  function queryBuilder() {
    const builder = {
      from: vi.fn(() => builder),
      innerJoin: vi.fn(() => builder),
      where: vi.fn(resultBuilder),
      limit: vi.fn(async () => []),
      then: Promise.resolve([]).then.bind(Promise.resolve([])),
    };
    return builder;
  }

  return {
    createColdContactThread: coldContact,
    db: {
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((value: unknown) => {
          inserts.push({ table, values: value });
          const chain = {
            onConflictDoNothing: vi.fn(() => chain),
            returning: vi.fn(async () => [{ id: "message-email-1" }]),
          };
          return chain;
        }),
      })),
      select: vi.fn(queryBuilder),
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
  emailDomains: {
    domain: "email_domains.domain",
    id: "email_domains.id",
    provider_install_id: "email_domains.provider_install_id",
    status: "email_domains.status",
    tenant_id: "email_domains.tenant_id",
  },
  emailLedgerEvents: {
    created_at: "email_ledger_events.created_at",
    event_type: "email_ledger_events.event_type",
    from_email: "email_ledger_events.from_email",
    space_id: "email_ledger_events.space_id",
    tenant_id: "email_ledger_events.tenant_id",
  },
  emailProviderEvents: {
    id: "email_provider_events.id",
    ledger_event_id: "email_provider_events.ledger_event_id",
    provider_event_id: "email_provider_events.provider_event_id",
    provider_install_id: "email_provider_events.provider_install_id",
  },
  emailProviderInstalls: {
    active_for_production: "email_provider_installs.active_for_production",
    id: "email_provider_installs.id",
    status: "email_provider_installs.status",
  },
  emailReplyTokens: {
    id: "email_reply_tokens.id",
    ses_message_id: "email_reply_tokens.ses_message_id",
    token_hash: "email_reply_tokens.token_hash",
    use_count: "email_reply_tokens.use_count",
  },
  emailSpacePolicies: {
    enabled: "email_space_policies.enabled",
    outside_sender_default: "email_space_policies.outside_sender_default",
    private_space_membership_required:
      "email_space_policies.private_space_membership_required",
    registered_users_allowed: "email_space_policies.registered_users_allowed",
    space_id: "email_space_policies.space_id",
    tenant_id: "email_space_policies.tenant_id",
  },
  emailSpaceSenderAllowlists: {
    id: "email_space_sender_allowlists.id",
    space_id: "email_space_sender_allowlists.space_id",
    tenant_id: "email_space_sender_allowlists.tenant_id",
    value: "email_space_sender_allowlists.value",
    value_type: "email_space_sender_allowlists.value_type",
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

function routeRow(overrides: Record<string, unknown> = {}) {
  return {
    recipientEmail: "finance@acme.thinkwork.ai",
    tenantId: "tenant-acme",
    tenantSlug: "acme",
    spaceId: "space-finance",
    spaceSlug: "finance",
    spaceStatus: "active",
    spaceAccessMode: "public",
    providerInstallId: "provider-resend",
    domainId: "domain-acme",
    ...overrides,
  };
}

function enabledPolicy(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    registeredUsersAllowed: true,
    privateSpaceMembershipRequired: true,
    outsideSenderDefault: "deny",
    ...overrides,
  };
}

function rateLimitPassRows() {
  return [[{ count: 0 }], [{ count: 0 }], [{ count: 0 }]];
}

describe("email-inbound routing", () => {
  beforeEach(() => resetMocks());

  it("routes cold-contact email for an enabled public Space", async () => {
    selectRows.push(
      [routeRow()],
      [enabledPolicy()],
      [{ id: "user-eric" }],
      ...rateLimitPassRows(),
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
    expect(insertedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          values: expect.objectContaining({
            event_type: "inbound_authorized",
            reason_code: "registered_user_allowed",
          }),
        }),
      ]),
    );
  });

  it("rejects cold-contact email when the Space trigger is disabled", async () => {
    selectRows.push([routeRow()], [enabledPolicy({ enabled: false })]);

    await handler(emailEvent("finance@acme.thinkwork.ai"));

    expect(createColdContactThread).not.toHaveBeenCalled();
    expect(insertedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          values: expect.objectContaining({
            event_type: "inbound_rejected",
            reason_code: "space_policy_disabled",
          }),
        }),
      ]),
    );
  });

  it("rejects cold-contact email when the Space policy is missing", async () => {
    selectRows.push([routeRow()], []);

    await handler(emailEvent("finance@acme.thinkwork.ai"));

    expect(createColdContactThread).not.toHaveBeenCalled();
    expect(insertedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          values: expect.objectContaining({
            event_type: "inbound_rejected",
            reason_code: "space_policy_missing",
          }),
        }),
      ]),
    );
  });

  it("rejects private Space cold-contact from non-members", async () => {
    selectRows.push(
      [routeRow({ spaceAccessMode: "private" })],
      [enabledPolicy()],
      [{ id: "user-eric" }],
      [],
    );

    await handler(emailEvent("finance@acme.thinkwork.ai"));

    expect(createColdContactThread).not.toHaveBeenCalled();
    expect(insertedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          values: expect.objectContaining({
            event_type: "inbound_rejected",
            reason_code: "private_space_membership_required",
          }),
        }),
      ]),
    );
  });

  it("routes token-bearing Space replies before cold-contact handling", async () => {
    parsedEmail.inReplyTo = "<ses-outbound-1>";
    selectRows.push(
      [routeRow()],
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
      [routeRow()],
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
    selectRows.push(
      [routeRow()],
      [
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
      ],
    );

    await handler(emailEvent("finance@acme.thinkwork.ai"));

    expect(createColdContactThread).not.toHaveBeenCalled();
    expect(insertedRows).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          values: expect.objectContaining({
            content: "Hello from email",
            thread_id: "thread-finance",
          }),
        }),
      ]),
    );
  });

  it("silently drops unroutable legacy tenant-dot-space addresses", async () => {
    await handler(emailEvent("acme.finance@agents.thinkwork.ai"));

    expect(createColdContactThread).not.toHaveBeenCalled();
    expect(insertedRows).toHaveLength(0);
    expect(mockSesSend).not.toHaveBeenCalled();
  });

  it("silently drops unroutable legacy per-agent addresses", async () => {
    await handler(emailEvent("marco@agents.thinkwork.ai"));

    expect(createColdContactThread).not.toHaveBeenCalled();
    expect(insertedRows).toHaveLength(0);
    expect(mockSesSend).not.toHaveBeenCalled();
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
