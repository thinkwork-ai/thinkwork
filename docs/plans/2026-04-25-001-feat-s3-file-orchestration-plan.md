---
title: "feat: Add S3 file orchestration primitive"
type: feat
status: active
date: 2026-04-25
origin: docs/brainstorms/2026-04-25-s3-event-driven-agent-orchestration-requirements.md
deepened: 2026-04-25
---

# feat: Add S3 file orchestration primitive

## Overview

Add a folder-native orchestration primitive on top of the fat-folder workspace model. Explicit S3 file writes under eventful workspace prefixes create canonical events, update a lightweight database index, and wake folder-addressed agent contexts through the existing wakeup processor. The runtime remains stateless between turns: each wake receives a workspace run id, reads `work/runs/{runId}/`, writes files/events, and exits.

**Definition — *eventful* prefix.** A prefix designated by this plan as one whose S3 writes are observed by the dispatcher and produce canonical events. Eventful is a deliberate platform designation, not an emergent property: only the explicit prefixes named in U2 are eventful. Writes outside those prefixes produce no events.

This plan treats `docs/brainstorms/2026-04-25-s3-event-driven-agent-orchestration-requirements.md` as the primary source and uses `docs/brainstorms/2026-04-25-s3-file-orchestration-primitive-requirements.md` as a scope guard: keep v1 primitive-first, make canonicalization platform-owned, and avoid workflow-engine semantics.

---

## Problem Frame

ThinkWork already has a single agent invocation path (`agent_wakeup_requests` -> `wakeup-processor` -> AgentCore), S3-backed workspace files, and an admin workspace editor. What is missing is a durable, inspectable way for agents, humans, schedulers, memory writes, and async sub-agents to coordinate through the same folder substrate.

The implementation should reuse the existing invocation path rather than creating a second agent runner. New S3 events canonicalize into workspace orchestration rows, then enqueue `agent_wakeup_requests` with enough payload for `wakeup-processor` to invoke the right root or sub-agent workspace context.

---

## Requirements Trace

- R1-R4. Fixed eventful folder layout and content-as-event prefixes from the origin document.
- R5-R8. Small event vocabulary, agent intent canonicalization, target authority, and bulk-write suppression.
- R9-R12. Folder-addressed wake primitive, trigger-typed run allocation/resume, stateless runtime, and resumable run lifecycle.
- R13-R14. Database operational source of truth (`agent_workspace_events` rows are the canonical events) with derived S3 audit mirror.
- R15-R16. Wake-chain depth and per-run inbox-write quota.
- R17-R19. Coexistence with `delegate_to_workspace`, scheduler conversion to inbox writes, and memory pipeline event subscription.
- Supplemental R1-R14. Primitive-first constraints: explicit prefixes, DB pointers to S3, `event.rejected`, mostly append-only run folders, read-only audit viewer plus HITL editor.

**Origin actors:** A1 paired human, A2 tenant operator, A3 Strands runtime, A4 sub-agent, A5 dispatcher Lambda, A6 memory pipeline, A7 importer/template sync/re-seeder.

**Origin flows:** F1 human-initiated work request, F2 async sub-agent wake, F3 HITL pause/resume, F4 memory ingest on file change.

**Origin acceptance examples:** AE1 inbox creates run+wakeup, AE2 bulk write suppression, AE3 event intent canonicalization, AE4 unauthorized inbox target rejection, AE5 review edit resumes run, AE6 sync delegate vs async wake separation, AE7 depth/quota rejection.

---

## Scope Boundaries

- Do not build a workflow engine: no DAG DSL, dependency graph authoring, compensation model, or built-in fan-in engine.
- Do not introduce in-runtime sleep; blocked work exits and resumes through files/events.
- Do not replace `delegate_to_workspace`; synchronous delegation remains for same-turn specialist calls.
- Do not let arbitrary S3 writes wake work; only explicit eventful prefixes are considered.
- Do not enable unrelated root-agent peer writes in v1.
- Do not include compound-engineering brainstorm -> plan -> work session handoff in v1.
- Do not make the admin UI a full orchestration console; v1 is audit viewing plus HITL review editing.

### Deferred to Follow-Up Work

- Full agent builder redesign from the fat-folder brainstorm: this plan adds the orchestration viewer/editor slices that can fit the current workspace route.
- Tenant-tunable quota/depth settings: v1 uses platform constants.
- DB partitioning automation for long-term event retention: define indexes now; partitioning can follow once production volume is measured.

---

## Context & Research

### Relevant Code and Patterns

- `terraform/modules/data/s3-buckets/main.tf` owns the primary S3 bucket. It has no EventBridge/S3 notification wiring today.
- `packages/api/src/handlers/wakeup-processor.ts` is already documented as the single execution path for agent invocations and claims `agent_wakeup_requests` atomically.
- `packages/database-pg/src/schema/heartbeats.ts` defines `agentWakeupRequests`; `packages/database-pg/src/schema/threads.ts` defines `threadTurns` and `threadTurnEvents`. These are per wake/turn, not a durable multi-wake workspace run.
- `packages/api/workspace-files.ts` and `apps/admin/src/lib/workspace-files-api.ts` are the current Cognito-authenticated S3 workspace file API surface.
- `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.workspace.tsx` is the current folder-tree editor to extend for run/audit viewing.
- `packages/agentcore-strands/agent-container/container-sources/write_memory_tool.py` shows the current pattern for workspace-writing Strands tools via the API, with tests around path safety.
- `packages/api/src/handlers/memory-retain.ts` currently calls `maybeEnqueuePostTurnCompile`; `packages/api/src/lib/wiki/enqueue.ts` invokes `wiki-compile` with `InvocationType: "Event"`.
- `packages/lambda/job-trigger.ts` currently creates threads and inserts `agentWakeupRequests` directly for scheduled agent jobs.

### Institutional Learnings

- `docs/solutions/patterns/apply-invocation-env-field-passthrough-2026-04-24.md`: add passthrough tests when new invocation payload fields cross the API -> AgentCore -> container boundary.
- `docs/solutions/best-practices/defer-integration-tests-until-shared-harness-exists-2026-04-21.md`: use focused unit/contract tests for Lambda orchestration paths unless a shared integration harness exists.
- `docs/solutions/logic-errors/compile-continuation-dedupe-bucket-2026-04-20.md`: compile-adjacent async work needs explicit idempotency and must not hide failures behind `ON CONFLICT DO NOTHING`.
- `docs/solutions/best-practices/probe-every-pipeline-stage-before-tuning-2026-04-20.md`: expose stage-level observability before optimizing a pipeline.
- `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md`: tenant-admin mutations and destructive/side-effecting paths must gate before writing or invoking.

### External References

- [Amazon S3 EventBridge notifications](https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventBridge.html): S3 can publish Object Created events to EventBridge.
- [Amazon EventBridge event patterns](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-patterns.html): rules can match source metadata and detail fields.
- [EventBridge pattern best practices](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-patterns-best-practices.html): patterns should be precise to avoid unexpected matches and loops.
- [EventBridge comparison operators](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-create-pattern-operators.html): prefix/suffix/wildcard filters are available for event content.
- [S3 event ordering and duplicates](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html): notifications are at-least-once and can arrive duplicated or out of order.

---

## Key Technical Decisions

