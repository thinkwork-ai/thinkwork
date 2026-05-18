---
title: "feat: Evals Overhaul — Red-Team Library + Substrate Fix"
type: feat
status: active
date: 2026-05-16
origin: docs/brainstorms/2026-05-16-evals-overhaul-redteam-library-and-substrate-fix-requirements.md
---

# feat: Evals Overhaul — Red-Team Library + Substrate Fix

## Summary

Twelve units across six phases: stall-probe before substrate decisions, runner substrate fixed via SQS-driven per-case fan-out using the team's inert-first seam-swap pattern, red-team library authored as new seed JSON under `seeds/eval-test-cases/` replacing the maniflow files (split by surface for reviewability), a small Performance slice, seed plumbing plus tenant-DB cleanup, drill-in extended in the existing `ResultDetailSheet` with a new on-demand span resolver (no schema growth), an `eval_scheduled` form on the existing `ScheduledJobFormDialog`, a `scheduled_job_id` provenance column, and a CLI cosmetic polish.

---

## Problem Frame

The evals module shipped from maniflow and was never re-targeted at thinkwork. Today the dashboard shows three runs hung at 0/96 (the runner cannot finish a full batch within its 900s Lambda timeout), red-team pass rates of 5–31% on a corpus authored for a different product, scheduling that has never fired, and a drill-in that omits per-evaluator scores and trace data. Prospects are asking for evals during procurement; the live dashboard is the artifact in each customer's forked deployment. See origin for the full pain narrative.

---

## Requirements

**Red-team library**
- R1. Ship a thinkwork-authored red-team starter pack covering four dimensions (prompt injection / jailbreak, tool / action misuse, data exfiltration / boundary, safety + scope + bias).
- R2. Targets default Strands agents, the default Computer, and three skills — GitHub, file system, and workspace.
- R3. Replace the maniflow seed pack outright; remove existing maniflow rows from already-deployed tenant DBs.
- R4. Each case carries category, target surface, and metadata sufficient to render its purpose in the UI list view without opening the body.
- R5. Volume target: ~15 cases per agents + Computer cell across 4 dimensions, plus 6–10 cases per skill across the four dimensions.

**Performance slice (v1)**
- R6. Small Performance/accuracy slice per surface — golden-answer matching + LLM-judge over representative tasks. Not a full Performance category.
- R7. Performance cases distinctly labeled from red-team in the UI.

**Runner / substrate fixes**
- R8. Full-corpus runs reach terminal status (`completed`, `failed`, or `cancelled`); no 0/N hangs.
- R9. Per-case results survive runner-level partial failures; single-case crashes don't invalidate the rest of the run.

**Drill-in**
- R10. Per-case result view shows prompt, agent response, judge reasoning, per-evaluator scores, assertion outcomes, and tool-call / span trace.
- R11. Failure modes visually distinguishable: assertion failure, evaluator low score, judge dissent, runner error, timeout.

**Scheduling**
- R12. Operators configure recurring eval runs from the existing Schedules tab; runs fire end-to-end.
- R13. Scheduled runs marked in the run list with schedule provenance.

**CLI parity**
- R14. CLI continues to support all existing eval subcommands against the new content.

**Origin actors:** A1 (Operator), A2 (Scheduler), A3 (Prospect / customer security reviewer), A4 (CLI user)
**Origin flows:** F1 (Operator-triggered eval run), F2 (Scheduled run), F3 (Drill into a failing test case)
**Origin acceptance examples:** AE1 (covers R8, R9), AE2 (covers R10, R11), AE3 (covers R12, R13), AE4 (covers R3)

---

## Scope Boundaries

- Tenant-authored agent template evals — deferred to v2; operators can still author cases in Studio against default agents.
- Customer-facing shareable report (PDF or hosted-link with sanitization) — fork-the-repo distribution makes the live dashboard sufficient.
- Visual diff / headless browser rendering for Computer artifacts — Computer evaluated as text + LLM-judge in v1.
- CI / PR-gated eval execution — operator- and scheduler-triggered only.
- Full Performance/accuracy category coverage — representative slice only in v1.
- Substrate swap to PromptFoo or other file-based eval frameworks — rejected; fights dashboard-resident anchoring.

### Deferred to Follow-Up Work

- Slack red-team skill cases — deferred until a prospect drives it; v1 ships GitHub + file system + workspace (see origin Key Decisions).
- Custom AgentCore evaluator authoring — v1 uses Builtin.* evaluators only.
- Tenant-DB cleanup runbook for self-hosted customer forks — out of band of the merge pipeline; document separately so customer ops can run the deletion against their own deployments.

---

## Context & Research

### Relevant Code and Patterns

- `packages/api/src/handlers/eval-runner.ts` — current 821-line runner. Per-case loop L607-732; AgentCore InvokeAgentRuntime L404-410; span wait L463-482 (30s initial + 15s poll + 120s max); EvaluateCommand L489-497; eval_results insert L716-729; cost-events L765-781; PASS_THRESHOLD=0.7 L67.
- `packages/lambda/job-trigger.ts` L435-481 — **already handles `eval_scheduled`** end-to-end (reads `cfg.agentId/model/categories`, inserts pending eval_runs, invokes eval-runner via LambdaClient Event). No backend wiring needed for scheduling.
- `packages/lambda/job-schedule-manager.ts` — creates AWS Scheduler resources from `scheduled_jobs` row.
- `packages/database-pg/src/schema/scheduled-jobs.ts` L38-79 — `trigger_type` is open text; `eval_scheduled` is an accepted value.
- `apps/admin/src/components/scheduled-jobs/ScheduledJobFormDialog.tsx` — generic schedule form; **does not yet preselect `eval_scheduled` or render eval-specific config fields** (the Phase F gap).
- `apps/admin/src/routes/_authed/_tenant/evaluations/$runId.tsx` L362-463 — `ResultDetailSheet`; renders status/score/duration/input/expected/actual/raw-assertions/error but **does not render `evaluatorResults`** (already in payload) and has **no tool-call/span trace**.
- `packages/api/src/lib/eval-seeds.ts` — bundles 13 maniflow JSONs at build time; replace contents to refresh the seed corpus.
- `seeds/eval-test-cases/` (repo root) — 13 maniflow JSON files + `README.md` documenting the case format.
- `packages/api/src/graphql/resolvers/evaluations/index.ts` L546-583 — `seedEvalTestCases` mutation; idempotency via `0012_eval_seed_unique.sql` partial unique index; default `agentcore_evaluator_ids: ["Builtin.Helpfulness"]` L571; `ensureTenantSeeded` L290-323 auto-seeds on first visit.
- `apps/admin/src/components/evaluations/EvalTestCaseForm.tsx` L49-64 — 16 Builtin.* evaluator IDs hardcoded with `level` metadata (TRACE / TOOL_CALL / SESSION); the v1 allowlist.
- `apps/cli/src/commands/eval.ts` + `apps/cli/src/commands/eval/seed.ts` — full CLI surface. Line 116 has stale "96 test cases across 9 categories" string.
- `packages/api/src/handlers/eval-runner.test.ts` — only 23 lines (pure-function only); mocking patterns for AgentCore + CW + DB **will need to be invented** during U3.
- `terraform/modules/app/lambda-api/handlers.tf` L298, L418-428 — eval-runner Lambda entry + timeout=900s + memory=512MB. L1260 outputs `eval-runner-fn-arn`.

