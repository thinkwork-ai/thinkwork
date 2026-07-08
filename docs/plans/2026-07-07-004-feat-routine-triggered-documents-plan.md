---
title: Routine-Triggered Documents - Plan
type: feat
date: 2026-07-07
topic: routine-triggered-documents
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Routine-Triggered Documents - Plan

## Goal Capsule

- **Objective:** Ship the emission-layer slice of routine-triggered documents (R1–R5, R8): a scheduled agent turn can finalize a document into its space as the run-as user, revisions are atomic keep-last-good, failures raise an inbox item and a reader-visible staleness indicator. Binding config (R6–R7) gets no implementation units — only the inert injection seam (U5) it will later fill.
- **Product authority:** Linear THINK-155 (parent THINK-175) and the Product Contract below (reviewed via ce-doc-review 2026-07-07; unchanged by planning).
- **Open blockers (R6–R7 only):** THINK-213 owns where the document binding attaches; two exported requirements are registered on its thread (see Outstanding Questions). None block this slice.
- **Stop conditions:** Surface instead of guessing if (a) the turn→run linkage reused by U1 turns out not to exist for automation turns, or (b) making scheduled emission atomic (U2) requires changing the human draft flow's visible behavior.
- **Tail ownership:** hand-rolled migration must be psql-applied to dev before merge (drift gate); watch the post-merge Deploy run.

---

## Product Contract

### Summary

Give scheduled runs the ability to emit and maintain documents headlessly: a first-class document binding on the scheduled workflow, run-as identity as the acting user for finalize-into-space, and keep-last-good failure semantics. The emission path already works for any agent turn; this closes the routine-context gaps.

### Problem Frame

Document emission (THINK-147/152/183) works only when a human is in the turn: the acting user is derived from the turn's triggering user message, and finalize-into-space is rejected without one. Scheduled turns have no triggering user message, so "every Monday, a pipeline report appears in Sales" is impossible today — the flagship recurring-report use case for the whole document stack. Meanwhile the platform has everything else the use case needs: schedule triggers with run-as identity (THINK-137), plates with content contracts (THINK-183/188), and per-plate conformance measurement (THINK-189) that would score every scheduled emission for free.

### Key Decisions

- **One living document, not a dated stack.** A recurring report targets a stable document; each run revises the head and prior state survives as Snapshots. Compounding history — supersedes chain, colophon, conformance corpus, share link — accrues to a single artifact instead of fragmenting across weekly copies.
- **Run-as user is the acting user.** THINK-137 already gives every scheduled run a `run_as_user_id` (default: creator) with a tenant-membership cross-check. That same identity becomes the acting user for emission: it stamps `created_by` and authorizes finalize-time space assignment member-or-above. No new identity concept; no service principal (THINK-145 KTD8 stands).
- **First-class document binding, not prompt convention.** The scheduled workflow carries a binding to the document it maintains (created on first run or pointed at an existing document, then pinned). Dispatch injects it into the turn; emission resolves it deterministically. Enforcement-over-nudge: the agent cannot fork a duplicate report through instruction drift, and the operator surface can show "this workflow maintains → Pipeline Report."
- **Co-plan as THINK-213's thin slice; only the binding surface waits.** THINK-213 demotes Automation to a trigger binding and centers Workflow/Run/Step; the document binding is a Workflow-level concept in that model, so building it on today's `agent_loop_versions.target_spec` would sit on the exact layer THINK-213 is churning. But this feature does not queue behind the unification wholesale: it is the first vertical slice co-planned inside THINK-213 — its own thin-slice candidate is a scheduled run producing completion evidence, and the emitted document plus its conformance report is exactly that evidence. Concretely: emission-layer work (R1–R5, R8) starts on today's stable run-as seam; binding-surface work (R6–R7) is specified against THINK-213's nouns and lands with its first Workflow increment. Rejected alternative: an interim binding column on today's automation shape (it would migrate via THINK-213's automation→workflow migration, but ships a config surface we'd immediately re-teach operators).

### Requirements

**Emission in scheduled context**

- R1. A scheduled run with a document binding emits or revises the bound document during its agent turn and finalizes it into the binding's space with no human in the loop.
- R2. The acting user for scheduled emission is the run's run-as user: it stamps document authorship and must be member-or-above in the target space for finalize to succeed.
- R3. Re-runs revise the same document: the head updates, the prior finalized state survives as a Snapshot, and the document's identity (URL, share links, conformance corpus, colophon chain) is stable across runs.

