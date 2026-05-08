---
date: 2026-05-08
topic: computer-thinkwork-ai-end-user-app
related:
  - docs/brainstorms/2026-05-06-thinkwork-computer-product-reframe-requirements.md
  - docs/brainstorms/2026-05-07-thinkwork-computer-on-strands-requirements.md
---

# computer.thinkwork.ai — End-User Web App

## Summary

A new end-user web app at `computer.thinkwork.ai` that becomes the desktop daily-driver for the human user of a ThinkWork Computer — sibling to mobile, distinct from admin. Phase 0 extracts shared visual primitives from admin into a new shared UI package; admin migrates to consume it. Phase 1 ships a rough cut: signed-in chrome with a "New Thread → Blank Chat" CTA, permanent nav links to placeholder Computer / Automations / Inbox pages, and a per-Computer threads list in the sidebar. Thread chat UI and real page content are Phase 2.

---

## Problem Frame

The 2026-05-06 product reframe established ThinkWork Computer as the durable per-user product object: always-on, owns workspace, threads, tasks, approvals, delegation. The 2026-05-07 Strands brainstorm grounded the runtime; upcoming work brings real personal-work orchestration online.

What's missing is an end-user surface on the web. Today the only web shell is `apps/admin`, which is shaped for the tenant operator: People, Billing, Compliance, Security Center, Templates, Memory, Skills, Evaluations, Analytics, Knowledge, Webhooks, alongside operator views of Computers and Threads. Mobile (`apps/mobile`) is the on-the-go end-user surface. Operators don't want the operator UI as their daily driver, and end users without admin scope have no desktop-class home for their Computer's work at all.

---

## Actors

- A1. End user (Eric in v1): the human owner of a ThinkWork Computer. Signs in with Google. Uses computer.thinkwork.ai as their desktop work surface. Already has access to admin and mobile.
- A2. Tenant operator: provisioner / governor of the tenant. Uses admin. Does not gain new capabilities from this work; operator-only surfaces stay in admin.
- A3. Cognito identity (existing `ThinkworkAdmin` app client + user pool): authenticates the same humans that admin authenticates today.
- A4. ThinkWork Computer (per A1): the durable per-user product object whose threads — and future page content — this app surfaces.

---

## Key Flows

- F1. Sign in to computer.thinkwork.ai
  - **Trigger:** A1 navigates to `https://computer.thinkwork.ai`.
  - **Actors:** A1, A3
  - **Steps:** App detects unauthenticated state → redirects to Cognito hosted UI / Google OAuth → callback returns to a registered callback URL on `computer.thinkwork.ai` against the existing `ThinkworkAdmin` Cognito client → app hydrates session and lands the user on their Computer page.
  - **Outcome:** The user is signed in on `computer.thinkwork.ai`. Because the same Cognito client backs both admin and computer, signing in here also satisfies admin (and vice versa, subject to refresh-token mechanics).
  - **Covered by:** R3, R4, R12

- F2. Create a new thread from the sidebar CTA
  - **Trigger:** A1 clicks "New Thread → Blank Chat" at the top of the sidebar.
  - **Actors:** A1, A4
  - **Steps:** Click opens the same create-thread dialog admin uses → user confirms → existing thread-create mutation runs → new thread is attached to A1's Computer → sidebar Threads section refreshes and shows the new thread → user is routed to the new thread's placeholder page.
  - **Outcome:** A real thread exists, scoped to A1's Computer. The chat UI is not yet rendered (Phase 2); the placeholder page tells the user the chat surface is coming.
  - **Covered by:** R5, R6, R7, R10

- F3. View threads on my Computer in the sidebar
  - **Trigger:** A1 has signed in and a sidebar render fires.
  - **Actors:** A1, A4
  - **Steps:** Sidebar fetches threads scoped to A1's Computer → renders newest first, capped at a sensible limit → an overflow affordance points at a future "all threads" view.
  - **Outcome:** A1 sees a focused list of their Computer's recent threads. Tenant-wide threads not on A1's Computer are absent.
  - **Covered by:** R7, R8

- F4. Land on a placeholder Computer / Automations / Inbox page
  - **Trigger:** A1 clicks a permanent nav link.
  - **Actors:** A1
  - **Steps:** Route renders a placeholder explaining the surface is coming; chrome (sidebar, top bar, theme, sign-out) works exactly as on populated pages.
  - **Outcome:** Navigation feels real even though the inner pages are empty; Phase 2 fills them in without re-shaping the shell.
  - **Covered by:** R9

---

## Requirements

**App + domain**
- R1. A new app workspace `apps/computer` exists in the monorepo, sharing tooling conventions with `apps/admin` (Vite, TanStack Router, urql, Cognito).
- R2. The app is reachable in dev at `https://computer.thinkwork.ai` once Phase 1 completes; production rollout is a separate user-driven step outside this work.
- R3. DNS + TLS wiring follows the existing admin pattern: Cloudflare CNAME (DNS-only, not proxied) → CloudFront, with an ACM certificate in `us-east-1`.
- R4. Authentication reuses the existing Cognito user pool *and* the existing `ThinkworkAdmin` app client. The new origin and callback path are added to that client's CallbackURLs and LogoutURLs. No new client is created.

