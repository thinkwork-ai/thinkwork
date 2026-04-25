---
date: 2026-04-25
topic: s3-event-driven-agent-orchestration
---

# S3-Event-Driven Agent Orchestration

## Problem Frame

The fat-folder consolidation makes S3 the canonical agent workspace — every agent's identity, memory, skills, and sub-agents live as files at deterministic paths. ThinkWork's coordination story has not caught up: today, sub-agent invocation is synchronous-only via `delegate_to_workspace`, memory ingestion runs through ad-hoc Lambda fire-and-forget chains, scheduled wakeups go through a separate AWS Scheduler path, and there is no primitive at all for long-running flows that pause for a human or wait on a sub-agent. Each scenario uses a different mechanism, and HITL — which is load-bearing for real enterprise work — cannot be built well with any of them.

S3 already gives us reliable change events (`s3:ObjectCreated` via EventBridge or notifications). Once workspace-as-folder is shipped, those events become an orchestration substrate that costs essentially nothing extra to enable: agent folders are the durable context boundary, files are the durable coordination boundary, S3 events are the wakeup boundary, and small handlers translate file changes into agent runs, memory ingestion, human review, or downstream jobs. This is the cloud-native equivalent of Kieran Klaassen's local-daemon pattern in [The Folder Is the Agent](https://every.to/source-code/the-folder-is-the-agent), adapted to ThinkWork's AWS-native, multi-tenant scale.

The decisive bet is **orchestration becomes folder-native and inspectable**. An operator opens the agent builder and sees not only the agent's instructions but its current queue (`work/inbox/`), active runs (`work/runs/{runId}/`), outputs (`work/runs/{runId}/result.md`), pending review requests (`review/`), errors (`errors/`), and event history (`events/`) — all as files, in S3, with the runtime as a stateless thin layer that wakes on change and reconstitutes from disk.

This document defines the **primitive** — not a workflow engine. v1 is wake + light orchestration: events wake a folder-addressable agent context, the agent reads files and decides what to do next, results land back in the folder. Multi-step DAGs, dependency graphs, fan-out/fan-in, and retry policies are explicitly out of scope.

---

## Visual: Folder layout with eventful surfaces

```
{tenant}/{agent}/                      ← workspace root (fat-folder agent)
├── AGENTS.md                          ← routing table (defines valid wake targets)
├── IDENTITY.md, SOUL.md, ...          ← canonical workspace files (non-eventful)
│
├── work/                              ← orchestration root
│   ├── inbox/                         ← EVENTFUL: drop *.md to request work
│   │   └── 2026-04-25-fix-ci.md
│   ├── runs/                          ← run audit trail (mostly non-eventful)
│   │   └── run_abc123/
│   │       ├── request.md             ← canonicalized request copy
│   │       ├── status.json            ← current state snapshot
│   │       ├── transcript.md          ← turn-by-turn agent output
│   │       ├── result.md              ← final output
│   │       ├── artifacts/             ← agent-produced files
│   │       └── events/                ← EVENTFUL: lifecycle markers
│   │           ├── started.json
│   │           ├── blocked.json
│   │           └── completed.json
│   └── outbox/                        ← EVENTFUL: result pointers for parent consumers
│       └── run_abc123.result.md
│
├── memory/                            ← EVENTFUL: writes trigger memory ingest
│   ├── lessons.md
│   └── preferences.md
│
├── review/                            ← EVENTFUL: HITL pending; human edits trigger resume
│   └── run_abc123.needs-human.md
│
├── errors/                            ← EVENTFUL: surfaces to escalation handler
│   └── run_def456.json
│
├── events/                            ← EVENTFUL (system-canonical): top-level event mirror
│   └── canonical/
│       └── 2026-04-25T10-00-00Z-work-requested.json
│
├── skills/                            ← non-eventful (reserved per fat-folder R25)
└── expenses/                          ← sub-agent (recursion: same orchestration shape inside)
    └── work/inbox/                    ← sub-agent has its own orchestration tree
```

