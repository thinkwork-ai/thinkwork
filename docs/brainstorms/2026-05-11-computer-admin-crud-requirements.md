---
date: 2026-05-11
topic: computer-admin-crud
---

# Computer Admin CRUD

## Summary

Give tenant admins a complete CRUD surface for Computers in `apps/admin`: manual create from two entry points (the Computers list and the Person detail page), auto-provision on tenant-member-add using a platform-default template, an expanded edit surface (rename, change template, set budget) on the detail page, and an archive action as the destructive operation. Read already works and stays as-is.

---

## Problem Frame

Today, the Computers backend is fully built (table, GraphQL mutations, tenant-admin authz, one-active-computer-per-user invariant), and admin can read the list and detail pages — but there is no UI to create a Computer. The list's empty state explicitly directs admins to either run an Agent-to-Computer migration or "provision users," but neither path is exposed in admin. Users who pre-date the Computer feature, or whose Computer was archived, are stranded: a tenant admin who navigates to that person's profile and wants to create a Computer for them has no affordance to do so. The single concrete trigger for this brainstorm is a tenant admin trying to provision a Computer for Joey Terrazas and finding no button anywhere in admin.

The edit surface is similarly thin. The only inline edit today is start/stop runtime; rename, template change, budget, and archive all require touching the database directly. As the platform scales toward enterprise onboarding (4 enterprises × 100+ agents), these admin-driven operations become routine and can no longer live outside the UI.

---

## Actors

- A1. **Tenant admin** — initiates manual Computer creation, edits Computer attributes, and archives Computers. Subject to the existing tenant-admin authz gate.
- A2. **Tenant member (subject)** — the user whose Computer is being created, edited, or archived. Does not act in admin; their Computer is provisioned for them.
- A3. **Auto-provision hook** — server-side mechanism that creates a Computer when a new tenant member is added. Runs without admin intervention.

---

## Key Flows

- F1. **Manual create from the Computers list**
  - **Trigger:** Admin clicks "New Computer" on `/computers`.
  - **Actors:** A1.
  - **Steps:** Open create dialog → select owner from tenant members without an active Computer → name field (required) → template picker (platform default preselected) → optional monthly budget → confirm.
  - **Outcome:** New Computer exists with status ACTIVE; admin lands on its detail page.
  - **Covered by:** R1, R7, R8, R9, R10.