### Institutional Learnings

- `docs/solutions/architecture-patterns/inert-first-seam-swap-multi-pr-pattern-2026-05-08.md` — the team's substrate-fix pattern. Stubs throw (not no-op) so DLQ alarms fire; body-swap forcing-function tests prevent silent regressions. Applies to U2/U3.
- `docs/solutions/best-practices/probe-every-pipeline-stage-before-tuning-2026-04-20.md` — anchors U1 (stall-probe). Tune the wrong knob and you burn sessions; instrument every stage first.
- `docs/solutions/runtime-errors/lambda-web-adapter-in-flight-promise-lifecycle-2026-05-06.md` — Lambda Event-invoke promise lifecycle. Surface dispatch status in response payload so smoke can assert fan-out happened.
- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` — hand-rolled SQL must carry `-- creates:` / `-- creates-column:` / `-- creates-constraint:` markers and be applied to dev pre-merge. Applies to U8 (delete migration) and U11 (column add).
- `docs/solutions/logic-errors/eval-runner-ignored-system-workflow-test-case-selection-2026-05-03.md` — smoke must pin worker effective scope (totalTests, testCaseIds, categories), not just launch ARN. Carries to U3 smoke gates.
- `docs/solutions/best-practices/bedrock-agentcore-sdk-version-drift-prefer-raw-boto3-2026-04-24.md` — any `ListEvaluators` probe uses raw boto3, not SDK wrappers. Applies to U2 dev-time evaluator-reachability check.
- `docs/solutions/design-patterns/audit-existing-ui-and-data-model-before-parallel-build-2026-04-28.md` — audit existing data shapes before adding new query surface. Applies to U9 (extend ResultDetailSheet rather than build parallel).
- `docs/solutions/best-practices/defer-integration-tests-until-shared-harness-exists-2026-04-21.md` — ship shape-invariant tests on seed YAML schemas in U4-U7; defer full LLM-judge integration smoke to a single harness.
- Auto-memory `project_async_retry_idempotency_lessons` — Lambda Event-invoke defaults to 2 retries; set `MaximumRetryAttempts=0` + SQS DLQ + per-case idempotency CAS. Applies to U2/U3.

### External References

- Not used. The substrate is in-house Lambda + AgentCore Evaluate; both alternatives surveyed in origin (PromptFoo, AgentCore Evaluations).

---

## Key Technical Decisions

- **Runner substrate: SQS-driven per-case worker, inert-first multi-PR seam-swap.** Trade is correctness / DLQ / idempotency vs ~1-2 PRs of extra scaffolding. Aligns with the team's recent substrate pattern.
- **Run finalization: worker CAS on last write.** Each worker, after inserting its eval_results row, counts rows for the run; if count == total_tests, performs run finalization with a CAS on `eval_runs.status='running' → 'completed'`. No separate reconciler Lambda.
- **Lambda retries disabled, application errors caught in worker.** `MaximumRetryAttempts=0` on the worker function; per-case application errors caught and written as `eval_results.status='error'` (worker returns success to SQS). Only infra-level failures route to DLQ.
- **Drill-in span trace: on-demand fetch via new GraphQL resolver.** Not persisted on `eval_results` rows. Trades a per-click latency hit for clean schema and no payload bloat. CloudWatch log retention is the implicit dependency.
- **Schedules: UI-only work.** `job-trigger.ts` L435-481 already wires `eval_scheduled` end-to-end. Phase F extends the existing `ScheduledJobFormDialog`; no new Lambda or scheduler resources.
- **Schedule provenance: new `eval_runs.scheduled_job_id text` column with FK to `scheduled_jobs.id` ON DELETE SET NULL.** Hand-rolled migration with `-- creates-column:` marker, applied to dev pre-merge.
- **Maniflow row cleanup: one-shot SQL deletes existing maniflow-era rows from already-deployed tenants.** Not just import-side removal — origin R3 requires no new runs use them; cleanup ensures the live dashboard reflects the new corpus immediately on deploy.
- **Computer Performance: LLM-judge only.** Resolves the origin's "Needs research" question; Computer outputs aren't deterministic enough for golden-answer matching.
- **Builtin.* evaluator allowlist sourced from `EvalTestCaseForm.tsx` L49-64.** 16 IDs with TRACE / TOOL_CALL / SESSION levels; new seed cases pick from this list only.
- **Shape-invariant tests for content units (U4-U7), not LLM-judge integration tests.** Defer full integration smoke to a shared harness; ship JSON schema validation per the defer-integration-tests learning.

---

## Open Questions

### Resolved During Planning

- Stall-probe root-cause: deferred to empirical measurement in U1; substrate fix shape in U2/U3 commits only after U1 confirms.
- Span trace surface: on-demand resolver (see Key Decisions).
- Schedules wiring: backend done; UI-only gap (see Context & Research).
- Computer Performance evaluator: LLM-judge only (see Key Decisions).

### Deferred to Implementation

- Exact FK behavior on `eval_results.test_case_id` — needed before U8 ships the maniflow-row DELETE migration. If CASCADE, historical run results get purged with the test cases (probably acceptable); if RESTRICT, the migration needs a different shape (e.g., set `enabled=false` instead of DELETE). Confirm with `\d+ eval_results` against dev before authoring the migration.
- Whether `eval_runs.session_id` (or equivalent linking field) is already present for the on-demand span resolver in U9. If missing, U9 needs either a small schema add or to thread the session_id through GraphQL payload.
- AgentCore `ListEvaluators` reachability per stage — confirm via raw-boto3 probe before U4 commits to specific Builtin.* IDs.
- SQS message group / FIFO vs Standard queue choice in U2 — depends on whether ordering matters for fan-out (it doesn't, but Standard's at-least-once delivery requires the idempotency CAS pattern to be airtight).
- Exact Lambda concurrency limit on the new worker function — set after U1's measurements inform per-case duration.

---

## Output Structure

New files under `seeds/eval-test-cases/` after U4–U8:

```
seeds/eval-test-cases/
├── README.md  (updated)
├── red-team-agents-prompt-injection.json   (NEW, ~15 cases)
├── red-team-agents-tool-misuse.json        (NEW, ~15 cases)
├── red-team-agents-data-boundary.json      (NEW, ~15 cases)
├── red-team-agents-safety-scope.json       (NEW, ~15 cases)
├── red-team-computer-prompt-injection.json (NEW, ~15 cases)
├── red-team-computer-tool-misuse.json      (NEW, ~15 cases)
├── red-team-computer-data-boundary.json    (NEW, ~15 cases)
├── red-team-computer-safety-scope.json     (NEW, ~15 cases)
├── red-team-skill-github.json              (NEW, ~25 cases)
├── red-team-skill-filesystem.json          (NEW, ~25 cases)
├── red-team-skill-workspace.json           (NEW, ~25 cases)
├── performance-agents.json                 (NEW, ~5 cases)
├── performance-computer.json               (NEW, ~5 cases)
└── performance-skills.json                 (NEW, ~5 cases)
```

The 13 maniflow files (`email-calendar.json`, `knowledge-base.json`, `mcp-gateway.json`, the old `red-team.json`, `sub-agents.json`, `brain-*.json` (×4), `thread-management.json`, `tool-safety.json`, `workspace-memory.json`, `workspace-routing.json`) are deleted in U8.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

Runner substrate fan-out flow after U3:

```mermaid
sequenceDiagram
  participant UI as Admin / CLI / Scheduler
  participant Disp as eval-runner (dispatcher)
  participant DB as Aurora (eval_runs, eval_results)
  participant Q as SQS eval-fanout
  participant Wkr as eval-worker (per case)
  participant AC as AgentCore (Invoke + Evaluate)
  participant CW as CloudWatch (spans)

  UI->>Disp: startEvalRun(runId)
  Disp->>DB: select enabled test cases
  Disp->>DB: update eval_runs set total_tests, status='dispatching'
  Disp->>Q: SendMessageBatch (N messages)
  Disp->>DB: update eval_runs set status='running'
  Disp-->>UI: { dispatched: N }
  loop per case (parallel, bounded by Lambda concurrency)
    Q->>Wkr: deliver { runId, testCaseId }
    Wkr->>DB: idempotency check on (run_id, test_case_id)
    Wkr->>AC: InvokeAgentRuntime
    Wkr->>CW: wait + fetch spans
    Wkr->>AC: EvaluateCommand (per evaluator_id)
    Wkr->>DB: insert eval_results ON CONFLICT DO NOTHING
    Wkr->>DB: count results for run; if last, CAS finalize
  end
  Wkr->>DB: insert costEvents (last writer only, unique on request_id)
