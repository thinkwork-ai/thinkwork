import { and, eq } from "drizzle-orm";
import {
  EMAIL_READINESS_CHECK_KEYS,
  emailProviderInstalls,
  emailReadinessChecks,
  emailSpacePolicies,
  type EmailChannelProvider,
} from "@thinkwork/database-pg/schema";
import type { Database } from "@thinkwork/database-pg";

type Db = Pick<Database, "select">;

export type OutboundEmailPolicyResult =
  | {
      allowed: true;
      providerInstallId: string;
      provider: EmailChannelProvider;
      firstSendReviewRequired: boolean;
    }
  | {
      allowed: false;
      reasonCode:
        | "email_provider_missing"
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

  if (!provider) {
    return {
      allowed: false,
      reasonCode: "email_provider_missing",
      message:
        "Email provider readiness is incomplete. Configure and verify the Email Channel plugin before sending production email.",
    };
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
    EMAIL_READINESS_CHECK_KEYS.every((key) =>
      readiness.some(
        (check: { check_key: string; status: string }) =>
          check.check_key === key && check.status === "pass",
      ),
    );
  if (!ready) {
    return {
      allowed: false,
      reasonCode: "email_readiness_incomplete",
      message:
        "Email provider readiness is incomplete. Production email fails closed until all readiness checks pass.",
    };
  }

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
    providerInstallId: provider.id,
    provider: provider.provider as EmailChannelProvider,
    firstSendReviewRequired,
  };
}
