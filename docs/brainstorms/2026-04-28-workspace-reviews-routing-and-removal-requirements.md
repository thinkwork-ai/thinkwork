---
date: 2026-04-28
topic: workspace-reviews-routing-and-removal
---

# Workspace Reviews: Persona-Driven Routing and Page Removal

## Problem Frame

The admin app currently exposes a top-level **Workspace Reviews** page (`apps/admin/src/routes/_authed/_tenant/workspace-reviews/index.tsx`) that lists every `awaiting_review` workspace run for the current tenant, regardless of which agent produced it or which human is responsible for resolving it. The page is in the **Work** sidebar group, alongside Threads (102) and Inbox (18), framed as an operator's to-do list.

That framing fights the rest of the platform's design. ThinkWork's stated stance — "user opt-in over admin config; admin owns infra only" — already pushes user-personal surfaces to mobile. Workspace HITL is user-personal: every user-source agent is paired to exactly one human (`agents.human_pair_id`), the parent-agent chain (`agents.parent_agent_id`) terminates at a paired human, and the mobile app already documents Threads as the user's HITL surface. A tenant-wide admin queue duplicates that surface for the same human, makes review-resolution centrally visible to operators who shouldn't be acting on someone else's reviews, and at enterprise scale (4 enterprises × 100+ agents) becomes a useless wall of unrelated reviews.

The exception is system agents (`agents.source = 'system'` — eval test agents and other platform-managed runtimes). These have no `human_pair_id` by design. Their HITL pauses are the only legitimate operator concern, and they're operational/infra, not user work — so they belong in **Manage**, not **Work**.

The decisive shift is **HITL routes by responsibility, not by tenancy**. Paired-human reviews surface only on that human's mobile threads. System-agent reviews surface as a pending-HITL badge on the existing **Automations** entry in admin → Manage. The standalone `/workspace-reviews` page comes out of the Work group entirely.

This is a routing-and-removal slice, not a feature add. The data model already supports it; the resolvers and UI do not.

---

## Visual: Before vs after

**Before — admin sidebar (Work group):**
```
Work
├── Dashboard
├── Threads (102)
├── Inbox (18)
└── Workspace Reviews        ← lists every awaiting-review run, tenant-wide
```

**After:**
```
Work
├── Dashboard
├── Threads (102)            ← admin stays HITL-blind for paired humans
└── Inbox (18)
                              (Workspace Reviews removed)

Manage
├── Analytics
├── Automations (3)          ← badge = pending HITL count for system agents only
├── Webhooks
├── People
└── Billing
```

**Routing model:**
```
agentWorkspaceRuns.status = 'awaiting_review'
│
├─ Run's agent (or any ancestor via parent_agent_id) has human_pair_id
│   └─ Surface in that human's MOBILE Threads
│       (admin Threads does not surface; admin operators are not the audience)
│
└─ Run's agent chain terminates at agents.source = 'system' (no human pair)
    └─ Badge + queue tab on admin → Manage → Automations
```

---

## Actors

- **Paired human** — the user identified by walking `parent_agent_id` up to an agent with `human_pair_id` set. Resolves their HITL on mobile only.
- **Tenant operator (admin role)** — handles HITL only for system agents. Not expected to resolve another human's reviews.
- **System agent** (`source='system'`) — eval test agents and other platform-managed runtimes. Have no human pair by design.
- **Sub-agent** — agent with `parent_agent_id` set. Its HITL routes to the parent chain's human, not to its own thread participants.

---

## Key Flows

### Flow A — Paired-human run (incl. sub-agent chain)

1. Agent (or sub-agent) writes a review file under `review/<run-id>.<slug>.md`.
2. Workspace event dispatcher records `review.requested`; run flips to `awaiting_review`.
3. Resolver walks `parent_agent_id` from the run's `agent_id` until it finds an agent with `human_pair_id` set (or hits a system agent — see Flow B).
4. The matching human's mobile Threads list shows the pending review with the existing "Needs answer" treatment.
5. Human approves / continues / rejects in-thread on mobile.
6. Resolution writes `review.responded` and (for accept/continue) enqueues a `workspace_event` wakeup. Existing contract.

### Flow B — System-agent run

