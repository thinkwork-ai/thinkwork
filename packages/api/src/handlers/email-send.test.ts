import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSesSend } = vi.hoisted(() => ({
  mockSesSend: vi.fn(),
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
  getDb: () => ({}),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  agents: {},
  agentCapabilities: {},
  emailReplyTokens: {},
}));

import { handler } from "./email-send.js";

describe("email-send direct routine invocation", () => {
  beforeEach(() => {
    mockSesSend.mockReset();
    mockSesSend.mockResolvedValue({ MessageId: "ses-123" });
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
