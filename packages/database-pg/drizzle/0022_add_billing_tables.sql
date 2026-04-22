-- Stripe billing tables + pending_owner_email column on tenants.
--
-- Paired with packages/database-pg/drizzle/0022_stripe_billing_indexes.sql,
-- which adds the partial unique index on tenants.pending_owner_email and the
-- single-active-subscription-per-tenant partial unique index on
-- stripe_subscriptions.
--
-- See docs/plans/2026-04-22-008-feat-stripe-pricing-and-post-checkout-onboarding-plan.md
-- (Unit 3).
--
-- Apply manually (matches 0018/0019/0020/0021 convention):
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0022_add_billing_tables.sql
--
-- Drift detection:
--   pnpm db:migrate-manual
--
-- creates-column: public.tenants.pending_owner_email
-- creates: public.stripe_customers
-- creates: public.stripe_subscriptions
-- creates: public.stripe_events
-- creates: public.stripe_customers_stripe_customer_id_uidx
-- creates: public.stripe_subscriptions_stripe_subscription_id_uidx

ALTER TABLE "tenants" ADD COLUMN "pending_owner_email" text;

CREATE TABLE "stripe_customers" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "stripe_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"stripe_price_id" text NOT NULL,
	"status" text NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "stripe_events" (
	"stripe_event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "stripe_customers" ADD CONSTRAINT "stripe_customers_tenant_id_tenants_id_fk"
   FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "stripe_subscriptions" ADD CONSTRAINT "stripe_subscriptions_tenant_id_tenants_id_fk"
   FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "stripe_customers_stripe_customer_id_uidx"
  ON "stripe_customers" ("stripe_customer_id");

CREATE UNIQUE INDEX IF NOT EXISTS "stripe_subscriptions_stripe_subscription_id_uidx"
  ON "stripe_subscriptions" ("stripe_subscription_id");