1. Same as A.1–A.2.
2. Resolver walks the parent chain. If it terminates at a `source='system'` agent without ever finding a `human_pair_id`, the review is classified system.
3. Admin → Manage → **Automations** sidebar entry shows a numeric badge equal to the count of pending system-agent reviews in the tenant.
4. Clicking the entry opens a system-HITL queue on the Automations page (tab or section, not a separate route).
5. Tenant operator approves / continues / rejects. Same `review.responded` contract; same wakeup behavior.

### Flow C — Cutover from current page

1. New surfaces (mobile chain-walk routing + Automations badge) ship and are verified against the live `awaiting_review` set in dev.
2. After parity confirmation, `/workspace-reviews` route, sidebar entry, and supporting components are deleted in a follow-up PR.
3. Any review created during the gap is picked up automatically by the new surfaces — no data migration needed; the routing is read-side only.

---

## Requirements

- **R1.** Workspace reviews owned by a paired human (directly or via parent-agent chain) MUST surface only on that human's mobile Threads. They MUST NOT appear in admin.
- **R2.** Workspace reviews whose agent chain terminates at a `source='system'` agent MUST surface only in admin → Manage → Automations. They MUST NOT appear in any user's mobile.
- **R3.** The Automations sidebar entry MUST show a numeric badge equal to the count of pending system-agent reviews in the current tenant.
- **R4.** Clicking Automations MUST open a system-HITL queue (tab or section) inside the existing Automations page. A new top-level route is out of scope.
- **R5.** The `/workspace-reviews` route, its sidebar entry, and its page component MUST be removed once the new surfaces achieve parity in dev.
- **R6.** The classification (paired vs system) MUST be deterministic from the database alone — no S3 reads required to decide where a review surfaces.
- **R7.** A user MUST NOT be able to see or act on another user's pending review through any admin or mobile surface. Tenant operators MUST NOT be able to act on paired-human reviews from the Automations queue.
- **R8.** All existing review-resolution mutations (`acceptAgentWorkspaceReview`, `cancelAgentWorkspaceReview`, `resumeAgentWorkspaceRun`) MUST continue to work unchanged. Routing changes which surface invokes them, not the contract.
- **R9.** Documentation MUST be updated to describe the routing model and remove references to a standalone admin Workspace Reviews page (`docs/src/content/docs/concepts/agents/workspace-orchestration.mdx` and the missing `applications/admin/automations` doc).

---

## Acceptance Examples

- **A1.** Eric is paired (via `human_pair_id`) to agent `marco`. Marco writes a review file. Eric's mobile Threads shows "Needs answer" on the relevant thread. Admin (logged in as the same tenant) shows no badge anywhere; the Automations badge is unchanged.
- **A2.** A `marco-research` sub-agent (whose `parent_agent_id` is `marco`) writes a review file. Eric's mobile Threads shows "Needs answer" — even though Eric is not in the sub-agent's thread participants — because the parent chain resolves to him.
- **A3.** The eval test agent (a `source='system'` agent) writes a review file. Admin → Automations sidebar entry shows `(1)`. Clicking opens the system-HITL queue with that one row. No mobile user sees it.
- **A4.** A tenant operator opens admin and sees the Automations badge. They approve a system-agent review. Eric's mobile is unaffected.
- **A5.** After cutover, navigating to `/workspace-reviews` returns a 404 (or redirects to Automations). The sidebar entry no longer appears.

---

## Success Criteria

- Admin → Work group contains no entry that lists paired-human reviews.
- Admin → Manage → Automations entry shows a badge whose count matches `count(*) from agent_workspace_runs where status='awaiting_review' and agent chain terminates at source='system'` for the current tenant.
- Mobile Threads correctly surfaces sub-agent reviews to the parent chain's paired human.
- Zero pending reviews in dev are unrouted (i.e., every `awaiting_review` run lands in exactly one of the two surfaces).
- The current `/workspace-reviews` page is deleted (route, component, sidebar entry).

---

## Scope Boundaries

**In scope:**
- Resolver-side classification (paired vs system) using `parent_agent_id` chain + `human_pair_id` + `agents.source`.
- Mobile Threads surfacing for sub-agent reviews via the parent chain.
- Automations badge + system-HITL queue tab.
- Removal of the standalone Workspace Reviews page.
- Documentation updates (workspace-orchestration concept doc, new Automations admin doc, removal of any references to the standalone page).

