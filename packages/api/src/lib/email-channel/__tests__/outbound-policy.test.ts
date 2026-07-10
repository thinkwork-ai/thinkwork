import { describe, expect, it } from "vitest";
import {
  emailProviderInstalls,
  emailReadinessChecks,
  emailSpacePolicies,
} from "@thinkwork/database-pg/schema";
import { evaluateOutboundEmailPolicy } from "../outbound-policy.js";

describe("evaluateOutboundEmailPolicy", () => {
  it("allows an active SES install without third-party readiness checks", async () => {
    // Regression: a tenant that selects built-in SES gets no
    // email_readiness_checks rows (those are third-party provider
    // semantics), and agent email must not fail closed because of it.
    const db = fakePolicyDb({
      providerRows: [
        {
          id: "install-ses",
          tenant_id: "tenant-1",
          provider: "ses",
          status: "ready",
          active_for_production: true,
        },
      ],
    });

    await expect(
      evaluateOutboundEmailPolicy({ db, tenantId: "tenant-1", spaceId: null }),
    ).resolves.toMatchObject({
      allowed: true,
      provider: "ses",
      providerInstallId: "install-ses",
      firstSendReviewRequired: true,
    });
  });

  it("defaults to built-in SES when no provider install exists", async () => {
    const db = fakePolicyDb();

    await expect(
      evaluateOutboundEmailPolicy({ db, tenantId: "tenant-1", spaceId: null }),
    ).resolves.toMatchObject({
      allowed: true,
      provider: "ses",
      providerInstallId: null,
      firstSendReviewRequired: true,
    });
  });

  it("blocks a disabled SES install despite the readiness bypass", async () => {
    const db = fakePolicyDb({
      providerRows: [
        {
          id: "install-ses",
          tenant_id: "tenant-1",
          provider: "ses",
          status: "disabled",
          active_for_production: true,
        },
      ],
    });

    await expect(
      evaluateOutboundEmailPolicy({ db, tenantId: "tenant-1", spaceId: null }),
    ).resolves.toMatchObject({
      allowed: false,
      reasonCode: "email_provider_disabled",
    });
  });

  it("allows a pending SES install (readiness is platform-owned)", async () => {
    const db = fakePolicyDb({
      providerRows: [
        {
          id: "install-ses",
          tenant_id: "tenant-1",
          provider: "ses",
          status: "pending",
          active_for_production: true,
        },
      ],
    });

    await expect(
      evaluateOutboundEmailPolicy({ db, tenantId: "tenant-1", spaceId: null }),
    ).resolves.toMatchObject({ allowed: true, provider: "ses" });
  });

  it("fails closed for a third-party provider with incomplete readiness", async () => {
    const db = fakePolicyDb({
      providerRows: [
        {
          id: "install-resend",
          tenant_id: "tenant-1",
          provider: "resend",
          status: "ready",
          active_for_production: true,
        },
      ],
      readinessRows: [
        readiness("credentials", "pass"),
        readiness("sending_domain", "pass"),
        readiness("inbound_receiving", "blocked"),
        readiness("webhook_signature", "pass"),
      ],
    });

    await expect(
      evaluateOutboundEmailPolicy({ db, tenantId: "tenant-1", spaceId: null }),
    ).resolves.toMatchObject({
      allowed: false,
      reasonCode: "email_readiness_incomplete",
    });
  });

  it("allows a third-party provider once every production check passes", async () => {
    const db = fakePolicyDb({
      providerRows: [
        {
          id: "install-resend",
          tenant_id: "tenant-1",
          provider: "resend",
          status: "ready",
          active_for_production: true,
        },
      ],
      readinessRows: [
        readiness("credentials", "pass"),
        readiness("sending_domain", "pass"),
        readiness("inbound_receiving", "pass"),
        readiness("webhook_signature", "pass"),
      ],
    });

    await expect(
      evaluateOutboundEmailPolicy({ db, tenantId: "tenant-1", spaceId: null }),
    ).resolves.toMatchObject({
      allowed: true,
      provider: "resend",
      providerInstallId: "install-resend",
    });
  });

  it("honors a disabled Space policy on the built-in SES path", async () => {
    const db = fakePolicyDb({
      spacePolicyRows: [
        {
          tenant_id: "tenant-1",
          space_id: "space-1",
          enabled: false,
          first_send_review_required: true,
        },
      ],
    });

    await expect(
      evaluateOutboundEmailPolicy({
        db,
        tenantId: "tenant-1",
        spaceId: "space-1",
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reasonCode: "email_space_policy_disabled",
    });
  });

  it("respects a Space policy that waives first-send review on the SES path", async () => {
    const db = fakePolicyDb({
      spacePolicyRows: [
        {
          tenant_id: "tenant-1",
          space_id: "space-1",
          enabled: true,
          first_send_review_required: false,
        },
      ],
    });

    await expect(
      evaluateOutboundEmailPolicy({
        db,
        tenantId: "tenant-1",
        spaceId: "space-1",
      }),
    ).resolves.toMatchObject({
      allowed: true,
      provider: "ses",
      firstSendReviewRequired: false,
    });
  });
});

function readiness(check_key: string, status: string) {
  return {
    tenant_id: "tenant-1",
    provider_install_id: "install-resend",
    check_key,
    status,
  };
}

function fakePolicyDb(
  seed: {
    providerRows?: Array<Record<string, any>>;
    readinessRows?: Array<Record<string, any>>;
    spacePolicyRows?: Array<Record<string, any>>;
  } = {},
) {
  const rows = new Map<unknown, Array<Record<string, any>>>([
    [emailProviderInstalls, [...(seed.providerRows ?? [])]],
    [emailReadinessChecks, [...(seed.readinessRows ?? [])]],
    [emailSpacePolicies, [...(seed.spacePolicyRows ?? [])]],
  ]);
  return {
    select() {
      return {
        from(table: unknown) {
          const data = rows.get(table) ?? [];
          // Awaitable result that also supports .limit(n), matching both
          // `await ...where(...)` and `await ...where(...).limit(1)` shapes.
          const result = {
            limit: (count: number) => data.slice(0, count),
            then: (
              resolve: (value: Array<Record<string, any>>) => unknown,
              reject?: (reason: unknown) => unknown,
            ) => Promise.resolve(data).then(resolve, reject),
          };
          return { where: () => result };
        },
      };
    },
  } as any;
}