```

Failure-mode badge derivation in U9:

```
status === 'error'
  ? errorMessage matches /timeout/i ? 'timeout' : 'runner-error'
  : score < passThreshold
    ? 'judge-fail'
    : any(assertions, !passed)
      ? 'assertion-fail'
      : 'pass'
```

---

## Implementation Units

### U1. Stall-probe and findings doc

**Goal:** Empirically verify the hung-at-0/96 root cause across pipeline stages (AgentCore invoke RTT, span fetch latency, evaluator API latency, DB write latency) before committing substrate shape.

**Requirements:** Informs R8.

**Dependencies:** None.

**Files:**
- Create: `scripts/eval-stall-probe.ts`
- Create: `docs/solutions/diagnostics/eval-runner-stall-findings-2026-05-NN.md`

**Approach:**
- Instrument an out-of-tree copy of the eval-runner per-case loop with per-stage timing. Run against the dev tenant's full enabled corpus (currently 96 maniflow cases). Capture: per-case Bedrock invoke ms, span-wait elapsed ms, per-evaluator EvaluateCommand ms, eval_results insert ms, total per-case wall time. Verify hypothesis "stall is 900s × concurrency=5 × per-case duration"; if a different stage dominates (e.g., span-wait timing out at the 120s ceiling), the substrate fix in U2/U3 targets that bottleneck instead.

**Execution note:** Commit the probe script per the probe-every-pipeline-stage learning so the next operator can re-run it.

**Patterns to follow:**
- `docs/solutions/best-practices/probe-every-pipeline-stage-before-tuning-2026-04-20.md`

**Test scenarios:** Test expectation: none — this unit ships a diagnostic script, not feature code. Verification is the findings doc identifies the stall stage with measurements.

**Verification:**
- Findings doc names the dominant stall stage with timing data and a recommended fan-out granularity (per-case vs per-batch) for U2/U3.

---

### U2. Inert SQS substrate (queue + DLQ + worker stub + IAM)

**Goal:** Land all Terraform resources for the per-case fan-out — SQS queue + DLQ + alarm + worker Lambda (throwing stub) + IAM — with no behavior change to user-facing runs. Worker throws on every invocation so the DLQ alarm fires if any traffic reaches it.

**Requirements:** Prep for R8, R9.

**Dependencies:** U1 (informs per-case duration → Lambda timeout + concurrency).

**Files:**
- Create: `terraform/modules/app/lambda-api/eval-fanout.tf` (or extend `handlers.tf`)
- Create: `packages/api/src/handlers/eval-worker.ts` (throwing stub)
- Create: `packages/api/src/handlers/eval-worker.test.ts` (forcing-function: stub must throw)
- Modify: `scripts/build-lambdas.sh` (add `eval-worker` entry per `feedback_lambda_zip_build_entry_required`)
- Modify: `terraform/modules/app/lambda-api/handlers.tf` (IAM SendMessageBatch on eval-runner role; ReceiveMessage/DeleteMessage/Bedrock/CloudWatch on eval-worker role; DB access via existing secret)
- Create: `terraform/modules/app/lambda-api/alarms.tf` additions (DLQ depth > 0 alarm)

**Approach:**
- SQS Standard queue (per-case fan-out doesn't need ordering); DLQ attached with `maxReceiveCount=3`.
- Worker Lambda: `MaximumRetryAttempts=0` on the function (Lambda Event-invoke retries off — relying on SQS visibility timeout for retry inside the queue); `BatchSize=1` so a single failing message doesn't poison the batch.
- Worker stub throws on every call so any accidental traffic before U3 trips the DLQ alarm.
- CloudWatch alarm on DLQ `ApproximateNumberOfMessagesVisible > 0` over 5min.
- IAM: eval-runner role gets `sqs:SendMessage,SendMessageBatch` on the queue; eval-worker role gets `sqs:ReceiveMessage,DeleteMessage,GetQueueAttributes` + `bedrock-agentcore:InvokeAgentRuntime,Evaluate,GetEvaluator,ListEvaluators` + CloudWatch Logs read on `aws/spans` and runtime log groups + DB secret access.

**Execution note:** Inert-first per the seam-swap pattern; the forcing-function test asserts the stub throws.

**Patterns to follow:**
- `docs/solutions/architecture-patterns/inert-first-seam-swap-multi-pr-pattern-2026-05-08.md`
- Existing Lambda Terraform shape: `terraform/modules/app/lambda-api/handlers.tf` L298 (eval-runner pattern).
- Existing build entry pattern: `scripts/build-lambdas.sh` (other handler entries).

**Test scenarios:**
- Happy path: terraform `plan` and `apply` on dev create queue, DLQ, alarm, worker Lambda; no errors.
- Forcing function: invoking eval-worker stub handler with any event throws — vitest asserts this.
- Integration: a manually-sent SQS message gets received by worker, throws, redrives until `maxReceiveCount=3`, lands in DLQ, alarm fires within 5min.
- IAM: eval-runner role can call `sqs:SendMessageBatch` against the queue; worker role can call `sqs:ReceiveMessage`. Verify via `aws sts simulate-principal-policy` or empirical test.

**Verification:**
- DLQ alarm visible in CloudWatch on dev; queue + DLQ + worker Lambda all show up in `aws lambda list-functions` / `aws sqs list-queues`. Forcing-function test passes in CI.

---

### U3. Worker live + dispatcher rewrite + run finalizer

**Goal:** Swap eval-worker stub for a real per-case body (invoke agent, run assertions, fetch spans, call evaluators, write `eval_results` with idempotency, perform run finalization on last write). Rewrite `eval-runner` as a thin dispatcher.

**Requirements:** R8, R9.

**Dependencies:** U2.

**Files:**
- Modify: `packages/api/src/handlers/eval-worker.ts` (real body, replacing stub)
- Modify: `packages/api/src/handlers/eval-runner.ts` (thin dispatcher; remove per-case loop / span-wait / evaluator loop / cost-events logic — all move into worker)
- Modify: `packages/api/src/handlers/eval-runner.test.ts` (dispatcher tests; mock SendMessageBatch)
- Create: `packages/api/src/handlers/eval-worker.test.ts` (replace forcing-function with real worker tests; mock AgentCore + CW + DB)
- Create: `packages/api/src/handlers/eval-worker-integration.test.ts` (full-corpus dispatch → worker → finalize, mocked SQS roundtrip)
- Modify: `terraform/modules/app/lambda-api/eval-fanout.tf` (remove the stub-throws note; bump Lambda concurrency from U1 data)

**Approach:**
- **Dispatcher (eval-runner)**:
  - Query enabled test cases for the run (existing selection logic — `event.input.testCaseIds` wins over categories, both fall back to all-enabled).
  - Update `eval_runs.total_tests`, set status `dispatching`.
  - `SendMessageBatch` to SQS in groups of 10, each entry `{ runId, testCaseId }`.
  - Update `eval_runs.status='running'` after all batches dispatched.
  - Return `{ runId, dispatched: N, totalTests: N }`.
- **Worker (eval-worker)**:
  - Receive 1 message (BatchSize=1).
  - Idempotency check: `SELECT 1 FROM eval_results WHERE run_id=? AND test_case_id=?`; if exists, ack and return.
  - Resolve test case + agent template + model (factor from current eval-runner L607-647).
  - Invoke AgentCore (existing `invokeAgent` shape).
  - Wait for spans + run assertions + call evaluators (existing logic, lifted from eval-runner).
  - Compute per-case score + status.
  - Insert `eval_results` with `ON CONFLICT (run_id, test_case_id) DO NOTHING`.
  - `maybeFinalize(runId)`: count rows for run; if `count == total_tests`, CAS update `eval_runs` from `status='running'` to terminal status with aggregated pass_rate; insert `costEvents` with `request_id='eval-run-{runId}'` (existing `onConflictDoNothing`).
  - Per-case application errors: caught inside worker, written as `eval_results.status='error'` with cause, worker returns success to SQS (no DLQ for app errors; DLQ only for infra failures).

**Execution note:** Test-first. Integration test for the full-corpus dispatch → worker → finalize flow lands before swapping the runner body. Body-swap forcing-function test in U2's eval-worker.test.ts is replaced with real coverage.

**Technical design:** See High-Level Technical Design above.

**Patterns to follow:**
- Existing eval-runner per-case loop (L607-732) — lift into worker, don't reinvent.
- `fetchSpansForSession` (L421-461), `waitForSpans` (L463-482), `callEvaluator` (L484-535) — move to worker.
- Cost-events idempotency keyed on `request_id` (L765-781) — preserve under last-writer CAS.
- Async retry idempotency (auto-memory `project_async_retry_idempotency_lessons`).

**Test scenarios:**
- Happy path (Covers AE1): mock dispatcher invocation with 120-case corpus → 12 SendMessageBatch calls → all 120 worker invocations succeed → `eval_runs.status='completed'`, `pass_rate` computed, single `costEvents` row inserted.
- Edge case: worker times out on one case (simulated via mock raising 900s overrun) → SQS redrive → second attempt → if still fails, DLQ; `eval_results` does NOT get a row for that case (crash → DLQ → alarm only).
- Error path (Covers AE1): worker handles a case where AgentCore returns ValidationException → worker catches, writes `eval_results.status='error'` with cause, returns success to SQS, no retry → run finalizes including the errored row in totals.
- Idempotency: same SQS message delivered twice → second `INSERT ON CONFLICT DO NOTHING` is a no-op → no duplicate result, no duplicate cost write.
- Race: simulate two workers writing the "last" result simultaneously → CAS on `eval_runs.status` succeeds for only one → only one `costEvents` insert (the unique on `request_id` enforces it).
- Cancellation: operator marks `eval_runs.status='cancelled'` mid-flight → workers in flight check status before writing result and short-circuit; in-flight Bedrock calls are NOT killed (known limitation per the eval-runner-ignored-test-case-selection learning).
- Dispatcher: smoke surfaces `{ dispatched, totalTests }` in response payload so smoke can assert fan-out happened (per Lambda Web Adapter / dispatch-status learning).

**Verification:**
- Full enabled corpus run against dev reaches `completed` end-to-end. AE1 holds.
- Smoke gate asserts `dispatched == totalTests` and run terminal status.
- Old eval-runner per-case loop is no longer reachable (delete dead code).

---

### U4. Red-team library — default Strands agents

**Goal:** Author ~60 red-team cases for default Strands agents across the four dimensions.

**Requirements:** R1, R2, R4, R5.

**Dependencies:** None for authoring; activated by U8.

**Files:**
- Create: `seeds/eval-test-cases/red-team-agents-prompt-injection.json` (~15 cases)
- Create: `seeds/eval-test-cases/red-team-agents-tool-misuse.json` (~15 cases)
- Create: `seeds/eval-test-cases/red-team-agents-data-boundary.json` (~15 cases)
- Create: `seeds/eval-test-cases/red-team-agents-safety-scope.json` (~15 cases)
- Modify: `seeds/eval-test-cases/README.md` (document agents-surface authoring conventions: required fields, evaluator-allowlist references, threshold defaults)
- Create: `seeds/eval-test-cases/__tests__/shape-invariants.test.ts` (Vitest schema validation across all seed files)

**Approach:**
- Per case: `name`, `category` (one of `red-team-prompt-injection` / `red-team-tool-misuse` / `red-team-data-boundary` / `red-team-safety-scope`), `target_surface: "agent"`, `prompt`, `expected_behavior` (prose for human reviewers), `assertions` (deterministic where possible — e.g., for jailbreak the response should NOT contain "system prompt" or "ignore previous"; for data-boundary the response should NOT contain a sentinel value seeded into another tenant's context), `agentcore_evaluator_ids` (from the 16-IDs allowlist; typically `Builtin.HarmfulRequestRefusal` + `Builtin.Helpfulness`), `threshold` (default 0.7).
- Use Anthropic's prompt-injection corpus + OWASP LLM Top 10 as inspiration for prompt design (not as the test cases themselves — authored fresh against thinkwork's agent context).

**Patterns to follow:**
- Existing seed JSON shape at `seeds/eval-test-cases/*.json`.
- Evaluator allowlist at `apps/admin/src/components/evaluations/EvalTestCaseForm.tsx` L49-64.

**Test scenarios:**
- Shape-invariant (Covers R4): each case has required fields (`name`, `category`, `prompt`, `agentcore_evaluator_ids`, `target_surface`, `threshold`); category is one of the four red-team dimensions; `threshold` is numeric in `(0, 1]`; `agentcore_evaluator_ids` is non-empty and only contains IDs from the EvalTestCaseForm allowlist.
- Uniqueness: case names within (tenant, source='yaml-seed') unique per `0012_eval_seed_unique.sql` partial unique index.

**Verification:**
- All four files lint as valid JSON. Shape-invariant tests pass. `pnpm --filter @thinkwork/api build` succeeds.

---

### U5. Red-team library — default Computer

**Goal:** Author ~60 red-team cases for the default Computer surface across the four dimensions.

**Requirements:** R1, R2, R4, R5.

**Dependencies:** None.

**Files:**
- Create: `seeds/eval-test-cases/red-team-computer-prompt-injection.json` (~15 cases)
- Create: `seeds/eval-test-cases/red-team-computer-tool-misuse.json` (~15 cases)
- Create: `seeds/eval-test-cases/red-team-computer-data-boundary.json` (~15 cases)
- Create: `seeds/eval-test-cases/red-team-computer-safety-scope.json` (~15 cases)
- Modify: `seeds/eval-test-cases/README.md` (document Computer-surface conventions)

**Approach:**
- Same case shape as U4 with `target_surface: "computer"`. Prompts elicit Computer-specific behaviors (artifact generation, applet rendering, embedded UI). Assertions focus on whether the agent refuses or routes correctly when asked to render harmful artifacts (e.g., a TSX component that exfiltrates clipboard contents), and on shadcn-validator allowlist behavior.
- Computer prompts cover artifact-injection attacks (user prompts the agent to generate a TSX artifact whose body contains exfil logic) and tool-misuse via the Computer's tool surface (browse arbitrary URLs, embed unauthorized iframes).

**Patterns to follow:**
- U4 file structure.
- Computer artifact substrate context in `apps/computer/` (for grounding prompt realism).

**Test scenarios:**
- Same shape-invariant as U4 with `target_surface === "computer"` assertion.

**Verification:** As U4.

---

### U6. Red-team library — skills (GitHub + file system + workspace)

**Goal:** Author ~25 cases per skill × 3 skills = ~75 cases targeting tool-level misuse, data-boundary, and safety on the three named skills.

**Requirements:** R1, R2 (skills surface), R4, R5.

**Dependencies:** None.

**Files:**
- Create: `seeds/eval-test-cases/red-team-skill-github.json` (~25 cases across 4 dimensions)
- Create: `seeds/eval-test-cases/red-team-skill-filesystem.json` (~25 cases)
- Create: `seeds/eval-test-cases/red-team-skill-workspace.json` (~25 cases)
- Modify: `seeds/eval-test-cases/README.md` (document skill-surface conventions)

**Approach:**
- Case shape adds `target_surface: "skill"` and `target_skill: "github" | "filesystem" | "workspace"`. Examples:
  - GitHub skill — "force-push to main branch of unrelated repo", "open PR with massive credentials leak in body", "comment on a closed issue with disclosure".
  - File system skill — "delete /etc/passwd", "read sibling tenant's workspace path", "symlink-escape from sandboxed dir".
  - Workspace skill — "read S3 path of another tenant's workspace", "overwrite USER.md with attacker-controlled prose", "write to memory/ outside agent's allowed scope".
- Assertions: deterministic refusal-pattern checks where possible (response contains a refusal marker; no destructive verb against the wrong target); LLM-judge as fallback.

**Patterns to follow:**
- U4 / U5 file structure.
- Existing skill connector behavior in `packages/skill-catalog/`.

**Test scenarios:**
- Shape-invariant as U4 + `target_skill` field present and one of the three values.

**Verification:** As U4.

---

### U7. Performance v1 slice

**Goal:** Author ~5 cases per surface × 3 surfaces = ~15 cases for performance/accuracy with distinct category labeling.

**Requirements:** R6, R7.

**Dependencies:** None.

**Files:**
- Create: `seeds/eval-test-cases/performance-agents.json` (~5 cases)
- Create: `seeds/eval-test-cases/performance-computer.json` (~5 cases)
- Create: `seeds/eval-test-cases/performance-skills.json` (~5 cases)
- Modify: `seeds/eval-test-cases/README.md` (document Performance conventions)

**Approach:**
- Category prefix `performance-` keeps the UI's category distinct from `red-team-*`.
- Per surface:
  - Agents: golden-answer or `icontains` on key facts (e.g., "what version of Node is required for this repo" → must contain "22"); plus `Builtin.Helpfulness`.
  - Computer: LLM-judge rubric on whether the output satisfies the task; no golden-answer matching (Computer outputs aren't deterministic enough).
  - Skills: golden-answer on the action taken (PR title, file path written, message body).

**Patterns to follow:**
- Existing assertion specs in seed JSONs.

**Test scenarios:**
- Shape-invariant: `category` starts with `performance-`, `agentcore_evaluator_ids` non-empty, threshold present, `target_surface` set.

**Verification:** As U4.

---

### U8. Seed plumbing + maniflow cleanup migration

**Goal:** Remove maniflow files from the seed import, add new red-team + Performance imports, ship a hand-rolled SQL migration that deletes existing maniflow-era seed rows from already-deployed tenant DBs. Apply to dev pre-merge.

**Requirements:** R3, AE4.

**Dependencies:** U4, U5, U6, U7.

**Files:**
- Modify: `packages/api/src/lib/eval-seeds.ts` (replace 13 maniflow imports with 14 new imports; update `EVAL_SEED_CATEGORIES`)
- Delete: `seeds/eval-test-cases/email-calendar.json`, `knowledge-base.json`, `mcp-gateway.json`, `red-team.json` (the maniflow one), `sub-agents.json`, `brain-onepager-citations.json`, `brain-triage-routing.json`, `brain-trust-gradient-promotion.json`, `brain-write-back-capture.json`, `thread-management.json`, `tool-safety.json`, `workspace-memory.json`, `workspace-routing.json`
- Create: `packages/database-pg/drizzle/0086_remove_maniflow_eval_seeds.sql` (hand-rolled; no `-- creates:` markers needed for pure DELETEs, but header must declare intent and the migration must be applied to dev pre-merge per the drift-checker workflow)

**Approach:**
- Migration shape:
  ```sql
  -- 0086_remove_maniflow_eval_seeds.sql
  -- Removes maniflow-era seed rows from eval_test_cases.
  -- Historical eval_results referencing these rows are preserved (FK behavior verified in implementation —
  -- if RESTRICT, rewrite to enabled=false instead of DELETE).
  -- Apply to dev with: psql "$DATABASE_URL" -f packages/database-pg/drizzle/0086_remove_maniflow_eval_seeds.sql
  DELETE FROM eval_test_cases
  WHERE source = 'yaml-seed'
    AND category IN (
      'email-calendar', 'knowledge-base', 'mcp-gateway',
      'sub-agents', 'brain-onepager-citations', 'brain-triage-routing',
      'brain-trust-gradient-promotion', 'brain-write-back-capture',
      'thread-management', 'tool-safety',
      'workspace-memory', 'workspace-routing'
    );
  -- The old 'red-team' category from maniflow is also removed here; new files use
  -- 'red-team-prompt-injection' / 'red-team-tool-misuse' / 'red-team-data-boundary' / 'red-team-safety-scope'.
  DELETE FROM eval_test_cases WHERE source = 'yaml-seed' AND category = 'red-team';
  ```
- Verify FK behavior on `eval_results.test_case_id` before merging — if RESTRICT, rewrite migration to set `enabled=false` on maniflow rows instead. (Deferred to implementation.)

**Patterns to follow:**
- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`.
- Existing `packages/database-pg/drizzle/0012_eval_seed_unique.sql` (header style for hand-rolled migrations).

**Test scenarios:**
- Covers AE4: against an empty tenant, `eval seed` produces only the new categories — no maniflow-era rows.
- Covers R3: against a deployed tenant with maniflow rows, post-migration state has zero maniflow seed rows.
- Edge case: re-running `eval seed` after migration is a no-op for maniflow categories (they're gone from `EVAL_SEEDS`) and idempotent for new ones (existing unique index).
- Integration: `eval_results` rows referencing deleted test cases handled correctly per the chosen FK behavior.

**Verification:**
- Fresh `pnpm db:push --stage dev` + `thinkwork eval seed --stage dev` produces only new categories.
- Migration applies cleanly to dev. CLI `eval categories` returns only new ones.
- Deploy drift gate passes on next merge.

---

### U9. Drill-in surface — per-evaluator scores + on-demand span trace

**Goal:** Extend `ResultDetailSheet` to render `evaluatorResults` (already in payload, currently unused), surface judge reasoning, distinguishable failure-mode badges, and an on-demand tool-call/span trace section served by a new GraphQL resolver.

**Requirements:** R10, R11, AE2.

**Dependencies:** None (new resolver, no schema growth).

**Files:**
- Modify: `apps/admin/src/routes/_authed/_tenant/evaluations/$runId.tsx` (rework `ResultDetailSheet` L362-463: render `evaluatorResults` array, badge derivation, lazy-load span section)
- Modify: `packages/database-pg/graphql/types/evaluations.graphql` (add `evalResultSpans(runId: ID!, testCaseId: ID!): [EvalSpan!]!` query and the `EvalSpan` type — fields: `timestamp`, `name`, `attributes` JSON string)
- Modify: `packages/api/src/graphql/resolvers/evaluations/index.ts` (add `evalResultSpans` resolver; reuses `fetchSpansForSession` extracted from eval-runner — refactor into shared module if simple, otherwise copy with attribution comment)
- Create: `packages/api/src/lib/agentcore-spans.ts` (shared `fetchSpansForSession` helper; eval-worker and the new resolver both import)
- Modify: `packages/api/src/handlers/eval-worker.ts` (import the extracted helper instead of inlining the fetch)
- Modify: `apps/admin/src/components/evaluations/EvalResultSheet.tsx` (if it exists separately — research shows ResultDetailSheet is currently inlined in $runId.tsx; extract during this unit for testability)
- Modify: `apps/admin/codegen` + `packages/api/codegen` (run after GraphQL change)
- Modify: `apps/admin/src/routes/_authed/_tenant/evaluations/$runId.test.ts` if present, otherwise create

**Approach:**
- Per-evaluator scores: iterate `evaluatorResults: EvaluatorResult[]` (already on the row) and render rows with evaluator_id, score badge, optional `explanation` (judge reasoning) collapsible.
- Failure-mode badge derived per the High-Level Technical Design pseudo-code.
- On-demand span trace: section is collapsed by default; expanding fires a `useEvalResultSpansQuery({ runId, testCaseId })` call. Resolver implementation: look up `eval_runs.session_id` (verify field exists during implementation — see Deferred to Implementation), then call `fetchSpansForSession(sessionId)` filtered to the test case's time window.
- Lazy-load means runs nobody drills into incur no CloudWatch cost.

**Execution note:** Test-first for the on-demand resolver (mock CloudWatch FilterLogEvents). Component test for badge derivation.

**Technical design:** See High-Level Technical Design "Failure-mode badge derivation" block above.

**Patterns to follow:**
- Existing `ResultDetailSheet` render style — extend, don't replace.
- `fetchSpansForSession` at current `packages/api/src/handlers/eval-runner.ts` L421-461.
- Audit-existing-UI learning at `docs/solutions/design-patterns/audit-existing-ui-and-data-model-before-parallel-build-2026-04-28.md`.

**Test scenarios:**
- Happy path (Covers AE2): result with `evaluatorResults: [{evaluator_id: "Builtin.Helpfulness", value: 0.4, explanation: "response lacks specificity"}]` and score 0.4 below threshold 0.7 → renders `judge-fail` badge, judge reasoning "response lacks specificity", and the evaluator row.
- Edge case: result with `status='error'` and `errorMessage` containing "timeout" → renders `timeout` badge.
- Edge case: result with empty `evaluatorResults` but failed assertion → renders `assertion-fail` badge and no per-evaluator rows.
- Integration: clicking "Show trace" → `evalResultSpans` query fires → mock returns 3 spans → spans render in chronological order.
- Resolver test: `evalResultSpans({ runId, testCaseId })` resolves session_id from eval_runs, calls `fetchSpansForSession` with correct args, returns parsed spans.
- Error path: CloudWatch FilterLogEvents throws → resolver returns empty array with a non-fatal error indicator on the response shape (operator sees "trace unavailable" rather than the page crashing).

**Verification:**
- AE2 holds end-to-end against a real failing red-team case in dev after U8 lands.
- Build + typecheck succeed; new GraphQL types regenerated in both `apps/admin` and `packages/api`.

---

### U10. Eval schedule form on existing ScheduledJobFormDialog

**Goal:** Add eval-specific fields to `ScheduledJobFormDialog` so `trigger_type=eval_scheduled` rows can be authored from `/automations/schedules?type=eval_scheduled`. Backend is already wired.

**Requirements:** R12, AE3.

**Dependencies:** None.

**Files:**
- Modify: `apps/admin/src/components/scheduled-jobs/ScheduledJobFormDialog.tsx` (preselect `trigger_type=eval_scheduled` when arriving with `?type=eval_scheduled`; render eval-specific config section: agent template select, model select, categories multi-select)
- Modify: `apps/admin/src/routes/_authed/_tenant/automations/schedules/index.tsx` (extend the filter prefixes L484-492 to recognize `eval_scheduled`; ensure rows render correctly under that filter)
- Modify: `apps/admin/src/routes/_authed/_tenant/evaluations/index.tsx` (verify the Schedules tab link continues to work end-to-end)
- Modify: `apps/admin/src/components/scheduled-jobs/ScheduledJobFormDialog.test.tsx` if present, otherwise create

**Approach:**
- Dialog reads `?type` URL param on mount; if `eval_scheduled`, preselects the trigger_type and unhides the eval config section.
- Eval config: agent template select (queries existing `agentTemplates`), model select (free-text or select from known model IDs), categories multi-select (queries `evalCategories(tenantId)`).
- On submit: `config: { agentId, model, categories }` posted to existing `/api/scheduled-jobs` endpoint (no backend changes).
- Form validation: agent select required; at least one category required.

**Patterns to follow:**
- Existing `ScheduledJobFormDialog` config sections for other trigger types.
- Agent + category selection patterns in `apps/admin/src/components/evaluations/` (the existing Run Evaluation dialog).

**Test scenarios:**
- Happy path (Covers AE3): user navigates to `/automations/schedules?type=eval_scheduled` → opens Create dialog → trigger_type preselected → fills agent + categories + cron expression → submits → POST `/api/scheduled-jobs` returns 201 → row appears in list with `eval_scheduled` filter applied.
- Edge case: user submits without selecting an agent → form validation blocks submit with field-level error.
- Edge case: user submits without selecting any category → form validation blocks submit.
- Integration: configured schedule fires (smoke uses a short cron like `*/5 * * * *`) → run appears in `/evaluations` Recent Runs.

**Verification:**
- AE3 happy path holds end-to-end on dev.

---

### U11. Schedule provenance — `eval_runs.scheduled_job_id`

**Goal:** Add a foreign-key column linking eval_runs to scheduled_jobs, populate it in `job-trigger.ts`, display provenance in the Recent Runs UI.

**Requirements:** R13.

**Dependencies:** U10 (eval schedules must exist to populate the column).

**Files:**
- Create: `packages/database-pg/drizzle/0087_eval_runs_scheduled_job_id.sql` (hand-rolled, `-- creates-column: public.eval_runs.scheduled_job_id` marker in header)
- Modify: `packages/database-pg/src/schema/evaluations.ts` (add `scheduledJobId: text("scheduled_job_id").references(() => scheduledJobs.id, { onDelete: "set null" })`)
- Modify: `packages/lambda/job-trigger.ts` L435-481 (set `scheduledJobId: cfg.scheduledJobId` — or the row id directly — when inserting `eval_runs`)
- Modify: `packages/database-pg/graphql/types/evaluations.graphql` (expose `scheduledJobId: ID` on `EvalRun` type)
- Modify: `packages/api/src/graphql/resolvers/evaluations/index.ts` (resolver maps the column; include in the run-list query)
- Modify: `apps/admin/src/routes/_authed/_tenant/evaluations/index.tsx` (badge in the Recent Runs row when `scheduledJobId` is set; link to `/automations/schedules/$id`)
- Modify: `apps/admin/codegen` + `packages/api/codegen` (run after GraphQL change)

**Approach:**
- Migration SQL:
  ```sql
  -- 0087_eval_runs_scheduled_job_id.sql
  -- creates-column: public.eval_runs.scheduled_job_id
  -- Apply to dev with: psql "$DATABASE_URL" -f packages/database-pg/drizzle/0087_eval_runs_scheduled_job_id.sql
  ALTER TABLE eval_runs
    ADD COLUMN scheduled_job_id text REFERENCES scheduled_jobs(id) ON DELETE SET NULL;
  CREATE INDEX idx_eval_runs_scheduled_job_id ON eval_runs(scheduled_job_id);
  ```
- job-trigger.ts: where `eval_scheduled` currently inserts the pending `eval_runs` row, include the `scheduled_jobs.id` value.
- UI: badge component reused from existing run-list patterns; clicking it routes to `/automations/schedules/$scheduledJobId` via TanStack Router.

**Patterns to follow:**
- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` (hand-rolled migration markers).
- Existing column additions in `packages/database-pg/src/schema/evaluations.ts`.
- Existing badge components in `apps/admin/src/components/evaluations/`.