**Out of scope:**
- A separate top-level "Operations" sidebar group.
- Cross-tenant or platform-admin views of reviews.
- Push/email notifications on review arrival (likely a follow-up; not blocking).
- Renaming or re-grouping Automations / Webhooks / Scheduled Jobs in admin IA.
- Changing the underlying review file format, event types, or mutation contracts.
- Backfilling older runs that pre-date `parent_agent_id` or `human_pair_id` population.

**Deferred for later:**
- Allowing tenant admins to act on paired-human reviews as a "cover for absent user" override. If needed, ship as an explicit escalation flow with audit, not as a default surface.
- A power-user "all reviews in tenant" view for audits. Reachable via direct GraphQL query for now.

**Outside this product's identity:**
- A general workflow/HITL console. ThinkWork's HITL surface is the human's thread, not a queue console.

---

## Key Decisions

- **Persona** — The operator for a workspace review is the conversation participant (paired human) for paired-human runs, and the tenant admin operator only for system-agent runs.
- **Routing key** — Parent-agent chain walked to the first `human_pair_id`; if the chain terminates at `source='system'` without finding one, the review is system.
- **Surface placement** — Paired-human → mobile Threads. System → admin Manage → Automations.
- **Page disposition** — Standalone `/workspace-reviews` is removed, not demoted.
- **Admin Threads stays HITL-blind** — Paired humans use mobile; admin Threads is not a fallback surface.
- **No new sidebar group** — Reuses existing Work / Manage groupings; no "Operations" or "HITL" group is introduced.
- **No data migration** — Routing is read-side; existing pending reviews are picked up automatically by the new surfaces.

---

## Dependencies / Assumptions

- **Assumption:** Every user-source agent has `human_pair_id` populated. Verified indirectly by `packages/api/src/graphql/resolvers/core/require-user-scope.ts:80` which already errors when this is null. If any orphaned user-source agents exist in production, they need a fix-up before this lands.
- **Assumption:** The `parent_agent_id` chain on user-source sub-agents always terminates at a paired human (not at a system agent). If a user-source agent ever roots at a system agent, that's an existing data hazard the routing logic must surface, not silently misclassify.
- **Assumption:** The mobile app's existing Threads HITL implementation can be extended to cover sub-agent reviews via parent-chain walk without rewriting its query plan.
- **Dependency:** No active product flows require an admin operator to see another user's pending review. If they do, the "Deferred for later" escalation flow becomes blocking.
- **Dependency:** The Automations page has space (visually and architecturally) to host a system-HITL queue tab.

---

## Outstanding Questions

These are planning-territory; documented here so /ce-plan picks them up.

- **Read-time chain walk vs denormalized column.** Should `agent_workspace_runs` gain a `responsible_user_id` populated at write-time (when the run starts or when it transitions to `awaiting_review`), or should resolvers walk the chain on every read? Read-time keeps the schema clean; write-time is faster at scale and avoids a recursive CTE on hot paths.
- **Cutover ordering.** New surfaces ship first → verify parity in dev → delete the page. What's the verification check (manual dev sweep, or a one-shot script that classifies every current `awaiting_review` run)?
- **Notification on arrival.** Push notification when a paired human's mobile gains a new pending review? Likely yes; not blocking this slice.
- **Sub-agent review copy.** What label appears in the parent's mobile thread when a sub-agent's review surfaces? Suggested: "Sub-agent {slug} needs your input on {target}." Resolved during planning.
- **Documentation slot for Automations.** Today there's no `docs/src/content/docs/applications/admin/automations.mdx`. The "Routines" entry in the Astro sidebar config (`docs/astro.config.mjs`) is also stale. Both need fixing as part of the doc work.
- **Data hazard surfacing.** If a review's agent chain unexpectedly has neither a `human_pair_id` nor a `source='system'` terminator, where does it land? Suggested: log + alert + fall back to admin Automations marked "unrouted," not silently drop.

---

## Next Steps

- Run `/ce-plan` to convert these requirements into an implementation plan covering: chain-walk resolver helper, mobile sub-agent surfacing, Automations badge + queue tab, page removal, and doc updates.
- Address the outstanding chain-walk strategy question (read-time vs denormalized) in plan §1.
- Confirm with one dev-data sweep that no current `awaiting_review` run would be unrouted under the new model before approving the plan.