**Sidebar shape**
- R5. The sidebar's first item is a "New Thread → Blank Chat" CTA at the top, above the permanent nav links.
- R6. The CTA, when clicked, creates a real thread using the same mutation admin already uses for thread creation, attaches it to the caller's Computer, and routes the user to that new thread.
- R7. Below the CTA, the sidebar renders three permanent nav items in this order: Computer, Automations, Inbox.
- R8. Below the permanent nav, a "Threads" section lists threads scoped to the caller's Computer, newest first, capped at a sensible Phase 1 limit. Tenant-wide threads not on the caller's Computer must not appear.

**Phase 1 page bar**
- R9. Computer, Automations, and Inbox routes render placeholder pages in Phase 1 (chrome works; inner content is a "coming soon" surface). Real content for each is explicitly Phase 2.
- R10. The thread-detail route renders a placeholder in Phase 1; the chat UI is Phase 2.
- R11. Sign-out, dark-mode toggle, and command-palette affordances behave as they do in admin.

**Auth and identity**
- R12. The same human user signed into admin can navigate to `computer.thinkwork.ai` and reach an authenticated surface; signing in once on either domain satisfies the other (subject to refresh-token mechanics).
- R13. End-user-only data scoping: every authenticated query on `computer.thinkwork.ai` is bounded to the caller's identity / Computer; operator-scoped data does not surface.

**Shared UI extraction (Phase 0)**
- R14. A new shared UI package is created that contains the visual primitives genuinely shared across admin and the new app: shadcn primitives, theme / design tokens, the Tailwind preset, the sidebar shell, and the create-thread dialog primitive.
- R15. `apps/admin` is migrated to consume the new package as part of Phase 0; admin's behavior is otherwise unchanged.
- R16. `apps/computer` consumes the new package from day one; it does not duplicate primitives or copy from `apps/admin`.
- R17. Routing, GraphQL/urql client wiring, Cognito hooks, and admin-specific domain components stay in their respective apps; the package contains no app-specific composition.

**Out of computer.thinkwork.ai's surface**
- R18. Operator-only surfaces — People, Billing, Compliance, Security Center, Templates, Memory governance, Skills, Evaluations, Analytics, Knowledge, Webhooks — are not navigable on `computer.thinkwork.ai`. They remain in admin.
- R19. The "Computer" nav link goes to a single page representing the caller's own Computer, not a list of computers — per the "one Computer per user in v1" invariant from the 2026-05-06 reframe.

---

## Acceptance Examples

- AE1. **Covers R3, R4, R12.** Given an existing user already signed into admin, when they navigate to `https://computer.thinkwork.ai`, they reach an authenticated surface without a second OAuth ceremony (refresh-token mechanics permitting), and the cert chain shows an ACM certificate fronted by CloudFront.
- AE2. **Covers R5, R6, R8.** Given the user is signed in and has zero threads on their Computer, when they click "New Thread → Blank Chat", a real thread is created and immediately appears at the top of the sidebar's Threads section; the user lands on that thread's placeholder page.
- AE3. **Covers R7, R8, R13.** Given a tenant with multiple users and multiple Computers, when end-user A signs into `computer.thinkwork.ai`, the sidebar's Threads section shows only threads on A's Computer; threads on other Computers are absent.
- AE4. **Covers R9, R10.** Given the user clicks Computer / Automations / Inbox / a thread row, the corresponding route renders a placeholder Phase 1 page; chrome (sidebar, top bar, theme, sign-out) renders identically to a populated page.
- AE5. **Covers R14, R15, R16.** Given Phase 0 ships, `apps/admin` and `apps/computer` both import shadcn primitives, theme tokens, the Tailwind preset, the sidebar shell, and the create-thread dialog primitive from the shared package; neither app contains a duplicate copy.
- AE6. **Covers R18, R19.** Given the user is signed in to `computer.thinkwork.ai`, when they inspect the sidebar, they see only the New Thread CTA, Computer (single page), Automations, Inbox, and the Threads section; no operator surfaces are present.

---

## Success Criteria

- A1 can sign in at `computer.thinkwork.ai` in dev and see a focused desktop end-user shell that visibly belongs to the same product family as admin and mobile.
- The sidebar feels real on day one: a New Thread CTA that creates a real thread, and a Threads list that reflects the caller's Computer.
- The package extraction lands cleanly: admin still works, computer consumes from day one, and the boundary between shared visual primitives and app-specific composition is obvious to a future contributor.
- Phase 2 (real Computer / Automations / Inbox / chat UI) can pick up the work without re-shaping the chrome, the auth, or the package boundary.
- Planning can sequence the work without re-deciding audience, domain, auth strategy, or Phase 1 functional bar.