**Eventful prefixes (v1, fixed list):** `work/inbox/`, `work/runs/{runId}/events/`, `work/outbox/`, `memory/`, `review/`, `errors/`, `events/canonical/`. Every other path is data and never fires events. EventBridge filters reject anything outside these prefixes at the bus, not at consumers.

---

## Actors

- A1. **Paired human** — end user chatting through admin/mobile. Drops messages that may land as `work/inbox/*.md`; responds to HITL prompts by editing files in `review/`. Never hand-authors event JSON.
- A2. **Tenant operator** — admin user who creates/edits agents, inspects active runs in the agent builder, audits HITL backlog, can manually drop work requests for testing or backfill.
- A3. **Agent runtime (Strands)** — stateless per turn. Each wake reads `runs/{runId}/` to reconstitute, performs work, writes results and event intents, exits. Never persists in-runtime state across turns.
- A4. **Sub-agent (specialist)** — same Strands runtime, scoped to a sub-agent folder per fat-folder R5/R9. Async resume of its parent is via the same primitive as any other wake.
- A5. **Dispatcher Lambda** — receives S3 → EventBridge events, validates against tenant scope and AGENTS.md routing, allocates `runId` for new work, writes canonical event records, invokes AgentCore wake. Stateless; the database row is the truth.
- A6. **Memory pipeline** — receives `memory.changed` events, runs retain/reflect/wiki-compile. Replaces the current `memory-retain → wiki-compile` Lambda Event-invoke chain.
- A7. **Importer / template-sync / re-seeder** — bulk writer. Writes through a controlled path that suppresses event firing (header-tagged or alternate prefix); never spawns runs from imports.

---

## Key Flows

- F1. **Human-initiated work request**
  - **Trigger:** Human/operator/external (mobile, admin, scheduled job, GraphQL mutation) writes `{agent}/work/inbox/2026-04-25-fix-ci.md`.
  - **Actors:** A1, A5, A3.
  - **Steps:** S3 event fires → EventBridge filter matches `work/inbox/*.md` → dispatcher resolves `target` (defaults to `.` for inbox-at-root), allocates `run_abc123`, writes `work/runs/run_abc123/request.md` (copy of inbox file), inserts canonical row in `agent_workspace_events` (type=`work.requested`, status=`pending`), writes `events/canonical/<ts>-work-requested.json` mirror, invokes AgentCore wake with `{tenant, agent, target, runId}` payload. Agent boots, reads `runs/run_abc123/request.md`, runs, writes results and event intents.
  - **Outcome:** A new run is observable in DB and in the agent's `runs/` folder; the agent has produced output or has paused for input.
  - **Covered by:** R1, R2, R5, R7, R10, R12.

- F2. **Sub-agent async wake (long-running specialist)**
  - **Trigger:** Parent agent in turn N decides to delegate asynchronously rather than synchronously. Parent writes a `work/inbox/*.md` to its own enumerated sub-agent (e.g. `expenses/work/inbox/run_abc123-context.md`) and writes its own `events/blocked.json` with `wait_for: {target: "expenses", runId: "run_def456"}`.
  - **Actors:** A3, A4, A5.
  - **Steps:** Parent's turn ends. Dispatcher fires on the sub-agent's inbox write, allocates sub-agent's `runId`, wakes sub-agent. Sub-agent runs (possibly across many turns of its own, possibly with its own HITL or further delegation), eventually writes `runs/run_def456/result.md` and a `run.completed` event intent. Dispatcher canonicalizes the completion, looks up any `wait_for` waiters in DB matching `target=expenses, runId=run_def456`, finds parent's blocked run, wakes parent at parent's `runId`. Parent reads the sub-agent's result file (path is in the canonical event), continues.
  - **Outcome:** Parent and sub-agent each have full audit trails in their own `runs/` folder; cross-agent linkage is in DB; no in-runtime state was held during the wait.
  - **Covered by:** R3, R5, R9, R11, R13, R16.

