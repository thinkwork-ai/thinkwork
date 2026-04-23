---
title: "feat: Stripe upgrade flow + soft-delete tenant on cancel"
type: feat
status: active
date: 2026-04-23
---

# feat: Stripe upgrade flow + soft-delete tenant on cancel

## Overview

Free-tier tenants can self-upgrade without signing out: "See plans" on the Billing screen opens an in-app plan picker, tapping a plan POSTs an authenticated checkout-session request, Stripe Checkout returns the paid subscription attached to the **existing** tenant (not a brand-new one). When a tenant cancels their subscription via the Stripe Customer Portal, the resulting `customer.subscription.deleted` webhook soft-deletes the tenant (`deactivated_at + deactivation_reason`); a 30-day grace period before hard-delete lets accidental cancels be reversed.

Ships in one PR across web + mobile + backend + schema.

## Requirements Trace

- **R1.** The `stripe-checkout` Lambda accepts an optional Cognito ID token. When present, it scopes the Checkout Session to the caller's tenant and passes `client_reference_id = "tenant:<tenantId>"` so the webhook distinguishes upgrade from signup.
- **R2.** The `stripe-webhook` handler has a new branch for upgrade (`client_reference_id` starts with `tenant:`): upsert `stripe_customers` for the existing tenant, insert `stripe_subscriptions`, flip `tenants.plan` — no new tenant row created.
- **R3.** On `customer.subscription.deleted`, set `tenants.deactivated_at = now()` and `tenants.deactivation_reason = 'stripe_subscription_canceled'`. `tenants.plan` also flips to `'free'` for UI consistency.
- **R4.** Mobile Billing: "See plans" opens an in-app plan picker (three cards from `@thinkwork/pricing-config`). Tap → authed checkout-session → open Stripe Checkout in a Safari sheet.
- **R5.** Admin Billing: same plan picker as a modal. Tap → authed checkout-session → `window.location.assign(url)`.
- **R6.** Existing `/onboarding/payment` mobile signup flow unchanged — no regression for unauthenticated signups.

## Scope Boundaries

- **Hard-delete** of deactivated tenants is a separate PR (requires a scheduled sweeper job + thought on cascading deletes). This PR sets the marker; a future PR cleans up.
- **Sign-in gate for deactivated tenants** (showing "Your workspace was canceled — reactivate via pricing") is a separate PR. This PR sets the flag but doesn't yet block the sign-in path. Low risk — a deactivated tenant with no active subscription still can't charge anything new.
- No changes to the www pricing page — it stays the unauthenticated-signup surface.
- Reactivation UX after cancel deferred to the sign-in-gate PR.
- No email to the user when the tenant is deactivated (add with the sign-in gate).

## Key Technical Decisions

- **Single `stripe-checkout` Lambda** — not a new `stripe-upgrade` handler. The only difference between signup and upgrade is an optional auth header + a different `client_reference_id`; everything else (validating the plan, creating the Checkout Session, returning `{ url }`) is identical.
- **`client_reference_id` is the seam** between signup and upgrade. Signup: random UUID. Upgrade: `tenant:<uuid>`. The webhook uses the prefix to route. Keeps the protocol simple and debuggable from Stripe's dashboard.
- **Plan picker is a shared UI concept, not a shared component** — admin uses a shadcn Dialog, mobile uses a `@gorhom/bottom-sheet` modal. Both render the same three cards from `@thinkwork/pricing-config`. Keeping the components separate is cheaper than inventing cross-platform UI for three cards.
- **Soft-delete via additive columns**, not a status enum. Two nullable columns (`deactivated_at`, `deactivation_reason`) minimize migration risk and leave the tenant row queryable until the sweeper runs.
- **Hard-delete is a job, not a webhook path**. On `customer.subscription.deleted` we only mark. A future scheduled sweeper checks `deactivated_at < now() - interval '30 days'` and cascades.

## Implementation Units

- [ ] **Unit 1: Schema — `tenants.deactivated_at` + `deactivation_reason`**
  - Modify: `packages/database-pg/src/schema/core.ts`
  - Create: `packages/database-pg/drizzle/0023_tenants_deactivation.sql` (hand-rolled, additive columns with `-- creates-column:` headers)

- [ ] **Unit 2: `stripe-checkout` — optional auth + upgrade branch**
  - Modify: `packages/api/src/handlers/stripe-checkout.ts`
  - When `Authorization: Bearer <cognito-jwt>` is present → resolve caller's tenantId via `authenticate()` + email fallback; set `client_reference_id = tenant:<id>`, `customer_email` from the user row, `metadata.source = "in-app-upgrade"`.
  - Unauth behavior unchanged.

- [ ] **Unit 3: `stripe-webhook` — upgrade branch + deactivation on cancel**
  - Modify: `packages/api/src/handlers/stripe-webhook.ts`
  - On `checkout.session.completed`: check `client_reference_id` prefix. If `tenant:<id>`, call a new `attachStripeSubscriptionToTenant(tenantId, session, customer, subscription)` helper that upserts `stripe_customers` + `stripe_subscriptions` + sets `tenants.plan` — no new tenant row, no welcome email (user is already signed in).
  - On `customer.subscription.deleted`: existing update + set `deactivated_at = now()`, `deactivation_reason = 'stripe_subscription_canceled'`.
  - Create: `packages/api/src/lib/stripe-attach-subscription.ts` (the new helper).

- [ ] **Unit 4: Admin Billing plan-picker modal**
  - Modify: `apps/admin/src/routes/_authed/_tenant/billing.tsx`
  - Replace the free-tier "See plans" button with a Dialog that renders the three cards; each card calls authed POST `/api/stripe/checkout-session` with `Authorization: Bearer <token>` + `{ plan }` → `window.location.assign(data.url)`.

- [ ] **Unit 5: Mobile Billing plan-picker bottom sheet**
  - Modify: `apps/mobile/app/settings/billing.tsx`
  - Modify: `apps/mobile/lib/stripe-checkout.ts` — accept optional `bearerToken` arg and forward as `Authorization` header.
  - Replace "See plans" (which routes to `/onboarding/payment`) with a `@gorhom/bottom-sheet` modal rendering three plan cards. Tap → call `startStripeCheckout(planId, { bearerToken })` → `openBrowserAsync(stripeUrl)` → Stripe Checkout in Safari sheet.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Upgrade webhook fires before the Lambda's cold-start cache has the current deploy's secret | `stripe-credentials.ts` already reads on cold start + caches; the env-var update forces container recycle on each deploy. Same pattern as today. |
| `client_reference_id` collision between signup UUIDs and `tenant:` prefix | Prefix is unambiguous — signup uses raw UUIDs (no `tenant:`). Branch dispatch is literal string prefix. |
| Deactivated tenant's signed-in user keeps operating without constraint | Acceptable for this PR; sign-in gate lands next. No new charges possible (subscription is canceled in Stripe). |
| Accidental cancel wipes data | Soft-delete + 30-day grace (grace enforcement lands with the sweeper PR). Operator can clear `deactivated_at` manually to restore. |
| Two plan-picker UIs (web/mobile) drift in copy | Both render from `@thinkwork/pricing-config` — plan strings are identical. Only the container (Dialog vs BottomSheet) differs. |

## Sources & References

- Prior PRs: #459 (admin Billing screen + webhooks), #461 (owner gate + mobile Billing), #458 (mobile Stripe + shared plan catalog), #445 (original backend).
- Load-bearing patterns: `packages/api/src/handlers/stripe-webhook.ts`, `packages/api/src/lib/stripe-provision-tenant.ts`, `packages/api/src/lib/stripe-update-subscription.ts`.
