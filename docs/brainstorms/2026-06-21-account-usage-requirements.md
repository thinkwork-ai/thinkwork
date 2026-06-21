---
date: 2026-06-21
topic: account-usage
linear_issue: THNK-60
---

# Account Usage

## Problem Frame

ThinkWork users and operators can see tenant-wide cost analytics today, but an individual profile does not explain that person's own platform usage. THNK-60 asks for a profile-top usage calendar, similar in spirit to GitHub contribution calendars or Claude usage views, plus a breakdown by model.

The v1 goal is personal and per-user transparency: when someone opens their own profile, or an operator opens a user's profile from Settings, the first visible section should answer "how active has this account been recently, how much did that cost, and which models drove it?" without forcing the user into the tenant-wide Analytics page.

---

## Actors

- A1. User: opens their own profile to understand recent ThinkWork usage and model mix.
- A2. Operator/Admin: opens a user's Settings profile to review that person's usage in context with role, budget, and model approvals.

---

## Key Flows

- F1. Self profile usage review
  - **Trigger:** A user opens Profile from the authenticated shell.
  - **Actors:** A1
  - **Steps:** The profile page loads the user's identity, shows an account usage section before editable profile fields, renders a recent daily activity calendar, and shows summary/model breakdown for the same period.
  - **Outcome:** The user understands their own recent activity, spend, token volume, and model mix without needing admin analytics access.
  - **Covered by:** R1, R2, R3, R4, R5, R8.

- F2. Operator reviews a user's profile
  - **Trigger:** An operator opens Settings -> Users -> User detail.
  - **Actors:** A2
  - **Steps:** The user detail page shows the same user-scoped usage section near the top, alongside existing budget and model approval context.
  - **Outcome:** The operator can connect usage patterns to budget status and model access for that user.
  - **Covered by:** R1, R2, R3, R4, R6, R7, R8.

---

## Requirements

**Profile placement**

- R1. The profile usage section appears at the top of the user's own Profile page, before editable profile details.
- R2. The same user-scoped usage section appears near the top of Settings -> Users -> User detail, before lower-priority profile/workspace details.
- R3. Empty or loading states should fit the profile page, not send the user to the tenant Analytics page.

**Calendar**

- R4. The calendar shows recent daily usage for the viewed user, with day-level intensity and hover/focus detail.
- R5. Calendar detail includes at least day, total spend, input tokens, output tokens, and event count for that day.
- R6. The visual should read as account activity, not as a commit or availability calendar; color intensity must represent ThinkWork usage volume for that user.

**Breakdown and summary**

- R7. The section shows a model breakdown for the viewed user over the same period as the calendar.
- R8. Model rows include model display name when known, model identifier fallback when unknown, total spend, input tokens, output tokens, and share of the viewed user's period usage.
- R9. The section includes compact period totals so the calendar and model breakdown have immediate context.

**Permissions and scoping**

- R10. A normal user can see only their own account usage.
- R11. Operators/admins viewing Settings -> Users can see usage for users in their tenant.
- R12. Usage data remains tenant-scoped; no profile surface may expose another tenant's cost events, users, models, or unattributed/system usage unless explicitly represented as out of scope.

---

## Acceptance Examples

- AE1. **Covers R1, R4, R5.** Given a user with usage on three days in the last month, when they open their Profile page, then the account usage section appears above profile fields and those days render with visible intensity and day-level totals.
- AE2. **Covers R2, R7, R8.** Given an admin opens a member's Settings user detail page, when the usage section loads, then the model breakdown reflects that member's usage only, not the whole tenant's model mix.
- AE3. **Covers R3.** Given a user has no recorded usage in the selected period, when their profile loads, then the section shows an empty state with zero totals rather than an error or a hidden panel.
- AE4. **Covers R10, R11, R12.** Given a normal member attempts to inspect another user's profile usage, then the UI and backing query do not return another user's usage; an authorized operator in the same tenant can view it.

---

## Success Criteria

- A user can understand their own recent ThinkWork usage pattern and model mix from the profile without visiting tenant-wide Analytics.
- An operator can review a user's usage alongside role, budget, and model approvals in one profile context.
- A downstream planner can reuse existing cost-event concepts while knowing which product behavior belongs on profile pages versus the Analytics page.

---

## Scope Boundaries

- v1 is a user-scoped profile section, not a replacement for tenant-wide Settings -> Analytics.
- v1 does not need export, billing invoices, or chargeback reports.
- v1 does not need cross-user comparison or ranking.
- v1 does not need per-thread drilldown from calendar days.
- v1 does not need configurable metrics beyond the period and user implied by the profile context.
- Unattributed/system usage is out of scope for the profile view unless it can be confidently associated with the viewed user.

---

## Key Decisions

- Use the profile as the front door. THNK-60 explicitly calls out the user's Profile page and Settings -> User -> Profile, so usage belongs in those contexts before expanding Analytics.
- Keep account usage user-scoped. Tenant-wide cost analytics already exist elsewhere; this feature should answer personal usage, not tenant spend governance.
- Treat cost, token volume, and event count as complementary signals. Cost is the clearest billing-like metric, tokens explain model consumption, and event count helps make low-cost activity visible.
- Use model display names when available. The existing model catalog can make breakdown rows legible while preserving raw model identifiers as fallback.

---

## Dependencies / Assumptions

- Existing cost data is recorded in `cost_events` with `tenant_id`, `user_id`, `created_at`, `amount_usd`, `model`, `input_tokens`, and `output_tokens`.
- Existing Analytics queries are tenant-scoped today; planning should determine whether to extend them with optional user filters or add profile-specific usage queries.
- The current profile surfaces are `apps/web/src/components/profile/SelfProfilePage.tsx` and `apps/web/src/components/settings/SettingsUserDetail.tsx`.
- Settings -> Analytics already renders tenant-level cost trend, cost by user, and cost by model from the cost GraphQL surface; this feature should reuse visual and formatting patterns where they fit.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R4, R5][Technical] Choose the period and bucket shape for the calendar, likely 30, 90, or 365 days based on available data volume and profile layout.
- [Affects R4, R6][Technical] Decide whether calendar intensity is driven by total spend, event count, token volume, or a normalized composite, and make the tooltip explicit.
- [Affects R7, R8][Technical] Decide whether model breakdown should include only LLM events or all events that carry model metadata.
- [Affects R10, R11, R12][Technical] Verify resolver authorization rules for self versus operator user-scoped usage queries.

---

## Next Steps

-> /ce-plan for structured implementation planning