- F3. **HITL pause / resume**
  - **Trigger:** Agent in turn N decides it needs a human. Writes `review/{runId}.needs-human.md` (the question, in markdown, for humans to read and answer in-place) and a `run.blocked` event intent. Turn N ends.
  - **Actors:** A3, A1 or A2, A5.
  - **Steps:** Dispatcher canonicalizes `run.blocked`, surfaces the review item to admin/mobile via standard notification path. Human opens the review file, edits with their answer (edit can be in-place or via admin UI). S3 event fires on `review/*` write. Dispatcher resolves runId from filename, looks up the blocked run, wakes target at the same `runId`. Agent boots, reads `runs/{runId}/` plus the resolved review file, continues from where it stopped.
  - **Outcome:** Long-running flows that need human judgment can pause indefinitely without holding compute, and resume without state-machine ceremony.
  - **Covered by:** R4, R5, R10, R13, R14.

- F4. **Memory ingest on file change**
  - **Trigger:** Agent or platform writes `{agent}/memory/lessons.md` (or any file under `memory/`).
  - **Actors:** A3 or A5, A6.
  - **Steps:** S3 event fires on `memory/*` → dispatcher emits canonical `memory.changed` event → memory pipeline (current `memory-retain` + `wiki-compile`) reads the changed file, runs retain/reflect/compile. The current Lambda Event-invoke chain (`memory-retain` calls `wiki-compile` directly) is replaced by both being driven from the canonical event.
  - **Outcome:** Writers no longer need to know about the pipeline; pipeline observability is unified with all other orchestration events.
  - **Covered by:** R6, R10, R12.

---

## Requirements

**Eventful folder layout**

- R1. The orchestration root for every agent is `{agent}/work/`, containing fixed subdirectories `inbox/`, `runs/`, and `outbox/`. Sub-agents recursively contain their own `work/` tree at their folder depth.
- R2. `{agent}/work/runs/{runId}/` is the durable audit trail for one run. Standard files: `request.md`, `status.json`, `transcript.md`, `result.md`, optional `artifacts/`, and `events/` for lifecycle markers. Files inside this folder (excluding `events/`) are non-eventful: agents write freely without firing.
- R3. Eventful prefixes are a fixed v1 set: `work/inbox/`, `work/runs/{runId}/events/`, `work/outbox/`, `memory/`, `review/`, `errors/`, `events/canonical/`. Any other path is data only. EventBridge rules filter on these prefixes; events outside the set never reach the dispatcher.
- R4. `review/`, `errors/`, and `memory/` are content-as-event prefixes: writing the file IS the signal. The dispatcher canonicalizes the corresponding event type (`review.requested`, error escalation, `memory.changed`) on observe; writers do not author the event JSON.

**Event vocabulary and write authority**

- R5. v1 event vocabulary is exactly seven types: `work.requested`, `run.started`, `run.blocked`, `run.completed`, `run.failed`, `review.requested`, `memory.changed`. Adding a new type requires an explicit PR with migration. Events are signals, not workflow instructions; the agent decides next action.
- R6. Hybrid write authority: agents may write event *intents* as JSON (e.g. an agent declaring `run.completed`); the dispatcher validates, stamps, and writes the canonical event record. Agent-authored JSON is intent, never trusted infrastructure truth.
- R7. Work-request authority: agents may write `work/inbox/*.md` only to (a) themselves, (b) any sub-agent enumerated in their composed `AGENTS.md` routing table (per fat-folder R5/R9), or (c) their direct parent. Peer-to-peer writes between unrelated root agents are rejected. Cross-tenant writes are always rejected at the dispatcher boundary.
- R8. Bulk operations (importer, template-sync, re-seeder per A7) write through a controlled path that suppresses event firing — either via an `x-amz-meta-thinkwork-suppress-event: true` object header that the EventBridge rule filters out, or via a parallel non-eventful prefix. Direct-from-runtime writes never carry the suppression tag.

**Wake addressing and run lifecycle**