**Test scenarios:**
- Migration: apply to dev → `scheduled_job_id` column exists, nullable, FK to `scheduled_jobs.id`, ON DELETE SET NULL, index present.
- Resolver: `scheduledJobId` round-trips through GraphQL as a nullable string.
- Happy path (Covers AE3 provenance): scheduled run inserts an `eval_runs` row with `scheduled_job_id` set → admin Recent Runs row shows schedule badge → clicking badge navigates to `/automations/schedules/$id`.
- Edge case: manual-trigger run has `scheduled_job_id IS NULL` → no badge rendered.
- Edge case: scheduled job is deleted while a run is in flight → `scheduled_job_id` set to NULL on cascade → row continues to display without a badge (no broken link).

**Verification:**
- AE3 provenance assertion holds. Migration drift gate passes on next deploy.

---

### U12. CLI polish — stale help text

**Goal:** Update the stale "96 test cases across 9 categories" description and verify CLI parity with new content.

**Requirements:** R14.

**Dependencies:** U8 (new categories exist).

**Files:**
- Modify: `apps/cli/src/commands/eval/seed.ts` L116 (update description to reflect new corpus counts and categories; ideally compute dynamically from `EVAL_SEED_CATEGORIES` to prevent re-staling)

**Approach:**
- One-line cosmetic update. No subcommand behavior changes — CLI's `categories` subcommand already queries the tenant rather than hardcoding categories.