- **Add `agent_workspace_runs` in addition to `agent_workspace_events`.** Origin R13 only names the event table, but a workspace run spans multiple wakeups across HITL/sub-agent waits while `thread_turns` are per AgentCore invocation. A small run table keeps the durable file-run lifecycle separate and links to wakeups/turns.
- **EventBridge catches candidate S3 writes; dispatcher is the authority.** EventBridge rules filter to candidate object keys, but the dispatcher still validates tenant, target path, event type, idempotency, and suppression. This avoids trusting AWS filtering as authorization.
- **Bulk-write suppression: HeadObject metadata check at the dispatcher.** Two facts shape the design: (a) `x-amz-meta-*` user-defined headers are NOT in the S3 EventBridge `detail` payload, and (b) `detail.requester` is the AWS account ID or service principal, NOT the IAM role/user ARN — all Lambdas in the same account share one `detail.requester` value, so it cannot distinguish importer from runtime. EventBridge filtering on either field is impossible. The dispatcher's first action on every event is `HeadObject` with a check for user-defined object metadata `x-amz-meta-thinkwork-suppress-event: true` before canonicalization (one S3 request per event; trivial cost relative to the canonicalize+enqueue work). Bulk writers (importer, template-sync, re-seeder) may set this metadata; runtime/Cognito writer paths strip or reject it (see U2). Optional v2: enable CloudTrail S3 data events to populate `detail.userIdentity.principalId`, then add EventBridge-level pre-filtering (~$0.10 per 100k events of CloudTrail cost). Reference: AWS docs "EventBridge event message structure for S3" + AWS re:Post "EventBridge rules to distinguish PutObject origins".
- **Idempotency uses S3 `sequencer`, persisted in Postgres.** Derive `idempotency_key = sha256(canonical_object_key + sequencer)`. The S3 `sequencer` field (in event detail) is monotonically lexicographic per object, so it doubles as both dedupe key and ordering hint — handles version-overwrite duplicates that `(bucket, key, etag)` would mishandle. Unique index `(tenant_id, idempotency_key)` on `agent_workspace_events`; `INSERT … ON CONFLICT (tenant_id, idempotency_key) DO NOTHING` is the dedup point. **Per `compile-continuation-dedupe-bucket` learning, every zero-row return MUST log the collision** — `ON CONFLICT DO NOTHING` silently swallowed dedup failures for 3 PRs in the past. Reference: AWS Storage Blog "Manage event ordering and duplicate events with Amazon S3 Event Notifications".
- **SQS in front of the dispatcher Lambda.** At ~1.6M events/month with tenant-correlated bursts (4 tenants × 100+ agents × scheduled fan-out), direct EventBridge → Lambda has no per-tenant concurrency control and a poison message has no replay buffer. SQS gives `MaximumConcurrency` per ESM (provisioned mode now supports 20K concurrent invokes), `ReportBatchItemFailures` + `bisect_batch_on_function_error` for partial-batch recovery, and the option to shard per-tenant queues later without a topology rewrite. Retry model is **SQS-correct, not Lambda-correct**: queue's `redrive_policy.max_receive_count = 1` means one delivery attempt then DLQ on failure (Lambda's `MaximumRetryAttempts` only applies to async/Event invokes, not SQS event-source-mappings). Use `function_response_types = ["ReportBatchItemFailures"]` so a single bad message in a batch doesn't fail the whole batch. The PR #552 `project_async_retry_idempotency_lessons` precedent is the right *intent* (one attempt + DLQ + idempotent processing); the *mechanism* differs from skill-runs because the trigger surface is different.
- **One EventBridge rule per eventful source prefix family, using the `wildcard` operator.** Syntax: `"key": [{ "wildcard": "tenants/*/agents/*/workspace/work/inbox/*.md" }]`. Per-rule cardinality is easier to reason about than one giant OR'd pattern, costs the same, and lets us wire each rule to a different SQS or DLQ later if a noisy prefix needs isolation. Reference: AWS Compute Blog "Filtering events in Amazon EventBridge with wildcard pattern matching".
- **Cross-tenant boundary at S3 IAM first, dispatcher second.** The Strands runtime's IAM role is scoped to its own tenant prefix (`tenants/${tenantSlug}/agents/${agentSlug}/*`); a compromised runtime cannot PUT into another tenant's prefix at all. The dispatcher's prefix-derived tenant check is defense-in-depth, not the primary line. Per `every-admin-mutation-requires-requiretenantadmin` and the rotated-`API_AUTH_SECRET` runbook: `API_AUTH_SECRET` bypasses `requireTenantMembership`, so the only safe tenant signal is the S3 prefix the dispatcher is reacting to.
- **Route through `agent_wakeup_requests`.** The S3 dispatcher should enqueue a wakeup with source `workspace_event` rather than invoke AgentCore directly. Existing budget, tool, KB, cost, notification, and run-event behavior stays centralized in `wakeup-processor`.
- **Cold-start-per-wake is the v1 reality; no warm-session optimization.** Earlier draft proposed `runtimeSessionId = workspaceRunId` to hit warm microVM sessions on resume — REMOVED because `wakeup-processor` invokes AgentCore via Lambda Web Adapter (`@aws-sdk/client-lambda` `InvokeCommand`), NOT `BedrockAgentCoreClient.InvokeAgentRuntimeCommand`. The session-resume contract doesn't exist on this code path. Each wakeup boots a fresh container, reads `runs/{runId}/`, runs, exits. If HITL/sub-agent resume latency proves unacceptable in production, a follow-up plan can migrate `wakeup-processor` from Lambda Web Adapter to direct `InvokeAgentRuntime` for `workspace_event` source — non-trivial refactor, not v1.
- **Expose `wake_workspace` as the async sibling of shipped `delegate_to_workspace`.** Plan 008 U9 is now live on `main`: `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py` registers a folder-addressed synchronous delegation tool with path validation, reserved-folder rejection, hard depth cap 5, and soft warning at depth 4. This plan extracts/reconciles that behavior into the shared target-resolution helper (U10), updates `delegate_to_workspace` to call the helper, and has `wake_workspace` adopt the same helper from day one.
- **F2 race resolution: parent writes `events/blocked.json` BEFORE child inbox.** A fast sub-agent can complete before the parent's turn ends, leaving the dispatcher's "look up waiters" query empty and losing the wake. The contract is: parent writes `events/blocked.json` with `wait_for: {target, runId}` first, THEN writes the child's `work/inbox/{requestId}.md`. The `wake_workspace` tool enforces this ordering internally for the async-with-wait variant. No buffering of unmatched completions needed.
- **HITL editor uses ETag-conditional PUT.** Two operators editing the same `review/{runId}.needs-human.md` concurrently would both fire wakes (corrupting `runs/{runId}/transcript.md` if the agent runs twice). The admin UI's review-save mutation includes `If-Match: <etag>` from the GET; mismatch surfaces a "review changed since you opened it" conflict to the operator. Single-source path; no separate locking service.
- **Single `wait_for` per `events/blocked.json` + N+1 wakes for N children, parent-managed.** Schema has single nullable `wait_for_run_id`; the platform does NOT manage fan-in. Fan-out pattern: parent issues N `wake_workspace` calls (writes N inbox files + initial `events/blocked.json` pointing at the FIRST child's runId), each with the child's runId tracked in `runs/{parentRunId}/status.json`. When child #1 completes, dispatcher wakes parent. Parent reads `status.json`, sees N-1 children still pending, writes new `events/blocked.json` with `wait_for` pointing at child #2 (or terminates if all done). Net wakes for N children: N+1. The wake-amplification cost is real and bounded by the depth-5 + 10-inbox-per-run quotas. Brainstorm Success Criterion #3 ("resume only when each specialist completes") describes platform-managed fan-in — flagged as Outstanding Question for brainstorm addendum; v1 ships agent-managed fan-out via `status.json`. Future v2 may add an array `wait_for` schema with platform fan-in semantics; v1 stays primitive.
- **Add `cancelled` and `expired` terminal run states.** Review-file deletion (operator cancels HITL) → `cancelled`. Sweeper-detected orphan blocks (e.g., `awaiting_subrun` for >7 days, `awaiting_review` for >30 days — defaults, tunable in operational layer) → `expired`. Both write canonical `run.failed` with explicit `reason` so operators can audit; brainstorm's `processing → failed` covers the event side.
- **Event vocabulary is 8 types**, enumerated as: 7 lifecycle/signal events (`work.requested`, `run.started`, `run.blocked`, `run.completed`, `run.failed`, `review.requested`, `memory.changed`) + 1 platform event (`event.rejected`). The platform event is needed for cases where rejection happens BEFORE a runId is allocated (e.g., `wake_chain_depth_exceeded`, `unauthorized_inbox_target`, schema-validation failure) and so cannot be expressed via `run.failed`. `run.blocked` keeps a unified `reason` field for review/subrun/error/timeout — it is one event type, not multiple, despite the state diagram showing distinct paths from it.
- **S3 audit mirror is both day-partitioned and run-linked.** "Canonical event" refers to the Postgres `agent_workspace_events` row (authoritative, operational truth). The S3 audit mirror is a derived, inspectable copy: top-level `events/audit/YYYY-MM-DD/*.json` supports folder browsing; `work/runs/{runId}/events/*.json` links the run audit trail to the same canonical event ids. Mirror writes happen AFTER the DB commit; a mirror-write failure marks the canonical event row `mirror_status='failed'` rather than blocking the wake — operators see DB truth with a divergence flag in the timeline.
- **Workspace-files API rejects PUT to protected orchestration prefixes.** The existing `packages/api/workspace-files.ts` handler (used by the Strands runtime for memory writes and by the admin SPA for workspace edits) is modified in U5 to refuse PUT operations targeting `work/inbox/`, `review/`, `work/runs/*/events/`, `events/intents/`, or `events/audit/` with HTTP 403 `error: "use orchestration writer"`. Same handler's presigned-URL branch denies minting URLs for those prefixes. `memory/*.md` remains eventful but not protected: ordinary memory writes may continue through the existing workspace-files API and produce `memory.changed` canonical events. Protected orchestration writes go EXCLUSIVELY through the new `write-api.ts` orchestration writer (U5), which enforces F2 race ordering (parent blocked.json BEFORE child inbox), single-`wait_for` shape, and tenant identity from scoped service auth or Cognito. This makes the F2 ordering and HITL conflict guarantees structural, not just tool-level discipline — closes both the agent-bypass-via-direct-API and admin-presigned-URL-bypass attack vectors.
- **CI observability via CloudWatch alerts, not deploy gates.** Each pipeline stage emits a structured log line (`work.requested`, `claimed`, `started`, `completed`/`failed`/`blocked`); per-stage CloudWatch metric filters drive alerts on missing transitions or unexpectedly long stage gaps. A post-deploy smoke gate is a follow-up plan (an earlier draft included one as U11; removed because the deploy-blocking gate needs its own bypass design and the canary-tenant data model is its own scope). The silent-multi-component-failure family (`deploy-silent-arch-mismatch`, `agentcore-runtime-no-auto-repull`) is mitigated in v1 by alerts (visible after deploy without blocking it), not by a gate.

---

## Open Questions

### Resolved During Planning

- Bulk-write suppression: HeadObject metadata check at the dispatcher is the v1 mechanism (one S3 request per event). Both EventBridge alternatives are unworkable in v1: `x-amz-meta-*` is not in the `detail` payload, and `detail.requester` is the AWS account ID (not IAM principal), so it can't distinguish importer from runtime. Optional v2: enable CloudTrail S3 data events to populate `detail.userIdentity.principalId` for EventBridge-level pre-filtering.
- Idempotency derivation: `sha256(canonical_object_key + sequencer)` from the S3 event's monotonic `sequencer` field, persisted as `(tenant_id, idempotency_key)` unique index. `INSERT … ON CONFLICT DO NOTHING` is safe but every zero-row return must log the collision (per `compile-continuation-dedupe-bucket`).
- Event-to-Lambda topology: SQS in front of the dispatcher, one EventBridge rule per eventful prefix family using the `wildcard` operator on `object.key`. Retry via SQS `redrive_policy.max_receive_count = 1` + DLQ; partial-batch handling via `function_response_types = ["ReportBatchItemFailures"]`. (Lambda `MaximumRetryAttempts` does NOT apply to SQS event-source-mappings — earlier draft was wrong.)
- Cross-tenant boundary: enforced at S3 IAM (Strands runtime role scoped to its own tenant prefix) as the primary line; dispatcher prefix-derived tenant check is defense-in-depth. Workspace-files API rejects PUT to protected orchestration prefixes (and presigned URL generator denies minting URLs for them), closing the agent-bypass and admin-bypass attack vectors structurally.
- AgentCore session resumption: deferred. `wakeup-processor` invokes via Lambda Web Adapter, not `BedrockAgentCoreClient.InvokeAgentRuntimeCommand`, so `runtimeSessionId` is not exposed on this code path. Cold-start-per-wake is the v1 reality. Follow-up plan can migrate to direct AgentCore invoke if measured latency demands.
- `delegate_to_workspace` dependency: resolved. Plan 008 U9 is live on `main`; U10 now extracts/reconciles the shipped validator behavior into a shared helper and updates both `delegate_to_workspace` and `wake_workspace` to use it.
- F2 race: parent writes `events/blocked.json` BEFORE child inbox; `wake_workspace` enforces the ordering for async-with-wait variants. No buffering of unmatched completions.
- HITL concurrent edits: ETag-conditional PUT in the admin save mutation; mismatch surfaces a conflict to the operator.
- Multi-child fan-out: single `wait_for` per `events/blocked.json` in v1; parent owns multi-child coordination in its own `status.json`.
- Cancelled/expired states: terminal `cancelled` (operator triggers `cancelReviewRequest` GraphQL mutation, NOT raw S3 DELETE) and `expired` (orphan-block sweeper covers `awaiting_subrun` >7d, `awaiting_review` >30d, `processing` >30m via U6 retry sweeper); all write canonical `run.failed` with explicit `reason`.
- Multi-child fan-out: parent issues N sequential `wake_workspace` calls and tracks completion in `runs/{parentRunId}/status.json`; each child completion produces one parent wake (N+1 total wakes for N children). Single-`wait_for` schema in v1; platform fan-in is explicitly out of scope. Brainstorm Success Criterion #3 needs a v1 addendum acknowledging the agent-managed shape — captured in `From 2026-04-25 review` below.
- Event vocabulary: 8 types — adopt `event.rejected` from the supplemental brainstorm for pre-runId rejections (depth/quota/auth violations).
- RunId allocation: dispatcher creates `agent_workspace_runs.id` for inbox writes; lifecycle/review/error events must reference an existing workspace run id.
- `run.blocked` vocabulary: keep one event type with `reason: "review" | "subrun" | "error" | "timeout" | ...`.
- `wake_workspace` exposure: implement as a separate Strands tool, backed by the workspace file API/orchestration writer.
- Waiter lookup: store wait relationships on `agent_workspace_events` and/or a small `agent_workspace_waits` table keyed by awaited target/run id.

### Deferred to Implementation

- Exact Drizzle migration number and SQL names.
- Retention/deletion policy for S3 run folders, review files, source/result bodies, S3 audit mirrors, canonical DB event rows, and tenant offboarding. V1 must classify these as tenant-sensitive, avoid logging bodies, and define default retention before production rollout.
- Whether `wiki-compile` subscribes by polling canonical events or by being invoked from the dispatcher for `memory.changed`. The invariant is that the event row is written before the compile job starts.

### From 2026-04-25 review

- **[Brainstorm addendum needed] Multi-child fan-out / Success Criterion #3** — Brainstorm `2026-04-25-s3-event-driven-agent-orchestration-requirements.md` Success Criterion #3 promises "fan out to 3+ specialists, resume only when each completes" (platform-managed fan-in). v1 ships single-`wait_for` schema with parent-managed fan-out via `status.json` (N+1 wakes for N children). Brainstorm needs an addendum acknowledging the deferred shape, OR v2 needs an explicit fan-in trigger. Owner: product.
- **[Identity bet, fold into U9 docs] Workspace-native orchestration as deliberate platform identity** — Adopting S3-as-orchestration-substrate with 8-event vocabulary, sweepers, depth/quota guards, and ETag conflict handling is a real positioning statement: ThinkWork bets agent orchestration is platform-owned + folder-native, not a thin layer over AgentCore + Scheduler + Lambda. Maintenance surface is ongoing. U9 now surfaces this framing in docs because sync `delegate_to_workspace` has shipped and async `wake_workspace` is this plan's core primitive.
- **[Trajectory v2 trigger] Concrete signal for adding platform fan-in semantics** — Define a measurable trigger (e.g., "when ≥N tenants hit ≥M concurrent multi-child waits per week, telemetry from U7+U8") that justifies extending the `wait_for` schema to an array shape and adding platform-managed fan-in. Without a defined trigger, the deferral risks drifting permanent. Owner: product after v1 lands.
- **[Pending product input] Which enterprise(s) and workflow(s) gate on HITL or async sub-agent fan-out?** — The plan motivates HITL as "load-bearing for real enterprise work" (carried from brainstorm) but no specific enterprise customer is named as the gating case. If named, lead the v1 rollout from that workflow. If not nameable, this is a designer-aesthetic priority — not a blocker for shipping, but worth surfacing for honest framing.
- **[Optimization, defer if tight on budget] U10 parity_test_cases simplification** — The TS+Python helper parity is enforced via a shared `parity_test_cases` constant. Could potentially simplify to mirrored fixtures + human-review discipline (no shared constant), reducing the cross-language coupling pattern that's net-new in this repo. Decide during U10 implementation.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
sequenceDiagram
  participant S3 as S3 workspace bucket
  participant EB as EventBridge rule
  participant SQS as SQS queue (per-rule, redrive max_receive=1)
  participant D as workspace-event-dispatcher
  participant DB as Postgres
  participant WP as wakeup-processor
  participant AC as AgentCore (cold-start per wake; reads runs/{runId}/)
  participant UI as Admin agent builder

  S3->>EB: ObjectCreated under eventful prefix
  EB->>SQS: matched event (no requester filter — see Key Decisions)
  SQS->>D: batch deliver; ReportBatchItemFailures for partial failure
  D->>S3: HeadObject (suppress-tag check, metadata)
  D->>DB: INSERT canonical event ON CONFLICT DO NOTHING (sequencer-keyed)
  D->>DB: upsert workspace run; bump depth/quota counters; verify run.agent_id matches actor
  D->>S3: write events/audit mirror (best-effort)
  D->>DB: insert agent_wakeup_requests(source=workspace_event)
  WP->>DB: claim wakeup
  WP->>AC: invoke via Lambda Web Adapter (payload includes runId / causeEventId / causeType / depth)
  AC->>S3: read work/runs/{runId}/, write result/event intent/review (via /api/workspaces/* — protected orchestration prefixes go through orchestration writer ONLY)
  UI->>DB: query runs/events (urql, tenant-scoped)
  UI->>S3: read source/result; ETag-conditional PUT for review files (via cancelReviewRequest mutation for cancellation)
```

```mermaid
stateDiagram-v2
  [*] --> pending: work.requested
  pending --> claimed: dispatcher enqueues wakeup
  pending --> failed: dispatcher reject (auth/quota/depth/cross-agent) -> event.rejected
  claimed --> processing: wakeup-processor invokes runtime
  claimed --> failed: invoke failure (sweeper requeues; surfaces after N retries)
  processing --> completed: run.completed
  processing --> failed: run.failed
  processing --> awaiting_review: run.blocked reason=review
  processing --> awaiting_subrun: run.blocked reason=subrun
  processing --> processing: orphan sweeper re-enqueue (wakeup_retry_count++)
  processing --> expired: orphan sweeper, retry_count >= N (default 3) -> reason=processing_orphan
  awaiting_review --> processing: review file edited (ETag-conditional; idempotent if already processing)
  awaiting_review --> cancelled: cancelReviewRequest mutation (NOT raw S3 DELETE)
  awaiting_review --> expired: sweeper, age > 30d (default)
  awaiting_subrun --> processing: awaited subrun completed (parent reads status.json; may re-block on next child for N+1 wake pattern)
  awaiting_subrun --> processing: awaited subrun failed (parent receives failure context)
  awaiting_subrun --> expired: sweeper, age > 7d (default)
  completed --> [*]
  failed --> [*]
  cancelled --> [*]
  expired --> [*]
```

> *State-machine notes:* `run.blocked` is a **single event type with a `reason` field** (`review` | `subrun` | `error` | `timeout`), not multiple events — the diagram shows distinct paths for clarity. Multi-child fan-out: parent issues N `wake_workspace` calls + status.json discipline; each child completion produces one parent wake (N+1 total wakes for N children). Idempotent resume: if a wake against an `awaiting_review` runId arrives while the run is already `processing`, the canonical event is recorded but no duplicate wakeup row enqueues — in-flight turn finishes, next turn starts with the latest review state.

---

## Implementation Units

- U1. **Add workspace orchestration schema and domain types**

**Goal:** Create the durable database model for workspace runs, canonical events, and wait relationships without overloading `thread_turns`.

**Requirements:** R5, R6, R10-R16; supplemental R4-R9.

**Dependencies:** None.

**Files:**
- Create: `packages/database-pg/src/schema/agent-workspace-events.ts`
- Modify: `packages/database-pg/src/schema/index.ts`
- Create: `packages/database-pg/graphql/types/agent-workspace-events.graphql`
- Create: `packages/database-pg/src/__tests__/schema-agent-workspace-events.test.ts`
- Generated: `packages/database-pg/drizzle/NNNN_agent_workspace_events.sql`

**Approach:**
- Add `agent_workspace_runs` with `id`, `tenant_id`, `agent_id`, `target_path`, `status`, `source_object_key`, `request_object_key`, `current_wakeup_request_id`, `current_thread_turn_id`, `parent_run_id`, `depth`, `inbox_write_count`, **`wakeup_retry_count` (default 0; incremented by U6 processing-orphan sweeper, capped at 3 before transitioning to `expired`)**, **`last_event_at` (timestamp, indexed; updated on every canonical event insert; the processing-orphan sweeper queries `WHERE status='processing' AND last_event_at < now() - interval '30 min'`)**, timestamps, and nullable `completed_at`. Status enum includes `pending`, `claimed`, `processing`, `completed`, `failed`, `awaiting_review`, `awaiting_subrun`, `cancelled`, `expired`.
- Add `agent_workspace_events` with canonical metadata from origin R13 plus `bucket`, `object_etag`, `object_version_id`, `sequencer` (the S3 monotonic field used for idempotency_key derivation), `mirror_status` (`ok` | `failed` — set after S3 audit mirror write attempt), `reason`, `payload`, `actor_type`, `actor_id`, `parent_event_id`, and a unique idempotency key indexed on `(tenant_id, idempotency_key)`.
- Add `agent_workspace_waits` keyed by `waiting_run_id`, `wait_for_run_id`, `wait_for_target_path`, `status`, timestamps. Single `wait_for` per blocked event in v1 (no array shape — see Key Decisions on multi-child fan-out).
- **Schema work for per-tenant rollout:** `tenants.workspace_orchestration_enabled boolean default false` column added. The U1 migration includes this column because U3 needs the flag before the first canary wakeup gate.
- Keep event payload bodies out of DB except small routing metadata. Store object bodies in S3.
- Index for dispatcher hot paths: idempotency, pending events, `(tenant_id, agent_id, target_path, status)`, waiter lookup, and `(status, last_event_at)` for the processing-orphan sweeper.

**Patterns to follow:**
- `packages/database-pg/src/schema/heartbeats.ts` for wakeup request relations and status indexes.
- `packages/database-pg/src/schema/wiki.ts` for derived-store indexing and owner-scoped reads.

**Test scenarios:**
- Happy path: inserting a workspace run with status `pending` and one canonical event satisfies required columns and relations.
- Error path: duplicate idempotency key for the same tenant/source/event is rejected or no-ops according to the migration constraint.
- Edge case: same source key in two tenants is allowed because idempotency is tenant-scoped.
- Integration: GraphQL schema build includes new run/event types without breaking existing `ThreadTurn` and `AgentWakeupRequest` types.

**Verification:**
- Drizzle schema exports compile, generated SQL is reviewable, and schema tests prove uniqueness/index assumptions.

---

- U2. **Wire S3 event candidates to a dispatcher Lambda**

**Goal:** Configure S3 -> EventBridge -> Lambda routing for candidate eventful workspace prefixes.

**Requirements:** R1-R4, R8, R13-R14; supplemental R1, R6, R14.

**Dependencies:** U1.

**Files:**
- Create: `packages/api/src/handlers/workspace-event-dispatcher.ts`
- Create: `packages/api/src/__tests__/workspace-event-dispatcher-event-pattern.test.ts`
- Modify: `scripts/build-lambdas.sh`
- Modify: `terraform/modules/data/s3-buckets/main.tf`
- Modify: `terraform/modules/app/lambda-api/handlers.tf`
- Modify: `terraform/modules/app/lambda-api/main.tf`
- Modify: `terraform/modules/app/lambda-api/variables.tf` if new bucket/event variables are needed

**Approach:**
- Enable S3 EventBridge notifications on the primary workspace bucket.
- Add a `workspace-event-dispatcher` Lambda to the API handler set with common env plus `WORKSPACE_BUCKET`.
- Add **one EventBridge rule per eventful source prefix family** (`work/inbox/`, `work/runs/*/events/`, `work/outbox/`, `memory/`, `review/`, `errors/`, `events/intents/`) using the `wildcard` operator on `object.key` (e.g., `"key": [{ "wildcard": "tenants/*/agents/*/workspace/work/inbox/*.md" }]`). Per-rule cardinality is easier to reason about, costs the same, and lets each rule wire to a different SQS or DLQ later. The `review/` rule subscribes to BOTH `Object Created` and `Object Removed` event types (review-file deletion handling). `events/audit/` is explicitly NOT eventful; it is the dispatcher's derived mirror output, so observing it would create a self-trigger loop.
- **No EventBridge-level requester/metadata filtering** — `x-amz-meta-*` is not in the `detail` payload, and `detail.requester` is the AWS account ID (not the IAM principal/ARN) so it cannot distinguish importer Lambda from runtime Lambda. Suppression is the dispatcher's responsibility (see U3 HeadObject check). Optional v2: enable CloudTrail S3 data events to populate `detail.userIdentity.principalId`, then add EventBridge-level pre-filtering.
- **Route each EventBridge rule to a per-rule SQS queue, not directly to Lambda.** Provisioned-mode SQS event-source-mapping gives `MaximumConcurrency`, `ReportBatchItemFailures` + `bisect_batch_on_function_error`, and per-tenant sharding option later.
- **SQS-correct retry model**: queue's `redrive_policy.max_receive_count = 1` (one delivery attempt → DLQ on failure); ESM uses `function_response_types = ["ReportBatchItemFailures"]` so a single bad message doesn't fail the whole batch. Lambda's `MaximumRetryAttempts` does NOT apply to SQS event-source-mappings (it's an `aws_lambda_function_event_invoke_config` field, async-only).
- **SQS queues + DLQs use SSE-KMS** with the same KMS key as the workspace S3 bucket; resource policy on each DLQ limits `ReceiveMessage`/`DeleteMessage` to the ops/on-call IAM role + dispatcher Lambda role; message retention 14 days max.
- **Dispatcher Lambda IAM** scoped to: S3 `GetObject`+`HeadObject` on workspace bucket (read source + suppression-metadata check), S3 `PutObject` on `events/audit/*` ONLY (not on `work/*`, `review/*`, or other operator-facing prefixes), SQS receive/delete on inbox queues, SQS send on DLQs, DB access through existing `DATABASE_SECRET_ARN`.
- **Strands runtime write identity** (out of this unit's file list but specified here for the U2/U3 contract): scoped to `tenants/${tenantSlug}/agents/${agentSlug}/*` write only. Suppression uses user-defined object metadata (`x-amz-meta-thinkwork-suppress-event: true`) checked by dispatcher `HeadObject`; ordinary runtime/API writes MUST NOT be able to set it. Enforce this in the workspace-files API and orchestration writer by stripping/rejecting suppression metadata from runtime/Cognito callers; importer/template-sync/re-seeder service paths are the only allowed metadata setters. Do not rely on S3 object-tag IAM conditions for this metadata guard. If object-tag APIs are also available in a writer path, deny `s3:PutObjectTagging` for runtime roles as defense-in-depth.
- **Importer / template-sync / re-seeder IAM principals** scoped to their own tenant prefix (`tenants/${tenantSlug}/*`) so cross-tenant writes fail at IAM, not just at the dispatcher.
- Do not use native S3 notification prefix rules for the eventful paths; EventBridge wildcard rules plus per-rule SQS plus dispatcher validation are the layered model.

**Patterns to follow:**
- `terraform/modules/app/lambda-api/handlers.tf` handler registration and `handler_extra_env`.
- Existing EventBridge Scheduler IAM in `terraform/modules/app/lambda-api/main.tf` for policy style.
- `scripts/build-lambdas.sh` handler build registration.

**Test scenarios:**
- Happy path: an EventBridge object-created fixture for `.../workspace/work/inbox/request.md` is accepted as a candidate event and lands in the inbox SQS.
- Happy path: object-removed fixture for `.../workspace/review/run_xxx.needs-human.md` lands in the review SQS (subscribes to both Created and Removed).
- Edge case: an object-created fixture for `.../workspace/IDENTITY.md` matches no rule and is dropped at the bus.
- Edge case: wildcard/nested sub-agent key such as `.../workspace/support/escalation/work/inbox/request.md` routes to the inbox SQS.
- Edge case: a bulk-write object with `x-amz-meta-thinkwork-suppress-event: true` reaches the dispatcher (no EventBridge filtering for it) and is ignored at HeadObject check before wakeup creation; ignored telemetry is logged.
- Error path: malformed bucket/key event shape returns a non-throwing ignored result with a warning; SQS message moves to DLQ after the Lambda's first failure (`max_receive_count=1`).
- Error path: dispatcher returns `batchItemFailures` for one message in a batch; SQS leaves that message in queue for re-delivery (which triggers DLQ on `max_receive_count=1`); other messages in the batch are deleted.
- Security: runtime/API caller attempting to set `x-amz-meta-thinkwork-suppress-event: true` through workspace-files or `write-api.ts` is rejected/stripped and logged; importer/template-sync/re-seeder service callers can set it.
- No-loop: dispatcher-written `events/audit/YYYY-MM-DD/*.json` object matches no EventBridge rule and produces no canonical event, wakeup, or DLQ message.

**Verification:**
- Terraform plan includes S3 EventBridge enablement, per-source-prefix EventBridge rules (review with both Created+Removed, no `events/audit/` rule), per-rule SQS queues with `max_receive_count=1` redrive + DLQs with SSE-KMS + scoped resource policy + 14d retention, dispatcher Lambda with `function_response_types=["ReportBatchItemFailures"]` ESM, dispatcher IAM scoped to `events/audit/*` writes only, runtime/API suppression-metadata rejection, importer principals scoped per-tenant, and no route/API Gateway exposure.

---

- U3. **Implement canonicalization, validation, S3 mirror, and rejection handling**

**Goal:** Turn candidate S3 writes into trusted canonical events or auditable `event.rejected` records.

**Requirements:** R3-R8, R10, R13-R16; AE2-AE4, AE7; supplemental R4-R7, R10, R12, R14.

**Dependencies:** U1, U2.

**Files:**
- Create: `packages/api/src/lib/workspace-events/key-parser.ts`
- Create: `packages/api/src/lib/workspace-events/canonicalize.ts`
- Create: `packages/api/src/lib/workspace-events/s3-mirror.ts`
- Create: `packages/api/src/lib/workspace-events/authority.ts`
- Create: `packages/api/src/__tests__/workspace-event-key-parser.test.ts`
- Create: `packages/api/src/__tests__/workspace-event-canonicalize.test.ts`
- Create: `packages/api/src/__tests__/workspace-event-authority.test.ts`
- Modify: `packages/api/src/handlers/workspace-event-dispatcher.ts`

**Phase 1 prerequisite:** U10 (`workspace-target.ts`) must land before U3 — `authority.ts` calls into it for path validation. See Phased Delivery for sequence.

**Approach:**
- Parse bucket keys into `{tenantSlug, agentSlug, workspaceRelativePath, targetPath, eventfulKind, sequencer, etag, versionId}`. Account for the existing `workspace/` prefix in actual S3 keys (verified slug-based, not UUID).
- Resolve tenant/agent IDs from slugs and reject mismatches without leaking cross-tenant existence (treat as empty result, not 403, per `every-admin-mutation-requires-requiretenantadmin`).
- **HeadObject is the primary suppression check** (since EventBridge can't filter on `x-amz-meta-*` or distinguish IAM principals via `detail.requester`). Check `x-amz-meta-thinkwork-suppress-event: true` on every event; suppressed writes by an importer principal return ignored without wakeup (telemetry logged). **HeadObject 404 behavior**: object disappeared between EventBridge fire and dispatcher pickup. For non-`work.requested` events, drop with telemetry (the source is gone, nothing to canonicalize). For `work.requested`, write `event.rejected` with `reason: "source_object_disappeared"` — operator-visible audit that an inbox file was created and then deleted before processing. **Forgery audit**: if HeadObject finds the suppress-tag on an object whose principal (from CloudTrail data events when available, otherwise inferred from S3 prefix scope) is the runtime role, write `event.rejected` with `reason: "suppression_tag_by_runtime"` — never silently ignore a runtime-attempted forgery. (The runtime IAM role's explicit Deny on suppress-tag write per U2 means this should be impossible in steady state; the audit is defense-in-depth for IAM misconfiguration.)
- Validate event intent JSON for `work/runs/{runId}/events/*.json` and `events/intents/*.json`; content-as-event prefixes derive event type from path.
- Validate target path via the shared helper from **U10 (`workspace-target.ts`)** — pass parsed `AGENTS.md` routing table; helper returns `{valid, normalized_path, depth, reason}`. Reject with `event.rejected` carrying the `reason` if invalid.
- **Cross-agent runId ownership check (security-critical):** for events that reference an existing `runId` (`run.started`, `run.blocked`, `run.completed`, `run.failed`, lifecycle events under `runs/{runId}/events/`), look up `agent_workspace_runs.agent_id` and verify it matches the `agentSlug` derived from the writing object's S3 prefix. If they diverge, write `event.rejected` with `reason: "run_not_owned_by_actor"` and DO NOT enqueue a wakeup. Same DB transaction as the canonical event insert. This blocks the same-tenant cross-agent attack where agent A writes a `run.completed` intent referencing agent B's runId. Without this check, the dispatcher would canonicalize the intent and (if B was waiting on something) wake B with attacker-controlled context.
- **F2 race ordering rule:** for `work.requested` triggered by an inbox write that has a sibling `events/blocked.json` referencing it, the dispatcher canonicalizes the `run.blocked` waiter row FIRST in the same transaction, then the `work.requested` row. This eliminates the race where a fast sub-agent's `run.completed` arrives before the parent's blocked record exists. The structural enforcement comes from `wake_workspace` in U5 + workspace-files API rejection in U5 — the dispatcher's same-transaction canonicalization ordering is the secondary line for cases where both sibling events arrive in the same SQS batch (which the orchestration writer's two-write atomicity makes the common case).
- Compute `idempotency_key = sha256(canonical_object_key + sequencer)` and use `INSERT … ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`. **Every zero-row return MUST log the collision** with `[workspace-event-dispatcher] dedup_collision` — silent `ON CONFLICT DO NOTHING` swallowed real failures for 3 PRs in the past (`compile-continuation-dedupe-bucket`).
- Enforce depth and per-run inbox quota in the same transaction that creates the canonical event.
- Write S3 audit mirrors after the DB event row, with object keys recorded back to DB. If mirror write fails after DB insert, mark event `mirror_status='failed'` rather than losing operational truth; admin UI surfaces a divergence flag in the timeline.
- Insert `event.rejected` for invalid target, invalid schema, quota/depth breach, malformed JSON, unsafe paths, source-object-disappeared, suppression-tag-by-runtime, or run-not-owned-by-actor. For pre-runId rejections (e.g., `wake_chain_depth_exceeded` where no parent run exists), the rejected row carries `source_object_key` only — no `run_id`.

**Patterns to follow:**
- `packages/api/src/__tests__/identity-md-writer.test.ts` for S3 command mocking.
- `packages/api/src/__tests__/wiki-enqueue.test.ts` for async pipeline idempotency and branching tests.
- `packages/api/src/graphql/resolvers/core/resolve-auth-user.js` patterns for tenant non-leakage when adding any API-facing helpers later.

**Test scenarios:**
- Covers AE3. Happy path: valid `run.completed` intent writes a canonical event row and S3 audit mirror that preserves source object key.
- Covers AE4. Error path: unrelated root-agent inbox target is rejected with `event.rejected` and no wakeup row.
- Covers AE7. Error path: 11th inbox write for the same run rejects with `inbox_quota_exceeded`.
- Covers AE7. Error path: depth 5 wake chain rejects with `wake_chain_depth_exceeded`.
- Edge case: duplicate S3 delivery for the same object/event hits the idempotency constraint and does not enqueue duplicate wakeups; collision is logged.
- Edge case: out-of-order `run.completed` for an unknown run is rejected, not used to allocate a new run.
- Edge case: suppressed bulk writes are recorded as ignored telemetry and do not create canonical events or wakeups.
- **Edge case: out-of-order `work.requested` arriving before sibling `events/blocked.json`** — when both arrive in the same batch with the parent block listed second, dispatcher canonicalizes the parent block first per the F2 ordering rule; when they arrive in separate batches with `work.requested` first, the dispatcher allocates the run normally and the later-arriving `events/blocked.json` is canonicalized as a state transition (no separate orphan handling needed because parent's runId is already known to the dispatcher via the inbox file's content reference).
- Edge case: HeadObject 404 on a non-`work.requested` event → dropped with telemetry, no canonical event row.
- Edge case: HeadObject 404 on a `work.requested` event → `event.rejected` with `reason: "source_object_disappeared"`.
- Security: agent A writes `events/intents/run-completed.json` with `runId` belonging to agent B (same tenant); dispatcher rejects with `event.rejected reason: "run_not_owned_by_actor"`; no wakeup of agent B.
- Security: HeadObject finds suppress-tag on object written by runtime principal (simulating IAM misconfiguration); `event.rejected reason: "suppression_tag_by_runtime"` is recorded for audit instead of silently ignoring.
- Error path: S3 audit mirror write fails after DB insert; dispatcher records `mirror_status='failed'` on the row and does not re-run side effects on retry.

**Verification:**
- Replaying the same S3 event fixture multiple times produces exactly one canonical event and at most one wakeup.
- Cross-agent runId ownership check rejects all attempted forgeries from same-tenant siblings; same-agent legitimate writes pass.

---

- U4. **Bridge canonical events into the existing wakeup path**

**Goal:** Enqueue agent wakes from canonical workspace events through `agent_wakeup_requests` and extend `wakeup-processor` payload handling for workspace runs.

**Requirements:** R9-R12, R17; F1-F3; AE1, AE5, AE6.

**Dependencies:** U1, U3.

**Files:**
- Modify: `packages/api/src/handlers/workspace-event-dispatcher.ts`
- Modify: `packages/api/src/handlers/wakeup-processor.ts`
- Create: `packages/api/src/__tests__/workspace-event-to-wakeup.test.ts`
- Create: `packages/api/src/__tests__/wakeup-processor-workspace-event.test.ts`
- Modify: `packages/database-pg/graphql/types/heartbeats.graphql` if wakeup payload/status fields are surfaced

**Approach:**
- For `work.requested`, create `agent_workspace_runs` first, copy/link `work/inbox/*.md` to `work/runs/{runId}/request.md`, write `status.json`, then insert `agent_wakeup_requests` with `source: "workspace_event"`.
- For review edits, lifecycle events, and error events, look up an existing workspace run and enqueue wakeup for the same run id only when the state transition is valid.
- Add workspace orchestration metadata to wakeup payload: `workspaceRunId`, `workspaceTargetPath`, `workspaceSourceObjectKey`, `workspaceEventId`, `workspaceRequestObjectKey`, `causeEventId`, `causeType`, `depth`, and optional `workspaceResumeReason`. Per `apply-invocation-env-field-passthrough`: pass the payload object intact, don't rebuild a subset dict — silent field drops are how this surface fails.
- In `wakeup-processor`, recognize `source === "workspace_event"` and build the agent message from the request/review/event pointers rather than thread-oriented defaults.
- **Cold-start-per-wake is the v1 contract.** `wakeup-processor` invokes the AgentCore container via `@aws-sdk/client-lambda` `InvokeCommand` against the Lambda Web Adapter (verified: `agentcore` is `aws_lambda_function` `package_type=Image` with `PORT=8080`+`AWS_LWA_PORT=8080`, NOT a `BedrockAgentCoreClient` runtime ARN). There is no `runtimeSessionId` on this invoke surface; each wake boots a fresh container that reads `runs/{runId}/` to reconstitute. An earlier draft proposed warm-session resumption via `runtimeSessionId = workspaceRunId` — REMOVED because the cited mechanism doesn't apply to the wakeup-processor's invoke path. If HITL/sub-agent resume latency proves unacceptable in production, a follow-up plan can migrate `wakeup-processor` for `workspace_event` source from the Lambda Web Adapter path to direct `BedrockAgentCoreClient.InvokeAgentRuntimeCommand` (which DOES expose `runtimeSessionId` — used today by `packages/api/agentcore-invoke.ts` for the chat-path invoker). Non-trivial refactor; not v1.
- Pass `workspaceRunId`, `workspaceTargetPath`, `workspaceSourceObjectKey`, `workspaceEventId`, `workspaceRequestObjectKey`, `causeEventId`, `causeType`, `depth`, and optional `workspaceResumeReason` through to AgentCore payload. This is the contract that Strands tests must lock down.
- Preserve existing budget, skill, KB, sandbox, cost, push, and thread-turn behavior. Link `agent_workspace_runs.current_wakeup_request_id/current_thread_turn_id` after the wakeup processor claims and creates a `thread_turn`.

**Execution note:** Add characterization coverage around current `wakeup-processor` payload construction before changing it; this is the central invocation path.

**Patterns to follow:**
- `packages/api/src/handlers/wakeup-processor.ts` existing `chat_message`, `trigger`, and `thread_assignment` source branching.
- `docs/solutions/patterns/apply-invocation-env-field-passthrough-2026-04-24.md` passthrough testing pattern.

**Test scenarios:**
- Covers AE1. Happy path: inbox event creates workspace run, canonical event, wakeup row, and wakeup payload with target `.`.
- Covers AE5. Happy path: review edit for `run_abc123` enqueues a wakeup with the same `workspaceRunId`, not a new run.
- Covers AE6. Happy path: sync `delegate_to_workspace` remains unaffected; only workspace-event source creates workspace orchestration rows.
- Error path: wakeup processor receives `workspace_event` payload missing `workspaceRunId` -> marks wakeup failed with clear error.
- Integration: workspace-event wakeup still creates `thread_turns` and `thread_turn_events` so existing observability queries continue to show turns.

**Verification:**
- Existing wakeup processor tests continue to pass, and new workspace-event tests prove the bridge does not bypass central invocation behavior.

---

- U5. **Add runtime tools for writing work requests and event intents**

**Goal:** Let agents create addressed async work and lifecycle intents through safe tools instead of hand-writing arbitrary S3 paths.

**Requirements:** R5-R7, R9-R12, R15-R17; F2-F3; supplemental R3-R10.

**Dependencies:** U3, U4, **U10 (shared target-resolution helper)**.

**Files:**
- Create: `packages/agentcore-strands/agent-container/container-sources/wake_workspace_tool.py`
- Create: `packages/agentcore-strands/agent-container/test_wake_workspace_tool.py`
- Modify: `packages/agentcore-strands/agent-container/container-sources/server.py`
- Modify: `packages/agentcore-strands/agent-container/container-sources/_boot_assert.py`
- Modify: `packages/agentcore-strands/agent-container/Dockerfile`
- Modify: `packages/api/workspace-files.ts`
- Create: `packages/api/src/lib/workspace-events/write-api.ts`
- Create: `packages/api/src/__tests__/workspace-orchestration-write.test.ts`
- Modify: `packages/workspace-defaults/files/TOOLS.md`
- Modify: `packages/workspace-defaults/files/CAPABILITIES.md`

**Approach:**
- **Workspace-files API rejects PUT to protected orchestration prefixes — structural enforcement of F2 ordering and HITL conflict guarantees.** The existing `packages/api/workspace-files.ts` POST handler is modified to reject PUT operations whose key matches `work/inbox/`, `review/`, `work/runs/*/events/`, `events/intents/`, or `events/audit/` with HTTP 403 `error: "use orchestration writer"`. The same handler's presigned-URL branch denies minting URLs for those prefixes (otherwise admin SPA could mint a presigned PUT and bypass everything). Memory writes (`memory/*.md`) and ordinary workspace edits remain allowed via this API; protected orchestration prefixes go EXCLUSIVELY through `write-api.ts`.
- Add the `write-api.ts` orchestration writer — narrow surface that creates work requests under `work/inbox/`, lifecycle intents under `work/runs/{runId}/events/`, and review files under `review/`. The writer validates tenant/agent identity from scoped service auth or Cognito, never from agent-supplied tenant slug, then performs the S3 PUT(s). Service-auth MUST be scoped, not mere possession of `API_AUTH_SECRET`: use a short-lived signed workspace-write token or server-side wake context carrying tenantId, agentId, workspaceRunId, allowed target(s), audience, and expiry. The writer derives tenant/agent/run from that token/DB state, rejects caller-supplied identity, and tests cross-tenant + same-tenant cross-agent attempts.
- Add a Strands tool `wake_workspace(target, request_md, reason?, idempotency_key?, wait_for_result: bool = False)` that calls `write-api.ts` and returns the source object key. **Path validation goes through `workspace_target.py` from U10** — the helper extracted/reconciled from shipped `delegate_to_workspace`, so both tools enforce identical reserved-name and depth rules from day one.
- **F2 race ordering enforced atomically in `write-api.ts`**: when `wait_for_result=True`, the orchestration writer performs the parent's `events/blocked.json` PUT BEFORE the child's inbox PUT, both within a single REST call. Even if the runtime caller crashes between calls, the write order is the API's responsibility, not the tool's.
- Single `wait_for` per call in v1 — multi-child fan-out is the parent's responsibility (call `wake_workspace` N times sequentially, track in `runs/{runId}/status.json`). Each child completion produces one parent wake (N+1 total wakes for N children). Platform fan-in is explicitly out of scope (see Key Decisions).
- Add helper functions for `mark_run_blocked`, `mark_run_completed`, and `request_human_review` only if the single tool would be too ambiguous for model use. Prefer explicit tool names over asking models to author JSON correctly.
- Register tools at boot and add boot assertions so Dockerfile copy omissions fail loudly (per `dockerfile-explicit-copy-list-drops-new-tool-modules` — already a 4-occurrence pattern).
- **Snapshot env vars at coroutine entry** per `feedback_completion_callback_snapshot_pattern` (PR #563): `THINKWORK_API_URL` + `API_AUTH_SECRET` captured once when the tool is first invoked, never re-read from `os.environ` later.
- Update default workspace docs so agents know when to use shipped synchronous `delegate_to_workspace` versus asynchronous `wake_workspace` (this plan). Three coexisting primitives in v1: existing generic `delegate(task, context)` for short text-only specialist calls, shipped sync `delegate_to_workspace` for folder-addressed same-turn specialist calls, and async `wake_workspace` for durable/HITL/sub-agent work that can pause and resume.

**Patterns to follow:**
- `packages/agentcore-strands/agent-container/container-sources/write_memory_tool.py` for enum/path safety and API calls.
- `packages/agentcore-strands/agent-container/test_workspace_composer_fetch.py` for no-direct-S3 runtime invariants.
- `docs/solutions/build-errors/dockerfile-explicit-copy-list-drops-new-tool-modules-2026-04-22.md` for boot assertion expectations.

**Test scenarios:**
- Happy path: `wake_workspace(".", "...")` writes an inbox file for the root target using current tenant/agent env.
- Happy path: `wake_workspace("expenses", "...")` writes under `expenses/work/inbox/` when target is valid.
- Happy path: `wake_workspace("expenses", "...", wait_for_result=True)` performs `events/blocked.json` PUT first, then inbox PUT — verified by mocking the S3 client and asserting call order.
- Error path: path traversal or reserved target such as `memory` is rejected before API call.
- Error path: missing runtime env returns a clear tool error and performs no write.
- Integration: server boot logs/registers `wake_workspace`; `_boot_assert.py` fails if the module is missing from Docker build.
- **Security: workspace-files API rejection** — PUT to `work/inbox/foo.md`, `review/run_xxx.needs-human.md`, `work/runs/run_xxx/events/started.json`, `events/intents/x.json`, `events/audit/x.json` all return HTTP 403 with `error: "use orchestration writer"`. PUT to `memory/lessons.md` and `IDENTITY.md` remain allowed (existing memory and workspace-edit paths preserved); memory writes remain eventful and produce `memory.changed` through dispatcher canonicalization.
- **Security: presigned URL gating** — `POST /api/workspaces/files` with `action=presignPut, key="work/inbox/foo.md"` returns HTTP 403; same for the other protected orchestration prefixes. Presigned PUT for `memory/lessons.md` still succeeds (memory write path preserved).

**Verification:**
- Strands unit tests show agents cannot write arbitrary workspace paths through the orchestration tools.
- workspace-files API integration tests confirm protected orchestration prefixes are blocked at HTTP 403 for both direct PUT and presigned URL minting.
- write-api.ts integration test confirms `wait_for_result=True` two-write sequence is atomic from the dispatcher's point of view (parent block lands before child inbox in S3).

---

- U6. **Implement HITL and async sub-agent resume semantics**

**Goal:** Make blocked workspace runs resume from human review edits or awaited sub-agent completions using one contract.

**Requirements:** R4, R9-R14, R17; F2-F3; AE5.

**Dependencies:** U1, U3, U4, U5.

**Files:**
- Modify: `packages/api/src/lib/workspace-events/canonicalize.ts`
- Modify: `packages/api/src/handlers/workspace-event-dispatcher.ts`
- Create: `packages/api/src/lib/workspace-events/waiters.ts`
- Create: `packages/api/src/lib/workspace-events/sweepers.ts`
- Create: `packages/api/src/handlers/workspace-orphan-sweeper.ts` (cron handler — orphan-block + processing-orphan)
- Create: `packages/api/src/graphql/resolvers/agent-workspace-events/cancelReviewRequest.mutation.ts`
- Create: `packages/api/src/__tests__/workspace-event-hitl-resume.test.ts`
- Create: `packages/api/src/__tests__/workspace-event-subrun-resume.test.ts`
- Create: `packages/api/src/__tests__/workspace-orphan-sweeper.test.ts`
- Create: `packages/api/src/__tests__/cancel-review-request.test.ts`
- Modify: `packages/api/src/handlers/wakeup-processor.ts`
- Modify: `terraform/modules/app/lambda-api/handlers.tf` (add sweeper handler + EventBridge schedule)
- Modify: `scripts/build-lambdas.sh`

**Approach:**
- `run.blocked` with `reason: "review"` sets workspace run status `awaiting_review`, records the review file key + ETag, and does not enqueue another wake until the review file changes.
- `review/{runId}.needs-human.md` writes and edits are canonicalized differently: first write creates/records review requested; subsequent human edit wakes the existing run.
- **HITL ETag-conditional save** for the admin save mutation (U8): the admin UI passes `If-Match: <etag>` from the GET; mismatch surfaces a "review changed since you opened it" conflict to the operator without firing a wake. Single-source-of-truth concurrency at the storage layer.
- **Cancellation via `cancelReviewRequest` GraphQL mutation, NOT raw S3 DELETE.** Operators initiating cancel-review go through a tenant-checked, run-state-aware mutation that (a) verifies caller's tenant owns the runId, (b) verifies the run is in `awaiting_review` (not `processing` mid-resume — surfaces a "review is being processed, cannot cancel right now" error if so), (c) writes a `cancelled` state transition canonically, (d) deletes the underlying `review/{runId}.needs-human.md` from S3 with the suppress-tag header so the deletion event itself doesn't fire a redundant cancel canonical event. The mutation returns the new run status. Concurrent cancellations: the second operator's mutation finds the run already `cancelled` and returns idempotent success ("already cancelled by [first operator] at [time]"). The `s3:ObjectRemoved` event for `review/` prefix exists as a defensive backup (e.g., manual S3 console deletion) — when it fires for a run still in `awaiting_review`, the dispatcher transitions to `cancelled` with `reason: "review_deleted_directly"` and surfaces an audit log entry flagging the bypass; runs already in terminal states ignore the event with telemetry.
- **Stale review-file GC**: when a run terminates (completed/failed/cancelled), the dispatcher synchronously deletes any lingering `review/{runId}.needs-human.md` (with suppression metadata) so a future edit cannot re-wake a completed run.
- `run.blocked` with `reason: "subrun"` writes a waiter row that points from parent run to child target/run once the child run is known. **Per the F2-ordering rule established in U3**, the parent's blocked record exists before the child inbox file lands, so child completions never race the waiter creation.
- **Sub-agent failure propagation**: when a child run transitions to `failed`, the dispatcher checks waiters and wakes the parent at the parent's `runId` with `causeType: "subrun_failed"` and the child's failure context in the wakeup payload. Parent decides how to handle (per the "agents decide" key decision); platform does not auto-fail the parent.
- **Single `wait_for` per blocked event**: the schema column is a single nullable `wait_for_run_id`; multi-child coordination is the parent's responsibility in `runs/{parentRunId}/status.json`.
- **Orphan sweepers** (cron, runs every 15 minutes via EventBridge schedule):
  - **Block sweeper**: transitions `awaiting_subrun` rows older than 7 days and `awaiting_review` rows older than 30 days (defaults — recorded as platform constants, not per-tenant tunable in v1) to terminal `expired` with `run.failed reason: "block_expired"`.
  - **Processing-orphan sweeper**: transitions `processing` rows with no `agent_workspace_events` activity for >30 minutes (default; configurable per-stage via Terraform variable). For each orphan, increment `agent_workspace_runs.wakeup_retry_count` and re-enqueue the wakeup if `retry_count < 3` (default cap); after the cap, transition to `expired` with `reason: "processing_orphan"`. This handles AgentCore microVM eviction (15-min idle, 8h hard cap) where the runtime crashed mid-turn after writing partial state — without it, runs sit in `processing` forever.
  - The `wakeup_retry_count` column lives on `agent_workspace_runs` (small schema addition to U1 — defaults 0; the sweeper increments and reads).
- `run.completed` checks waiters in the same transaction and enqueues parent wakeups for satisfied waits.
- **Idempotent resume**: if a wake against an `awaiting_review` runId arrives while the run is already `processing` (e.g., human saves twice in quick succession), the second wake is recorded as a canonical event but does not enqueue a duplicate `agent_wakeup_requests` row — the in-flight turn is allowed to finish, then the next turn starts with the latest review state.
- Preserve parent/child audit trails in their own run folders and link through DB metadata and canonical event payloads.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/threads/delegateThread.mutation.ts` for safe same-tenant delegation/wakeup insertion.
- Existing `threadDependencies` flow for blocked/unblocked mental model, without reusing thread dependencies directly for workspace runs.

**Test scenarios:**
- Covers AE5. HITL: blocked run + human review edit -> same workspace run transitions to processing and enqueues one wakeup.
- Happy path: sub-agent completion wakes exactly one waiting parent and marks waiter satisfied.
- Happy path: multi-child fan-out — parent issues 3 `wake_workspace` calls; each child completion produces one parent wake; parent re-blocks on next pending child or terminates if all done. Verify N+1=4 total parent wakes.
- Happy path: `cancelReviewRequest` mutation transitions `awaiting_review` to `cancelled` and deletes the review file with suppress-tag.
- Happy path: processing-orphan sweeper picks up a `processing` run with stale `last_event_at`, increments `wakeup_retry_count`, re-enqueues wakeup; after 3 retries, transitions to `expired` with `reason: "processing_orphan"`.
- Edge case: review file edit for already completed run is ignored or rejected without wakeup.
- Edge case: duplicate sub-agent completion event does not enqueue duplicate parent wakeups.
- Edge case: idempotent resume — second `awaiting_review` wake while already `processing` records the canonical event but enqueues no duplicate wakeup row.
- Edge case: concurrent `cancelReviewRequest` — second mutation finds run already `cancelled` and returns idempotent success with first-operator attribution.
- Edge case: `cancelReviewRequest` for run in `processing` (already resumed before operator clicked Cancel) returns "review is being processed, cannot cancel" error; operator can wait and retry or contact agent author.
- Edge case: raw `s3:ObjectRemoved` for `review/{runId}.needs-human.md` of `awaiting_review` run → cancellation via direct-deletion path with audit log; for already-terminal run → ignored with telemetry.
- Edge case: sub-agent failure (`run.failed`) wakes parent at parent's runId with `causeType: "subrun_failed"`; parent decides next action.
- Error path: blocked event references a wait target that violates AGENTS.md authority -> `event.rejected`.
- Error path: orphan sweeper claims a `processing` row, finds wakeup_retry_count already at cap, transitions to `expired` without enqueuing a wakeup.

**Verification:**
- Both HITL and sub-agent waits use the same run-resume fields in `agent_workspace_runs` and wakeup payloads.
- Block-sweeper + processing-orphan-sweeper runs produce the expected terminal states for their respective stuck-row classes.
- `cancelReviewRequest` mutation cannot be called cross-tenant (tenant-check before any S3 or DB write).

---

- U7. **Move scheduler and memory producers onto the file-event substrate**

**Goal:** Convert two existing producers to prove the primitive composes with platform systems: scheduled agent jobs and memory/wiki pipeline.

**Requirements:** R18-R19, R4, R11; F4.

**Dependencies:** U3, U4.

**Files:**
- Modify: `packages/lambda/job-trigger.ts`
- Create: `packages/lambda/__tests__/job-trigger-workspace-inbox.test.ts` or colocated package test matching current conventions
- Modify: `packages/api/src/handlers/memory-retain.ts`
- Modify: `packages/api/src/lib/wiki/enqueue.ts`
- Modify: `packages/api/src/handlers/wiki-compile.ts` (becomes a `memory.changed` canonical-event subscriber)
- Modify: `packages/api/src/handlers/workspace-event-dispatcher.ts` only if U7 needs additional producer-specific attribution; the per-tenant wakeup gate itself is already introduced in U1/U3 via `tenants.workspace_orchestration_enabled`.
- Create: `packages/api/src/__tests__/memory-retain-workspace-event.test.ts`
- Create: `packages/api/src/__tests__/wiki-enqueue-workspace-event.test.ts`
- Create: `packages/api/src/__tests__/wiki-compile-event-subscriber.test.ts`

**Approach:**
- For agent scheduled jobs, write a `work/inbox/*.md` request object and let the dispatcher allocate the workspace run and wakeup. **Per the existing precedent in `job-trigger.ts`** (`agent_*` triggerType already inserts `agent_wakeup_requests` rows for `wakeup-processor` to pick up — direct AgentCore invoke is NOT used today), the migration is even smaller than originally framed: replace the `agent_wakeup_requests` insert with an S3 PutObject to the agent's inbox prefix; the dispatcher handles the wakeup creation downstream. Pre-migration audit: confirm no production tenants have already scheduled `agent_*` triggers (likely none per existing memory note).
- Preserve thread creation in `job-trigger.ts` if it is still needed for user-visible schedule history. Per `survey-before-applying-parent-plan-destructive-work`: survey `wakeup-processor` for code paths still depending on `agent_wakeup_requests` rows produced by the scheduler before retiring that branch.
- Carry scheduler actor attribution into the request frontmatter or companion metadata so the dispatcher sets `requested_by_actor_type/id` on the wakeup.
- **Per-tenant rollout uses the U1 schema flag `tenants.workspace_orchestration_enabled`.** Default `false` in v1; flipped per-tenant after canary smoke. Dispatcher reads this flag and SKIPS wakeup-enqueue for tenants where it's false (canonical event still records for observability — operators can see what would have fired). The Terraform variable `enable_workspace_orchestration` at the module level controls whether the EventBridge rules + SQS infrastructure exist at all (defaults `false` in v1, flipped at stage level once Phase 2 ships).
- **Memory pipeline same-PR cutover (no per-tenant flag).** Earlier draft proposed `memory_use_event_subscriber` per-tenant flag for dual-path rollout; REMOVED because (a) the brainstorm called this "a wiring change, not a rewrite," (b) `wiki_compile_jobs` table already has owner-scoped dedup that handles the transient overlap window, (c) at 4-tenant scale a long-lived dual-path adds complexity without proportionate safety benefit. Cutover sequence in a single PR: (1) `wiki-compile.ts` modified to subscribe to `memory.changed` canonical events (via SQS or direct dispatcher invoke), (2) `memory-retain.ts` modified to write the `memory/*.md` file and STOP calling `maybeEnqueuePostTurnCompile` directly, (3) `wiki/enqueue.ts` `maybeEnqueuePostTurnCompile` becomes a no-op (kept as a safety stub for one release in case rollback is needed; removed in a follow-up). The transient overlap (between deploy of new `wiki-compile` subscriber side and `memory-retain` removing direct invoke) is bounded by `wiki_compile_jobs` idempotent INSERT; double-fires are dedup'd.
- Pre-cutover survey per `survey-before-applying-parent-plan-destructive-work`: confirm no other code paths invoke `maybeEnqueuePostTurnCompile` or `wiki-compile` Lambda directly before retiring the call.
- For workspace `memory/*.md` changes from sources OTHER than `memory-retain` (e.g., agent direct write, future bulk import), the `memory.changed` event is the only path; the dispatcher → `wiki-compile` subscription handles them uniformly.
- The invariant is canonical event first, downstream processing second.

**Patterns to follow:**
- `packages/lambda/job-trigger.ts` existing thread + wakeup creation branch.
- `packages/api/src/lib/wiki/enqueue.ts` existing job dedupe tests.
- `docs/solutions/logic-errors/compile-continuation-dedupe-bucket-2026-04-20.md` warning about hidden dedupe failures.

**Test scenarios:**
- Happy path: scheduled agent job writes exactly one inbox object and does not directly insert a duplicate agent wakeup.
- Error path: S3 write failure in `job-trigger` is logged and surfaces as job failure rather than silently dropping scheduled work.
- Happy path: `memory.changed` canonical event enqueues compile once for a tenant/agent owner.
- Edge case: chat turn retain and memory file change in the same interval do not double-enqueue compile jobs beyond dedupe policy.
- Integration: existing scheduled skill/eval branches remain unchanged.

**Verification:**
- Existing job-trigger tests for non-agent branches still pass; new agent schedule tests prove the inbox path is the only agent wake path.

---

- U8. **Expose workspace runs, events, errors, and HITL review in GraphQL and admin**

**Goal:** Give operators the inspectable audit surface promised by the requirements without building a full orchestration console.

**Requirements:** R12-R14; AE1, AE3, AE5; supplemental R12-R14.

**Dependencies:** U1, U3, U6.

**Files:**
- Create: `packages/database-pg/graphql/types/agent-workspace-events.graphql`
- Create: `packages/api/src/graphql/resolvers/agent-workspace-events/index.ts`
- Create: `packages/api/src/graphql/resolvers/agent-workspace-events/workspaceRuns.query.ts`
- Create: `packages/api/src/graphql/resolvers/agent-workspace-events/workspaceEvents.query.ts`
- Create: `packages/api/src/graphql/resolvers/agent-workspace-events/awaitingReviewBacklog.query.ts`
- Create: `packages/api/src/graphql/resolvers/agent-workspace-events/createWorkspaceWorkRequest.mutation.ts`
- Create: `packages/api/src/graphql/resolvers/agent-workspace-events/saveReviewFile.mutation.ts`
- (cancelReviewRequest mutation file is created in U6 — referenced here for the UI binding)
- Modify: `packages/api/src/graphql/resolvers/index.ts`
- Create: `packages/api/src/__tests__/agent-workspace-events-resolvers.test.ts`
- Create: `apps/admin/src/routes/_authed/_tenant/analytics/agent-runs/index.tsx`
- Create: `apps/admin/src/routes/_authed/_tenant/analytics/agent-runs/$runId.tsx`
- Create: `apps/admin/src/routes/_authed/_tenant/review/index.tsx`
- Create: `apps/admin/src/routes/_authed/_tenant/review/$runId.tsx`
- Modify: `apps/admin/src/lib/graphql-queries.ts` or route-local GraphQL documents
- Modify: `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.workspace.tsx` (add "View runs →" link/tab to the agent-runs index pre-filtered to this agent)
- Modify: `apps/admin/src/components/layout/Sidebar.tsx` (add "Review backlog" nav item with awaiting-review badge count)
- Create: `apps/admin/src/components/agents/WorkspaceRunTimeline.tsx`
- Create: `apps/admin/src/components/agents/WorkspaceReviewEditor.tsx`
- Create: `apps/admin/src/components/agents/RunStateBanner.tsx` (state-differentiated banners: awaiting_review, awaiting_subrun, expired, cancelled, mirror-divergence)
- Create: `apps/admin/src/__tests__/workspace-run-timeline.test.tsx`
- Create: `apps/admin/src/__tests__/workspace-review-editor.test.tsx`
- Create: `apps/admin/src/__tests__/awaiting-review-backlog.test.tsx`

**Approach:**

*GraphQL surface*

- Add tenant-scoped queries for workspace runs/events by `agentId`, `targetPath`, `status`, and `runId`. Use `resolveCallerTenantId(ctx)` per the OAuth-tenantId-resolver memory feedback (Google-federated users have null `ctx.auth.tenantId` until the pre-token trigger ships). Cross-tenant lookups return empty (non-leakage) per `resolve-auth-user.js` precedent.
- All run/review GraphQL reads and mutations are tenant-admin/operator surfaces: call `requireTenantAdmin(ctx, tenantId)` (or a future named review-operator permission) before returning run/review bodies or performing side effects. Derive operator identity from `ctx.auth`, not from authority-bearing arguments.
- `awaitingReviewBacklog` query returns the count + list of `awaiting_review` runs across all agents the operator can access (for the sidebar badge and the `_tenant/review/` index). V1 ownership model is a tenant-admin queue, not assignment/claiming: any tenant admin can open a review; ETag conflict handling prevents silent overwrite. The only v1 notification surface is the sidebar badge/polling plus run status; assignable review ownership and external notifications are follow-up work.
- `createWorkspaceWorkRequest` mutation: minimal operator inbox initiation, not a full orchestration console. Accepts `agentId`, optional `targetPath`, and markdown body; gates with tenant-admin/operator permission; validates `targetPath` through U10; writes the inbox object through the orchestration writer; returns the new source object key and, once U4 is live, the workspace run id. This preserves the article-native "drop a request file and inspect results later" workflow without exposing arbitrary event-intent authoring.
- `saveReviewFile` mutation: accepts `runId`, `etag` (`If-Match`), `body`, optional `force: bool`. Steps: (1) `resolveCallerTenantId(ctx)`; (2) `requireTenantAdmin(ctx, callerTenantId)` or named review-operator permission; (3) `SELECT agent_workspace_runs WHERE id=$runId AND tenant_id=$callerTenantId` — return `NOT_FOUND` on mismatch (non-leakage; this is the run-ownership cross-check); (4) verify run status is `awaiting_review` — error if not (operator's view is stale); (5) S3 PUT with `If-Match: $etag` unless `force=true`; (6) on `If-Match` mismatch, return `REVIEW_CONFLICT` GraphQL error with current ETag + body. Mutation never bypasses ETag without explicit `force=true`.
- `cancelReviewRequest` mutation (file in U6): tenant-admin/operator gated; transitions `awaiting_review` -> `cancelled`; idempotent on second call (returns first-canceller attribution).

*Admin UI*

- **Run/audit viewer at `/analytics/agent-runs/`** — tenant-wide index mirroring `analytics/skill-runs/` convention (urql + DataTable + status-filter chips). Default sort: `Started DESC`. Default filter: `Status: in (processing, awaiting_review, awaiting_subrun)` so operators see live work. Agent filter chip allows pinning to one agent. From `agents/$agentId_.workspace.tsx`, add "View runs →" link/tab in breadcrumb pre-filtered to that agent.
- **Folder-tree live status badges** — the existing fat-folder workspace route remains the folder-native entry point. Add lightweight rollups per folder node (active count + highest-severity state precedence: failed/expired > awaiting_review > awaiting_subrun > processing/claimed > pending > completed). Clicking a badge opens `/analytics/agent-runs/` pre-filtered by agent + targetPath. Polling cadence follows the run index (30s) unless AppSync subscriptions are already available for this surface. This is status visibility, not an orchestration console.
- **Run-detail page at `/analytics/agent-runs/$runId`** — `WorkspaceRunTimeline` component shows event-by-event timeline with state-differentiated rendering (`RunStateBanner` per state):
  - `awaiting_review`: review editor (see below) + "Waiting since N hours/days" label + `Cancel review` button (calls `cancelReviewRequest` mutation)
  - `awaiting_subrun`: shows the awaited child agent slug + child runId + child's current status (queryable inline since it's a sibling row); "Waiting since N hours". No `Cancel wait` control in v1 — voluntary waiter cancellation would be an orchestration control with separate parent/child semantics and needs its own follow-up mutation/contract.
  - `expired`: terminal banner "Platform timed this out after N days" — visually distinct from `failed`
  - `cancelled`: terminal banner "Cancelled by [operator name] at [time]"
  - `failed` with `mirror_status='failed'`: divergence indicator inline; "S3 audit mirror missing — DB event below" + link to ops runbook
  - All states: "Last event N min ago" stale-data indicator using canonical event timestamp
  - **causeEventId chain inline rendering**: timeline rows for resume wakes (woken by review edit, sub-agent completion, sweeper retry, etc.) render the causal predecessor inline as an expandable row showing event type + source runId/target — NOT a click-through to a separate event detail page. Operator sees the wake chain at a glance.
- **HITL backlog at `/review/`** — tenant-wide list of `awaiting_review` runs across operator-accessible agents:
  - Nav entry: "Review backlog" sidebar item with badge count of awaiting-review runs (live-updating via urql polling, 30s interval)
  - Index columns: `Agent` (slug), `Run started` (relative time), `Waiting since` (relative time, sortable), `Source` (origin agent for sub-agent escalations, "human" for human-initiated, "schedule" for scheduler-initiated), `Status`
  - Default sort: `Waiting since DESC` (oldest waiting first)
  - Post-save behavior: redirect to backlog index with success toast; the row auto-removes from awaiting-review list once status flips to `processing`
  - Cancel-review affordance: explicit button in row + detail view that calls `cancelReviewRequest` mutation (NOT raw S3 DELETE)
- **`WorkspaceReviewEditor` component**: explicit `Save` button (NO auto-save); save mutation only fires on button click; ETag-conditional PUT only on button press. If review file has frontmatter schema (e.g., a `--- response_required: true ---` block), validate frontmatter intact before allowing save (otherwise corrupt review goes to S3 and triggers wake with broken context).
- **ETag conflict UX**: when `saveReviewFile` returns `REVIEW_CONFLICT`, render an **inline banner above the editor** (NOT toast — operator's draft must stay visible). Banner copy: "This review changed since you opened it. [Reload latest] [Keep editing]". `Reload latest` replaces editor content with server version, clears conflict, holds operator's draft in component state for one undo. `Keep editing` dismisses banner; next save re-fires conflict if upstream still ahead. Force-overwrite (`force=true`) is gated behind a confirmation dialog: "You're about to overwrite changes from [other operator/timestamp]. Continue?"
- The UI reads source/review/result bodies from S3 through existing workspace file APIs (NOT through new orchestration writer — that's write-only); DB rows for status/timeline.
- Run-detail body hierarchy by state: show a status banner and timeline first, then primary body (`review` while `awaiting_review`, `result/outbox` when terminal, `request/source` for pending/processing), then secondary tabs for request, review response, result/outbox, transcript, `status.json`, and event payloads. Large bodies truncate with "open full file"; missing/deleted/malformed/S3-error bodies render inline non-destructive states with retry.
- Accessibility/responsive requirements: run table, filter chips, timeline expansion, conflict banner, force-overwrite dialog, cancel actions, review editor, sidebar badge, and folder-tree badges must support keyboard navigation, focus restoration after dialogs, screen-reader labels for status badges, touch targets at narrow widths, and non-overlapping responsive layouts.
- Keep authoring minimal: edit review files, inspect run folders, no arbitrary event-intent editor.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/triggers/threadTurns.query.ts` and `threadTurnEvents.query.ts` for run/event query shape.
- `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.workspace.tsx` existing tree and CodeMirror editing pattern.
- `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md` for mutation gating.

**Test scenarios:**
- Happy path: admin queries runs for one agent and receives only that tenant's rows.
- Error path: cross-tenant `agentId` returns not found/empty, not foreign data (non-leakage).
- **Security: cross-tenant `saveReviewFile`** — caller tenant A supplies runId belonging to tenant B; mutation returns `NOT_FOUND` (not `FORBIDDEN`); no S3 write attempted.
- **Security: non-admin tenant member** attempting `workspaceRuns`, `workspaceEvents`, `awaitingReviewBacklog`, `createWorkspaceWorkRequest`, `saveReviewFile`, force-overwrite, or `cancelReviewRequest` is denied before any S3 read/write or DB transition.
- Happy path: tenant admin creates a workspace work request from the admin UI; mutation writes through orchestration writer and does not allow arbitrary event-intent authoring.
- Happy path: saving a review file writes the S3 object via `If-Match` ETag; dispatcher later resumes via event; mutation itself does not directly invoke AgentCore.
- Concurrency: two operators save the same review file with stale ETag → second save returns `REVIEW_CONFLICT` with current ETag + body; operator sees inline banner + Reload-latest option.
- Concurrency: operator clicks `force=true` after confirmation → save bypasses ETag check; previous operator's edit is overwritten; canonical wake fires once on the latest content.
- Happy path: `cancelReviewRequest` transitions run to `cancelled`; index list updates; no wake fires.
- UI happy path: HITL backlog shows the operator's awaiting-review runs sorted by waiting-since DESC; sidebar badge count matches list length.
- UI happy path: fat-folder tree shows active/awaiting/failed rollups by target path; badge click opens the run index pre-filtered to that folder.
- UI happy path: agent-runs index defaults to live runs (processing + awaiting_*); status filter chips toggle terminal states; agent filter chip pins to one agent.
- UI happy path: blocked run renders a review editor with "Waiting since N hours" + Cancel-review button.
- UI happy path: `awaiting_subrun` run shows awaited child + child's current status inline.
- UI happy path: completed run renders result + causeEventId-chain expandable timeline rows.
- UI happy path: `expired` and `cancelled` terminal banners are visually distinct from `failed`.
- UI edge case: S3 audit mirror missing but DB event exists → timeline shows DB event with mirror-divergence indicator + ops-runbook link.
- UI edge case: review file has malformed frontmatter; editor save button is disabled with explanation; operator must fix frontmatter before saving.
- UI a11y/responsive: keyboard-only operator can filter runs, expand timeline rows, open/save review, handle a conflict dialog, and return focus to the triggering control; narrow viewport layout does not overlap table/filter/editor controls.

**Verification:**
- Admin can answer "why did this agent wake up?" from the run timeline alone — causeEventId chain rendering inline (NOT click-through-only) lets the operator trace the wake source in ≤1 view.
- HITL backlog operator workflow: open sidebar → click "Review backlog" → triage oldest-first → save or cancel → next item — no per-agent navigation required.

---

- U9. **Document and evaluate the sync/async folder primitives**

**Goal:** Make the primitive legible to agents, operators, and future implementers now that folder-addressed sync delegation (`delegate_to_workspace`) exists and this plan adds durable async orchestration (`wake_workspace`).

**Requirements:** R17 plus all success criteria.

**Dependencies:** U5, U8, U10.

**Files:**
- Modify: `packages/workspace-defaults/files/AGENTS.md`
- Modify: `packages/workspace-defaults/files/TOOLS.md`
- Modify: `packages/workspace-defaults/files/CAPABILITIES.md`
- Create: `docs/src/content/docs/concepts/agent-orchestration.mdx`
- Modify: `docs/src/content/docs/concepts/agents.mdx`
- Create: `packages/agent-tools/eval/datasets/workspace-orchestration.yaml`

**Approach:**
- Document `wake_workspace` use cases: long-running specialists, HITL pause/resume, operator-created work requests, scheduler-converted requests.
- Document eventful folder prefixes, mostly append-only run folders, and the "files plus canonical events are state" rule.
- Document the **three-primitive landscape** explicitly: (1) generic `delegate(task, context)` (existing, no folder targeting) — for short text-only specialist calls within a turn; (2) sync `delegate_to_workspace(target, task)` (shipped in plan 008 U9) — for folder-addressed same-turn specialist calls; (3) async `wake_workspace(target, request_md, ...)` (this plan) — for long-running/HITL/sub-agent work that can pause and resume across turns. The discrimination is: need result *this turn* -> `delegate` or `delegate_to_workspace`; can suspend and resume -> `wake_workspace`.
- **Frame v1 explicitly as "files-and-events, not journal-replay"** in the design rationale: the durable-execution landscape (Temporal, Restate, DBOS, Inngest, LangGraph) splits between journal/replay and DB checkpointing, both of which assume the engine owns state. ThinkWork's primitive uses the filesystem as the durable substrate, exactly because LLM tool-call sequences are non-deterministic and journal-replay can't reproduce them — the durability shape we need is "wake from disk and continue," which is what R11 codifies. Stating this upfront preempts the inevitable "why aren't we using Temporal?" question and makes the trade-offs (no automatic retries, no DAG semantics) a deliberate boundary rather than an oversight.
- Add eval cases for choosing `wake_workspace` for long-running/HITL work, choosing `delegate_to_workspace` for same-turn folder specialist work, refusing unrelated peer writes, preserving stateless resume semantics, and the multi-child fan-out pattern (worked example: parent uses `status.json` to track 3 children; each child completion produces one parent wake).
- Keep docs aligned with the primitive-first scope and explicitly call out non-goals (no DAG, no platform fan-in, no in-runtime sleep).
- Surface the workspace-native-orchestration identity bet from Open Questions in the docs now that both sync and async folder primitives are present.

**Test scenarios:**
- Happy path eval: model chooses `wake_workspace` for "ask expenses to audit this over the next hour and resume me."
- Happy path eval: model chooses `delegate_to_workspace` for "ask expenses to inspect this receipt and answer in this turn."
- Happy path eval: model chooses human review file for an approval request.
- Error path eval: model refuses to write work to an unrelated root agent.
- Regression eval: model does not claim it can sleep in runtime; it describes file-based resume.
- Eval: model uses `status.json` correctly to coordinate multi-child fan-out (sets up status.json with 3 pending child runIds; understands that each child completion will wake parent and parent re-blocks on next pending child).

**Patterns to follow:**
- Existing `packages/agent-tools/eval/datasets/workspace-routing.yaml` and `workspace-memory.yaml`.
- The `/docs/agent-design/` section from the fat-folder requirements if available in the docs branch.

**Verification:**
- Docs and evals encode the same mental model as the implementation and origin requirements; no doc references `delegate_to_workspace` as future or optional.

---

- U10. **Shared workspace target-resolution helper (TS + Python parity)**

**Goal:** Extract/reconcile one canonical "is this a valid workspace target path" helper used by both `wake_workspace` (this plan) and shipped `delegate_to_workspace`, so both tools enforce identical path safety, reserved-folder rejection, route authority, and depth-cap rules.

**Requirements:** R3, R7, R9, R15, R25 (fat-folder reserved names); supplemental R3, R10.

**Dependencies:** None — must land in Phase 1 ahead of U3 (which calls it for authority validation) and U5 (which calls it for tool input validation).

**Files:**
- Create: `packages/api/src/lib/workspace-target.ts`
- Create: `packages/api/src/__tests__/workspace-target.test.ts`
- Create: `packages/agentcore-strands/agent-container/container-sources/workspace_target.py`
- Create: `packages/agentcore-strands/agent-container/test_workspace_target.py`
- Modify: `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py` (replace local `validate_path` logic with `workspace_target.py` helper while preserving the public tool contract)
- Modify: `packages/agentcore-strands/agent-container/test_delegate_to_workspace_tool.py` (keep existing depth/reserved/path tests passing against the shared helper)
- Modify: `packages/agentcore-strands/agent-container/Dockerfile` (add the new module to the explicit COPY list per `dockerfile-explicit-copy-list-drops-new-tool-modules` learning)
- Modify: `packages/agentcore-strands/agent-container/container-sources/_boot_assert.py` (assert the module is importable at boot)

**Approach:**
- Single function signature in both languages: `parse_target(input: str, agents_md_routes: list[str]) -> {valid: bool, normalized_path: str, depth: int, reason: str | None}`.
- Validation rules (must match across TS and Python byte-for-byte semantically):
  1. `.` resolves to root (depth 0).
  2. Single-segment slug must be in the agent's composed `AGENTS.md` routing-table targets.
  3. Multi-segment path (e.g., `support/escalation`) must be a chain of valid `Go to` targets walking down the routing tree.
  4. Reject `..`, leading `/`, `\`, query-string-y characters, anything not matching `^[a-z0-9][a-z0-9-]{0,63}(/[a-z0-9][a-z0-9-]{0,63})*$`.
  5. Reject `memory`, `skills` at any depth (reserved per fat-folder R25).
  6. Reject if normalized folder depth exceeds platform cap (hard cap 5; warn at 4 for sync delegation). This matches the completed fat-folder plan and current `delegate_to_workspace` tests: depth 5 succeeds, depth 6 rejects. Wake-chain depth/quota remains a separate dispatcher/run constraint.
- The helper is pure; it does NOT fetch S3 or DB — caller passes the parsed routing table.
- TS impl is the source of truth; Python impl includes a `parity_test_cases` constant mirroring the TS test fixtures so any divergence fails CI on both sides.

**Patterns to follow:**
- `packages/api/src/lib/workspace-events/authority.ts` (created in U3) calls into this helper rather than re-implementing.
- `packages/agentcore-strands/agent-container/container-sources/write_memory_tool.py` for the path-safety + tests pattern in Python.
- `feedback_lambda_zip_build_entry_required` for the new-Python-module discipline (Dockerfile + boot assertion).

**Test scenarios:**
- Happy path: `parse_target(".", routes)` returns `{valid: true, normalized_path: "", depth: 0}` for any routes.
- Happy path: `parse_target("expenses", ["expenses", "recruiting"])` returns `{valid: true, normalized_path: "expenses", depth: 1}`.
- Happy path: `parse_target("support/escalation", routes_with_chain)` resolves the chain and returns depth 2.
- Edge case: leading slash, trailing slash, double slash all rejected with explicit `reason`.
- Edge case: case-mismatched slug (e.g. `Expenses` when route is `expenses`) rejected — slugs are case-sensitive to match S3 prefix discipline.
- Error path: `..` traversal rejected with `reason: "traversal"`.
- Error path: target `memory` rejected with `reason: "reserved_name"`; same for `skills` at any depth.
- Happy path: `parse_target("a/b/c/d/e", routes)` with chain depth 5 succeeds.
- Error path: `parse_target("a/b/c/d/e/f", routes)` with chain depth 6 rejects with `reason: "depth_exceeded"`.
- Error path: target slug not in `agents_md_routes` rejected with `reason: "not_routable"`.
- Integration (parity): `for case in parity_test_cases: assert ts_result == py_result` runs in both vitest and pytest; CI fails if any divergence.
- Integration: `_boot_assert.py` in the container fails to start if `workspace_target.py` is missing from the Docker image.

**Verification:**
- Both `wake_workspace` (U5) and shipped `delegate_to_workspace` call into the same helper without re-implementing path validation; CI parity test passes for ≥20 cases and the existing `delegate_to_workspace` depth/reserved-name tests continue to pass.

---

> *U11 (post-deploy smoke gate as a CI step) was scoped during deepening and removed during document review. Reasoning: introduces canary-tenant data model + sentinel Lambda + deploy-blocking CI gate with no documented bypass — net-new operational infrastructure with no prior art in this repo, not aligned with "ship the primitive" scope. The underlying silent-multi-component-failure risk is mitigated in v1 by per-stage CloudWatch alerts (visible after deploy without blocking it; see Documentation/Operational Notes). A standalone follow-up plan can introduce the smoke gate with proper bypass design once the rollout has produced concrete data on which silent-failure modes actually bite.*

---

## System-Wide Impact

- **Interaction graph:** S3 EventBridge candidates feed `workspace-event-dispatcher`; dispatcher writes DB/S3 canonical records and enqueues `agent_wakeup_requests`; `wakeup-processor` remains the only AgentCore invocation path.
- **Error propagation:** Invalid files become `event.rejected`; dispatcher/runtime failures mark canonical events/runs failed and retain source object pointers.
- **State lifecycle risks:** S3 delivery is at-least-once and unordered. Idempotency and valid state transitions must live in Postgres transactions, not in Lambda memory.
- **API surface parity:** Admin UI, scheduler, runtime tools, and memory pipeline all interact with the same canonical event/run model.
- **Integration coverage:** Dispatcher -> wakeup -> AgentCore payload is the most important cross-layer contract; cover it with focused unit/contract tests + per-stage CloudWatch metric filters as the live observability path. (A post-deploy smoke gate as a CI step was scoped during deepening as U11 and removed during document review — see U11 tombstone for reasoning.)
- **Cross-tenant blast surface:** Three layers of defense — (1) S3 IAM scopes Strands runtime role to its own tenant prefix (primary), (2) workspace-files API rejects PUT to protected orchestration prefixes for both direct PUT and presigned URL minting (closes the agent-bypass-via-direct-API and admin-presigned-URL-bypass attack vectors structurally), (3) dispatcher's prefix-derived tenant check + cross-agent runId ownership check on event intents (defense-in-depth at canonicalization). Admin SPA writes to inbox/review go through `createWorkspaceWorkRequest`, `saveReviewFile`, and `cancelReviewRequest` GraphQL mutations with explicit tenant cross-check before any S3 write.
- **AgentCore deploy timing:** Container changes (new `wake_workspace` tool registration, dispatcher payload changes consumed by runtime) require the explicit runtime-update step from PR #489 + ≥60s warm-flush wait per `agentcore-runtime-no-auto-repull` and `project_agentcore_default_endpoint_no_flush`. CloudWatch alerts on the per-stage metric filters surface effective-deployment failures within minutes of an issue (visible after deploy, not blocking it).
- **Unchanged invariants:** Existing chat, email, webhook, sync `delegate`, shipped sync `delegate_to_workspace`, budget, skill, KB, and cost paths still go through current wakeup processor behavior unless source is `workspace_event`. The `wakeup-processor` payload-construction branch on `source === "workspace_event"` is additive — existing source branches (`chat_message`, `trigger`, `thread_assignment`) are unchanged. Synchronous `delegate` and `delegate_to_workspace` return results in-context and produce no canonical workspace event; that audit-timeline gap is the only known cost of the primitive being additive rather than replacing.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Duplicate/out-of-order S3 notifications create duplicate runs or invalid resumes | Sequencer-keyed idempotency in Postgres; status transition checks; tests replay fixtures repeatedly; every zero-row INSERT logs the collision. |
| EventBridge filtering misses or overmatches nested paths | One rule per eventful prefix using `wildcard` operator; per-rule SQS isolation; dispatcher owns parsing and validation. |
| Bulk imports accidentally trigger memory/run work | HeadObject metadata check at the dispatcher (since neither `x-amz-meta-*` nor `detail.requester` are filterable at EventBridge). Bulk writers set object metadata `x-amz-meta-thinkwork-suppress-event: true`; runtime/Cognito writer paths strip or reject that metadata unless the caller is an approved importer/template-sync/re-seeder service. |
| Overloading `thread_turns` confuses multi-wake run lifecycle | Add `agent_workspace_runs` and link per-turn `thread_turns` to it. |
| Runtime tool misuse creates unbounded fan-out | Shared U10 target-resolution helper enforces AGENTS.md authority + depth + reserved-name rules; per-run inbox quota at dispatcher. |
| Memory pipeline double-fires during migration | Same-PR cutover relying on `wiki_compile_jobs` idempotent INSERT (no per-tenant flag). Transient overlap window between `wiki-compile.ts` becoming a subscriber and `memory-retain.ts` removing direct invoke is dedup'd at the table level. |
| Admin UI exposes cross-tenant run data | Resolver tests use tenant mismatch fixtures; run/review surfaces require tenant-admin or review-operator permission; mutations gate before S3 writes; `resolveCallerTenantId` everywhere; `saveReviewFile`, `createWorkspaceWorkRequest`, and `cancelReviewRequest` perform explicit run/agent ownership cross-check before any S3 write or DB transition. |
| Lambda build misses new Python tool module | Dockerfile explicit-copy list + `_boot_assert.py` + boot tests (4-occurrence pattern per `dockerfile-explicit-copy-list-drops-new-tool-modules`). |
| **Silent multi-component failure** (dispatcher → EventBridge → Lambda → AgentCore Runtime → Strands tool registration — green CI on one layer tells you nothing about the next) | Per-stage CloudWatch alerts on dispatcher invocation count, DLQ depth, missing transitions, and stage-gap timing. Alerts surface within minutes (not at deploy time). A post-deploy smoke gate is a planned follow-up plan; v1 ships with the alert-based mitigation. |
| **AgentCore runtime serves stale code after Lambda update** (per `agentcore-runtime-no-auto-repull`) | Each unit that ships container changes relies on the runtime-update step from PR #489; warm flush via the 15-min reconciler; CloudWatch alerts catch effective-deployment failures via per-stage metric filters. |
| **Cross-tenant attack via runtime IAM** (compromised agent writes to victim tenant's prefix) | Runtime IAM scoped to `tenants/${tenantSlug}/agents/${agentSlug}/*` only — write itself fails at S3 IAM. Workspace-files API rejects PUT to protected orchestration prefixes (closes agent + admin bypass paths). Dispatcher prefix-derived check + cross-agent runId ownership check are defense-in-depth. `API_AUTH_SECRET` cannot bypass tenant scope because the writer uses scoped service auth and the dispatcher derives tenant from the S3 prefix, not the API key. |
| **Same-tenant cross-agent attack via `events/intents/`** (agent A writes a `run.completed` for agent B's runId) | Dispatcher's cross-agent runId ownership check (U3): compares `agent_workspace_runs.agent_id` to the `agentSlug` derived from the writing object's S3 prefix; mismatch produces `event.rejected reason: "run_not_owned_by_actor"` and no wake. Same DB transaction as canonical event insert. |
| **Sub-agent waiter race** (child completes before parent's blocked record exists) | F2 ordering enforced at the orchestration writer API level (`write-api.ts`): when `wait_for_result=true`, parent's `events/blocked.json` PUT happens BEFORE child inbox PUT in a single REST call. Dispatcher's same-transaction canonicalization order is secondary defense for the same-batch case. |
| **Concurrent HITL edits** (two operators save the same review file) | ETag-conditional PUT in `saveReviewFile` mutation; mismatch returns `REVIEW_CONFLICT` GraphQL error with current ETag + body; admin UI surfaces inline banner with Reload-latest + force-overwrite-with-confirmation options without firing a wake. |
| **Concurrent HITL cancellations** (two operators click Cancel) | `cancelReviewRequest` mutation is idempotent: second call finds run already `cancelled` and returns first-canceller attribution. Routes through GraphQL mutation, not raw S3 DELETE, so concurrency semantics are explicit. |
| **Orphan blocks and orphan-processing sit forever** (sub-agent never completes; human never responds to review; runtime crashes mid-turn) | U6 sweepers: block-sweeper for 7d `awaiting_subrun` / 30d `awaiting_review` → `expired`; processing-orphan sweeper retries `processing` rows stale >30m up to N=3 retries via `wakeup_retry_count`, then `expired`. |
| **HeadObject 404** (object disappeared between EventBridge fire and dispatcher pickup) | U3 explicit handling: drop with telemetry for non-`work.requested` events; `event.rejected reason: "source_object_disappeared"` for `work.requested` so operators can see the disappearing-inbox case. |
| **Coexistence with `delegate_to_workspace`** (audit timeline gap — sync delegate produces no canonical events) | Documented as accepted gap in U9; v1 audit viewer reads transcripts to surface sync delegations. Future v2 can add synthetic `delegate.invoked`/`delegate.completed` events if the gap is observably painful. |
| **Validator drift between sync and async folder tools** | U10 extracts/reconciles the shipped `delegate_to_workspace` validation behavior into a shared TS/Python helper and updates both tools to use it; existing delegate tests stay as regression coverage. |
| **Run/review/audit data persists indefinitely** | V1 classifies run folders, review files, source/result bodies, and audit mirrors as tenant-sensitive; adds explicit retention/offboarding policy before production rollout; structured logs never include request/review/result bodies. |

---

## Documentation / Operational Notes

- Add CloudWatch metrics/log fields for dispatcher decisions: `canonicalized`, `rejected`, `ignored_suppressed`, `duplicate`, `wakeup_enqueued`, `mirror_failed`. Per `probe-every-pipeline-stage-before-tuning`: emit one log line per stage (`work.requested`, `claimed`, `started`, `completed`/`failed`/`blocked`) so a failed wake produces actionable diagnostics from day one.
- Each EventBridge rule has its own SQS queue with a dedicated DLQ; messages that fail dispatcher canonicalization land in DLQ for replay. SQS retry model: queue's `redrive_policy.max_receive_count = 1` (one delivery attempt then DLQ on failure) + `function_response_types = ["ReportBatchItemFailures"]` for partial-batch handling. (Lambda's `MaximumRetryAttempts` does NOT apply to SQS event-source-mappings — earlier draft conflated the two retry models.)
- **SQS queues + DLQs** use SSE-KMS encryption with the workspace bucket's KMS key; DLQ resource policy limits `ReceiveMessage`/`DeleteMessage` to the ops/on-call IAM role + dispatcher Lambda role only; message retention 14 days max.
- **CloudWatch alerts (v1 observability)**: alert when DLQ depth > 0 for >5min, dispatcher invocation error rate >1%, mirror-failure rate >1%, per-stage metric filter shows missing transitions (e.g., `work.requested` without follow-on `claimed` within 60s). These alerts surface silent-multi-component-failures within minutes of an issue, visible to operators without blocking deploys. A per-tenant volume/cost dashboard is a follow-up once production volumes are measurable (per the brainstorm's own "partitioning can follow once production volume is measured" guidance).
- **Per-tenant rollout**: `tenants.workspace_orchestration_enabled` flag controls whether the dispatcher enqueues wakeups for a tenant's events (defaults `false`; flipped per-tenant after canary tenant smoke passes). The dispatcher's EventBridge rule + SQS infrastructure existence is gated by Terraform variable `enable_workspace_orchestration` at the module level (defaults `false` in v1; flipped at stage level once Phase 2 ships). Two-level gate: stage-level Terraform var creates infra; tenant-level DB flag activates wakeups.
- **HITL cancellation goes through `cancelReviewRequest` GraphQL mutation, NOT raw S3 DELETE.** Operators triggering Cancel from the admin UI invoke the mutation; raw S3 deletion (e.g., AWS console operator action) is a defensive backup that produces an audit-flagged `cancelled` transition.
- **Retention/privacy baseline**: run folders, review files, request/result bodies, event payload objects, and audit mirrors are tenant-sensitive. Do not log bodies in structured logs. Before production rollout, define default retention for terminal run folders and audit mirrors, deletion behavior for tenant offboarding, and redaction rules for operator-facing exports. SQS/DLQ retention remains 14 days max.
- PR description must call out any manual Drizzle migration requirements per `manually-applied-drizzle-migrations-drift-from-dev`. Hand-rolled `0xxx_agent_workspace_events.sql` (recommended given partial indexes + CHECK constraints + careful FK ordering) MUST include `-- creates: public.agent_workspace_events`, `-- creates: public.agent_workspace_runs`, `-- creates: public.agent_workspace_waits`, `-- creates-column: public.agent_workspace_runs.wakeup_retry_count`, and `-- creates-column: public.tenants.workspace_orchestration_enabled` markers so `db:migrate-manual` reporter validates presence at deploy time.
- Worktree discipline (this is a 10-unit phased plan; expect parallel worktrees): per `feedback_worktree_tsbuildinfo_bootstrap`, every fresh worktree needs `find . -name tsconfig.tsbuildinfo -not -path '*/node_modules/*' -delete && pnpm --filter @thinkwork/database-pg build` after `pnpm install` BEFORE typecheck. Worktrees clean up per `feedback_cleanup_worktrees_when_done` after PR merge.

---

## Phased Delivery

### Phase 1: Foundation (ship inert; no live event consumers)

- **U10** shared workspace target-resolution helper (TS + Python parity) — lands first; required by U3 and U5 and updates shipped `delegate_to_workspace` to avoid validator drift.
- **U1** schema (`agent_workspace_runs`, `agent_workspace_events`, `agent_workspace_waits`, `tenants.workspace_orchestration_enabled`, plus `wakeup_retry_count` column) — can land in parallel with U10.
- **U2** S3 → EventBridge → SQS → dispatcher Lambda infrastructure — Terraform variable `enable_workspace_orchestration` defaults `false`, so EventBridge rules + SQS exist only when a stage opts in.
- **U3** canonicalization, validation, S3 audit mirror, rejection handling, cross-agent ownership check — lands with unit tests. When `workspace_orchestration_enabled` is false for a tenant, the dispatcher records the canonical event for observability but does not enqueue wakeups.

Phase 1 exit criterion: with `enable_workspace_orchestration=true` at stage level and the canary tenant's `workspace_orchestration_enabled=true`, a canary inbox write produces a canonical `work.requested` event row in DB and an S3 audit mirror, with no agent wake (U4 not yet shipped). Idempotency proven by replaying fixtures.

### Phase 2: Wake Primitive (live for canary tenant)

- **U4** bridge into `wakeup-processor` (cold-start-per-wake, no warm-session optimization in v1); characterization tests pin existing payload shape before changes land.
- **U5** Strands runtime tools (`wake_workspace`) using U10 helper; workspace-files API rejects PUT to protected orchestration prefixes; presigned URL generator denies same; F2-race ordering enforced atomically in `write-api.ts`; scoped service-auth token/env snapshot at coroutine entry.
- **U6** HITL + sub-agent resume semantics; ETag-conditional `saveReviewFile`; `cancelReviewRequest` mutation; block-sweeper + processing-orphan-sweeper.

Phase 2 exit criterion: canary tenant's agent receives an inbox write, runs to completion, and a HITL pause/resume round-trip works end-to-end. CloudWatch per-stage alerts confirm pipeline observability. (Post-deploy smoke gate as a CI step is deferred to a follow-up plan — see U11 tombstone.)

### Phase 3: Producers and Visibility

- **U7** scheduler conversion (`job-trigger.ts` writes inbox files) + memory pipeline same-PR cutover (`wiki-compile.ts` becomes `memory.changed` event subscriber, `memory-retain.ts` stops calling `maybeEnqueuePostTurnCompile` directly, idempotency via `wiki_compile_jobs` dedup).
- **U8** admin GraphQL + UI: run/audit viewer at `analytics/agent-runs/` (tenant-wide with agent filter chip), folder-tree live status badges, minimal operator work-request creation, HITL backlog at `review/` with sidebar nav badge, `saveReviewFile` mutation with ETag-conditional + run-ownership cross-check, `cancelReviewRequest` mutation, state-differentiated rendering, causeEventId chain inline rendering.
- **U9** sync/async docs + evals; "files-and-events, not journal-replay" framing; three-primitive landscape.

Phase 3 exit criterion: all production tenants flipped to `workspace_orchestration_enabled=true` after canary tenant has run for [duration TBD by ce-work]; legacy `memory-retain → wiki-compile` Lambda Event-invoke fully removed; admin UI HITL backlog operator workflow validated end-to-end.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-25-s3-event-driven-agent-orchestration-requirements.md](../brainstorms/2026-04-25-s3-event-driven-agent-orchestration-requirements.md)
- **Supplemental requirements:** [docs/brainstorms/2026-04-25-s3-file-orchestration-primitive-requirements.md](../brainstorms/2026-04-25-s3-file-orchestration-primitive-requirements.md)
- Related requirements: [docs/brainstorms/2026-04-24-fat-folder-sub-agents-and-workspace-consolidation-requirements.md](../brainstorms/2026-04-24-fat-folder-sub-agents-and-workspace-consolidation-requirements.md)
- Related code: `packages/api/src/handlers/wakeup-processor.ts`
- Related code: `packages/api/workspace-files.ts`
- Related code: `packages/agentcore-strands/agent-container/container-sources/write_memory_tool.py`
- Related code: `packages/lambda/job-trigger.ts`
- Related code: `packages/api/src/handlers/memory-retain.ts`
- Related code: `terraform/modules/data/s3-buckets/main.tf`
- AWS docs: [Using EventBridge with Amazon S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventBridge.html)
- AWS docs: [Amazon EventBridge event patterns](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-patterns.html)
- AWS docs: [EventBridge event pattern best practices](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-patterns-best-practices.html)
- AWS docs: [EventBridge comparison operators](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-create-pattern-operators.html)
- AWS docs: [S3 event notification ordering and duplicates](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html)