- R9. The wake primitive `wake_workspace(target)` is sibling to `delegate_to_workspace(target)` and uses the same `target` resolution (`.` = root agent, `expenses` = enumerated sub-agent, `support/escalation` = nested sub-agent). Reserved folders (`memory/`, `skills/`) are never valid targets.
- R10. Wake addressing is trigger-typed: `work.requested` events allocate a fresh `runId`; lifecycle, review, and error events carry an existing `runId` (via filename or event payload) and wake the same run. New runs are never created from non-inbox triggers.
- R11. The Strands runtime is stateless per wake. Each turn reconstitutes from `runs/{runId}/` files. There is no in-runtime sleep, no persistent agent context across wakes. Files plus the canonical event log are the entire state.
- R12. Run lifecycle: `pending` → `claimed` → `processing` → (`completed` | `failed` | `awaiting_review` | `awaiting_subrun`). `awaiting_review` and `awaiting_subrun` are resumable; another wake to the same `runId` continues the run.

**Canonical event log (DB + S3 mirror)**

- R13. Postgres `agent_workspace_events` table is the operational source of truth. Lean schema: `id`, `tenant_id`, `agent_id`, `target_path`, `type`, `status` (pending/claimed/processed/failed/ignored), `source_object_key`, `canonical_object_key`, `run_id`, `idempotency_key`, `wait_for_run_id` (nullable, for sub-agent waiters), `created_at`, `processed_at`. The DB does not store task/result bodies.
- R14. S3 `events/canonical/*.json` is an append-only readable mirror of the DB log, keyed by ISO timestamp + event-type slug. Mirror is derived from DB; the DB write is authoritative. Operators inspecting an agent see the event timeline as files alongside its `runs/`.

**Loop prevention and quotas**

- R15. Wake-chain depth limit: a single inbox-driven causal chain (parent inbox → child inbox → grandchild inbox …) is rejected past depth 4 by default. Depth is recorded in the canonical event row; the dispatcher refuses wakes whose parent chain exceeds the limit.
- R16. Per-run inbox-write quota: a single run may write at most M inbox files (default M=10). Exceeding the quota fails the write at the dispatcher and writes a `run.failed` event. The agent's AGENTS.md routing table further constrains topology — combined with depth limit and quota, fan-out is bounded without a workflow engine.

**Coexistence with existing primitives**

- R17. `delegate_to_workspace` (synchronous, in-process) remains the primitive for short specialist calls where the parent needs the result in the same turn. `wake_workspace` (asynchronous, files-and-events) is the primitive for long-running, durable, or HITL-bearing work. Both honor identical target-resolution rules. The agent runtime exposes both; agents choose based on latency need.
- R18. AWS Scheduler (current `job-schedule-manager → job-trigger`) writes `work/inbox/*.md` files at scheduled times rather than invoking agents directly. Cron wakeups become indistinguishable from human-authored requests at the orchestration layer.
- R19. The current `memory-retain → wiki-compile` Lambda Event-invoke chain is replaced: `memory-retain` writes `{agent}/memory/...` (which fires `memory.changed`), and `wiki-compile` subscribes to the canonical event instead of being invoked directly. Both Lambdas keep their handlers; the wiring shifts.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R10.** Given an operator drops `{agent}/work/inbox/2026-04-25-fix-ci.md` via the admin UI, when the dispatcher processes the S3 event, it allocates `run_abc123`, writes `{agent}/work/runs/run_abc123/request.md` (copy), inserts a canonical row with `type=work.requested, status=pending, run_id=run_abc123`, and invokes AgentCore wake with `target=., runId=run_abc123`. The admin UI shows the run as `pending` immediately.
- AE2. **Covers R3, R8.** Given an importer uploads a FOG bundle containing files under the agent's root, including a `memory/lessons.md` file, the importer adds `x-amz-meta-thinkwork-suppress-event: true` to every object. EventBridge rule filters out tagged objects; no `memory.changed` event fires; no run spawns from the import. The same `memory/lessons.md` written later by the runtime (no tag) does fire.
- AE3. **Covers R5, R6.** Given an agent in turn N writes `work/runs/run_abc123/events/completed.json` with `{type: "run.completed", runId: "run_abc123", result: "work/runs/run_abc123/result.md"}`, the dispatcher validates the schema, stamps `tenant_id`, `agent_id`, `created_at`, and writes the canonical row. The agent's intent file is preserved as `source_object_key`; the canonical row's `canonical_object_key` points to a stamped mirror in `events/canonical/`.
- AE4. **Covers R7.** Given root agent A's runtime writes to root agent B's `work/inbox/foo.md` (both at tenant root, neither enumerated in the other's AGENTS.md), the dispatcher rejects the write at the canonicalization step (not at S3 write — S3 doesn't know — but at event processing) and emits a `run.failed` event on A's current run with reason `unauthorized_inbox_target`.
- AE5. **Covers R10, R11, R12.** Given run `run_abc123` is in `awaiting_review` status with a `review/run_abc123.needs-human.md` file open, when a human edits that file via the admin UI (saving causes a new S3 PUT), the dispatcher resolves `runId=run_abc123` from the filename, looks up the row, transitions it to `processing`, and wakes the target at the same runId. The agent boots, reads `runs/run_abc123/` plus the resolved review file, continues.
- AE6. **Covers R3, R9, R17.** Given a parent agent calls `delegate_to_workspace("expenses")` synchronously for a short calculation, no S3 events fire and no rows are inserted in `agent_workspace_events`. The same agent, later in the same turn, calls `wake_workspace("expenses")` with a long-running task; the inbox file is written and a `work.requested` event canonicalizes. Two primitives, two paths, no overlap.
- AE7. **Covers R15, R16.** Given an agent's run writes 11 inbox files in a single turn (one over the M=10 quota), the dispatcher accepts the first 10 canonical events and fails the 11th with `run.failed` reason `inbox_quota_exceeded`. Given a chain reaches depth 5 (root → A → B → C → D → E), the depth-5 wake is rejected with `wake_chain_depth_exceeded`; the failing event is recorded so operators can audit.