- F2. **Manual create from a Person detail page (Joey's case)**
  - **Trigger:** Admin opens `/people/$humanId` for a user without an active Computer and clicks the "Provision Computer" CTA.
  - **Actors:** A1, A2 (subject).
  - **Steps:** CTA opens the same create dialog with the owner field preselected and read-only → admin confirms name + template + optional budget → confirm.
  - **Outcome:** Same as F1; the CTA disappears from the Person page (the user now has an active Computer).
  - **Covered by:** R2, R7, R8, R9, R10.

- F3. **Auto-provision on tenant-member-add**
  - **Trigger:** A user is added to a tenant (existing addTenantMember path).
  - **Actors:** A3.
  - **Steps:** Tenant member row is created → hook resolves the platform default template → creates a Computer for the new member with status ACTIVE → if the hook fails, the membership succeeds and the failure is surfaced as a backfill candidate.
  - **Outcome:** New tenant members have a Computer by default; failures degrade gracefully to the manual path.
  - **Covered by:** R3, R4, R11, R14.

- F4. **Edit a Computer**
  - **Trigger:** Admin opens `/computers/$computerId` and edits a field in the Config tab.
  - **Actors:** A1.
  - **Steps:** Inline edit on name → save. Open template picker → preview consequence warning ("changes derived skills and MCP") → confirm. Edit monthly budget cents → save.
  - **Outcome:** Computer reflects new attribute values; runtime status is unaffected by attribute edits.
  - **Covered by:** R5, R6, R13.

- F5. **Archive a Computer**
  - **Trigger:** Admin clicks "Archive" on `/computers/$computerId`.
  - **Actors:** A1.
  - **Steps:** Confirmation dialog explaining the user loses their active workplace and the slot is freed → admin confirms → status flips to ARCHIVED.
  - **Outcome:** Computer is archived; the user is again eligible to receive a new Computer (manual create or re-provision).
  - **Covered by:** R12, R15, R16.

---

## Requirements

**Create — manual**
- R1. The Computers list (`/computers`) exposes a "New Computer" action that opens a create dialog. The dialog collects owner (tenant member picker), name, template (platform default preselected), and optional monthly budget. On success, admin is taken to the new Computer's detail page.
- R2. The Person detail page (`/people/$humanId`) exposes a "Provision Computer" CTA when, and only when, that user has no active Computer. The CTA opens the same create dialog as R1 with the owner preselected and not editable.

**Create — auto-provision**
- R3. When a new tenant member is added (existing membership path), the platform automatically creates a Computer for that member using a designated platform-default template. No admin configuration is required for auto-provision to work on day one.
- R4. If auto-provision fails for any reason, tenant-member-add itself must still succeed. The user becomes a member; the missing Computer is recoverable via the manual create path (R1 or R2).

**Update**
- R5. The Computer detail page Config tab supports inline rename. Slug stays server-managed and is not user-editable.
- R6. The Config tab supports changing the base template. Committing a template change requires a confirmation step that explicitly states the change re-derives the Computer's skills and MCP configuration.
- R13. The Config tab supports setting, changing, and clearing the monthly budget (in cents). Clearing the budget returns the Computer to "unbounded."

**Delete (archive)**
- R12. The Computer detail page exposes an "Archive" action that flips status to ARCHIVED via a destructive confirmation dialog. Hard delete is not offered.
- R15. Archived Computers are excluded from the default `/computers` list view. The list offers an optional filter to include archived Computers for audit purposes.
- R16. Archiving a Computer frees the one-active-per-user slot. The same user becomes eligible for a new active Computer through manual create or re-provision.

**Cross-cutting**
- R7. All Computer create / update / archive actions require the existing tenant-admin role. Non-admin tenant members see the surfaces in read-only form or not at all, consistent with current admin patterns.
- R8. The "one active Computer per user per tenant" invariant is honored end-to-end. The create dialog must not allow producing a duplicate active Computer; users with an active Computer do not appear in the owner picker for new-Computer creation.
- R9. Failures from the underlying mutation (validation, template missing, slot already occupied) surface as user-readable errors in the create dialog without losing the admin's in-progress input.
- R10. The create dialog preselects the platform-default template but allows changing it. The owner field is preselected only when entered via the Person detail page (R2).
- R11. The "auto-provision succeeded" and "auto-provision failed" events are visible to the admin somewhere observable (existing computer events surface is the natural home), so an admin can audit which members were auto-provisioned and which need backfill.
- R14. Auto-provision does not re-create a Computer for a user who already has an active one, even on edge cases like re-invite or status flip. The slot invariant is the source of truth.

---

## Acceptance Examples

- AE1. **Covers R2, R8.** Given Joey Terrazas is a tenant member with no active Computer, when the admin opens `/people/<joey-id>`, the page shows a "Provision Computer" CTA. When the admin clicks it, the create dialog opens with Joey preselected as the owner; the admin completes the dialog and is redirected to Joey's new Computer detail page.
- AE2. **Covers R2, R8.** Given Joey already has an active Computer, when the admin opens `/people/<joey-id>`, no "Provision Computer" CTA appears.
- AE3. **Covers R3, R4.** Given a brand-new tenant with no admin-configured default Computer template, when an admin adds a new member, the platform-default template is used to auto-create that member's Computer. The admin did not have to configure anything for this to happen.
- AE4. **Covers R4, R11.** Given auto-provision fails after a new tenant member is added (e.g., transient template fetch error), the member exists in the tenant, no Computer is created, and the failure is observable so the admin can backfill via R1 or R2.
- AE5. **Covers R6.** Given a Computer with template "Default", when the admin opens the template picker on the Config tab and selects a different template, a confirmation step appears stating the change re-derives skills and MCP. The change commits only after the admin confirms.
- AE6. **Covers R8.** Given the admin opens the "New Computer" dialog on `/computers`, the owner picker lists tenant members who do not have an active Computer; members who already have one do not appear.
- AE7. **Covers R12, R15, R16.** Given an active Computer, when the admin clicks "Archive" and confirms the destructive dialog, status becomes ARCHIVED, the Computer disappears from the default list view (visible under the "include archived" filter), and the owning user becomes eligible for a new active Computer.

---

## Success Criteria

- A tenant admin can create a Computer for any tenant member without touching the database, the CLI, or any non-admin surface. The Joey case is resolvable end-to-end in admin.
- New tenant members get a Computer automatically on day one of a fresh tenant install, without requiring admin to pre-configure a default template.
- Archived Computers free the active-computer slot cleanly, so re-provisioning a user after archive is a normal admin path, not an incident.
- `ce-plan` can pick this up without inventing product behavior: the entry points, fields, gating, invariants, and failure modes are all named here.

---

## Scope Boundaries

- Owner reassignment (moving a Computer between users) — deferred to a separate brainstorm because of workspace and memory provenance implications.
- Hard delete of Computers — not offered; archive is the only destructive operation.
- Bulk operations (bulk create, bulk archive) — not in scope; admin acts on one Computer at a time.
- Admin Settings surface to override the platform-default Computer template at the tenant level — deferred; the platform default is sufficient for v1.
- CLI commands for Computer CRUD — admin-only feature in this brainstorm; CLI parity is a later question.
- Mobile UX changes — out of scope; mobile is the end-user surface, not the admin one.
- Changes to existing Dashboard, Workspace, Runtime, Live Tasks, or Events panels on the detail page — Config tab grows; the others stay as-is.
- Auto-un-archive on re-invite — archive remains terminal for that Computer; re-provisioning produces a new row.

---

## Key Decisions

- Manual create exists on both the Computers list and the Person detail page. Rationale: the two natural admin entry points ("I want to make a Computer" vs "this person needs a Computer") are equally common; the Joey case is the second one, and forcing a context switch is the wrong default.
- Auto-provision is zero-config with a built-in platform-default template. Rationale: day-one installs must work without admin setup; deferring auto-provision until admin picks a default template would have made this brainstorm's Joey case the *normal* state rather than the exception.
- Archive is the destructive operation; hard delete is excluded. Rationale: the schema's `status` enum already commits to ARCHIVED as a soft-delete primitive, and archived Computers are useful audit history.
- The one-active-Computer-per-user invariant is preserved end-to-end. Rationale: it is enforced at the database level (partial unique index) and at the resolver level; the UI must reflect it rather than fight it.
- Owner reassignment is deferred. Rationale: it is rare, dangerous (workspace + memory provenance), and out of proportion with this brainstorm's primary value, which is unblocking creation.

---

## Dependencies / Assumptions

- The existing `createComputer` and `updateComputer` GraphQL mutations remain the canonical write paths; this brainstorm does not introduce new mutations. Archive uses `updateComputer` with `status: ARCHIVED`.
- A "platform-default Computer template" identity exists or will be designated. Today, `agent_templates` distinguishes `kind = 'system'` vs `'user'` but has no explicit "default Computer template" flag — ce-plan must decide whether to designate one by slug convention, add a column, or carry a tenant-level pointer with a built-in fallback.
- Tenant-admin authz (`requireTenantAdmin`) is the gate for all CUD operations and is already implemented.
- The `addTenantMember` mutation is the trigger point for auto-provision. The hook adds work to that path; the existing membership-create behavior must remain correct on failure.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R3, R11][Technical] How is the "platform-default Computer template" identified — by slug convention, by an `is_default` column on `agent_templates`, or by a configuration constant? The product decision (zero-config day-one auto-provision works) is fixed; the mechanism is a planning call.
- [Affects R4, R11][Technical] What is the exact failure-surfacing path for auto-provision errors — a `computer_events` row against a stub Computer, a tenant-level admin notification, or a "needs backfill" list view? The product decision (failure must not block membership; admin must be able to see and recover) is fixed; the surface is a planning call.
- [Affects R6][Technical / Needs research] Does changing the base template require re-running existing skill/MCP derivation pipelines, or is the consequence purely advisory in the UI? Re-derivation logic exists for AGENTS.md changes; the planner should confirm whether template change triggers the same path.
- [Affects R1, R2][Technical] Where does the create dialog live structurally — a shared modal component reused by both entry points, a route, or a sheet? Pure UI plumbing — leave to ce-plan.
- [Affects R15][Technical] How are archived Computers represented in the list — filter toggle, separate tab, or a "Show archived" switch on the existing FilterBarSort? Product behavior (default hidden, available on request) is fixed; the control is a planning call.
