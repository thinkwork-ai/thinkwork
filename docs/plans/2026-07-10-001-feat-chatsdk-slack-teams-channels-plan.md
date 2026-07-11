---
title: Chat SDK Slack & Teams Channels - Plan
type: feat
date: 2026-07-10
topic: chatsdk-slack-teams-channels
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Chat SDK Slack & Teams Channels - Plan

## Goal Capsule

- **Objective:** ThinkWork agents live in Slack and Microsoft Teams, with Vercel Chat SDK as the sole external channel adapter layer (webhook parsing, card rendering, message post/edit) and ThinkWork remaining the system of record. One master effort under Linear THINK-84, decomposed into nine sub-issues.
- **Product authority:** Linear THINK-84 (full-commitment decision 2026-07-10), the ideation record at docs/ideation/2026-07-10-think-84-chatsdk-slack-teams-ideation.html, and this brainstorm dialogue.
- **Open blockers:** Security sign-off on gated email auto-link (R9) blocks shipping that identity path, not planning. No other blockers; Chat SDK's unvalidated Lambda runtime behavior is burned down inside the first sub-effort (R4), not ahead of it.

---

## Product Contract

### Summary

Bring ThinkWork agents into Slack and Teams through Chat SDK as the one adapter layer for both platforms: an @mention creates a ThinkWork thread in the tenant's general Space, the agent answers with a placeholder that progressively edits to the final response, and agent questions settle safely in-channel as interactive cards. Slack ships first on a shared foundation; the Teams plan is rewritten around Chat SDK and its distribution paperwork starts immediately.

### Problem Frame