---

## Success Criteria

- An operator opens the agent builder for any active agent and sees, as folder views, its current `work/inbox/`, in-flight `work/runs/`, pending `review/`, recent `errors/`, and a canonical event timeline. The orchestration state is fully inspectable as files, not opaque workflow rows.
- A long-running flow with a human approval step can be built end-to-end in v1 without writing a workflow engine or persistent agent runtime: agent writes a review file, human edits it, agent resumes — no other infrastructure required.
- A parent agent can fan out work to 3+ enumerated specialist sub-agents asynchronously, exit its own turn, and resume only when each specialist completes. No parent-side context held during the wait.
- The current `memory-retain → wiki-compile` Lambda chain is replaced by event-driven subscribers; memory writers no longer hard-code knowledge of downstream pipelines.
- `ce-plan` can proceed from this document without inventing the eventful prefix list, event vocabulary, write-authority rules, run-lifecycle states, canonical-log shape, loop-prevention thresholds, or coexistence rules with `delegate_to_workspace` and AWS Scheduler.

---

## Scope Boundaries

- **Not building a workflow engine.** No DAG, no dependency graph, no built-in retries, no fan-in coordination, no compensation/rollback. Events wake; agents decide. If a flow needs DAG semantics, it composes them by writing further inbox files, not by declaring them.
- **Not generalizing to arbitrary FS-backed orchestration.** This is S3-specific (EventBridge integration, prefix filters, multi-tenant scoping). Local FS is not in scope; CLI dev loops use API mocks or direct invocation, not an FS-watcher daemon.
- **Not eliminating `delegate_to_workspace`.** Synchronous in-process delegation stays for short, low-latency specialist calls. The two primitives coexist by design (R17).
- **Not replacing AWS Scheduler.** Time-based triggers stay; Scheduler now writes inbox files instead of invoking agents directly (R18). The Scheduler infra itself doesn't change.
- **Not solving compound-engineering session handoff (brainstorm → plan → work).** The lifecycle (user sessions, no Strands runtime, different actor model) is too different for the same v1 primitive. Future work; the same shape will likely extend, but not as part of this v1.
- **Not introducing in-runtime agent suspension.** The Strands runtime is stateless per turn (R11). No `agent.sleep()`, no persistent context across wakes. Files reconstitute state.
- **Not enabling peer-to-peer writes between unrelated root agents.** Authority follows AGENTS.md hierarchy (R7). Cross-root coordination, if ever needed, is a separate brainstorm with its own threat model.
- **Not extending the eventful prefix list in v1.** Adding a prefix is an explicit future PR. The fixed list (R3) is part of the contract; reviewers can rely on it.
- **Not building per-tenant configurability of depth/quota in v1.** R15 (depth 4) and R16 (M=10) are platform defaults. Tenants get the same numbers; tuning is a future concern.