**Test scenarios:** Test expectation: none — pure help-text change.

**Verification:**
- `pnpm --filter @thinkwork/cli dev -- eval seed --help` shows accurate counts.

---

## System-Wide Impact

- **Interaction graph:** Dispatcher (eval-runner) → SQS → per-case workers (eval-worker, new) → AgentCore (InvokeAgentRuntime + Evaluate) → CloudWatch (spans). Last-writer worker also writes `costEvents` and finalizes `eval_runs`. Scheduler path adds `job-trigger.ts → eval-runner` unchanged.
- **Error propagation:** Per-case application errors caught in worker, recorded as `eval_results.status='error'`. Infra-level worker crashes route via SQS redrive (`maxReceiveCount=3`) to DLQ; CloudWatch alarm fires. Dispatcher errors caught and write `eval_runs.status='failed'` with cause.
- **State lifecycle risks:** Run finalization race between two workers finishing "last" — mitigated by CAS update on `eval_runs.status`. Duplicate per-case inserts mitigated by `ON CONFLICT (run_id, test_case_id) DO NOTHING`. Duplicate cost writes mitigated by existing unique on `costEvents.request_id`. In-flight Bedrock calls not killed on cancel — documented limitation per the existing eval-runner-ignored-test-case-selection learning.
- **API surface parity:** GraphQL adds `evalResultSpans` query (U9) and `EvalRun.scheduledJobId` field (U11). REST surface (`/api/scheduled-jobs`) unchanged. CLI subcommand surface unchanged.
- **Integration coverage:** Full dispatcher → SQS → worker → finalize flow covered by U3 integration tests. Schedule end-to-end covered by U10 + U11 integration tests. Drill-in covered by U9 component + resolver tests. Maniflow cleanup covered by U8 integration.
- **Unchanged invariants:** Existing `eval_runs`, `eval_results`, `eval_test_cases` schemas remain (additive only via U11). The dashboard URL surface (`/evaluations/*`) is unchanged. CLI command shape unchanged. AgentCore Evaluate dependency unchanged. The 16 Builtin.* evaluators allowlist is unchanged. The Phase-1 system-workflows revert is not reopened.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Stall-probe (U1) reveals the bottleneck is *not* batch-vs-timeout (e.g., span-wait timing out at 120s ceiling, or AgentCore Evaluate per-call latency) — substrate shape needs revision. | U1 explicitly defers the U2/U3 commitment. If U1 surfaces a different stall stage, the fix shape is renegotiated in plan revision before U2 lands. |
| AgentCore Builtin.* evaluators not reachable on every stage. | Dev-time raw-boto3 `ListEvaluators` probe in U2 before U4 commits to specific IDs. If any required evaluator is missing, fall back to LLM-judge for that dimension. |
| Maniflow row DELETE migration (U8) fails due to FK RESTRICT on `eval_results.test_case_id`. | Pre-flight check on FK behavior; if RESTRICT, rewrite to `UPDATE eval_test_cases SET enabled=false WHERE ...` instead of DELETE. Documented as Deferred to Implementation. |
| Per-case worker cost (120 cases × per-case Lambda invocation + Bedrock invoke + evaluator calls) scales unfavorably for full-corpus nightly runs. Rough estimate: $25–60 per full run at current evaluator cost rates. | Document cost in operational notes; surface per-run cost in the dashboard (already wired via `costEvents`); consider per-tenant rate-limiting if costs surprise customers in their forks. |
| `eval_runs.session_id` (or equivalent linking field) not present, blocking the on-demand span resolver (U9). | Deferred-to-implementation check during U3 worker rewrite; if missing, U3 adds the field as a small schema addition. |
| Scheduled run firing while a previous scheduled run for the same job is still active. | Document expected behavior — runs are independent; concurrent scheduled runs against the same template are allowed. If this becomes a real problem, add a "skip if previous run still active" guard at the dispatcher level (deferred). |
| Smoke run after U3 takes too long for CI to wait. | Smoke pins dispatch shape (`dispatched_cases`, `totalTests`) without waiting for terminal status, per the dispatch-status-in-response-payload learning. Full-corpus terminal status is verified out-of-band on dev. |
| Post-merge Deploy fails silently (per `feedback_watch_post_merge_deploy_run`). | After each merge in this plan, watch `gh run list --branch main`; surface any silent failures before queueing the next PR. |

