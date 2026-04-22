/**
 * Billing tables — Stripe customer + subscription mirror + webhook event dedup.
 *
 * Flow: stripe-webhook Lambda receives checkout.session.completed, inserts a
 * row in `stripe_events` (PK conflict = replay; return 200 and skip), then
 * pre-provisions a tenants row with `pending_owner_email` and attaches
 * stripe_customers + stripe_subscriptions rows. bootstrapUser later claims
 * the tenant when the paying user signs in via Google OAuth.
 *
 * See docs/plans/2026-04-22-008-feat-stripe-pricing-and-post-checkout-onboarding-plan.md
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./core";

// ---------------------------------------------------------------------------
// stripe_customers — 1:1 with tenants.
// ---------------------------------------------------------------------------

export const stripeCustomers = pgTable(
  "stripe_customers",
  {
    tenant_id: uuid("tenant_id")
      .primaryKey()
      .references(() => tenants.id, { onDelete: "cascade" }),
    stripe_customer_id: text("stripe_customer_id").notNull(),
    email: text("email").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("stripe_customers_stripe_customer_id_uidx").on(
      table.stripe_customer_id,
    ),
  ],
);

// ---------------------------------------------------------------------------
// stripe_subscriptions — subscription state mirror. At most one active row
// per tenant is enforced by a hand-rolled partial unique index; see
// drizzle/0022_stripe_billing_indexes.sql.
// ---------------------------------------------------------------------------

export const stripeSubscriptions = pgTable(
  "stripe_subscriptions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    stripe_subscription_id: text("stripe_subscription_id").notNull(),
    stripe_price_id: text("stripe_price_id").notNull(),
    // Raw Stripe status string: incomplete, incomplete_expired, trialing,
    // active, past_due, canceled, unpaid, paused. Kept as text (not an enum)
    // so Stripe API changes don't require a migration.
    status: text("status").notNull(),
    current_period_end: timestamp("current_period_end", {
      withTimezone: true,
    }),
    cancel_at_period_end: boolean("cancel_at_period_end")
      .notNull()
      .default(false),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("stripe_subscriptions_stripe_subscription_id_uidx").on(
      table.stripe_subscription_id,
    ),
  ],
);

// ---------------------------------------------------------------------------
// stripe_events — webhook dedup. INSERT on receive; PK conflict means the
// event was already processed and we return 200 without side effects.
// ---------------------------------------------------------------------------

export const stripeEvents = pgTable("stripe_events", {
  stripe_event_id: text("stripe_event_id").primaryKey(),
  event_type: text("event_type").notNull(),
  processed_at: timestamp("processed_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});