---

## Key Decisions

- **Implicit eventful folders + explicit lifecycle events, not pure-explicit.** Folder name announces orchestration intent; `events/*.json` carries machine lifecycle. Authoring stays ergonomic (drop a file in `inbox/`, write to `memory/`); machine state stays validated. Pure-explicit (require `events/*.json` for every signal) doubled bookkeeping without adding clarity. Pure-implicit (any S3 write) was rejected because imports and template-sync would fire spurious events.
- **`wake_workspace` as conceptual sibling of `delegate_to_workspace`.** Identical target-resolution; one is sync-in-context, the other is async-via-files. Operators reading the runtime see two parallel primitives with one mental model rather than two unrelated mechanisms.
- **Stateless runtime per turn.** Files plus canonical events are the only state. No in-runtime sleep, no persistent agent context. This is the property that makes HITL and sub-agent async resume share one contract.
- **Trigger-typed wake addressing.** Inbox writes allocate runs; lifecycle/review/error writes attach to existing runs. No separate "new vs resume" API on the wake primitive — the trigger location decides.
- **Hybrid event-write authority.** Agents express intent as JSON; platform canonicalizes. This preserves filesystem expressiveness without letting agent-authored JSON become trusted truth.
- **Dual-write canonical log: Postgres index, S3 mirror.** DB for queries, idempotency, dashboards, retries; S3 for the inspectable folder-native story. The DB write is authoritative; the S3 mirror is derived. Folder-only would have weakened cross-agent admin queries; DB-only would have broken the "everything is a file" coherence.
- **Authority follows AGENTS.md hierarchy.** Agents write inbox to self, enumerated children, or direct parent — no further. The fat-folder routing table is reused for both sync delegation and async wake; one authority surface, two primitives.
- **v1 is a primitive, not a framework.** Light orchestration only — wake, status, HITL, sub-agent resume. The temptation to add DAG/retry/fan-in is the rabbit hole that locks ThinkWork into being a workflow engine. Refused.

---

## Dependencies / Assumptions

- **Depends on fat-folder consolidation (2026-04-24-fat-folder-sub-agents-and-workspace-consolidation-requirements.md)** for the workspace folder-as-agent layout, AGENTS.md routing rules, and reserved-folder-name enforcement. This brainstorm composes on top of those decisions; sub-agent recursion in F2 reuses fat-folder R5/R9 directly.
- **Verified absent:** No `aws_s3_bucket_notification` or EventBridge-on-S3 wiring exists in `terraform/` today; this is net-new infrastructure but uses standard AWS patterns. S3 → EventBridge is a single-bucket-config change per workspace bucket.
- **Verified present:** The current memory pipeline (`packages/api/src/handlers/memory-retain.ts` and `wiki-compile.ts`) uses Lambda Event-invokes; replacing the chain with event-bus subscribers per R19 is a wiring change, not a rewrite.
- **Verified present:** `delegate_to_workspace` is live in the Strands runtime (`packages/agentcore-strands/agent-container/container-sources/server.py`) and described in shipped `ROUTER.md`. `wake_workspace` is the conceptual sibling per R9/R17.
- **Verified present:** AWS Scheduler wiring (`job-schedule-manager → job-trigger`) exists per `project_automations_eb_provisioning` memory; R18 redirects its target from direct agent invoke to inbox-file write.
- The 4 existing agents do not need backfill — they have no prior orchestration state. New runs adopt the new structure starting at v1 cutover.
- Multi-tenant isolation is assumed at the S3 prefix layer (`{tenant}/{agent}/...`) and reinforced by the dispatcher's tenant check on every event. Cross-tenant prefix collision is impossible because tenant IDs are UUIDs.
- At 400+ agent scale (per `project_enterprise_onboarding_scale`), assume each tenant generates O(thousands) of events per day. EventBridge rule throughput, SQS DLQ capacity, and Postgres `agent_workspace_events` partitioning are planning concerns but well within AWS-managed-service limits.