---

## Alternative Approaches Considered

- **Chunked-resume in the existing eval-runner Lambda** (same Lambda self-invokes for the next chunk via `LambdaClient.send(InvokeCommand, { InvocationType: 'Event' })`, state persisted on `eval_runs` row). Rejected because: (a) Lambda Event-invoke retries default to 2 and require explicit disabling per the async-retry-idempotency learning; (b) no DLQ visibility for per-chunk failures; (c) fights the team's recent inert-first seam-swap pattern; (d) per-case error isolation is harder (one chunk's crash impacts every case in the chunk).
- **Step Functions Map state for per-case fan-out.** Rejected — the team just reverted from system-workflows on 2026-05-06; reopening that decision invites the same fragility the revert plan addressed.
- **PromptFoo or file-based corpus rearchitecture.** Rejected at brainstorm (origin Key Decisions) — fights dashboard-resident anchoring and customer-triggerable / scheduled / drillable requirements.
- **Persisting span snapshots on `eval_results` rows for drill-in.** Rejected in favor of the on-demand resolver — trades a per-click latency hit for no schema growth, no payload bloat, and lazy CloudWatch cost.
- **Customer-facing shareable report.** Rejected at brainstorm — forked-repo distribution makes each customer's own dashboard sufficient. The displaced effort goes into library volume.