**Failure semantics**

- R4. A failed run — turn error, no emission, or document-gate rejection — leaves the last good finalized version in place as the document's current state.
- R5. A failed run raises a headless-failure inbox item naming the workflow and the reason, reusing THINK-137's inbox-item surface; detection is new work — today's headless-failure path fires only for routine/workflow targets at dispatch time, so observing agent-turn errors and finalize-gate rejections is a new seam, not reuse. The run never leaves the document half-updated or forks a duplicate.
- R8. The bound document surfaces its last-successful-refresh time to space members; when a scheduled refresh has failed since the last success, viewers see a stale indicator (e.g., "Last updated Jul 7 — scheduled refresh failed Jul 14") without needing operator-inbox access.

**Binding lifecycle**

- R6. The document binding is configured on the scheduled workflow: the author either creates a new document on first run or binds an existing one, and the binding is visible from both sides (workflow shows the document it maintains; the document's provenance shows the workflow that maintains it). Binding an existing document requires the binder to have edit rights on that document, and the takeover is visible at bind time — the document's provenance flips to "maintained by ⟨workflow⟩" immediately, not only after the first run.
- R7. Deleting the binding or the workflow orphans the document gracefully: the document survives as a normal artifact; only the scheduled maintenance stops.

### Key Flows

- F1. Weekly report run
  - **Trigger:** Schedule fires (Monday 07:00); the workflow's run starts with run-as = the workflow's configured user.
  - **Steps:** Dispatch injects the document binding into the agent turn → agent gathers data and emits against the bound document's plate → emission revises the head, finalizes into the bound space as the run-as user → Snapshot pins the prior week → conformance recorder scores the emission against the plate (existing THINK-189 path, no new work).
  - **Outcome:** Space members see the refreshed report; last week's version is one Snapshot back.
  - **Covers R1, R2, R3.**
- F2. Failed run
  - **Trigger:** The Monday run errors, or the emitted document fails the finalize gate.
  - **Steps:** Emission does not replace the finalized head → run completes as failed → headless-failure inbox item raised with workflow name and reason.
  - **Outcome:** The space still shows last week's good report with a stale indicator for readers; the operator finds the failure in the inbox, not by noticing a broken document.
  - **Covers R4, R5, R8.**

R6–R7 (binding lifecycle) have no flows yet: the binding's host object is defined by THINK-213, so their flows land in planning once that model exists.

### Acceptance Examples

- AE1. **Given** a workflow "Weekly pipeline report" bound to a sales-rep-review-plate document in the Sales space, running as Eric, **when** the schedule fires three Mondays in a row, **then** the Sales space contains exactly one "Pipeline Report" document, finalized, created by Eric, with one Snapshot per superseded weekly state (at least two after three finalized runs), and three rows in the plate's conformance corpus.
- AE2. **Given** the same workflow, **when** week 4's run throws before emission completes, **then** the document head still shows week 3's content and an inbox item names the workflow and the error.
- AE3. **Given** a run-as user who has been removed from the Sales space, **when** the schedule fires, **then** finalize is rejected, the last good version stands, and the inbox item says the run-as user lacks space membership.

### Scope Boundaries

- Deterministic (token-free) routines do not author documents — emission requires an agent turn, so this lands on scheduled workflows with agent steps. The issue's word "routine" maps there under THINK-213's taxonomy.
- Delivery is out of scope: the document appears in its space; emailing or Slack-notifying on refresh is separate work.
- Per-period document stacks ("Pipeline Report — Jul 7", "— Jul 14", …) are not offered in v1; the living document is the only mode.
- Multi-document bindings (one workflow maintaining several documents) are deferred until a real use case appears.

### Dependencies / Assumptions

- **THINK-213 (blocker):** the canonical run model defines the object the document binding lives on and the dispatch path that injects it. Emission-layer work (R1–R5, R8) is independent of it; binding-surface work (R6–R7) is not.
- THINK-137's run-as injection seam (`requestedByActorType/Id` → envelope user scope) is the identity substrate for R2. Its survival under THINK-213 is NOT guaranteed by THINK-213's plan — the "optionally running as a user" guardrail is from THINK-137's plan (docs/plans/2026-07-04-002-feat-automations-trigger-target-plan.md), and THINK-213's plan does not mention run-as identity. See Outstanding Questions: this is an exported requirement on THINK-213, not an assumption.
- Assumes the THINK-147 finalize guard gains a second derivation source (run-as identity) rather than being bypassed — the member-or-above space check still runs against the derived user.

### Outstanding Questions

- **Deferred to planning:** whether the binding injects as turn context the emit tool reads or as a constraint the emission API enforces server-side (or both — likely both, per enforcement-over-nudge). *Resolved for this slice by KTD4: both — payload field plus server-side target enforcement.*
- **Deferred to planning:** first-run bootstrap ordering — whether the document is created at bind time (empty shell) or by the first run's emission. *Still open; owned by the R6–R7 planning round (binding config does not exist in this slice).*
- **Resolve before planning (exported requirements on THINK-213, registered on its Linear thread so its definition-schema workstream owns answering them; their landing is the signal that unblocks R6–R7 here):**
  - THINK-213's Workflow definition schema must name where a document binding attaches (workflow-level output vs agent-step property).
  - THINK-213's Workflow definition schema must carry run-as identity (today's `agent_loops.run_as_user_id`) so scheduled runs retain an acting-user substrate for R2.

