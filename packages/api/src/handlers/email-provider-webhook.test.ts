import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmailProviderError } from "../lib/email-channel/provider-contract.js";

const {
  db,
  getSecret,
  processNormalizedInboundEmail,
  resetMocks,
  selectRows,
  verifyEvent,
} = vi.hoisted(() => {
  const rows: unknown[][] = [];
  const secret = vi.fn();
  const processInbound = vi.fn();
  const verify = vi.fn();

  function resultBuilder() {
    const result = rows.shift() ?? [];
    return { limit: vi.fn(async () => result) };
  }

  const query = {
    from: vi.fn(() => query),
    where: vi.fn(resultBuilder),
  };

  return {
    db: {
      select: vi.fn(() => query),
    },
    getSecret: secret,
    processNormalizedInboundEmail: processInbound,
    resetMocks: () => {
      rows.length = 0;
      secret.mockReset();
      secret.mockImplementation(async (ref: string) =>
        ref.includes("webhook")
          ? "whsec_test"
          : JSON.stringify({ apiKey: "re_test" }),
      );
      processInbound.mockReset();
      verify.mockReset();
    },
    selectRows: rows,
    verifyEvent: verify,
  };
});

vi.mock("@thinkwork/runtime-config", () => ({
  getSecret,
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => db,
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  emailProviderInstalls: {
    active_for_production: "email_provider_installs.active_for_production",
    credential_secret_ref: "email_provider_installs.credential_secret_ref",
    id: "email_provider_installs.id",
    provider: "email_provider_installs.provider",
    status: "email_provider_installs.status",
    webhook_secret_ref: "email_provider_installs.webhook_secret_ref",
  },
}));

vi.mock("./email-inbound.js", () => ({
  processNormalizedInboundEmail,
}));

vi.mock("../lib/email-channel/providers/resend.js", () => ({
  createResendProvider: () => ({
    provider: "resend",
    verifyEvent,
  }),
}));

vi.mock("../lib/email-channel/providers/ses.js", () => ({
  createSesProvider: () => ({
    provider: "ses",
    verifyEvent,
  }),
}));

import { handler } from "./email-provider-webhook.js";

describe("email-provider-webhook", () => {
  beforeEach(() => resetMocks());

  it("rejects invalid Resend signatures before processing inbound mail", async () => {
    selectRows.push([providerInstall()]);
    verifyEvent.mockRejectedValue(
      new EmailProviderError(
        "resend",
        "RESEND_WEBHOOK_SIGNATURE_INVALID",
        "Resend webhook signature verification failed.",
      ),
    );

    const result = await handler(webhookEvent());

    expect(result.statusCode).toBe(400);
    expect(processNormalizedInboundEmail).not.toHaveBeenCalled();
    expect(verifyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        rawBody: '{"type":"email.received"}',
        webhookSecret: "whsec_test",
        credential: "re_test",
      }),
    );
  });

  it("passes verified inbound events through the shared inbound gate", async () => {
    const inbound = {
      provider: "resend",
      providerEventId: "evt_1",
      providerMessageId: "email_1",
      receivedAt: new Date("2026-06-17T12:00:00Z"),
      fromEmail: "eric@acme.com",
      toEmails: ["finance@acme.thinkwork.ai"],
      subject: "Hello",
      textBody: "Body",
      headers: {},
      attachments: [],
      metadata: {},
    };
    const providerEvent = {
      provider: "resend",
      providerEventId: "evt_1",
      providerMessageId: "email_1",
      eventType: "received",
      occurredAt: inbound.receivedAt,
      inbound,
      metadata: {},
    };
    selectRows.push([providerInstall()]);
    verifyEvent.mockResolvedValue(providerEvent);

    const result = await handler(webhookEvent());

    expect(result.statusCode).toBe(200);
    expect(processNormalizedInboundEmail).toHaveBeenCalledWith({
      inbound,
      providerEvent,
    });
  });
});

function providerInstall() {
  return {
    id: "provider-install-1",
    tenant_id: "tenant-acme",
    provider: "resend",
    status: "ready",
    active_for_production: true,
    credential_secret_ref: "resend/credential",
    webhook_secret_ref: "resend/webhook",
  };
}

function webhookEvent(): APIGatewayProxyEventV2 {
  return {
    body: '{"type":"email.received"}',
    headers: {
      "svix-id": "msg_1",
      "svix-timestamp": "1760000000",
      "svix-signature": "v1,test",
    },
    isBase64Encoded: false,
    pathParameters: { providerInstallId: "provider-install-1" },
    requestContext: { http: { method: "POST" } },
  } as unknown as APIGatewayProxyEventV2;
}
