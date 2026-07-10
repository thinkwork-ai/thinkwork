import { and, eq } from "drizzle-orm";
import {
  emailProviderInstalls,
  emailReadinessChecks,
  emailSpacePolicies,
  type EmailChannelProvider,
} from "@thinkwork/database-pg/schema";
import type { Database } from "@thinkwork/database-pg";
import { PRODUCTION_READINESS_CHECKS } from "./readiness.js";

type Db = Pick<Database, "select">;

export type OutboundEmailPolicyResult =
  | {
      allowed: true;
      /**
       * Null when sending through built-in SES without a provider install
       * row (no provider has ever been configured for the tenant).
       */
      providerInstallId: string | null;
      provider: EmailChannelProvider;
      firstSendReviewRequired: boolean;
    }
  | {
      allowed: false;
      reasonCode:
        | "email_provider_disabled"
        | "email_readiness_incomplete"
        | "email_space_policy_disabled";
      message: string;
    };

export async function evaluateOutboundEmailPolicy(input: {
  db: Db;
  tenantId: string;
  spaceId?: string | null;
}): Promise<OutboundEmailPolicyResult> {
  const [provider] = await input.db
    .select()
    .from(emailProviderInstalls)
    .where(
      and(
        eq(emailProviderInstalls.tenant_id, input.tenantId),
        eq(emailProviderInstalls.active_for_production, true),
      ),
    )
    .limit(1);

  // Built-in SES path: an explicitly selected SES install, or no provider
  // install at all. SES readiness is owned by the platform deployment (IAM
  // role + Terraform-managed agents domain), not tenant plugin checks — the
  // resend-style readiness gate below only applies to third-party providers.
  // This keeps email always available: plugins are opt-in upgrades, SES is
  // the baseline.
  if (!provider || provider.provider === "ses") {
    // Still honor an operator's explicit disable (or a probe-recorded
    // failure) on the SES install itself — always-available covers the
    // default states (no install, pending, ready), not an install someone
    // turned off.
    if (
      provider &&
      (provider.status === "disabled" || provider.status === "failed")
    ) {
      return {
        allowed: false,
        reasonCode: "email_provider_disabled",
        message:
          "The selected SES email provider is disabled. Re-enable it in Settings before sending.",
      };
    }
    return finalizeWithSpacePolicy(input, {
      providerInstallId: provider?.id ?? null,
      provider: "ses",
    });
  }

  const readiness = await input.db
    .select()
    .from(emailReadinessChecks)
    .where(
      and(
        eq(emailReadinessChecks.tenant_id, input.tenantId),
        eq(emailReadinessChecks.provider_install_id, provider.id),
      ),
    );
  const ready =
    provider.status === "ready" &&
    PRODUCTION_READINESS_CHECKS.every((key) =>
      readiness.some(
        (check: { check_key: string; status: string }) =>
          check.check_key === key && check.status === "pass",
      ),
    );
  if (!ready) {
    return {
      allowed: false,
      reasonCode: "email_readiness_incomplete",
      message: `Email provider readiness is incomplete for ${provider.provider}. Production email through a third-party provider fails closed until its credential, domain, receiving, and webhook checks pass.`,
    };
  }

  return finalizeWithSpacePolicy(input, {
    providerInstallId: provider.id,
    provider: provider.provider as EmailChannelProvider,
  });
}

async function finalizeWithSpacePolicy(
  input: { db: Db; tenantId: string; spaceId?: string | null },
  selected: {
    providerInstallId: string | null;
    provider: EmailChannelProvider;
  },
): Promise<OutboundEmailPolicyResult> {
  let firstSendReviewRequired = true;
  if (input.spaceId) {
    const [policy] = await input.db
      .select()
      .from(emailSpacePolicies)
      .where(
        and(
          eq(emailSpacePolicies.tenant_id, input.tenantId),
          eq(emailSpacePolicies.space_id, input.spaceId),
        ),
      )
      .limit(1);
    if (policy && policy.enabled === false) {
      return {
        allowed: false,
        reasonCode: "email_space_policy_disabled",
        message: "Email is disabled for this Space.",
      };
    }
    firstSendReviewRequired = policy?.first_send_review_required !== false;
  }

  return {
    allowed: true,
    providerInstallId: selected.providerInstallId,
    provider: selected.provider,
    firstSendReviewRequired,
  };
}
