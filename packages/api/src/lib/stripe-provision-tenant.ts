/**
 * Pre-provision a tenant row from a successful Stripe Checkout Session.
 *
 * Called by the stripe-webhook Lambda after signature verification and event
 * dedup succeed. Writes tenants + tenant_settings + stripe_customers +
 * stripe_subscriptions plus an inert owner principal and exact Cognito
 * enrollment in a single transaction. The recipient owns nothing until the
 * opaque link and independent one-time challenge are consumed.
 */

import type Stripe from "stripe";
import {
  db,
  and,
  eq,
  tenants,
  tenantMembers,
  tenantSettings,
  users,
} from "../graphql/utils.js";
import { schema } from "@thinkwork/database-pg";
import { generateSlug } from "@thinkwork/database-pg/utils/generate-slug";
import { workspaceFolderName } from "@thinkwork/database-pg/utils/workspace-folder-name";
import { issueEnrollmentGrants } from "../handlers/auth-enrollment.js";
import { ensureTenantBootstrapDefaults } from "./tenant-bootstrap-defaults.js";
import { ensureDefaultThreadSpace } from "./spaces/default-space.js";
import { priceIdToInternalPlan } from "./stripe-plans.js";

const { stripeCustomers, stripeSubscriptions } = schema;

export interface ProvisionInput {
  session: Stripe.Checkout.Session;
  customer: Stripe.Customer;
  subscription: Stripe.Subscription;
  appUrl: string;
}

export interface ProvisionResult {
  tenantId: string;
  email: string;
  plan: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  ownerUserId: string;
  membershipId: string;
  enrollment: {
    startToken: string;
    recipientChallenge: string;
    expiresAt: Date;
  };
}

const UNKNOWN_PLAN = "unknown";

/**
 * Idempotent at the uniqueness-constraint layer: if stripe_subscription_id
 * already exists, we ignore the insert (another concurrent delivery of the
 * same event type got here first). The stripe_events table is the primary
 * dedup gate; this is belt-and-suspenders.
 */
