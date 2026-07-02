---
date: 2026-07-01
topic: think-117-compilation-substrate
linear_issue: THINK-117
origin: docs/brainstorms/2026-07-01-think-117-customer-onboarding-resource-broker-requirements.md
---

# THINK-117 Design Note: Compilation Substrate & Latency Budget for the Onboarding Blocker Broker

**Resolves:** the "compilation substrate + latency budget" gate in
`docs/brainstorms/2026-07-01-think-117-customer-onboarding-resource-broker-requirements.md`
(R9–R11, R13, R53–R54).

## 1. Decision

The compilation substrate is a **labeled hybrid, weighted heavily
deterministic**: a pure-code gather/normalize layer, deterministic
blocker-selection rules evaluated over the operator-owned process definition
(R54), and a small number of explicitly-labeled LLM synthesis slots. The broker
call is synchronous with a **p50 ≤ 2.5 s / p95 ≤ 8 s / hard cap 15 s** budget,
met by serving P21 and n8n from pre-warmed mirrors rather than
fetch-on-request. This is not aspirational — it is the shape the codebase
already has: the existing `/mcp/context-engine` endpoint
(`packages/api/src/handlers/mcp-context-engine.ts`) does a parallel provider
fan-out with per-provider timeouts and **zero LLM calls on the request path**;
even its "answer" mode is deterministic string formatting over the top-5 hits
(`packages/api/src/lib/context-engine/synthesis.ts`).

## 2. Three-layer model

**Layer A — deterministic gather + normalize (pure code).** Reuse the Context
Engine router pattern (`packages/api/src/lib/context-engine/router.ts`):
`Promise.all` fan-out, per-source timeout (`DEFAULT_QUICK_TIMEOUT_MS = 2_500`,
`DEFAULT_DEEP_TIMEOUT_MS = 8_000`), and failures degrading to a provider-local
status carrying `state`, `durationMs`, `hitCount`, `error`. That status array
**is** the R29 coverage summary, nearly for free. Sources:
`work_items`/`linked_tasks` rows (Postgres), the normalized onboarding facts
already persisted in thread metadata (`normalizeCustomerOnboardingSource` in
`packages/api/src/lib/spaces/customer-onboarding-workflow.ts` —
`p21CustomerId`, `accountSetupBlockers`, `missingFields[]`,
tax/credit/DocuSign fields), the n8n execution mirror, and the P21 mirror.
Freshness stamps come from `last_synced_at` / `finishedAt` fields that already
exist.

**Layer B — deterministic blocker selection (rules over R54 process
definition).** More of this exists than the gate assumes.
`evaluateChecklistApplicability` already implements declarative applicability
rules (`always` / `when_true` / `when_missing_required_intake`) read from
checklist-item templates — data the compiler reads, not a workflow engine,
exactly R54's construction. `missingFields()` is a deterministic blocker
detector. `packages/api/src/lib/work-items/customer-onboarding.ts` maintains
`blocked`/`required`/`applicable` flags and status categories with a full
`workItemEvents` history. Blocker ranking, the no-active-blocker state, and
cross-source conflict detection (AE2: work item says "waiting on credit" while
P21 mirror says account ready → lower confidence, show both facts) are
rule-table extensions of this substrate. Confidence is a deterministic
function of coverage + freshness + conflict flags — never a model's
self-assessment.

**Layer C — labeled LLM synthesis slots.** Exactly three: (1) narrative
explanation of the ranked blocker set; (2) summarization of free-text evidence
(`accountSetupBlockers` is prose, as are Work Item notes); (3) Company Brain /
Hindsight `reflect` output — `reflect` is LLM read-synthesis (it runs its own
model per `packages/api/src/lib/hindsight-cost.ts`; the memory provider
exposes `recall` vs `reflect` in
`packages/api/src/lib/context-engine/providers/memory.ts`). Default the Brain
slot to `recall` (raw units, source-fact origin); `reflect` output, when used,
lands in a synthesis slot.