### Sources / Research

- Grounding dossier from this brainstorm: acting-user derivation and finalize guard (`packages/api/src/lib/artifacts/document-emission.ts`), run-as injection (`packages/agent-loops-core/src/dispatcher.ts`), automation target/run-as storage (`packages/database-pg/src/schema/agent-loops.ts`).
- docs/plans/2026-07-04-002-feat-automations-trigger-target-plan.md — THINK-137 Trigger→Target model, R5 run-as context injection, R4 headless-run semantics.
- docs/plans/2026-07-07-002-feat-canonical-run-model-plan.md — THINK-213, the blocking run-model unification.
- docs/plans/2026-07-04-002-feat-html-document-artifacts-plan.md — THINK-147 scope boundary that deferred this feature.

---

## Planning Contract

**Product Contract preservation:** unchanged by planning (one annotation: the first two Outstanding Questions carry their planning resolutions in place).

### Key Technical Decisions

- KTD1. **Acting user resolves server-side from the run, never from the callback payload.** `resolveActingUserId` (packages/api/src/lib/artifacts/document-emission.ts:310-329) gains a second derivation source: when the triggering message yields no user, resolve turn → agent-loop run → `agent_loops.run_as_user_id`, with a tenant-membership cross-check before use. The emission handler input (`chat-agent-activity.ts:185-192` — `{tenantId, threadId, agentId, turnId, triggeringMessageId}`) already carries `turnId`; the run linkage is resolved in the database, preserving THINK-147's "derived SERVER-SIDE … never trusted from the payload" rule. The concrete server-side mapping: `agent_loop_iterations` by `(tenant_id, thread_turn_id)` — stamped at dispatch by `linkAgentLoopIterationTurn` (packages/api/src/handlers/wakeup-processor.ts:1454-1462) — then `agent_loop_runs.agent_loop_id` → `agent_loops.run_as_user_id`. This deliberately does NOT reuse `projectAgentLoopFinalize`'s contextSnapshot-derived runId, which is payload-derived and would violate the trust rule.
- KTD2. **Scheduled emission is atomic: the visible head changes only after the finalize gate passes.** Research finding (corrected in review): within a single emit call, the gates (compile rejection at document-emission.ts:652-672, DocSpector preflight :677-704, finalize space authorization :728-756) already return before any S3/DB write. The keep-last-good exposure is narrower but real: (a) a *draft* emit earlier in the turn overwrites the head render and flips `artifacts.status` to `draft` (:767-790) before a later finalize emit fails its gate — and the body resolver always reads the head (packages/api/src/graphql/resolvers/artifacts/types.ts:39-45); (b) failures/crashes between the head writes and the finalize pin/flip (:804+, e.g., "Document row missing after upsert" :811-819). For run-derived (scheduled) emissions, stage all writes (drafts included — see U2) and perform head swap + status update + pin as the last step after every gate passes; on any failure, no visible state changes. The human flow (triggering-user-message turns) keeps today's draft-visible behavior unchanged.
- KTD3. **Refresh state lives as two nullable columns on `artifacts`.** `last_refresh_at` and `refresh_failed_at` (timestamptz), stamped only by the scheduled-emission path: success sets `last_refresh_at` and clears `refresh_failed_at`; failure sets `refresh_failed_at`. Hand-rolled migration only (Drizzle `db:generate` is retired) with `-- creates-column:` markers, psql-applied to dev before merge. No new table; the automation-run ledger stays the audit trail.
- KTD4. **The documentId injection seam ships inert, enforced at both ends.** `buildAgentLoopWakeupPayload`'s `agentLoop` block (packages/agent-loops-core/src/run-ledger.ts:460-474) gains an optional `documentId`; both trigger-builder call sites (packages/lambda/job-trigger.ts:977-980 and packages/api/src/graphql/resolvers/agent-loops/triggerAgentLoopRun.mutation.ts:133-136) pass it as null until THINK-213's binding exists (payload-parity learning: a field present on one dispatch path only silently fails on the other). When present, emission enforces it server-side: `document.emit` from that turn revises exactly that artifact id — the agent cannot fork a duplicate. Nothing sets it in production until the binding lands (ship-inert convention).
- KTD5. **Failure detection lands at two points, raising one deduplicated inbox item type.** (a) Gate/authorization rejections are detected inside the emission handler itself (it returns `ok:false` within a successful turn — invisible to run status); (b) turn-level errors are detected in `projectAgentLoopFinalize`'s terminal-failure decision (packages/api/src/lib/agent-loops/finalize-projection.ts:385-398). Both raise an inbox item in the `automation_headless_failure` pattern (packages/database-pg/src/ledger-db.ts:363-378; constants :51-52) under a new type `document_refresh_failed`, deduplicated one-open-item-per-automation, config carrying runId/errorCode/errorMessage/artifactId. Scope: only runs whose payload carries a `documentId` (KTD4) or whose emission failed — not every automation turn.
- KTD6. **Conformance is confirmed free.** THINK-189's recorder (`recordDocumentConformance`, merged on main via #3483 — may be absent in stale checkouts) keys off compiled `sectionFacts` + digest + plate manifest only; it has no acting-user or triggering-message dependency, and the waiver seam (packages/api/src/lib/artifacts/document-waivers.ts) is written from compiled output alone. Scheduled emissions populate the conformance corpus with zero new work.

