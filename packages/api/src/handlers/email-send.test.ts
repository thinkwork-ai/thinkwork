import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { insertedReplyTokens, mockSesSend, resetDb, selectRows } = vi.hoisted(
  () => {
    process.env.THINKWORK_API_SECRET = "test-secret";
    const rows: unknown[][] = [];
    const inserts: unknown[] = [];
    return {
      insertedReplyTokens: inserts,
      mockSesSend: vi.fn(),
      resetDb: () => {
        rows.length = 0;
        inserts.length = 0;
      },
      selectRows: rows,
    };
  },
);

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
}));

vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: class {
    send = mockSesSend;
  },
  SendEmailCommand: class {
    constructor(public input: unknown) {}
  },
  SendRawEmailCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    insert: () => ({
      values: (value: unknown) => {
        insertedReplyTokens.push(value);
        return Promise.resolve();
      },
    }),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(selectRows.shift() ?? []),
      }),
    }),
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  agents: {
    id: "agents.id",
    slug: "agents.slug",
    tenant_id: "agents.tenant_id",
  },
  agentCapabilities: {
    agent_id: "agentCapabilities.agent_id",
    capability: "agentCapabilities.capability",
  },
  emailReplyTokens: {},
}));

import { handler } from "./email-send.js";

describe("email-send direct routine invocation", () => {
  beforeEach(() => {
    mockSesSend.mockReset();
    mockSesSend.mockResolvedValue({ MessageId: "ses-123" });
    resetDb();
    delete process.env.ROUTINE_EMAIL_SOURCE;
  });

  it("sends routine email events without HTTP bearer auth", async () => {
    const result = await handler({
      tenantId: "4b9a2462-51ee-4529-88c3-4cfd82392d4b",
      routineId: "dfef43de-33e5-48c3-b3db-9e06dd6a45e5",
      executionId:
        "arn:aws:states:us-east-1:123456789012:execution:routine:exec",
      to: ["ericodom37@gmail.com"],
      subject: "Austin weather update",
      body: "Current weather for Austin: clear.",
      bodyFormat: "markdown",
    });

    expect(mockSesSend).toHaveBeenCalledOnce();
    const command = mockSesSend.mock.calls[0][0];
    expect(command.input).toMatchObject({
      Source: "automation@agents.thinkwork.ai",
      Destination: { ToAddresses: ["ericodom37@gmail.com"] },
      Message: {
        Subject: { Data: "Austin weather update", Charset: "UTF-8" },
        Body: {
          Text: {
            Data: "Current weather for Austin: clear.",
            Charset: "UTF-8",
          },
        },
      },
    });
    expect(result).toEqual({ messageId: "ses-123", status: "sent" });
  });

  it("rejects direct routine email events missing required fields", async () => {
    const result = await handler({
      to: ["ericodom37@gmail.com"],
      subject: "Austin weather update",
    });

    expect(result).toMatchObject({ statusCode: 400 });
    expect(mockSesSend).not.toHaveBeenCalled();
  });
});

describe("email-send HTTP agent invocation", () => {
  const agentId = "00000000-0000-4000-8000-000000000001";
  const tenantId = "tenant-1";

  beforeEach(() => {
    mockSesSend.mockReset();
    mockSesSend.mockResolvedValue({ MessageId: "ses-space-1" });
    resetDb();
  });

  it("sends from the active Space address and persists the reply token", async () => {
    selectRows.push(
      [{ id: agentId, tenant_id: tenantId, slug: "finance-agent" }],
      [
        {
          enabled: true,
          config: {
            vanityAddress: "legacy-finance",
            maxReplyTokenAgeDays: 14,
            maxReplyTokenUses: 5,
          },
        },
      ],
    );

    const result = await handler(
      emailSendEvent({
        agentId,
        to: "recipient@example.com",
        subject: "Quarterly close",
        body: "Here is the brief.",
        threadId: "thread-finance",
        spaceTenantSlug: "acme",
        spaceSlug: "finance",
      }),
    );

    expect(result).toMatchObject({ statusCode: 200 });
    expect(mockSesSend).toHaveBeenCalledOnce();
    const command = mockSesSend.mock.calls[0][0];
    expect(command.input.Source).toBe("acme.finance@agents.thinkwork.ai");
    expect(command.input.Destinations).toEqual(["recipient@example.com"]);

    const rawMessage = Buffer.from(command.input.RawMessage.Data).toString(
      "utf8",
    );
    expect(rawMessage).toContain("From: acme.finance@agents.thinkwork.ai");
    expect(rawMessage).toContain("Reply-To: acme.finance@agents.thinkwork.ai");
    expect(rawMessage).toContain("X-Thinkwork-Reply-Token:");

    expect(insertedReplyTokens).toHaveLength(1);
    expect(insertedReplyTokens[0]).toMatchObject({
      agent_id: agentId,
      context_id: "thread-finance",
      context_type: "thread",
      max_uses: 5,
      recipient_email: "recipient@example.com",
      ses_message_id: "ses-space-1",
      tenant_id: tenantId,
    });
  });

  it("rejects sends when Space context is missing", async () => {
    selectRows.push(
      [{ id: agentId, tenant_id: tenantId, slug: "finance-agent" }],
      [{ enabled: true, config: { vanityAddress: "legacy-finance" } }],
    );

    const result = await handler(
      emailSendEvent({
        agentId,
        to: "recipient@example.com",
        subject: "Quarterly close",
        body: "Here is the brief.",
      }),
    );

    expect(result).toMatchObject({ statusCode: 400 });
    expect(JSON.parse(result.body as string).error).toContain(
      "Active Space email context is required",
    );
    expect(mockSesSend).not.toHaveBeenCalled();
    expect(insertedReplyTokens).toHaveLength(0);
  });

  it("does not persist a reply token when SES rejects the send", async () => {
    selectRows.push(
      [{ id: agentId, tenant_id: tenantId, slug: "finance-agent" }],
      [{ enabled: true, config: {} }],
    );
    mockSesSend.mockRejectedValueOnce(new Error("SES unavailable"));

    const result = await handler(
      emailSendEvent({
        agentId,
        to: "recipient@example.com",
        subject: "Quarterly close",
        body: "Here is the brief.",
        activeSpaceTenantSlug: "acme",
        activeSpaceSlug: "finance",
      }),
    );

    expect(result).toMatchObject({ statusCode: 500 });
    expect(insertedReplyTokens).toHaveLength(0);
  });

  it("rejects malformed Space slugs before sending", async () => {
    selectRows.push(
      [{ id: agentId, tenant_id: tenantId, slug: "finance-agent" }],
      [{ enabled: true, config: {} }],
    );

    const result = await handler(
      emailSendEvent({
        agentId,
        to: "recipient@example.com",
        subject: "Quarterly close",
        body: "Here is the brief.",
        spaceTenantSlug: "acme.inc",
        spaceSlug: "finance",
      }),
    );

    expect(result).toMatchObject({ statusCode: 400 });
    expect(JSON.parse(result.body ?? "{}").error).toContain(
      "Invalid tenant slug",
    );
    expect(mockSesSend).not.toHaveBeenCalled();
    expect(insertedReplyTokens).toHaveLength(0);
  });
});

function emailSendEvent(body: Record<string, unknown>): APIGatewayProxyEventV2 {
  return {
    body: JSON.stringify(body),
    headers: { authorization: "Bearer test-secret" },
    requestContext: { http: { method: "POST" } },
  } as unknown as APIGatewayProxyEventV2;
}
