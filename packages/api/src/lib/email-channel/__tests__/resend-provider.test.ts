import { describe, expect, it, vi } from "vitest";
import { createResendProvider } from "../providers/resend.js";
import { EmailProviderError } from "../provider-contract.js";

describe("Resend Email Channel provider", () => {
  it("sends structured email through the Resend API with idempotency", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "email_123" }),
    })) as any;
    const provider = createResendProvider({ fetchImpl });

    await expect(
      provider.send({
        credential: "re_test_key",
        from: "space@example.com",
        to: ["customer@example.com"],
        subject: "Hello",
        text: "Plain",
        html: "<p>Plain</p>",
        replyTo: "space@example.com",
        idempotencyKey: "send-1",
        tags: { tenant: "thinkwork" },
      }),
    ).resolves.toMatchObject({
      provider: "resend",
      providerMessageId: "email_123",
      status: "sent",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer re_test_key",
          "Idempotency-Key": "send-1",
        }),
      }),
    );
    const body = JSON.parse(fetchImpl.mock.calls[0]?.[1]?.body);
    expect(body).toMatchObject({
      from: "space@example.com",
      to: ["customer@example.com"],
      reply_to: "space@example.com",
      tags: [{ name: "tenant", value: "thinkwork" }],
    });
  });

  it("verifies raw webhook bytes before normalizing an inbound event", async () => {
    const rawBody =
      '{"type":"email.received","id":"evt_123","created_at":"2026-06-17T12:00:00.000Z","data":{"id":"email_123","from":"Sender <sender@example.com>","to":["space@tenant.thinkwork.ai"],"subject":"Inbound"}}';
    const verifyWebhook = vi.fn(({ payload }) => JSON.parse(payload));
    const provider = createResendProvider({
      verifyWebhook,
      fetchReceivedEmailContent: async () => ({
        textBody: "Fetched body",
        htmlBody: "<p>Fetched body</p>",
        headers: { "message-id": "<original@example.com>" },
      }),
    });

    const event = await provider.verifyEvent({
      rawBody,
      credential: "re_test_key",
      webhookSecret: "whsec_test",
      headers: {
        "svix-id": "msg_123",
        "svix-timestamp": "1710000000",
        "svix-signature": "v1,test",
      },
    });

    expect(verifyWebhook).toHaveBeenCalledWith({
      payload: rawBody,
      headers: {
        "svix-id": "msg_123",
        "svix-timestamp": "1710000000",
        "svix-signature": "v1,test",
      },
      webhookSecret: "whsec_test",
    });
    expect(event).toMatchObject({
      provider: "resend",
      providerEventId: "evt_123",
      providerMessageId: "email_123",
      eventType: "received",
      inbound: {
        fromEmail: "sender@example.com",
        toEmails: ["space@tenant.thinkwork.ai"],
        subject: "Inbound",
        textBody: "Fetched body",
      },
    });
  });

  it("rejects missing or invalid webhook signatures before parsing", async () => {
    const verifyWebhook = vi.fn(() => {
      throw new Error("bad signature");
    });
    const provider = createResendProvider({ verifyWebhook });

    await expect(
      provider.verifyEvent({
        rawBody: '{"not":"parsed"}',
        webhookSecret: "whsec_test",
        headers: {},
      }),
    ).rejects.toMatchObject({
      code: "RESEND_WEBHOOK_SIGNATURE_MISSING",
      failClosed: true,
    });
    expect(verifyWebhook).not.toHaveBeenCalled();

    await expect(
      provider.verifyEvent({
        rawBody: '{"not":"trusted"}',
        webhookSecret: "whsec_test",
        headers: {
          "svix-id": "msg_123",
          "svix-timestamp": "1710000000",
          "svix-signature": "v1,bad",
        },
      }),
    ).rejects.toBeInstanceOf(EmailProviderError);
  });
});