### High-Level Technical Design

```mermaid
sequenceDiagram
    participant S as Scheduler/job-trigger
    participant D as agent-loops dispatcher
    participant W as wakeup-processor
    participant A as Agent turn (Pi)
    participant E as document-emission handler
    participant DB as Postgres/S3
    participant I as inbox_items

    S->>D: trigger {runAsUserId, documentId?}
    D->>W: enqueueWakeup (payload.agentLoop carries both)
    W->>A: envelope scope.user_id = runAsUserId
    A->>E: document.emit (turnId, no triggering user msg)
    E->>DB: resolve turn→run→run_as_user_id + tenant-membership check (KTD1)
    E->>E: compile → DocSpector gate → finalize authz (member-or-above)
    alt all gates pass
        E->>DB: head swap + status final + Snapshot pin + last_refresh_at (KTD2/3)
    else any failure
        E->>DB: no visible change; refresh_failed_at stamped
        E->>I: document_refresh_failed item (dedup per automation) (KTD5a)
    end
    Note over W,I: turn-level crash → finalize-projection terminal decision → same inbox item (KTD5b)
```

### Assumptions

- The turn→run mapping is confirmed durable: `agent_loop_iterations.thread_turn_id` is stamped at dispatch (wakeup-processor.ts:1454-1462), so the U1 lookup is a pure tenant-scoped DB resolution. Execution should check whether that column carries an index suitable for per-emission lookup and add one in U3's migration if not.
- Adding nullable columns to `artifacts` is non-breaking for all existing readers (columns are additive; resolvers expose them explicitly).

---

## Implementation Units

### U1. Run-derived acting user for scheduled emission