---

## Scope Boundaries

- The thread chat UI itself (rendering messages, sending, streaming, attachments) is Phase 2.
- Real Computer / Automations / Inbox pages are Phase 2.
- A multi-Computer list view is excluded; one Computer per user is the invariant.
- Operator-only surfaces are not added to `computer.thinkwork.ai`; they stay in admin.
- Mobile app changes are out of scope.
- Admin functional changes other than consuming the shared UI package are out of scope.
- Production rollout in Phase 1 is excluded; dev is the launch target.
- Marketing site (`www.thinkwork.ai`) changes are out of scope.
- Renaming the `ThinkworkAdmin` Cognito client to a more neutral name now that two surfaces share it is excluded — naming churn is its own follow-up.
- A redesign of admin's IA. Admin keeps its existing nav and surfaces; computer is additive.

---

## Key Decisions

- **End-user surface as a separate app, not a route inside admin.** Audience is materially different from admin (user vs operator) and matches the existing mobile/admin split. Embedding it inside admin would force per-route role-gating and reauthorize the operator IA into the end-user world.
- **Reuse the existing `ThinkworkAdmin` Cognito app client.** Same users invited into the tenant; signing in once gives access to both surfaces; refresh tokens work transparently. A new client would gate the same humans behind a duplicate identity surface for no product gain. The naming is misleading after this change but renaming is deferred.
- **Shared UI package extracted up front, not after.** Two consumers force a real boundary; copy-paste-then-extract was rejected because the second consumer is shipping right after the first. The cost is admin migration, paid once.
- **Phase 1 bar = auth + real threads in sidebar + placeholder pages.** Pure-chrome was rejected because deploying empty chrome doesn't prove the user-scoped data flow; chat-UI-included was rejected because extracting thread-detail isn't worth the Phase 1 weight. The middle bar proves the auth + GraphQL pipe end-to-end.
- **Dev-first rollout.** Production promotion is gated on Phase 2 surfaces being real enough to point users at; Phase 1 in dev is the iteration substrate.

---

## Dependencies / Assumptions

- The existing admin Cognito + Cloudflare + CloudFront pattern in `terraform/modules/thinkwork` and `terraform/modules/app/static-site` extends to a second site instance with a parallel set of `computer_*` variables. Verified by the matching `admin_*` variables and three existing static-site instances in `terraform/modules/thinkwork/main.tf`.
- The same Google OAuth federation that backs admin sign-in is the right credential mechanism for end users on `computer.thinkwork.ai`. No password-based sign-in path is in scope.
- A Computer exists for the caller when they visit `computer.thinkwork.ai`. Bootstrapping the caller's Computer if absent is handled by the broader Computer reframe work, not this brainstorm.
- The threads-list query that admin uses (`threadsPaged`) is tenant-wide and does not natively scope to the caller's Computer; either a new GraphQL field or a new filter on the existing field is required. The exact shape is a planning concern.
- `apps/admin` does not currently expose its visual primitives as a package; extracting them is structural work but does not require GraphQL schema changes.

---

## Outstanding Questions

### Resolve Before Planning

(none — synthesis was confirmed)

### Deferred to Planning

- **[Affects R8][Technical]** Define the exact GraphQL shape for "threads on my Computer" — new `me.computer.threads(...)` field, new filter on `threadsPaged`, or another shape — including pagination and ordering semantics.
- **[Affects R6][Technical]** Confirm reuse of admin's create-thread mutation and any computer-scoping inputs (does the mutation accept a `computerId`, or is it inferred from the caller's identity?).
- **[Affects R3][Technical]** Identify the existing greenfield Cloudflare DNS resource pattern and parameterize a `computer.thinkwork.ai` record alongside it.
- **[Affects R4][Technical]** Define the precise set of CallbackURLs and LogoutURLs to add to the `ThinkworkAdmin` client (incl. dev, worktree ports if relevant, and prod placeholders) without disturbing existing values.
- **[Affects R14, R15, R16, R17][Technical]** Identify which `apps/admin/src/components/ui/*` files belong in the new package, how the Tailwind preset / theme tokens are structured for cross-app consumption, and which sidebar-shell pieces are reusable vs admin-shaped.
- **[Affects R15][Technical]** Sequence the admin migration: can it be a single PR, or does it need to be staged behind a backwards-compatible re-export path while admin's many imports update?
- **[Affects R12][Needs research]** Verify cross-domain refresh-token behavior with Cognito + Google federation on the existing `ThinkworkAdmin` client; if a single sign-in does not carry across `admin.thinkwork.ai` and `computer.thinkwork.ai` cleanly, decide whether the second OAuth roundtrip is acceptable for Phase 1.

---

## Next Steps

→ `/ce-plan` for structured implementation planning, sequencing Phase 0 (extract shared UI package + admin migration) before Phase 1 (apps/computer scaffold, auth, sidebar with real threads, deploy + Cloudflare wiring).