Enterprise users live in Slack and Teams, and ThinkWork currently has no working channel presence. The Slack v1 ingress handlers have been inert stubs since the Computer feature was removed (PR #1666) — events are accepted and dropped pending a Spaces-based redesign — while the OAuth install flow, tenant/workspace binding, secrets layout, and thread-mapping schema remain live. The approved Teams plan (docs/plans/2026-05-21-006-feat-microsoft-teams-bot-think-plan.md) is unimplementable as written: it enqueues through `enqueueComputerTask`, a helper deleted with the Computer feature, and hand-builds the JWT validation and Adaptive Card plumbing that Chat SDK now provides. Rebuilding both channels by hand means maintaining two parsing stacks, two card renderers, and two identity flows that drift apart; Chat SDK collapses that into one adapter surface — but it is a young dependency (public beta March 2026) whose AWS Lambda behavior is not yet validated, and the platforms impose hard constraints (Slack's 3-second ack with up to 4 redeliveries; Teams' single-tenant bot registration) that the architecture must absorb.

### Key Decisions

- **Full commitment to Chat SDK on both platforms — no legacy escape hatch.** The hand-rolled Slack parsing and Block Kit rendering are retired as Chat SDK equivalents land. Unfavorable findings are absorbed by architecture (the queue boundary), not by switching implementations.
- **ThinkWork stays the system of record.** Chat SDK never owns the agent loop, conversation history, or approval state. Channel messages are projections of ThinkWork threads.
- **Chat SDK is confined behind a thin ThinkWork-owned seam** (the ChannelPort boundary), lint-enforced, so core thread/identity/HITL code carries no Chat SDK dependency and ownership lines stay legible.
- **Chat SDK never runs on the webhook ack path.** The ack handler verifies, records, and enqueues; parsing and dispatch happen in a queue consumer with no platform deadline.
- **Slack-first build; Teams paperwork and plan rewrite start in parallel.** Slack reuses proven OAuth/tenant-binding assets; Teams distribution (Azure registration + per-customer app catalog) is the longest calendar item and starts at kickoff.
- **Placeholder → progressive edits, not token streaming.** Milestone-based message edits deliver responsiveness without a turn-event→text-stream translation layer and without riding platform edit rate limits.
- **Per-provider identity strength.** Teams identities are trusted from the verified Bot Framework JWT; Slack identities auto-link on verified email match gated to tenant-verified domains, audited, with a link-code fallback.
- **Portal-only routing at v1.** All channel-originated threads land in the tenant's general Space; plumbed channel→Space bindings and their operator surface are an in-effort fast-follow.

### Actors

- A1. Channel end user — a Slack workspace or Teams tenant member who mentions the agent or answers its cards.
- A2. Tenant operator — installs and monitors channel connections, holds the admin surfaces.
- A3. ThinkWork platform agent (Pi runtime) — executes the work and asks HITL questions.
- A4. Platform delivery (Slack/Teams) — webhooks with retries, rate limits, and per-platform card capabilities; a constraint-bearing actor, not just a pipe.

### Requirements

**Foundation and boundary**

- R1. All Slack and Teams webhook parsing, card/message rendering, and message post/edit operations go through Chat SDK adapters; each hand-rolled Slack equivalent is removed when its Chat SDK replacement lands.
- R2. Chat SDK imports are confined to the channel adapter boundary and enforced by lint; core thread, identity, and HITL code has no Chat SDK dependency.
- R3. Chat SDK conversation state reads and writes ThinkWork's own thread mapping through a custom state adapter; no second conversation store exists.
- R4. The three named risk areas — Lambda ack timing, per-tenant credential injection, and thread-state fit — are measured and documented in the foundation spike before the Slack channel build hardens.

**Ingress**

- R5. The webhook-facing handler acks within each platform's deadline doing only signature verification, retry short-circuit, and durable enqueue; parsing, identity resolution, and dispatch happen off the ack path.
- R6. Event processing is idempotent across platform redeliveries, backed by a durable ingress ledger that records every delivery with a resolution status operators can query.

**Identity and tenancy**

- R7. One channel-identity resolver maps platform users to ThinkWork users with per-provider policy: Teams users auto-resolve from the verified Bot Framework JWT via the existing federation bridge; Slack users auto-link on verified email match only for tenant-verified email domains, recorded with an audit marker.
- R8. Users who cannot be auto-resolved receive a link-code flow via DM on first contact; their triggering events are recorded in the ingress ledger, not silently dropped.
- R9. The Slack email auto-link path ships only after security sign-off on its account-takeover surface.

**Thread mapping**

- R10. An @mention on either platform creates or continues a ThinkWork thread in the tenant's general Space with platform provenance preserved; replies in the same platform thread continue the same ThinkWork thread.
- R11. Channel copies are projections: losing or deleting a channel message never loses ThinkWork state, and the finalized ThinkWork message can always regenerate the channel rendering.

**Rendering and streaming**

- R12. The agent posts a placeholder promptly after a mention, edits it at major turn milestones, and the finalized response is guaranteed to be the last edit.
- R13. Cards (HITL questions, status, completion summaries) are authored once against the typed message-parts model and compile to Slack Block Kit and Teams Adaptive Cards.
- R14. A golden-card suite renders the canonical card set for both platforms in CI, catching fidelity regressions on Chat SDK version changes.

**Human-in-the-loop**

- R15. Every channel card action carries a single-use token; settlement is idempotent — duplicate taps and platform redeliveries never double-fire, and race losers see who answered and when.
- R16. Consequential approvals (risk tier covering spend, publishing, and external communication) require step-up to an authenticated ThinkWork session via deep link; a channel tap alone never authorizes them.
- R17. Canonical HITL state remains the pending-question record and its end-turn sentinel; channel cards are triggers and projections only.

**Teams**

- R18. The 2026-05-21 Teams plan is rewritten around Chat SDK's Teams adapter (its enqueue mechanism no longer exists in the codebase), reusing the existing HMAC install-state signer rather than introducing a second one.
- R19. Teams distribution work — single-tenant Azure Bot registration and per-customer tenant app catalog submission — starts at effort kickoff.

**Operator and observability**

- R20. Operators can see per-workspace channel health: ingress ledger outcomes, delivery failures, ack latency, and installation status.
- R21. (Fast-follow) Plumbed channel→Space bindings with an operator surface for creating and verifying bindings; portal-to-general remains the zero-config default.

### Key Flows

- F1. Mention → response (both platforms)
  - **Trigger:** A1 @mentions the agent in a channel.
  - **Steps:** Webhook verified, recorded, enqueued (ack within deadline); consumer parses via Chat SDK, resolves identity (F3 if unlinked), creates/continues the thread in the general Space, dispatches the agent; placeholder posts promptly; message edits at milestones; finalized response is the last edit.
  - **Covers:** R1, R2, R5, R6, R10, R12.
- F2. HITL question → settle
  - **Trigger:** A3 asks a question mid-task on a channel-originated thread.
  - **Steps:** Question renders as a card (compiled per platform); A1 taps an option; low-tier answers settle idempotently in-channel and the card updates; consequential approvals deep-link to an authenticated ThinkWork session; duplicate taps see "answered by X".
  - **Covers:** R13, R15, R16, R17.
- F3. Unlinked Slack user first contact
  - **Trigger:** A Slack user with no ThinkWork link mentions the agent.
  - **Steps:** Resolver checks verified email match against tenant users (tenant-verified domains only); on match, auto-links with audit marker and proceeds with F1; on no-match, DMs a link code and records the event in the ledger.
  - **Covers:** R7, R8, R9.
- F4. Operator installs a channel
  - **Trigger:** A2 installs the Slack app (existing OAuth flow) or uploads the tenant Teams app package.
  - **Steps:** Install binds workspace/tenant using the existing signed install-state; operator sees installation status and channel health (R20); mentions start flowing with portal routing.
  - **Covers:** R19, R20.

### Acceptance Examples

- AE1. **Covers R6.** Given Slack redelivers the same event 3 times with retry headers, when all four deliveries arrive, then exactly one agent turn runs and the ledger shows one `ok` and three `dedupe` resolutions.
- AE2. **Covers R15.** Given two users tap "Approve" on the same card within a second, when both actions arrive, then exactly one settles; the second user sees the card updated with who answered and when; no second dispatch fires.
- AE3. **Covers R7, R9.** Given an unlinked Slack user whose verified profile email matches a ThinkWork user on a tenant-verified domain, when they first mention the agent, then a link is auto-created with an audit marker and the mention proceeds without an onboarding step.
- AE4. **Covers R16.** Given an agent asks approval to send an external email, when a user taps "Approve" in Slack, then the action does not settle in-channel; the user receives an authenticated deep link and the approval records only after step-up completes.
- AE5. **Covers R14.** Given a Chat SDK version bump changes Adaptive Card compilation output, when CI runs, then the golden-card suite fails with a per-card diff before the bump merges.
- AE6. **Covers R12.** Given an agent turn runs long, when the platform user watches the channel, then a placeholder appeared promptly after the mention and the finalized response is the message's final state even if intermediate edits were dropped or rate-limited.

### Success Criteria

- Done means: an @mention in Slack **and** Teams creates a thread in the tenant's general Space, responds with placeholder → progressive edits, and HITL cards settle safely (R15/R16) — with R21 explicitly excluded from the done gate.
- Lint proves the boundary: no Chat SDK imports outside the channel adapter layer.
- The golden-card suite runs in CI for both platforms before the Teams channel ships.

### Scope Boundaries

**Deferred for later (inside or after this effort)**

- Plumbed channel→Space routing and its operator surface (sub-issue 9; excluded from the done gate).
- Enterprise Grid multi-tenant workspaces (one workspace serving multiple tenants); the binding registry is designed as the future seam but the constraint stays.
- Outbound anchor messages and the Slack DM collapse-to-one-thread fix.
- True token streaming.
- Provisional/guest identities for no-match users beyond the link-code flow.
- Additional channels (Google Chat, Discord, etc.) — the adapter layer makes them cheaper later, but none are in this effort.
- Self-serve credential/install wizard replacing operator Secrets Manager setup.
- Ambient channel ingestion feeding the Compounding Wiki (open consent questions).

### Dependencies / Assumptions

- Chat SDK's AWS Lambda runtime behavior is unvalidated in its docs — assumed workable behind the queue boundary; R4 measures it first.
- Chat SDK is young (public beta 2026-03) and fast-moving; MIT-licensed and forkable. Version bumps are gated by the golden-card suite.
- Existing assets are reused, not rebuilt: Slack OAuth install flow, tenant↔workspace binding and per-tenant Secrets Manager token layout, thread-mapping schema, signed install-state payload, pending-question HITL machinery.
- Teams app-catalog approval cycles are customer-controlled calendar time; R19 exists to start that clock at kickoff.

### Outstanding Questions

**Resolve before planning:** none.

**Deferred to planning**

- Queue technology and shape for the ack-path boundary (FIFO ordering/dedup requirements are set by R5/R6; the specific service and topology are planning's call).
- The exact risk-tier taxonomy for step-up approvals beyond the named floor (spend, publish, external communication).
- Ingress ledger schema and retention.
- Milestone-edit cadence for progressive edits (what counts as a "major milestone" per platform rate limits).
- Sub-issue 9 binding-resolution order (channel binding → workspace default → general).

### Sources / Research

- Ideation record with per-idea bases and verifier verdicts: docs/ideation/2026-07-10-think-84-chatsdk-slack-teams-ideation.html (local artifact — `docs/ideation/` is gitignored; repo-grounding claims in this contract were verified against source by a fresh-context verifier during that run).
- Linear THINK-84 — Slack & Teams Integration (verdict, integration shape, do-not-adopt list).
- Existing Teams plan to be rewritten: docs/plans/2026-05-21-006-feat-microsoft-teams-bot-think-plan.md.
- Existing Slack substrate: packages/api/src/handlers/slack/, packages/api/src/lib/slack/, packages/database-pg/src/schema/slack.ts.
- Typed message parts: packages/thread-json-render/; HITL machinery: packages/agentcore-pi/src/extensions/ask-user-question.ts and the pending-question schema.
- Chat SDK: https://chat-sdk.dev/ and https://github.com/vercel/chat (adapters, JSX cards, state adapters; Lambda support unconfirmed in docs).
- Platform constraints: Slack Events API 3-second ack + retry schedule; Teams multi-tenant Azure Bot registration deprecated 2025-07 (single-tenant + app catalog required).

### Delivery Structure

Nine sub-issues under THINK-84, sequenced; each carries its requirement coverage:

1. Foundation spike: ChannelPort seam, Chat SDK state adapter, risk burn-down — R1–R4.
2. Verify-and-enqueue ingress + ingress ledger — R5, R6.
3. Channel identity resolver: gated email auto-link, link-code fallback, security sign-off — R7–R9.
4. Slack channel v1: mention → thread → placeholder + progressive edits — R10–R12 (Slack).
5. Unified JSX card layer + golden-card CI suite — R13, R14.
6. Card-rails HITL: single-use tokens, idempotent settle, step-up — R15–R17.
7. Teams plan rewrite + distribution paperwork — R18, R19 (starts at kickoff, parallel to 1–6).
8. Teams channel v1: federated identity, mention loop on the shared foundation — R7, R10–R12 (Teams).
9. Fast-follow: plumbed channel→Space bindings + operator surface — R21.