- **Goal:** A scheduled turn's emission resolves the automation's run-as user as the acting user, unlocking headless finalize-into-space.
- **Requirements:** R1, R2. Covers the identity legs of AE1/AE3.
- **Dependencies:** none.
- **Files:** `packages/api/src/lib/artifacts/document-emission.ts`, a small resolver in `packages/api/src/lib/agent-loops/` (turn→run→run-as lookup), `packages/api/src/lib/artifacts/document-emission.test.ts`.
- **Approach:** Extend the emission deps with `resolveRunActingUserId({tenantId, turnId})`: turn → agent-loop run → `agent_loops.run_as_user_id`, returning null unless the user passes the tenant-membership cross-check (mirror THINK-137's narrow service path — never widen `resolveCaller`). `resolveActingUserId` tries the triggering-message source first (human turns keep priority), then the run source. The THINK-147 guard text stays; it simply stops firing when the run source yields a user.
- **Patterns to follow:** THINK-137 R5 injection discipline (dispatcher.ts:356-385 comment block); existing dep-injection style in `document-emission.ts` (deps object with injectable resolvers).
- **Test scenarios:**
  - Happy: turn linked to a run with run-as user who is a tenant member and space member → acting user = run-as user; `created_by` stamped; finalize-with-space succeeds. Covers AE1 (identity leg).
  - Human turn with triggering user message AND run linkage → triggering-message user wins (priority order).
  - Run-as user not a tenant member (stale reference) → resolver returns null → guard fires as today.
  - Covers AE3: run-as user is a tenant member but not member-or-above in the target space → finalize rejected with the existing FORBIDDEN error.
  - Turn with no run linkage and no triggering user → null (unchanged behavior).
- **Verification:** unit tests green; existing human-flow emission tests unchanged.

### U2. Atomic keep-last-good for run-derived emission

- **Goal:** A failed scheduled emission leaves readers seeing the last finalized version — no draft flash, no half-updated head.
- **Requirements:** R3, R4. Covers AE2.
- **Dependencies:** U1 (the run-derived path this ordering applies to).
- **Files:** `packages/api/src/lib/artifacts/document-emission.ts`, `packages/api/src/lib/artifacts/document-emission.test.ts`.
- **Approach:** For emissions whose acting user came from the run source, reorder writes: stage digest + render to non-head keys, run compile → gate → finalize authorization, and only then perform the artifact upsert, head render write, status change, Snapshot pin, and waiver replacement. On any failure, delete/ignore staged keys and change nothing visible. Draft emits on run-derived turns also stage (never touch head or `artifacts.status`); draft continuity within the turn rides the emission response's documentId plus the U5 turn-bound documentId — `findExistingDraftDocument` (document-emission.ts:330-348) is not consulted for run-derived emissions, and a run-derived emit with no resolvable documentId creates the document only at finalize. Human-turn emissions keep the existing write order (draft-visible is intentional there). Watch idempotency: a retried scheduled emission must not collide with the original's staged keys (separate namespace per attempt, per the retry-idempotency learning).
- **Execution note:** Start with a failing test that asserts the current behavior gap — gate rejection after re-emission leaves a draft head visible — then invert it for the run-derived path.
- **Test scenarios:**
  - Covers AE2: run-derived emission fails the DocSpector gate → artifact row, head render, status, and versions are byte-identical to before the run; staged keys not exposed via `renderHtml`.
  - Run-derived emission passes all gates → head swapped, status final, prior version pinned as Snapshot, exactly one new version row.
  - Human-turn emission → current draft-first ordering unchanged (regression guard).
  - Two sequential successful run-derived emissions → two Snapshots, stable artifact id (R3).
  - Failure after staging, then a successful retry → success state correct, no orphaned visible state.
  - Run-derived draft emit then gate-rejected finalize → head, status, and versions unchanged (the draft never became visible).
- **Verification:** unit tests green; `pnpm --filter @thinkwork/api test` full suite (emission is a shared seam).

### U3. Refresh-state columns + failure → inbox item

- **Goal:** Failed scheduled runs are observable: refresh timestamps on the artifact and one deduplicated inbox item per automation.
- **Requirements:** R4, R5.
- **Dependencies:** U1, U2.
- **Files:** `packages/database-pg/src/schema/artifacts.ts`, `packages/database-pg/drizzle/02XX_artifact_refresh_state.sql` (next free number — 0221 at plan time, re-check for in-flight contention; hand-rolled, `-- creates-column: public.artifacts.last_refresh_at` / `.refresh_failed_at` markers), `packages/api/src/lib/artifacts/document-emission.ts`, `packages/api/src/lib/agent-loops/finalize-projection.ts`, `packages/database-pg/src/ledger-db.ts`, tests alongside each.
- **Approach:** Success path (U2's post-gate block) sets `last_refresh_at = now`, clears `refresh_failed_at`. Failure path (a) — emission-handler gate/authz rejection on a run-derived emission — sets `refresh_failed_at` and raises a `document_refresh_failed` inbox item via the `raiseHeadlessFailureItem` pattern (ledger-db.ts:363-378): dedup one open item per automation, config `{runId, errorCode, errorMessage, artifactId}`. Failure path (b) — terminal run failure in `projectAgentLoopFinalize` for runs whose payload carried a `documentId` — raises the same item type (artifact stamp only when the artifact is known). Item type constant beside `HEADLESS_FAILURE_INBOX_TYPE` (ledger-db.ts:51-52). The finalize path is new wiring, not reuse: the `AgentLoopFinalizeLedger` interface has no inbox capability today — add an inbox-raise method mirroring the dispatch ledger's `raiseHeadlessFailure` shape, reading documentId from the contextSnapshot already passed into `projectAgentLoopFinalize`.
- **Patterns to follow:** `raiseHeadlessFailure` dedup/increment shape (dispatcher.ts:171-187, ledger-db.ts:363-378); hand-rolled migration conventions (header markers, psql apply to dev).
- **Test scenarios:**
  - Gate rejection → `refresh_failed_at` set, `last_refresh_at` untouched, one pending `document_refresh_failed` item with runId + reason.
  - Second consecutive failure → same item incremented/refreshed, not a second open item.
  - Success after failure → `last_refresh_at` set, `refresh_failed_at` cleared; item handling matches the existing headless-failure resolve behavior.
  - Terminal run failure with `documentId` in payload → item raised from finalize-projection path.
  - Human-turn emission failure → no stamps, no item (scheduled-path only).
- **Verification:** migration precheck (`pnpm db:migrate-manual`) reports clean after psql apply to dev; api tests green.

### U4. Staleness indicator on the document surface

- **Goal:** Space members can see when the document was last successfully refreshed and whether a scheduled refresh has failed since.
- **Requirements:** R8.
- **Dependencies:** U3 (columns).
- **Files:** `packages/database-pg/graphql/types/artifacts.graphql` (two fields on the Artifact type), `packages/api/src/graphql/resolvers/artifacts/types.ts`, `apps/web/src/components/artifacts/ArtifactBodyView.tsx`, `apps/web/src/components/artifacts/ArtifactBodyView.test.tsx` (or the existing test home for that component), codegen in `apps/web` + `packages/api`.
- **Approach:** Expose `lastRefreshAt`/`refreshFailedAt` on the Artifact GraphQL type (schema field + resolver in the same commit — the executable-schema guard `server.schema.test.ts` must stay green). Render in the existing status strip (`ArtifactBodyView.tsx:82-96`): when `lastRefreshAt` present, show "Refreshed ⟨relative⟩"; when `refreshFailedAt > lastRefreshAt`, append the failure ("· scheduled refresh failed ⟨relative⟩") with a warning tone. No indicator for never-refreshed documents (fields null).
- **Patterns to follow:** the strip's existing `Updated {relativeTime(...)}` rendering; AWSJSON/codegen conventions (prettier only graphql.ts).
- **Test scenarios:**
  - Fields null → strip unchanged from today (regression).
  - `lastRefreshAt` set, no failure → "Refreshed" line, no warning.
  - `refreshFailedAt` newer than `lastRefreshAt` → stale indicator visible with both times.
  - `refreshFailedAt` older than `lastRefreshAt` (recovered) → no warning.
- **Verification:** web tests green; `server.schema.test.ts` green; pixels on local vite against dev data before claiming UI done.

### U5. Inert documentId injection seam

- **Goal:** The dispatch→turn→emission pipeline can carry a bound documentId end-to-end, enforced server-side, with nothing setting it until THINK-213's binding lands.
- **Requirements:** R1 (the enforcement half); prepares R6 without building its config surface.
- **Dependencies:** U1 (emission-side context), U2 (target enforcement composes with atomic ordering).
- **Files:** `packages/agent-loops-core/src/run-ledger.ts` (payload builder + types), `packages/lambda/job-trigger.ts`, `packages/api/src/graphql/resolvers/agent-loops/triggerAgentLoopRun.mutation.ts`, `packages/api/src/handlers/wakeup-processor.ts` (payload → turn context), `packages/api/src/lib/artifacts/document-emission.ts` (target enforcement), tests alongside.
- **Approach:** Optional `documentId` on the trigger object and on `buildAgentLoopWakeupPayload`'s `agentLoop` block (run-ledger.ts:460-474), passed as null from both trigger call sites (payload-parity rule: both builders in the same commit, carried identically on start and resume payloads). Wakeup-processor threads it into the turn's emission context (note: `thread_turns.context_snapshot` already spreads the full wakeup payload — decide typed field vs snapshot read at execution). Emission enforcement: when the turn carries a documentId, `document.emit` targets exactly that artifact — an emit that would create or revise a different document is rejected with a model-actionable error (agent self-corrects in-turn, DocSpector-style). Before accepting the bound target, verify the artifact row's `tenant_id` matches the turn's tenant (mirror KTD1's cross-check); mismatch rejects with the same actionable error.
- **Execution note:** Sequence this unit last — THINK-213's lane is actively working in `run-ledger.ts`/`dispatcher.ts`/`job-trigger.ts`; landing U5 against their then-current state keeps the rebase trivial.
- **Test scenarios:**
  - Payload builder carries documentId identically on start and resume payloads (parity test, mirroring the existing parity-test pattern).
  - Turn with documentId → emit revises that artifact even if the agent supplies a different/no id.
  - Turn with documentId → emit attempting a new document → rejected with actionable error naming the bound document.
  - Turn with a documentId whose artifact belongs to a different tenant → rejected; no write occurs.
  - No documentId (all production paths today) → behavior byte-identical to before (inert guard).
- **Verification:** api + agent-loops-core tests green; grep confirms no production caller sets the field.

### U6. Live acceptance smoke on dev

- **Goal:** Prove the slice end-to-end on the deployed stack with a real scheduled automation.
- **Requirements:** R1–R5, R8. Covers AE1 (identity + revision legs), AE2, AE3.
- **Dependencies:** U1–U5 deployed to dev.
- **Files:** none shipped — smoke scripts in scratch; findings recorded in the PR/Linear evidence.
- **Approach:** Create a dev automation (agent-thread target, Space-bound, run-as = Eric) whose instructions emit a sales-rep-review document; set the bound documentId directly via the U5 seam for run 2+ (test-only, since no binding UI exists). Run 1: document created, finalized, created_by = Eric, conformance row present. Run 2: same artifact revised, Snapshot count incremented. Run 3 (forced gate failure via planted off-plate content): head unchanged, `refresh_failed_at` stamped, inbox item present, staleness indicator visible in the web UI. Membership-revocation check per AE3.
- **Test scenarios:** the three runs above are the scenarios; each asserts through GraphQL + DB + pixels, not bare Lambda invokes (bare-invoke-≠-E2E rule).
- **Verification:** evidence (queries + screenshots) attached to the PR/Linear before the feature is called done.

---

## Verification Contract

| Gate | Command | Applies to |
|------|---------|------------|
| API suite | `pnpm --filter @thinkwork/api test` | U1–U5 |
| Agent-loops-core suite | `pnpm --filter @thinkwork/agent-loops-core test` (or its package test script) | U5 |
| Web suite | `pnpm --filter @thinkwork/web test` | U4 |
| Executable-schema guard | `npx vitest run src/graphql/server.schema.test.ts` (in packages/api) | U4 |
| Monorepo typecheck | `pnpm -r --if-present typecheck` | all |
| Migration drift | `pnpm db:migrate-manual` after psql apply to dev | U3 |
| Codegen freshness | `pnpm --filter @thinkwork/api codegen && pnpm --filter @thinkwork/web codegen` (no diff) | U4 |
| Live smoke | U6 protocol on dev | release gate |

Vitest green is not tsc green — run typecheck as its own gate. GraphQL schema field and resolver land in the same commit.

---

## Definition of Done

- R1–R5 and R8 each traceable to green tests in U1–U5; AE1 (identity + revision legs), AE2, AE3 proven live on dev via U6 with recorded evidence.
- Migration psql-applied to dev before merge; drift precheck clean; post-merge Deploy run watched green.
- The U5 seam verified inert: no production code path sets `documentId`.
- Human-turn emission behavior verified unchanged (draft-visible flow, existing tests untouched or updated only for dep-shape changes).
- No abandoned experimental code in the diff; worktree removed and branch deleted after merge.
- THINK-155 Linear updated with evidence; R6–R7 remain open pending THINK-213's exported requirements.
