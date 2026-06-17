import { describe, expect, it, vi } from "vitest";
import { createSesProvider, normalizeSesInbound } from "../providers/ses.js";

describe("SES Email Channel provider", () => {
  it("sends raw MIME through SES compatibility mode", async () => {
    const send = vi.fn(async () => ({ MessageId: "ses-message-1" }));
    const provider = createSesProvider({ sesClient: { send } as any });

    await expect(
      provider.send({
        from: "space@tenant.thinkwork.ai",
        to: ["customer@example.com"],
        subject: "Ignored for raw",
        rawMessage: "From: space@tenant.thinkwork.ai\r\n\r\nhello",
      }),
    ).resolves.toEqual({
      provider: "ses",
      providerMessageId: "ses-message-1",
      status: "sent",
      metadata: { mode: "raw" },
    });
    expect((send.mock.calls as any[][])[0]?.[0]?.constructor.name).toBe(
      "SendRawEmailCommand",
    );
  });

  it("sends structured text/html through SES compatibility mode", async () => {
    const send = vi.fn(async () => ({ MessageId: "ses-message-2" }));
    const provider = createSesProvider({ sesClient: { send } as any });

    await expect(
      provider.send({
        from: "automation@agents.thinkwork.ai",
        to: ["customer@example.com"],
        cc: ["ops@example.com"],
        subject: "Status",
        text: "Plain status",
        html: "<p>Status</p>",
      }),
    ).resolves.toMatchObject({
      provider: "ses",
      providerMessageId: "ses-message-2",
      metadata: { mode: "simple" },
    });
    expect((send.mock.calls as any[][])[0]?.[0]?.constructor.name).toBe(
      "SendEmailCommand",
    );
  });

  it("normalizes SES receipt records without changing reply-token substrate", async () => {
    const inbound = await normalizeSesInbound(sesRecord());

    expect(inbound).toMatchObject({
      provider: "ses",
      providerEventId: "ses-message-3",
      providerMessageId: "ses-message-3",
      fromEmail: "sender@example.com",
      toEmails: ["space@tenant.thinkwork.ai"],
      subject: "Hello from SES",
    });
    expect(inbound.metadata).toMatchObject({
      s3Key: "email/inbound/ses-message-3",
    });
  });
});

function sesRecord() {
  return {
    eventSource: "aws:ses",
    eventVersion: "1.0",
    ses: {
      mail: {
        timestamp: "2026-06-17T12:00:00.000Z",
        source: "Sender <sender@example.com>",
        messageId: "ses-message-3",
        destination: ["space@tenant.thinkwork.ai"],
        headers: [
          { name: "Subject", value: "Hello from SES" },
          { name: "Message-ID", value: "<original@example.com>" },
        ],
        commonHeaders: {
          from: ["Sender <sender@example.com>"],
          to: ["space@tenant.thinkwork.ai"],
          subject: "Hello from SES",
        },
      },
      receipt: {
        timestamp: "2026-06-17T12:00:00.000Z",
        recipients: ["space@tenant.thinkwork.ai"],
        spamVerdict: { status: "PASS" },
        virusVerdict: { status: "PASS" },
        spfVerdict: { status: "PASS" },
        dkimVerdict: { status: "PASS" },
        dmarcVerdict: { status: "PASS" },
        action: { type: "S3", bucketName: "bucket", objectKey: "key" },
      },
    },
  };
}