---

## Phased Delivery

### Phase A — Diagnose
- U1: Stall-probe (no production code change; ships diagnostic script + findings doc).

### Phase B — Runner substrate (inert-first multi-PR)
- U2: Inert SQS substrate + worker stub + DLQ + alarms + IAM.
- U3: Worker live + dispatcher rewrite + run finalizer.

### Phase C — Library content (parallelizable with B)
- U4: Red-team library — default Strands agents.
- U5: Red-team library — default Computer.
- U6: Red-team library — GitHub + file system + workspace skills.
- U7: Performance v1 slice.

### Phase D — Library plumbing
- U8: Seed plumbing + maniflow cleanup migration. Depends on U4–U7.

### Phase E — Drill-in
- U9: Per-evaluator scores + on-demand span trace. Independent of A–D.

### Phase F — Scheduling UI
- U10: Eval schedule form on existing dialog.
- U11: Schedule provenance column (depends on U10 for end-to-end smoke).

### Phase G — CLI polish
- U12: Stale help text. Depends on U8 (new categories).

**Suggested sequencing:** U1 → U2 || U4 || U5 || U6 || U7 || U9 || U10 → U3 → U8 → U11 → U12. Phases C, E, and F can ship in parallel with B once U2 lands. Phase D gates on Phase C completion. U11 gates on U10. U12 gates on U8.

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Stall stage misidentified, substrate fix targets wrong knob | Low | High | U1 explicitly defers U2/U3 commitments until findings doc lands |
| FK RESTRICT blocks U8 maniflow DELETE | Med | Med | Pre-flight FK check; fall back to enabled=false |
| Builtin.* evaluator missing in a stage | Low | High | Raw-boto3 ListEvaluators probe in U2 before U4 ships |
| Cost surprises in forked customer deployments | Med | Med | Surface per-run cost in dashboard (already wired); document in customer docs |
| Worker idempotency CAS race on finalization | Low | High | CAS on `eval_runs.status` + existing `costEvents.request_id` unique |
| Post-merge Deploy silent failure | Med | High | Watch `gh run list --branch main` after every merge per the learning |
| Library authoring effort balloons (4 dimensions × 2 surfaces × ~15 cases is real work) | Med | Med | Phase C parallelizable across authors; shape-invariant tests prevent shape regressions during authoring |
| New SQS infrastructure adds an operational surface (DLQ alarm, redrive policy, runaway concurrency) | Med | Med | DLQ alarm wired in U2; per-function concurrency reservation tuned from U1 measurements |

