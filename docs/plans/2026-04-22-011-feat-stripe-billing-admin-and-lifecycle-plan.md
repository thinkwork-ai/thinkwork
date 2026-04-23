---
title: "feat: Admin billing screen + Stripe subscription lifecycle events"
type: feat
status: active
date: 2026-04-22
---

# feat: Admin billing screen + Stripe subscription lifecycle events

## Overview

Two coupled pieces shipped as one PR:

1. **Subscription lifecycle events in the Stripe webhook** — handle `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed` so the `stripe_subscriptions` mirror row stays live and `tenants.plan` reflects reality (not just the snapshot taken at checkout).
2. **Admin Billing screen** — `admin.thinkwork.ai/settings/billing` shows the signed-in user's tenant subscription state and a "Manage subscription" button that opens the Stripe Customer Portal (Stripe hosts cancel / plan change / update card / invoice history).

Without this, every paid tenant's subscription state is a snapshot that rots the moment anything changes, and users have nowhere to self-serve their billing.

## Requirements Trace

- **R1.** Stripe webhook processes the four additional event types idempotently (dedup via `stripe_events` PK, same pattern as checkout.session.completed).
- **R2.** `stripe_subscriptions` row stays in sync: `status`, `current_period_end`, `cancel_at_period_end`, `stripe_price_id` update as Stripe fires events.
- **R3.** `tenants.plan` flips to `"free"` when the subscription is canceled end-of-period or after dunning timeout. Flips to the new plan name when a paid upgrade/downgrade lands.
- **R4.** New `currentSubscription` GraphQL query returns the signed-in user's tenant subscription, or `null` for free tenants.
- **R5.** New `POST /api/stripe/portal-session` Lambda (Cognito-auth'd) creates a Stripe Customer Portal session and returns the URL.
- **R6.** Admin Billing screen lives under the existing Settings nav, shows plan/status/renewal/cancel-flag, and a button that opens the portal URL.

## Scope Boundaries

- **Stripe Customer Portal** is hosted by Stripe. We don't build cancel / plan-change / card-update / invoice-history UIs — the portal handles them.
- No email notifications for dunning / cancelation in this PR. Separate follow-up.
- No admin-side "grant a plan" operator action (e.g., comp a tenant). Later.
- No multi-seat billing or usage-based pricing. Subscription-mode only.
- No mobile Billing screen. Mobile visitors tap "Manage subscription" and get an in-app browser pointed at the portal URL — we'll wire that in a follow-up.

## Key Technical Decisions

- **Webhook handler stays a single Lambda.** Adding event types into the `switch` block in `stripe-webhook.ts` keeps the DB-constraint idempotency gate + signature verification shared across all events. No new Lambdas for per-event handlers.
- **Row-update helper in a separate file.** `packages/api/src/lib/stripe-update-subscription.ts` is a pure DB helper that takes a Stripe `Subscription` or `Invoice` object and writes the mirror. Testable in isolation; webhook branches call it.
- **Plan flip on cancelation**: `customer.subscription.deleted` (end-of-period or immediate) sets `tenants.plan = "free"`. Intermediate states (`past_due`, `canceled` but still in grace period) don't change the plan — only the status. Product decision: we don't gate features by plan yet, so even "free" after cancel is just a label. When we do gate, that's a separate migration.
- **`currentSubscription` GraphQL query** returns the `stripe_subscriptions` row joined to `stripe_customers.email` (so the admin UI can show which email is on file) — null when no row exists. Scoped by `resolveCallerTenantId(ctx)` per the Google-federated memory.
- **`stripe-portal` REST Lambda** (not GraphQL) — the portal session creation requires a hop-by-hop redirect on the client side; a synchronous fetch + `window.location.assign(url)` is cleaner than a GraphQL mutation that returns a URL.
- **Portal session `return_url`** lands the user back on the admin Billing screen.
- **Stripe webhook endpoint** needs its enabled_events list updated out-of-band (same endpoint, add event types via `stripe post`). Documented as a post-deploy cutover step in the PR body.

## Implementation Units

- [ ] **Unit 1: `stripe-update-subscription` helper**
  - `packages/api/src/lib/stripe-update-subscription.ts` — pure function that takes a `Stripe.Subscription` (or subscription ID + resolved customer) and upserts into `stripe_subscriptions`. Also optionally updates `tenants.plan` when called with `{ plan: "new-plan-name" }`.
  - `packages/api/src/lib/stripe-update-subscription.test.ts` — mocked DB; verify upsert + plan flip branches.

- [ ] **Unit 2: Webhook lifecycle branches**
  - `packages/api/src/handlers/stripe-webhook.ts` — add case handlers for four new event types.
  - Test scenarios: each event type produces the right DB write; unknown events ack and skip.

- [ ] **Unit 3: Portal-session Lambda**
  - `packages/api/src/handlers/stripe-portal.ts` — POST /api/stripe/portal-session, Cognito-auth'd.
  - Looks up `stripe_customers` by caller's tenant, creates `stripe.billingPortal.sessions.create({ customer, return_url })`, returns `{ url }`.
  - Register in `scripts/build-lambdas.sh` + `terraform/modules/app/lambda-api/handlers.tf`.

- [ ] **Unit 4: GraphQL `currentSubscription` query**
  - Add to `packages/database-pg/graphql/types/` (new `billing.graphql` or extend `core.graphql`).
  - Resolver in `packages/api/src/graphql/resolvers/billing/currentSubscription.query.ts`.
  - Codegen for admin: `pnpm --filter @thinkwork/admin codegen`.

- [ ] **Unit 5: Admin Billing screen**
  - `apps/admin/src/routes/_authed/settings/billing.tsx` — React + shadcn UI, uses the `currentSubscription` query + "Manage subscription" button that POSTs to `/api/stripe/portal-session` and redirects.
  - Add to settings nav.

- [ ] **Unit 6: Post-merge cutover documentation**
  - PR body includes: `stripe post /v1/webhook_endpoints/we_...` to add the new event types.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Stripe sends events we don't recognize | Default case acks + logs — consistent with current webhook. |
| Concurrent webhook deliveries on the same subscription | `stripe_events` PK dedup + `stripe_subscriptions_stripe_subscription_id_uidx` unique index keep DB consistent. Upsert uses `ON CONFLICT ... DO UPDATE` so last-write-wins is safe. |
| Customer Portal session for a tenant with no Stripe customer row | Handler returns 404 with a clear "no active subscription" message; admin UI renders the free-tier state. |
| `tenants.plan` flip to "free" after cancel silently downgrades features | Features aren't plan-gated yet, so this is cosmetic today. When gating lands, add a grace-period read. |
| Admin UI shipped before webhook events enabled on Stripe dashboard | PR body includes the `stripe post` cutover command as a required post-deploy step. |
