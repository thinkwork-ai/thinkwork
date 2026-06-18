import { describe, expect, it, vi } from "vitest";
import {
  createSendGridProvider,
  listSendGridAuthenticatedDomains,
  usableSendGridDomains,
} from "../providers/sendgrid.js";

describe("SendGrid Email Channel provider", () => {
  it("lists paginated authenticated domains and keeps only usable non-legacy domains", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () =>
          Array.from({ length: 100 }, (_, index) => ({
            id: index + 1,
            domain: `example-${index + 1}.com`,
            valid: true,
            legacy: false,
            default: index === 0,
            dns: { dkim1: { valid: true } },
          })),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: 101,
            domain: "ready.example",
            subdomain: "mail",
            valid: true,
            legacy: false,
            default: false,
            username: "owner@example.com",
            dns: { mail_cname: { valid: true } },
          },
          {
            id: 102,
            domain: "legacy.example",
            valid: true,
            legacy: true,
            default: false,
            dns: {},
          },
          {
            id: 103,
            domain: "pending.example",
            valid: false,
            legacy: false,
            default: false,
            dns: {},
          },
        ],
      });

    const domains = await listSendGridAuthenticatedDomains({
      credential: "SG.test",
      fetchImpl: fetchImpl as any,
    });

    expect(domains).toHaveLength(103);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://api.sendgrid.com/v3/whitelabel/domains?limit=100&offset=0",
      expect.objectContaining({
        headers: { Authorization: "Bearer SG.test" },
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://api.sendgrid.com/v3/whitelabel/domains?limit=100&offset=100",
      expect.any(Object),
    );
    expect(
      usableSendGridDomains(domains).map((domain) => domain.domain),
    ).toContain("ready.example");
    expect(
      usableSendGridDomains(domains).map((domain) => domain.domain),
    ).not.toContain("legacy.example");
  });

  it("sends structured email through SendGrid Mail Send with idempotency", async () => {
    const headers = new Headers({ "x-message-id": "sg-msg-123" });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 202,
      headers,
      json: async () => ({}),
    })) as any;
    const provider = createSendGridProvider({ fetchImpl });

    await expect(
      provider.send({
        credential: "SG.test",
        from: "noreply@example.com",
        to: ["alex@example.com"],
        subject: "You're invited",
        text: "Plain",
        html: "<p>Plain</p>",
        idempotencyKey: "invite-1",
        tags: { tenantId: "tenant-1" },
      }),
    ).resolves.toMatchObject({
      provider: "sendgrid",
      providerMessageId: "sg-msg-123",
      status: "sent",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.sendgrid.com/v3/mail/send",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer SG.test",
          "Idempotency-Key": "invite-1",
        }),
      }),
    );
    const body = JSON.parse(fetchImpl.mock.calls[0]?.[1]?.body);
    expect(body).toMatchObject({
      from: { email: "noreply@example.com", name: "ThinkWork" },
      subject: "You're invited",
      personalizations: [
        {
          to: [{ email: "alex@example.com" }],
          custom_args: { tenantId: "tenant-1" },
        },
      ],
      content: [
        { type: "text/plain", value: "Plain" },
        { type: "text/html", value: "<p>Plain</p>" },
      ],
    });
  });

  it("surfaces SendGrid errors without leaking the API key", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ errors: [{ message: "bad key" }] }),
    })) as any;

    await expect(
      listSendGridAuthenticatedDomains({
        credential: "SG.secret",
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      provider: "sendgrid",
      code: "SENDGRID_DOMAIN_LIST_FAILED",
      metadata: {
        status: 401,
        error: "bad key",
      },
    });

    await expect(
      listSendGridAuthenticatedDomains({
        credential: "SG.secret",
        fetchImpl,
      }),
    ).rejects.not.toMatchObject({
      metadata: expect.objectContaining({ credential: "SG.secret" }),
    });
  });

  it("marks inbound and webhook readiness as not applicable for outbound invites", async () => {
    const provider = createSendGridProvider();
    const checks = await provider.readinessChecks({
      credentialConfigured: true,
      webhookSecretConfigured: false,
      domainVerified: true,
      inboundVerified: false,
      providerEventsReachable: false,
      loopTestPassed: false,
    });

    expect(
      checks.find((check) => check.checkKey === "credentials"),
    ).toMatchObject({
      status: "pass",
    });
    expect(
      checks.find((check) => check.checkKey === "sending_domain"),
    ).toMatchObject({
      status: "pass",
    });
    expect(
      checks.find((check) => check.checkKey === "inbound_receiving"),
    ).toMatchObject({
      status: "pass",
      metadata: { notApplicableFor: "sendgrid_invitation_outbound" },
    });
    expect(
      checks.find((check) => check.checkKey === "webhook_signature"),
    ).toMatchObject({
      status: "pass",
      metadata: { notApplicableFor: "sendgrid_invitation_outbound" },
    });
  });
});