**Payload mapping:** blocker list, statuses, freshness, coverage, conflicts,
confidence, actions → Layers A+B. Prose explanation and evidence summaries →
Layer C, each tagged. The MCP response reuses the existing `content`
(model-readable text) + `structuredContent` envelope from
`mcp-context-engine.ts`; the MCP App resource renders the structured payload
(net-new output path per the brainstorm's Dependencies — internal
`thread-json-render` in `packages/api/src/lib/thread-json-render/` is
ThinkWork-client-only today).

## 3. Latency budget

Hard constraints: the endpoint sits behind HTTP API Gateway, whose integration
timeout caps at **30 s**; the MCP TypeScript SDK's default request timeout is
**60 s**, but host UX (Claude's tool-call spinner) degrades well before that.
Budget: **p50 ≤ 2.5 s, p95 ≤ 8 s, hard cap 15 s**. Breakdown: auth + posture
resolution ≤ 200 ms; parallel source fan-out ≤ 2.5 s (each source individually
timed out, matching the router's quick budget — Postgres read-model queries
are ~50–300 ms); rules + assembly ≤ 100 ms; optional LLM synthesis slot ≤ 4 s
(one bounded call, skippable — return `synthesis: unavailable` rather than
block).

**Pre-warmed read model, not fetch-on-request.** P21 and n8n cannot be inside
a 2.5 s fan-out reliably. Both patterns exist in-repo: webhook/event-driven
mirroring (`sync-linked-task.ts`, `refresh-linked-tasks.ts` for LastMile →
`linked_tasks`/`work_items`) and on-demand API pulls (`discoverN8nExecutions`
in `packages/api/src/lib/workflows/n8n-executions.ts`, which hits the tenant
n8n API with stored credentials). Recommend: **background sync into
ThinkWork's DB is the serving path**; the broker reads mirrors and stamps
freshness. A live revalidate of a single stale source may run within the 2.5 s
slot; on miss, return the partial view with the gap named in the coverage
summary (R30) — never block the whole answer on a slow external system.

## 4. False-authority guardrails

Every evidence-board entry carries an `origin` discriminator — `source_fact`
(provenance: providerId, source record ref, `fetchedAt`), `derived_rule`
(ruleId + process-definition version + input fact refs), or `llm_synthesis`
(modelId, prompt ref, input evidence refs) — rendered distinctly in the
command center. Layer C output can cite but never mint facts: synthesis slots
receive only Layer A/B evidence and their claims link back to it. R53
correction capture: coordinator corrections write `workItemEvents`-style
events plus `emitAuditEvent` (`packages/api/src/lib/compliance/emit.ts`, typed
event enums, hash-chained log) keyed by ruleId or synthesis-slot id, so
correction rate is measurable **per layer** — a mislabeled rule is fixed in
the rule table; a bad synthesis tightens or removes the slot.

## 5. What this rules out

- **Running the Pi agent loop inside the broker call** — minutes-scale,
  nondeterministic, wakeup-based; incompatible with a 15 s synchronous budget
  and R55's structural read-only posture.
- **Pure-LLM compilation** — reintroduces the sampling/false-authority failure
  R28–R31 exist to prevent, makes confidence un-auditable, and busts the
  budget.
- **Fetch-on-request to P21/n8n as the primary path**; and unlabeled `reflect`
  output flowing into "canonical" fields.

## 6. Open questions for planning

1. P21 mirror mechanism: n8n-mediated push, scheduled pull Lambda, or extend
   the LastMile-style webhook sync — and target freshness SLO (≤ 15 min?).
2. Does the broker reuse `ContextEngineService` providers or a sibling
   `broker/` module sharing router/timeout/status types?
3. Conflict-rule authoring surface: where does the operator edit the R54
   process definition + conflict table (checklist `external_task_template`
   config vs. new source-map entity)?
4. New `COMPLIANCE_EVENT_TYPES` needed for broker calls / evidence display /
   corrections (R23, R31)?
5. Which model + invocation path backs synthesis slots (Bedrock direct from
   the Lambda vs. Hindsight `reflect` only), and is the slot on by default or
   `depth: deep`-gated?