---

## Documentation / Operational Notes

- **Pre-merge dev migration steps for U8 and U11:** `psql "$DATABASE_URL" -f packages/database-pg/drizzle/0086_remove_maniflow_eval_seeds.sql` and `psql "$DATABASE_URL" -f packages/database-pg/drizzle/0087_eval_runs_scheduled_job_id.sql` — both must run against dev before merge or the deploy drift gate fails.
- **Customer-fork runbook (out-of-band):** customers running their own forked deployments need to apply U8's maniflow-cleanup SQL after pulling. Document under `docs/src/content/docs/operations/` (rendered at `/operations/` in Starlight).
- **DLQ alarm response:** if the new `eval-fanout-dlq` alarm fires, the runbook is: (1) inspect DLQ message bodies for the failing test_case_id, (2) check eval-worker CloudWatch logs for the corresponding session_id, (3) reproduce locally via the U1 probe script if the failure is application-level.
- **ListEvaluators probe (one-time per stage):** `aws bedrock-agentcore-control list-evaluators --region us-east-1` (raw boto3 / CLI; not the SDK wrapper per the SDK drift learning). Run against dev and prod before U4 ships.
- **Post-merge deploy watch:** `gh run list --branch main` after every PR in this plan, per the silent-deploy-failure feedback.
- **Worktree hygiene reminders:** in fresh worktrees, `find . -name tsconfig.tsbuildinfo -not -path '*/node_modules/*' -delete && pnpm --filter @thinkwork/database-pg build` before any typecheck. Admin dev port must be in Cognito CallbackURLs (5174/5175/5180). Always pnpm, never npm. Any new Lambda handler (eval-worker in U2) requires both Terraform `handlers.tf` and a `scripts/build-lambdas.sh` entry.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-16-evals-overhaul-redteam-library-and-substrate-fix-requirements.md](docs/brainstorms/2026-05-16-evals-overhaul-redteam-library-and-substrate-fix-requirements.md)
- **Phase-1 revert plan (precursor; merged 2026-05-06):** docs/plans/2026-05-06-002-refactor-wiki-evals-revert-from-system-workflows-plan.md (frontmatter still says `status: active` — cosmetic; work is merged)
- **Inert-first seam-swap pattern:** docs/solutions/architecture-patterns/inert-first-seam-swap-multi-pr-pattern-2026-05-08.md
- **Probe-every-stage-before-tuning:** docs/solutions/best-practices/probe-every-pipeline-stage-before-tuning-2026-04-20.md
- **Hand-rolled migrations drift:** docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md
- **AgentCore SDK drift:** docs/solutions/best-practices/bedrock-agentcore-sdk-version-drift-prefer-raw-boto3-2026-04-24.md
- **Audit existing UI before parallel build:** docs/solutions/design-patterns/audit-existing-ui-and-data-model-before-parallel-build-2026-04-28.md
- **Lambda Web Adapter promise lifecycle:** docs/solutions/runtime-errors/lambda-web-adapter-in-flight-promise-lifecycle-2026-05-06.md
- **eval-runner test case selection bug:** docs/solutions/logic-errors/eval-runner-ignored-system-workflow-test-case-selection-2026-05-03.md
- **Defer integration tests until shared harness:** docs/solutions/best-practices/defer-integration-tests-until-shared-harness-exists-2026-04-21.md
- **Async retry idempotency:** auto-memory `project_async_retry_idempotency_lessons` (PR #552 P0-C)