---

## Outstanding Questions

### Resolve Before Planning

- (None — all product decisions are resolved in this document.)

### Deferred to Planning

- [Affects R3, R8][Technical] Bulk-write suppression mechanism: object metadata header (`x-amz-meta-thinkwork-suppress-event: true`) filterable in EventBridge, vs. parallel non-eventful path for importers, vs. both. Tag-based is more flexible; path-based is simpler to enforce. Planning chooses based on EventBridge filter expression cost and importer code shape.
- [Affects R5, R6, R13][Technical] Idempotency key derivation. Default is `sha256(canonical_object_key + event_type)`; planning confirms whether that's stable across replays (S3 event delivery is at-least-once) and whether DDB conditional-write or Postgres `INSERT ... ON CONFLICT` is the primary dedup point.
- [Affects R9, R17][Technical] Strands runtime exposure of the `wake_workspace` tool: same code path as `delegate_to_workspace` with an async flag, or separate tool. Affects the system prompt that ships in the agent's CAPABILITIES.md and TOOLS.md.
- [Affects R10, R12][Technical] The runId allocation boundary: dispatcher generates UUID at canonicalization, vs. inbox-file naming convention required to include a runId, vs. agent-side allocation. Default to dispatcher-generated; planning confirms consistency with admin-UI display needs.
- [Affects R13, R14][Technical] Postgres partitioning strategy for `agent_workspace_events`. At 400 agents × 1k events/day = 400k/day = 12M/month, single table is fine for ~6 months; planning defines partitioning horizon and S3-mirror retention vs. DB row retention.
- [Affects R14][Technical] S3 canonical-mirror path scheme: per-day partition (`events/canonical/2026-04-25/...`), per-run nested under runs (`runs/{runId}/events/canonical/...`), or both. Affects browse UX in the agent builder.
- [Affects R15, R16][Technical] Where the depth counter and quota counter live. Depth: in the canonical event row, derived by walking parent chain on insert. Quota: incremented on each inbox write within a run, fail-fast at M+1. Planning confirms these are simple Postgres fields, not a separate counter service.
- [Affects R18][Technical] Migration of existing `job-trigger` invocations: Lambda updates to write inbox files instead of invoking agents directly. Backwards compat for already-scheduled jobs that expect direct invocation — probably none in production yet, but planning audits.
- [Affects R19][Technical] `wiki-compile` subscriber switch: today it's invoked from `memory-retain` directly. New shape: both subscribe to the canonical event. Planning confirms the order-of-operations during cutover so memory writes don't double-fire or drop.
- [Affects R7, R15, R16][Needs research] Whether and how the AGENTS.md routing parser (per fat-folder Outstanding Question on the structured table parser) integrates with the dispatcher's authority check. Both need to read the same parsed routing table; planning decides whether the parser lives in TS (API/dispatcher), Python (Strands), or both.
- [Affects R11][Technical] How the agent runtime signals "I'm exiting because I'm blocked" vs "I'm exiting because I'm done" — both are turn-end. Status field in the agent's final tool call, or implicit from which event intent was last written. Planning defines the runtime-side contract.
- [Affects R5][Needs research] Whether `run.blocked` should split into `run.blocked.review` and `run.blocked.subrun` for cleaner consumer routing, or stay as one type with a `reason` field. The current 7-event vocabulary keeps the `reason` field; planning may revisit.
- [Affects R17][Technical] When an agent writes both a `delegate_to_workspace` synchronous call AND a `wake_workspace` asynchronous call in the same turn, the system observes two artifacts (sync result in-context, async run in DB). Planning defines whether the agent builder shows them side-by-side in the run timeline or as separate views.

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