export async function provisionTenantFromStripeSession(
  input: ProvisionInput,
): Promise<ProvisionResult> {
  const { session, customer, subscription } = input;

  const email = (session.customer_details?.email || customer.email || "")
    .trim()
    .toLowerCase();
  if (!email) {
    throw new Error(
      "Cannot provision tenant: checkout session has no customer email",
    );
  }

  const priceId = subscription.items.data[0]?.price.id;
  if (!priceId) {
    throw new Error(
      `Cannot provision tenant: subscription ${subscription.id} has no price`,
    );
  }

  const internalPlan = priceIdToInternalPlan(priceId) ?? UNKNOWN_PLAN;
  if (internalPlan === UNKNOWN_PLAN) {
    console.warn(
      `[stripe-provision-tenant] Unrecognized price_id=${priceId} on subscription=${subscription.id}; writing plan="${UNKNOWN_PLAN}" and continuing so Stripe stops retrying. Operator follow-up required.`,
    );
  }

  const emailLocal = email.split("@")[0] || "workspace";
  const displayName =
    session.customer_details?.name?.trim() ||
    customer.name?.trim() ||
    `${emailLocal}'s Workspace`;

  // Stripe's `Subscription` type pins `current_period_end` to a number, but
  // newer API versions report it as optional at runtime on some paused /
  // incomplete states. Coerce defensively so this module keeps working
  // through API upgrades without a typings chase.
  const currentPeriodEndRaw =
    (subscription as unknown as { current_period_end?: number | null })
      .current_period_end ?? null;

  const result = await db.transaction(async (tx) => {
    const [existingSubscription] = await tx
      .select({ tenantId: stripeSubscriptions.tenant_id })
      .from(stripeSubscriptions)
      .where(eq(stripeSubscriptions.stripe_subscription_id, subscription.id))
      .limit(1);
    if (existingSubscription) {
      const [existingTenant] = await tx
        .select({ id: tenants.id, plan: tenants.plan })
        .from(tenants)
        .where(eq(tenants.id, existingSubscription.tenantId))
        .limit(1);
      const [existingOwner] = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.tenant_id, existingSubscription.tenantId),
            eq(users.email, email),
          ),
        )
        .limit(1);
      const [existingMembership] = existingOwner
        ? await tx
            .select({ id: tenantMembers.id })
            .from(tenantMembers)
            .where(
              and(
                eq(tenantMembers.tenant_id, existingSubscription.tenantId),
                eq(tenantMembers.principal_type, "user"),
                eq(tenantMembers.principal_id, existingOwner.id),
                eq(tenantMembers.role, "owner"),
              ),
            )
            .limit(1)
        : [];
      if (!existingTenant || !existingOwner || !existingMembership) {
        throw new Error(
          `Existing Stripe provisioning for ${subscription.id} is incomplete`,
        );
      }
      const baseUrl = input.appUrl.trim().replace(/\/$/, "");
      const enrollment = await issueEnrollmentGrants({
        tenantId: existingTenant.id,
        intendedUserId: existingOwner.id,
        membershipId: existingMembership.id,
        grantKind: "pending_owner",
        redirectUri: `${baseUrl}/auth/callback`,
        transaction: tx,
      });
      return {
        tenantId: existingTenant.id,
        email,
        plan: existingTenant.plan,
        stripeCustomerId: customer.id,
        stripeSubscriptionId: subscription.id,
        ownerUserId: existingOwner.id,
        membershipId: existingMembership.id,
        enrollment,
      };
    }

    const [tenant] = await tx
      .insert(tenants)
      .values({
        name: displayName,
        slug: generateSlug(),
        plan: internalPlan,
        issue_prefix: "TW",
        issue_counter: 0,
        first_admin_claim_required: true,
      })
      .returning();

    await tx
      .insert(tenantSettings)
      .values({ tenant_id: tenant.id })
      .onConflictDoNothing();

    const [owner] = await tx
      .insert(users)
      .values({
        tenant_id: tenant.id,
        email,
        name: displayName,
        workspace_folder_name: workspaceFolderName(displayName, [], "user"),
      })
      .returning({ id: users.id });

    const [membership] = await tx
      .insert(tenantMembers)
      .values({
        tenant_id: tenant.id,
        principal_type: "user",
        principal_id: owner.id,
        role: "owner",
        status: "pending",
      })
      .returning({ id: tenantMembers.id });

    await tx
      .insert(stripeCustomers)
      .values({
        tenant_id: tenant.id,
        stripe_customer_id: customer.id,
        email,
      })
      .onConflictDoNothing();

    await tx
      .insert(stripeSubscriptions)
      .values({
        tenant_id: tenant.id,
        stripe_subscription_id: subscription.id,
        stripe_price_id: priceId,
        status: subscription.status,
        current_period_end: currentPeriodEndRaw
          ? new Date(currentPeriodEndRaw * 1000)
          : null,
        cancel_at_period_end: subscription.cancel_at_period_end ?? false,
      })
      .onConflictDoNothing();

    const baseUrl = input.appUrl.trim().replace(/\/$/, "");
    const enrollment = await issueEnrollmentGrants({
      tenantId: tenant.id,
      intendedUserId: owner.id,
      membershipId: membership.id,
      grantKind: "pending_owner",
      redirectUri: `${baseUrl}/auth/callback`,
      transaction: tx,
    });

    return {
      tenantId: tenant.id,
      email,
      plan: internalPlan,
      stripeCustomerId: customer.id,
      stripeSubscriptionId: subscription.id,
      ownerUserId: owner.id,
      membershipId: membership.id,
      enrollment,
    };
  });

  // These defaults are recoverable and intentionally do not weaken the
  // atomic ownership boundary above. Enrollment remains valid if a seed is
  // temporarily unavailable; operators can rerun the idempotent seed.
  try {
    await ensureTenantBootstrapDefaults({
      tenantId: result.tenantId,
      userId: result.ownerUserId,
    });
    await ensureDefaultThreadSpace({
      tenantId: result.tenantId,
      userId: result.ownerUserId,
    });
  } catch (error) {
    console.warn(
      "[stripe-provision-tenant] Tenant defaults could not be seeded:",
      error,
    );
  }

  return result;
}
