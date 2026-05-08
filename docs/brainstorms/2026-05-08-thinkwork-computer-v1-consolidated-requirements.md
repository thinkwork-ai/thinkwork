---
title: ThinkWork Computer v1 — apps/computer-centric consolidated requirements
type: feat
status: active
date: 2026-05-08
tier: deep-product
supersedes:
  - docs/plans/2026-05-08-012-feat-apps-computer-scaffold-plan.md
consolidates:
  - docs/plans/2026-05-07-010-feat-thinkwork-computer-on-strands-plan.md
  - docs/plans/2026-05-08-001-feat-computer-thinkwork-ai-end-user-app-plan.md
  - docs/plans/2026-05-08-009-feat-computer-generated-dashboard-artifacts-plan.md
  - docs/plans/2026-05-08-010-feat-computer-app-artifact-ui-plan.md
---

# ThinkWork Computer v1 — apps/computer-centric consolidated requirements

## Summary

ThinkWork Computer is the most important feature in the platform. v1 ships **apps/computer** as the central end-user surface — a Perplexity-style workbench where a tenant-provisioned end user can ask the Computer to research, analyze, and produce inspectable interactive outputs. The first concrete proof is a **LastMile CRM pipeline-risk dashboard**: Computer pulls live CRM opportunities, joins with email/calendar engagement signals and bounded web research, produces a constrained dashboard manifest, and renders it in a split-view shell that keeps provenance visible alongside the app canvas.

This requirements doc consolidates four prior plans and resolves four open product questions so a single focused implementation plan can follow. Five testable milestones let the team demo on dev at every step, with the first milestone shippable against fixture data before any runtime substrate work lands.

---

## Problem Frame

Four overlapping plans accumulated in parallel sessions and now compete for attention:

- **Plan 010-runtime** (`docs/plans/2026-05-07-010-feat-thinkwork-computer-on-strands-plan.md`) defines a Python Strands ECS container that replaces the TS task-dispatcher. Substrate-heavy, not customer-visible. 0 of 16 units shipped; work parked in `~/.codex/worktrees/9a04/thinkwork`.
- **Plan 001** (`docs/plans/2026-05-08-001-feat-computer-thinkwork-ai-end-user-app-plan.md`) creates `apps/computer` itself plus auth, Terraform, and CI deploy. ~80% shipped (#959, #961, #962, #966, #968, #970, #971, #974, #975).
- **Plan 012** (`docs/plans/2026-05-08-012-feat-apps-computer-scaffold-plan.md`) is a strict subset of plan 001's slice C; fully shipped via #962 and now redundant. **Retire.**
- **Plan 009** (`docs/plans/2026-05-08-009-feat-computer-generated-dashboard-artifacts-plan.md`) defines the LastMile CRM dashboard manifest contract, secure GraphQL API, deterministic refresh executor. Imported via #978; 0 of 9 units shipped.
- **Plan 010-ui** (`docs/plans/2026-05-08-010-feat-computer-app-artifact-ui-plan.md`) is the apps/computer UI companion to plan 009 — workbench, gallery, split-view, CRM dashboard components. Imported via #980; 0 of 8 units shipped.

The plans are largely complementary, not conflicting, but no single document sequences them under a unified product narrative with testable milestones. End users currently see a half-shipped frontend backed by no Computer, and engineering effort is dispersed across runtime substrate and UI ahead of any concrete demo target.

This brainstorm establishes that narrative: **what does v1 of ThinkWork Computer look like to a real end user**, and which slices of the four remaining active plans must compose to deliver each testable milestone.

---

## Actors

- **A1 End user (Computer owner):** an enterprise team member working inside `apps/computer`. Operator pre-provisioned them in admin. They sign in via Google, see the workbench, ask Computer to do work, approve sensitive actions, and read generated dashboards.
- **A2 Operator (admin):** the customer's ThinkWork administrator. Lives in the admin SPA. Adds end users to the tenant, manages templates, monitors Computer activity, controls connector approvals.
- **A3 ThinkWork Computer:** the long-running per-user agent on the ECS+EFS reconciler. Runs the Strands agent loop in `packages/computer-strands/` (after plan 010-runtime lands). Produces durable thread messages, generated artifacts, and emits coarse-grained events plus token-stream chunks.
- **A4 Delegated worker:** the AgentCore coding-worker container (out of v1 scope). Plan 010-runtime U13–U14. Mentioned only as a non-goal here.
- **A5 LastMile CRM MCP:** the read-only tenant-approved MCP source for opportunities, activities, products, quantities. Per plan 009.
- **A6 Email/calendar + bounded web research:** plan 009 read-only context sources for engagement signals and account research.
- **A7 Mobile (apps/mobile):** secondary surface for Computer ownership. Receives push notifications for HITL approvals; deep-links into apps/computer for the actual approval interaction.

---

## Resolved Decisions (from this brainstorm)

These bind the consolidated plan and replace any conflicting language in the four source plans.

### D1. Approvals UX — web-primary, mobile push deep-links to apps/computer

apps/computer is the **canonical** approval surface. Computer-raised HITL events (`computer_approval` rows) render in a queue inside apps/computer with full payload preview and edit-and-approve support per plan 010 U6's "minimum viable UX bar." Mobile receives a push notification with a deep link that opens the same approval screen in apps/computer (mobile browser or installed PWA). The mobile inbox stops rendering `computer_approval` items in v1.

Implication for plan 010-runtime U6: the approval bridge writes to `inbox` rows as before, but the consumer is apps/computer, not apps/mobile. Mobile-side inbox rendering for `computer_approval` is **deferred for later**.

### D2. Streaming wire — two-layer AppSync pattern

**Layer 1 (ephemeral token streaming, no DB write per chunk):** Computer ECS task receives Bedrock `contentBlockDelta` events (~25–50 tokens each) via `converse_stream`. For each delta, ECS calls a NONE-datasource AppSync mutation `publishComputerThreadChunk(threadId, chunk)` over HTTPS+IAM. Mutation does no DB write; it just fires the subscription. Browser subscribes to `onComputerThreadChunk(threadId)` via the AppSync bridge already in `terraform/schema.graphql` and appends chunks to a transient buffer for the canonical AI streaming UX.

**Layer 2 (durable persistence at turn boundaries):** On Bedrock `messageStop`, ECS calls the existing GraphQL mutation `appendThreadMessage(...)` writing one row to `messages`. This row powers history reload, Hindsight ingestion, cost attribution, audit logging, and the existing `onThreadTurnUpdated` subscription. Optional intermediate snapshots at tool-call boundaries (mid-turn) for crash-resume.

**Implication for dashboard refresh (plan 009):** the dashboard refresh path stays plan 009's "short-poll task state" — no streaming needed for deterministic refresh.

### D3. Onboarding — operator pre-provisions in admin; first sign-in claims

Operator opens admin → "Add User" with email + role → pending-user row created bound to operator's tenant. End user signs in via Google on apps/computer → `bootstrapUser` hits the existing claim path (`packages/api/src/graphql/resolvers/core/bootstrapUser.mutation.ts:66`) and binds the Cognito identity to the pre-provisioned tenant. apps/computer's auto-create-new-tenant path stays suppressed per plan 013 R8.

Implication: developers use admin to create their own tenant, then sign into apps/computer as a member of that tenant. No self-serve sign-up for end users in v1.

### D4. Memory contract — Read + forget panel, cross-thread

apps/computer has a `Memory` panel (sidebar nav item or settings route) that lists what Hindsight has retained about the user — entities, topics, decisions distilled by the existing `runHindsightBankMerge` path. User can read every entry and click "forget this" on any item. No edit. No fixed expiration; user-driven deletion is the only TTL in v1.

Memory is **user-scoped, cross-thread** per the 2026-04-24 memory scope refactor (`docs/plans/2026-04-24-001-...`). One memory surface per user aggregates across all their Computer threads. Hindsight bank-merge already supports this shape.

---

## Requirements

### Carried from origin plans (load-bearing only — full requirements live in source plans)

- From plan 001: secure Google OAuth via existing `ThinkworkAdmin` Cognito client; apps/computer site Terraform, ACM SAN, Cognito callbacks, CI deploy job; thread-list scoped to caller's Computer; multi-user fixture test that prevents cross-user thread leakage.
- From plan 009: dashboard manifest is **constrained**, not arbitrary React; refresh re-runs saved recipes without LLM; v1 mutation posture is **read-only across CRM, email/calendar, web**; LastMile CRM pipeline-risk dashboard is the v1 demo target.
- From plan 010-runtime: Strands ECS container replaces TS task-dispatcher; per-Computer ECS+EFS reconciler unchanged; iteration-budget goal loop; Aurora-backed `SessionManager` for crash-resume; deterministic 5-scenario deploy smoke gate.
- From plan 010-ui: Perplexity-inspired layout grammar (workbench, gallery, split-view) using ThinkWork branding; CRM dashboard rendered by ThinkWork-owned components (Recharts-based); transcript stays visible alongside app canvas.

### v1-specific

- **R1.** A pre-provisioned end user can sign into `apps/computer`, see a Perplexity-style workbench, click a starter card, and reach an opened generated dashboard end-to-end on dev.
- **R2.** Dashboards (and other generated artifacts) appear in an Apps gallery and open in a split-view artifact shell with provenance/transcript on the left and the app canvas on the right.
- **R3.** When the Computer is thinking, apps/computer renders the canonical AI streaming UX (token-by-token deltas) sourced from the AppSync subscription channel defined in D2. Per-message persistence flows through the existing `appendThreadMessage` path.
- **R4.** Computer-raised HITL approvals render in apps/computer with full payload preview and approve/deny/edit-and-approve controls per plan 010 U6's minimum viable bar. Mobile push opens the same screen in apps/computer.
- **R5.** End users see what the Computer remembers about them (entities/topics/decisions) and can forget any item. Memory is cross-thread.
- **R6.** Onboarding: operator pre-provisions an end user in admin; first sign-in on apps/computer claims the pending tenant.
- **R7.** Refresh on a generated dashboard reuses the saved recipe deterministically (no LLM in the refresh path) and clearly distinguishes refresh from "Ask Computer" reinterpretation.
- **R8.** All five testable milestones below are demonstrable on the dev stage by a real human.

---

## Flows

### F1. End-to-end LastMile CRM pipeline-risk dashboard happy path (the demo)

```
A2 Operator (admin)
  └─→ Add User: alex@acme.com to tenant acme

A1 End user (alex@acme.com)
  ├─→ Sign in via Google to https://computer.thinkwork.ai
  │     └─→ bootstrapUser claim path binds Cognito identity to acme tenant
  ├─→ Lands on apps/computer workbench
  │     └─→ Sees starter card "CRM pipeline risk on LastMile opps"
  ├─→ Clicks starter card → composer pre-fills, submits → createThread + Computer task
  │
A3 Computer (Strands ECS task)
  ├─→ AppSync chunks stream to apps/computer (Layer 1) — A1 sees thinking
  ├─→ Reads CRM via A5 LastMile CRM MCP (read-only, approved tools only)
  ├─→ Raises HITL approval to read Gmail/Calendar engagement metadata
  │     └─→ apps/computer renders approval, mobile push notifies A1
  │
A1 End user
  ├─→ Approves email/calendar metadata read in apps/computer queue
  │
A3 Computer
  ├─→ Reads engagement signals; conducts bounded web research per account
  ├─→ Produces dashboard manifest (validated v1 schema, recipe + snapshot)
  ├─→ Writes manifest to S3; creates DATA_VIEW artifact row with metadata.kind="research_dashboard"
  ├─→ appendThreadMessage(role=assistant, content=summary, ...)
  └─→ Computer turn complete; thread surfaces durable artifact card
  │
A1 End user
  ├─→ Clicks artifact card → routes to apps/computer/apps/<id> (split view)
  ├─→ Sees transcript + sources on left, CRM dashboard on right
  ├─→ Filters by stage/product, opens evidence drawer per opportunity
  └─→ Clicks Refresh → deterministic recipe re-run, no LLM call, manifest snapshot updates
```

Memory (D4) records distilled facts: "Alex cares about LastMile CRM stale-Q3 opportunities." Future threads recall context.

### F2. Cross-tenant denial

Another tenant's user (Bob @ Globex) signs into apps/computer. Cannot see Acme threads, Acme dashboards, Acme memory. Verified by multi-user fixture test from plan 001 U13.

### F3. Refresh fails on partial source

Recipe re-runs; CRM succeeds; Gmail token expired. Manifest stores per-provider status; UI shows partial coverage warning; CRM charts remain visible; user clicks "Ask Computer" to recover the email path.

### F4. Memory forget

A1 opens Memory panel, sees "User prefers stale-deal sort by amount." Clicks forget. Next Computer thread does not recall that.

### F5. Onboarding edge — unprovisioned sign-in

A user not pre-provisioned signs in. apps/computer renders the existing plan 013 R8 "no tenant" surface with a "contact your operator" CTA. No tenant gets created.

---

## Acceptance Examples (scriptable on dev)

- **AE1.** Pre-provisioned user signs in, sees workbench, clicks CRM starter card → reaches an opened dashboard within ~2 minutes (M3 milestone).
- **AE2.** During the Computer turn, apps/computer renders streaming token output token-by-token via AppSync subscription; refreshing the page mid-stream loses live tokens but the assistant message persists from `appendThreadMessage` once the turn completes.
- **AE3.** Cross-tenant user gets 0 results; cross-user-same-tenant user cannot read another's dashboard manifest.
- **AE4.** HITL approval appears in apps/computer's approval queue with payload preview; mobile push fires; clicking the push opens apps/computer to the approval screen; approve flips Computer task back to running.
- **AE5.** Refresh on the dashboard re-runs the saved recipe; mock spy proves no LLM provider was invoked during refresh; manifest's `lastRefreshAt` updates.
- **AE6.** Memory panel lists ≥1 retained item after the demo run; clicking forget removes the item; a follow-up Computer thread does not recall it.
- **AE7.** Operator removes the user in admin; user can no longer sign into apps/computer.
- **AE8.** Deployed-URL smoke (`scripts/smoke-computer.sh dev`) returns 0 against `https://computer.thinkwork.ai`.

---

## Testable Milestones

Each milestone is a slice a real human can click through on the dev stage. Earlier milestones gate later ones; each can ship as one or more PRs without blocking the next milestone's parallel work where the dependency is satisfied.

### M1. apps/computer is a Perplexity-style workbench against fixtures + real manifest API

**What ships:**
- Plan 009 U1 (manifest contract + schema validator + S3 storage + access helpers).
- Plan 009 U2 (secure `dashboardArtifact` query + `refreshDashboardArtifact` mutation, gated by ownership).
- Plan 010-ui U1–U6 (workbench, task dashboard, task thread, apps gallery, split-view shell, CRM dashboard components).
- Plan 010-ui U8 (visual verification with fixture data).
- One hand-crafted fixture manifest committed to the repo as `apps/computer/src/test/fixtures/crm-pipeline-risk-dashboard.json`.
- Onboarding bootstrap (D3): admin "Add User" wired; apps/computer claim path enabled.

**Demo:** Operator (Eric) provisions himself in admin (real claim path). Signs into apps/computer, sees workbench, clicks "CRM pipeline risk" starter card → routes to a fixture-backed thread page → opens fixture dashboard in split view → fixture refresh button no-ops gracefully. **Zero runtime substrate work.** Tests the entire UX layer with deterministic data.

**Exit criteria:** AE1 modulo "real Computer" — replaced by fixture; AE2/AE3/AE5/AE7 pass against fixture path.

### M2. Strands runtime replaces TS dispatcher; Computer thinks; token streaming live

**What ships:**
- Plan 010-runtime U1 (`packages/computer-stdlib/` skeleton).
- Plan 010-runtime U2 (`computer_tasks.needs_approval` + task-type enum migration).
- Plan 010-runtime U3 (`packages/computer-strands/` Computer container scaffold + ECR build).
- Plan 010-runtime U4 (env-snapshot + 5-scenario smoke gate, partially inert).
- Plan 010-runtime U5 (runtime/session loader + goal loop with iteration budget).
- D2 wire: ECS publishes via `publishComputerThreadChunk` AppSync mutation; apps/computer subscribes to `onComputerThreadChunk(threadId)` and renders Layer 1 token chunks. Layer 2 `appendThreadMessage` writes on `messageStop`.
- apps/computer's task thread view renders the streaming buffer per plan 010-ui U3.

**Demo:** Eric clicks New Thread, types a goal that needs no tools (e.g., "summarize what you know about the LastMile CRM opportunity dataset"). Watches the Computer's thinking land token-by-token in apps/computer. Refreshing the page mid-stream and re-loading shows the persisted final message via `appendThreadMessage`.

**Exit criteria:** AE2 passes against real Computer.

### M3. Computer creates a real dashboard from CRM + Gmail/Calendar with HITL approval on web

**What ships:**
- Plan 009 U3 (Computer task contract `dashboard_artifact_refresh` + lifecycle events).
- Plan 009 U4 (read-only source adapters: CRM MCP, email/calendar, web research).
- Plan 009 U5 (pipeline-risk transforms, scoring, templated summaries).
- Plan 009 U6 (initial dashboard generation from a Computer thread; dual TS-runtime / stdlib paths per plan 009).
- Plan 010-runtime U6 (approvals + Aurora SessionManager). **Plan 010 U6 mobile inbox rendering deferred** per D1 — apps/computer renders the approval queue.
- Plan 010-runtime U7 (workspace/workpapers tools — needed for evidence storage during dashboard generation).
- Plan 010-runtime U9 (Google Workspace read tools — Gmail metadata + Calendar upcoming).
- apps/computer approval-queue UI: per plan 010 U6 minimum bar (legible question, Approve/Deny, edit-and-approve for the email-send case, push deep-link wiring).
- Plan 010-ui U7 (refresh + reinterpretation UX states wired to the real Computer task).

**Demo:** Eric asks for "pipeline risk on LastMile opps." Computer reads CRM, raises an approval to read Gmail metadata for engagement signals; Eric approves in apps/computer; Computer completes, dashboard appears. Refresh works against the real recipe. Mobile push fires on a separate device for the approval and deep-links to apps/computer.

**Exit criteria:** AE1 (real Computer), AE4, AE5 all pass.

### M4. Browser tool feeds dashboard evidence; memory panel lands

**What ships:**
- Plan 010-runtime U9b (admin-enabled AgentCore Browser + Nova Act tool with policy gates, screenshot/session artifacts, cost attribution).
- Plan 010-runtime U8 (Hindsight memory module — recall + reflect tool wrappers).
- apps/computer Memory panel UI (D4) — list, forget; backed by a thin GraphQL query/mutation against Hindsight bank-merge surfaces.
- Browser evidence integration: dashboard's `Evidence` section renders screenshot artifacts + URL/title fetched-at metadata when source kind is web research.

**Demo:** Eric asks for "deeper risk analysis including company news for the top 3 stale opportunities." Computer browses public sources for each account, captures screenshot evidence, attaches to the dashboard's evidence drawer. Memory panel shows what was retained from the previous M3 run; Eric forgets one item; next thread doesn't recall it.

**Exit criteria:** AE6 passes; browser evidence visible in dashboard; HITL approval gates browser-go-ahead per existing browser-automation plan policy.

### M5. Refresh, golden-workflow demo, dev-URL smoke

**What ships:**
- Plan 009 U7 (apps/computer dashboard artifact viewer — final polish on top of M1).
- Plan 009 U8 (refresh end-to-end + thread/timeline integration).
- Plan 009 U9 (documentation, fixtures, end-to-end smoke).
- Plan 010-runtime U16 (golden-workflow E2E + browser-backed acceptance gate).
- Plan 001 U14 (`scripts/smoke-computer.sh dev` + README).
- F5 unprovisioned-sign-in surface verified.

**Demo:** One scripted end-to-end demo runs reliably on dev: provision-user → sign-in → starter-card → Computer thread → dashboard generated → refresh → memory retained → cross-tenant denial confirmed. Smoke script gates regressions on every deploy.

**Exit criteria:** AE7, AE8, all earlier AEs pass; smoke gate live in `deploy.yml`.

---

## Single-agent vs multi-agent split recommendation

The five milestones partition cleanly along three surfaces with stable boundary contracts:

| Agent | Surface | Files | Milestone load |
|---|---|---|---|
| **A — Frontend / UI** | apps/computer, mobile push deep-link, memory panel UI, approval queue UI | `apps/computer/**`, `apps/mobile/src/inbox` (deep-link only) | Heavy in M1, M3, M4 |
| **B — API / Manifest** | dashboard-artifacts module, GraphQL schema/operations, AppSync subscription bridge, schema migrations | `packages/api/src/lib/dashboard-artifacts/**`, `packages/api/src/graphql/resolvers/artifacts/**`, `packages/database-pg/graphql/types/**`, `packages/database-pg/drizzle/00NN_*.sql` | Heavy in M1, M3, M5 |
| **C — Runtime / Container** | computer-stdlib, computer-strands ECS image, browser tool, Hindsight integration, deploy smoke | `packages/computer-stdlib/**`, `packages/computer-strands/**`, `packages/agentcore-strands/agent-container/browser_*` | Heavy in M2, M3, M4 |

Boundary contracts:
- **A↔B:** GraphQL schema (manifest types, dashboard query, refresh mutation, approval queue queries, memory queries, AppSync subscription on `onComputerThreadChunk`).
- **B↔C:** Computer task input/output JSON, manifest schema validation, AppSync mutation-publish endpoint contract.
- **A↔C:** none direct (always via B).

**Recommendation: split into three agents starting at M2.**

- **M1 is single-agent** (mostly UI-only with API skeleton). One developer ships the workbench + API contract end-to-end against fixtures. Assigning three agents to M1 invites contract churn before the contracts have settled.
- **M2 onward is parallelizable.** B lands the GraphQL schema + AppSync subscription contract early; A starts wiring the streaming UI against the contract; C builds the Strands container against the same contract. Boundary-conflict potential is low if contracts are frozen at the start of M2.
- **Contract-freeze gate:** end of M1 is a checkpoint. A/B/C agree on the M2-shape contract (subscription event names, payload shapes, mutation signatures) before parallel work starts.

If only one developer is available, the same milestones still apply sequentially. A single agent would work M1 → M2 → M3 → M4 → M5 with no boundary-coordination overhead.

---

## Scope Boundaries

### Deferred for later (in-scope for v1.5+, intentionally cut from v1)

- **Mobile inbox rendering of `computer_approval`** — push notifications and deep-link only in v1; mobile app gets the full approval UI later.
- **Apps/computer mutations of CRM, email, calendar.** v1 is read-only across all source systems per plan 009.
- **Computer delegation to AgentCore coding-worker.** Plan 010-runtime U13–U14 deferred. v1 in-process subagents only if needed (likely deferred entirely).
- **CE skills folder + `load_skill` shims.** Plan 010-runtime U13–U14. Coding-worker only; not on critical demo path.
- **Routines** (plan 010-runtime U11). No scheduled background work in v1.
- **Connector → Computer dispatch** as a new narrow endpoint (plan 010-runtime U15). Existing `dispatch_target_type='computer'` path already routes connectors; defer until friction is observed.
- **Voice / BidiAgent mode.**
- **Multi-Computer-per-user.** One Computer per user enforced by `uq_computers_active_owner` partial unique index.
- **Generic desktop UI / live remote-desktop takeover.** Browser tool ships with screenshot/session artifacts only.
- **Real-time refresh subscription** on dashboard manifests. Plan 009's short-poll is fine for v1; add subscription only if observed friction warrants it.
- **Self-serve sign-up** (D3). Operator-pre-provisioned only in v1.
- **Edit memory items** (D4). Read + forget only in v1.
- **AgentCoreMemorySessionManager.** Plan 010-runtime keeps Aurora-backed `SessionManager` for v1.
- **Drive / Docs / Sheets native API access.** Browser tool may operate the web UIs in v1 demos.
- **`packages/computer-runtime/` (TS task-dispatcher) deletion.** Two-deploy grace period; deletion in a later cleanup PR.
- **Memory expiration / TTL.** User-driven forget only.
- **Public sharing, anonymous app links, team galleries** (plan 010-ui deferred list).
- **Arbitrary generated React app hosting** (plan 009 + plan 010-ui both reject this).
- **In-view dashboard editing** (plan 009 deferred).
- **Rich version diffing between dashboard generations.**
- **Visual regression service (Percy/Chromatic).**
- **Mobile-native dashboard implementation in `apps/mobile`.**

### Outside this product's identity (the product we must NOT accidentally build)

- A generic BI platform.
- A replacement for LastMile CRM reporting.
- A public app-builder or website-generator.
- Hidden autonomous reinterpretation during routine refresh (refresh is deterministic, full stop).
- Workflow automation that mutates external systems on the user's behalf (read-only across CRM/email/calendar/web in v1).
- A generic app marketplace.
- A CRM replacement UI.
- A BI dashboard builder.
- A shared/public computer.thinkwork.ai (private per-user surface).

---

## Sources

- Plan 010-runtime: `docs/plans/2026-05-07-010-feat-thinkwork-computer-on-strands-plan.md`
- Plan 001: `docs/plans/2026-05-08-001-feat-computer-thinkwork-ai-end-user-app-plan.md`
- Plan 012 (retire): `docs/plans/2026-05-08-012-feat-apps-computer-scaffold-plan.md`
- Plan 009: `docs/plans/2026-05-08-009-feat-computer-generated-dashboard-artifacts-plan.md`
- Plan 010-ui: `docs/plans/2026-05-08-010-feat-computer-app-artifact-ui-plan.md`
- Plan 013 (auth + threads, already shipped): `docs/plans/2026-05-08-013-feat-computer-auth-and-threads-plan.md`
- Origin brainstorm for plans 009 + 010-ui: `docs/brainstorms/2026-05-08-computer-generated-research-dashboard-artifacts-requirements.md`
- AppSync subscription bridge in repo: `terraform/schema.graphql`
- Hindsight bank-merge: `packages/api/src/lib/memory/hindsight-bank-merge.ts`
- bootstrapUser claim path: `packages/api/src/graphql/resolvers/core/bootstrapUser.mutation.ts`
- Recently merged context (admin reframe arc): #963, #964, #965, #967, #969, #972, #973, #976
- apps/computer infra (already shipped): #966, #968, #970, #971, #974, #975
- Scaffold (already shipped, retire plan 012): #962
- @thinkwork/ui (already shipped): #959, #961

---

## Next step

Run `/ce-plan` against this requirements doc to produce a single consolidated implementation plan. The plan should:

- Mark plan 012 as `status: superseded` and update its frontmatter to point at the consolidated plan.
- Reference plans 009 + 010-runtime + 010-ui by U-ID rather than re-stating their units (their units carry forward intact; the consolidated plan only sequences them under M1–M5).
- Carry forward plan 001's remaining unshipped units (U4 admin migration → defer indefinitely; U12 CORS audit → roll into M5; U14 dev smoke → roll into M5).
- Encode the contract-freeze gate at end of M1 as an explicit checkpoint.
- Encode the multi-agent split (A/B/C) as optional execution guidance, not as a hard partition (single-agent execution must remain trivially valid).
- Include all four resolved decisions (D1–D4) verbatim in the Key Technical Decisions section so the plan does not re-litigate.
