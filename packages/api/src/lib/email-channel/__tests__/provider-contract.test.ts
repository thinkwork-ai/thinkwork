import { describe, expect, it, vi } from "vitest";
import {
  emailLedgerEvents,
  emailProviderEvents,
} from "@thinkwork/database-pg/schema";
import { createEmailChannelService } from "../channel-service.js";
import {
  EmailProviderError,
  providerSafeError,
  type EmailProviderAdapter,
} from "../provider-contract.js";
import { recordProviderEvent } from "../ledger.js";
import {
  buildReadinessChecks,
  productionReadinessPassed,
} from "../readiness.js";

describe("Email Channel provider contract", () => {
  it("routes sends through the selected provider adapter", async () => {
    const send = vi.fn(async () => ({
      provider: "ses" as const,
      providerMessageId: "ses-123",
      status: "sent" as const,
      metadata: {},
    }));
    const service = createEmailChannelService({
      providers: { ses: fakeAdapter("ses", { send }) },
    });

    await expect(
      service.send("ses", {
        from: "space@tenant.thinkwork.ai",
        to: ["user@example.com"],
        subject: "Hello",
        text: "Body",
      }),
    ).resolves.toMatchObject({ providerMessageId: "ses-123" });
    expect(send).toHaveBeenCalledOnce();
  });

  it("keeps provider errors fail-closed and safe to surface", () => {
    const err = new EmailProviderError(
      "resend",
      "RESEND_SEND_FAILED",
      "Resend email send failed; production email must fail closed.",
      { retryable: true, metadata: { secret: "not returned" } },
    );

    expect(err.failClosed).toBe(true);
    expect(providerSafeError(err)).toEqual({
      code: "RESEND_SEND_FAILED",
      message: "Resend email send failed; production email must fail closed.",
      provider: "resend",
      retryable: true,
    });
  });

  it("requires all readiness checks before production can pass", () => {
    const blocked = buildReadinessChecks({
      credentialConfigured: true,
      webhookSecretConfigured: true,
      domainVerified: true,
      inboundVerified: false,
      providerEventsReachable: true,
      loopTestPassed: true,
    });
    expect(productionReadinessPassed(blocked)).toBe(false);
    expect(
      blocked.find((check) => check.checkKey === "inbound_receiving"),
    ).toMatchObject({ status: "blocked" });

    const ready = buildReadinessChecks({
      credentialConfigured: true,
      webhookSecretConfigured: true,
      domainVerified: true,
      inboundVerified: true,
      providerEventsReachable: true,
      loopTestPassed: true,
    });
    expect(productionReadinessPassed(ready)).toBe(true);
  });

  it("records provider events idempotently before writing ledger rows", async () => {
    const db = fakeLedgerDb();
    const event = {
      provider: "resend" as const,
      providerEventId: "evt_123",
      providerMessageId: "email_123",
      eventType: "delivered" as const,
      occurredAt: new Date("2026-06-17T12:00:00Z"),
      metadata: { status: "ok" },
    };

    await expect(
      recordProviderEvent({
        db,
        tenantId: "tenant-1",
        providerInstallId: "provider-1",
        event,
      }),
    ).resolves.toEqual({ recorded: true, ledgerEventId: "ledger-1" });
    await expect(
      recordProviderEvent({
        db,
        tenantId: "tenant-1",
        providerInstallId: "provider-1",
        event,
      }),
    ).resolves.toEqual({ recorded: false, ledgerEventId: "ledger-1" });
    expect(db.ledgerRows).toHaveLength(1);
  });
});

function fakeAdapter(
  provider: "resend" | "ses",
  overrides: Partial<EmailProviderAdapter> = {},
): EmailProviderAdapter {
  return {
    provider,
    send: vi.fn(),
    verifyEvent: vi.fn(),
    normalizeInbound: vi.fn(),
    readinessChecks: vi.fn(),
    domainInstructions: vi.fn(),
    ...overrides,
  } as EmailProviderAdapter;
}

function fakeLedgerDb() {
  const providerRows: Array<Record<string, any>> = [];
  const ledgerRows: Array<Record<string, any>> = [];
  return {
    providerRows,
    ledgerRows,
    insert(table: unknown) {
      return {
        values(values: Record<string, any>) {
          if (table === emailProviderEvents) {
            return {
              onConflictDoNothing() {
                return {
                  returning() {
                    const existing = providerRows.find(
                      (row) =>
                        row.provider_install_id ===
                          values.provider_install_id &&
                        row.provider_event_id === values.provider_event_id,
                    );
                    if (existing) return [];
                    const row = {
                      ...values,
                      id: `provider-${providerRows.length + 1}`,
                    };
                    providerRows.push(row);
                    return [{ id: row.id }];
                  },
                };
              },
            };
          }
          if (table === emailLedgerEvents) {
            return {
              returning() {
                const row = {
                  ...values,
                  id: `ledger-${ledgerRows.length + 1}`,
                };
                ledgerRows.push(row);
                return [{ id: row.id }];
              },
            };
          }
          throw new Error("unexpected table");
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Record<string, any>) {
          return {
            where() {
              if (table === emailProviderEvents) {
                const row = providerRows[providerRows.length - 1];
                if (row) Object.assign(row, values);
              }
              return [];
            },
          };
        },
      };
    },
    select() {
      return {
        from(table: unknown) {
          return {
            where() {
              return {
                limit() {
                  if (table !== emailProviderEvents) return [];
                  const row = providerRows[0];
                  return row ? [{ ledgerEventId: row.ledger_event_id }] : [];
                },
              };
            },
          };
        },
      };
    },
  } as any;
}
