---
date: 2026-05-27
topic: admin-space-email-trigger-management
status: draft
scope: standard
area: apps/admin
---

# Admin Space Email Trigger Management

## Problem Frame

The Admin Space Detail Triggers tab currently treats a Space email trigger as a mostly synthetic row: when enabled, it shows the derived address `<space-slug>@<tenant-slug>.thinkwork.ai`, and clicking the row only opens a Disable confirmation dialog. This is not enough for real Space operations. If a Space was originally named Customer Onboarding and later renamed Customer, the email address remains tied to the original slug, which makes the displayed operational address stale.

Admins need one place to manage the Space email trigger: change the address, pause/disable inbound cold-contact email, and delete the email trigger row. Changing the address must not strand existing Space workspace files in S3 under the old Space source prefix.

---

## Actors

- A1. Tenant admin: configures Space triggers in the admin app.
- A2. Registered tenant sender: sends cold-contact email to a Space address.
- A3. Workspace renderer/runtime: reads Space source files from S3 when composing Space context.
- A4. SES inbound handler: receives email and routes it to the matching active Space.

---

## Key Flows

- F1. Change Space email address
  - **Trigger:** A tenant admin edits the email trigger address prefix from the Space Triggers tab.
  - **Actors:** A1, A3, A4
  - **Steps:** Admin opens the email trigger detail/action dialog, edits the address prefix, sees the resulting full address, saves, and ThinkWork updates the Space slug-backed address only after validating uniqueness and migrating Space source files.
  - **Outcome:** The new address routes inbound email to the same Space, and existing workspace/source files remain available.
  - **Covered by:** R1, R2, R3, R4, R5

- F2. Disable or re-enable Space email trigger
  - **Trigger:** A tenant admin pauses or resumes email ingestion.
  - **Actors:** A1, A2, A4
  - **Steps:** Admin disables the trigger; the row remains visible with Disabled status; cold-contact email to the address is rejected/ignored by the inbound handler; admin can later enable the same trigger again.
  - **Outcome:** The address remains reserved and visible, but cold-contact email no longer creates or reopens Space threads while disabled.
  - **Covered by:** R6, R7, R8

- F3. Delete Space email trigger
  - **Trigger:** A tenant admin deletes the email trigger.
  - **Actors:** A1, A2, A4
  - **Steps:** Admin confirms a destructive delete; ThinkWork removes the email trigger configuration from the Triggers table; cold-contact email is no longer accepted for that Space address; the Space itself and its workspace/source files are untouched.
  - **Outcome:** The email trigger disappears without deleting the Space or losing workspace files.
  - **Covered by:** R9, R10

---

## Requirements

**Email address editing**

- R1. Admins can edit the Space email address prefix from the email trigger row/detail surface in `apps/admin -> Spaces -> Space Detail -> Triggers`.
- R2. The UI shows the full resulting address as `<edited-space-slug>@<tenant-slug>.thinkwork.ai` before save.
- R3. The edited address prefix must be normalized and validated with the same slug-style constraints used for Space slugs.
- R4. The edited address prefix must be unique within the tenant before save.
- R5. Saving an edited prefix must preserve the Space workspace/source files by moving or otherwise preserving objects currently addressed by the old Space source prefix. Verified current prefix shape: `tenants/<tenant-slug>/spaces/<space-slug>/source/`.

**SES and inbound routing**

- R6. The SES inbound behavior remains domain-level and lookup-based: inbound cold-contact email resolves a Space by tenant slug and Space slug, then checks email trigger state before creating work.
- R7. Disable/pause stops accepting cold-contact email for that Space address without affecting token-bearing replies to agent-initiated emails.
- R8. A disabled trigger remains visible in the Triggers table with a Disabled status and an enable/resume action.

**Delete behavior**

- R9. Delete removes the Space email trigger from the Triggers table and prevents cold-contact email from routing through that trigger.
- R10. Delete does not delete the Space, does not delete or move Space workspace/source files, and does not change existing threads.

**Admin UX**

- R11. Clicking the Email trigger row opens a management dialog or detail view that supports address edit, copy address, disable/enable, and delete.
- R12. Destructive actions use distinct confirmation copy: Disable is reversible and preserves the row; Delete removes the trigger row/configuration.
- R13. The Triggers Add dropdown can create/recreate an Email trigger when no email trigger row exists.

---

## Acceptance Examples

- AE1. **Covers R1-R5.** Given a Space has email address `customer-onboarding@acme.thinkwork.ai` and source files under `tenants/acme/spaces/customer-onboarding/source/`, when an admin changes the prefix to `customer`, then the email row shows `customer@acme.thinkwork.ai`, inbound lookup resolves the same Space, and the Workspace tab still lists the existing Space files.
- AE2. **Covers R6-R8.** Given a Space email trigger is disabled, when a registered tenant sender emails that address as a cold-contact message, then the inbound handler does not create a thread; when an admin re-enables it, later valid cold-contact email can route again.
- AE3. **Covers R9-R13.** Given an email trigger row exists, when an admin deletes it, then the row disappears from the Triggers table, the Add -> Email option becomes available again, and the Space workspace files remain intact.

---

## Success Criteria

- Admins can correct stale Space email addresses after a Space rename without manually touching AWS resources.
- Disabling and deleting are visibly different operations: disabled triggers can be resumed; deleted triggers are removed from the table.
- Existing Space workspace/source content survives an address-prefix change.
- A downstream planner can implement without inventing delete semantics, disable semantics, or the S3 preservation rule.

---

## Scope Boundaries

- No multiple email aliases per Space in this version.
- No custom domains or per-tenant inbound domains.
- No SES receipt rule changes are required for each Space address if the existing domain-level handler can continue resolving by tenant and Space slug.
- No deletion of Space workspace/source files as part of email trigger delete.
- No change to token-bearing reply handling for agent-initiated email.
- No user-facing mobile or end-user Spaces UI changes in this slice.

---

## Key Decisions

- **Use one canonical Space email address.** The address prefix is the Space slug-backed address, not a separate alias list.
- **Changing the address changes the Space slug-backed routing key.** This keeps inbound lookup simple, but requires explicit preservation of S3 Space source files.
- **Disable and delete are separate states.** Disable pauses inbound cold-contact while preserving the row; delete removes the trigger row/configuration.
- **SES stays centralized.** The app should not require per-address SES resource provisioning for every Space email address.

---

## Dependencies / Assumptions

- Current email address derivation is `${space.slug}@${tenant.slug}.thinkwork.ai` in `apps/admin/src/components/spaces/SpaceDetailChrome.tsx`.
- Current inbound cold-contact lookup joins `tenants.slug` and `spaces.slug` in `packages/api/src/handlers/email-inbound.ts`.
- Current Space source files are addressed through `spaceSourcePrefix(tenantSlug, spaceSlug)` in `packages/api/src/lib/spaces/template-migration.ts`.
- The current GraphQL model exposes only `emailTriggersEnabled`, so planning should determine the smallest model change that can represent absent, disabled, and enabled trigger states.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R5][Technical] Should prefix preservation be implemented as an object copy/delete migration, a compatibility alias/redirect, or a stable ID-based storage prefix for Spaces?
- [Affects R8-R10][Technical] What is the smallest persisted shape for email trigger state: an enum on `spaces`, a `trigger_config` entry, or a dedicated Space email trigger record?
- [Affects R13][Technical] When a deleted email trigger is recreated, should it reuse the current Space slug automatically or prompt the admin for a prefix?

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
