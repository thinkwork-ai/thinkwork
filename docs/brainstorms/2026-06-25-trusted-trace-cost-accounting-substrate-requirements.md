---
date: 2026-06-25
topic: trusted-trace-cost-accounting-substrate
---

# Trusted Trace and Cost Accounting Substrate

## Problem Frame

ThinkWork has useful thread history, cost events, runtime diagnostics, and
evaluation snapshots, but they are not yet grounded in a single trustworthy
observability substrate. Thread history and Activity views are currently too
close to being the source of truth: they join `thread_turns.usage_json`,
`cost_events`, runtime phase logs, CloudWatch Bedrock invocation logs, and eval
snapshot evidence in different places.

That fragmentation is now a product risk. Budgets depend on accurate usage and
cost numbers, but prior zero-token incidents show that a normalizer drift can
silently corrupt budget-facing data. Operators also lack good access to trace
detail without falling back to CloudWatch/X-Ray consoles, which makes debugging,
eval case creation, and user-data understanding harder than it should be.

ThinkWork needs an exhaustive trace and accounting substrate underneath the
simple user-facing thread projection. The substrate must reconcile provider
usage at the invocation level and provider billing at the bill/export level
before budget enforcement can be trusted.

---

## Actors

- A1. Tenant operator: debugs bad turns, reviews cost, configures budgets, and
  flags production failures into eval datasets.
- A2. Tenant user: generates foreground and background agent work that incurs
  model, tool, memory, and runtime cost.
- A3. ThinkWork runtime: emits trace, span, phase, tool, model, memory, and
  workspace evidence while executing a turn.
- A4. Accounting reconciler: compares runtime-reported usage, provider
  invocation evidence, and provider billing exports.
- A5. Eval system: snapshots trace evidence for replay, scoring, and later trace
  judgment.
- A6. Product surfaces: thread history, Activity, analytics, budgets, CLI, and
  future trace workbench views.

---

## Key Flows

- F1. Turn execution produces canonical trace evidence
  - **Trigger:** A foreground, scheduled, webhook, or eval replay turn runs.
  - **Actors:** A2, A3, A6
  - **Steps:** Runtime emits structured trace/span/event evidence for model
    calls, tool calls, phase timing, workspace hydration, memory/context
    retrieval, and final response. Product surfaces render simple thread history
    and Activity projections from that evidence.
  - **Outcome:** A user still sees a clean thread, while operators can drill
    into a complete correlated execution trace.
  - **Covered by:** R1, R2, R3, R4, R5

- F2. Usage is reconciled before hard budget enforcement
  - **Trigger:** A model/tool/runtime cost event is recorded.
  - **Actors:** A3, A4, A6
  - **Steps:** The platform stores runtime-reported usage, reconciles the
    invocation against provider-observed invocation logs, and later reconciles
    aggregate spend against provider billing exports. Each usage row carries a
    confidence/reconciliation state.
  - **Outcome:** Budgets are enforced only from usage that meets the required
    reconciliation bar, and mismatches become visible operational work instead
    of silent accounting drift.
  - **Covered by:** R6, R7, R8, R9, R10, R11

- F3. Operator inspects a bad turn
  - **Trigger:** An operator opens a suspicious or failed turn.
  - **Actors:** A1, A6
  - **Steps:** The surface shows thread history as the default projection and
    exposes a trace detail view with model requests, token counts, costs,
    tool invocations, timings, workspace/context evidence, and reconciliation
    status.
  - **Outcome:** The operator can explain what happened without copying IDs
    into CloudWatch or manually joining cost rows to logs.
  - **Covered by:** R12, R13, R14

- F4. Production failure becomes an eval case with evidence
  - **Trigger:** An operator flags a bad production turn.
  - **Actors:** A1, A5
  - **Steps:** The eval system snapshots the self-contained conversation,
    workspace projection, tool/model trace evidence, and resolution target.
  - **Outcome:** The resulting dataset case can replay against the current
    agent and retain the trace evidence needed for debugging and future trace
    judgment.
  - **Covered by:** R15, R16

---

## Requirements

**Canonical trace substrate**

- R1. ThinkWork owns a canonical trace model for agent execution evidence; thread
  history, Activity, CLI, analytics, evals, and audit views are projections from
  it rather than independent sources of truth.
- R2. Every turn has a stable trace identity that correlates thread turn,
  runtime session, model invocation, tool invocation, memory/context lookup,
  workspace hydration, response finalization, and cost rows.
- R3. The trace model supports parent/child relationships for model calls,
  tool calls, agent profile runs, sub-agent/profile lanes, memory calls, and
  runtime phases.
- R4. The substrate retains enough raw/provider references to reopen source
  evidence in AWS observability tools when needed, without requiring those tools
  for ordinary product use.
- R5. Product surfaces may stay simple, but no simple surface may become the
  only place where trace evidence exists.

**Trusted usage and billing**

- R6. Per-invocation provider-observed reconciliation is required for model
  usage: runtime-reported token/cost data must be reconciled against provider
  invocation logs or equivalent provider-observed evidence.
- R7. Exact provider-bill reconciliation is required: aggregate model, tool,
  memory, and runtime spend must reconcile against provider billing exports or
  account-level billing records.
- R8. Every usage/cost row carries an explicit reconciliation state, including
  at least runtime-reported, invocation-reconciled, bill-reconciled, mismatch,
  and unreconciled/error states.
- R9. Hard budget enforcement uses only usage that meets the configured
  reconciliation bar. Low-confidence usage can be shown with warnings, but must
  not silently drive strict enforcement.
- R10. Reconciliation mismatches are visible to operators with enough context to
  identify the affected tenant, user, turn, provider, model/tool, time window,
  and suspected cause.
- R11. Historical usage that cannot be reconciled is not silently upgraded or
  hidden; it remains marked with its true confidence state.

**Operator access**

- R12. Operators can inspect a turn's trace detail inside ThinkWork without
  manually searching CloudWatch or X-Ray.
- R13. Trace detail shows model/tool sequence, token counts, cache-read tokens,
  estimated cost, reconciled cost, duration, error state, workspace/context
  evidence, and the source evidence references used for reconciliation.
- R14. CLI trace commands expose the same canonical evidence and return
  diagnostic empty states instead of generic GraphQL failures.

**Evaluation and audit**

- R15. Flagging a thread for evaluation snapshots available trace evidence as
  part of the eval case, not merely the rendered thread transcript.
- R16. The trace substrate preserves enough provenance for later trace judgment
  and audit workflows, even though the main eval mode remains replay.

**Platform posture**

- R17. AWS observability remains the native infrastructure evidence layer for
  ThinkWork deployments, but trace detail cannot be locked inside CloudWatch as
  the only usable product surface.
- R18. Langfuse-style trace/eval workbench exploration is tracked separately
  and must not replace the trusted accounting substrate as the source of truth.

---

## Acceptance Examples

- AE1. **Covers R6, R8, R9.** Given a turn whose runtime response reports
  0 input/output tokens but provider invocation logs show non-zero usage, when
  reconciliation runs, then the canonical usage row is marked mismatch or
  corrected from provider evidence and hard budgets do not trust the zero-token
  runtime value.
- AE2. **Covers R7, R10.** Given a month of reconciled invocation rows, when the
  provider billing export arrives, then ThinkWork compares aggregate spend by
  tenant/user/model/provider and surfaces any variance outside the configured
  tolerance.
- AE3. **Covers R12, R13.** Given an operator opens a failed turn, when they
  expand trace detail, then they can see the model calls, tool calls, token/cost
  evidence, timing phases, and reconciliation states without leaving ThinkWork.
- AE4. **Covers R15, R16.** Given an operator flags a bad turn for evaluation,
  when the eval case is saved, then the case includes available tool/model trace
  evidence and provenance references alongside the conversation and resolution
  target.
- AE5. **Covers R11.** Given older cost rows recorded before provider
  reconciliation existed, when they appear in analytics, then they are labeled
  with their unreconciled confidence state rather than being presented as exact
  bill-grade data.

---

## Success Criteria

- Operators can debug a bad turn from ThinkWork's trace detail without using
  CloudWatch as the primary UI.
- Budget enforcement is trusted because per-invocation usage and provider bill
  reconciliation are explicit and auditable.
- Token/cost numbers shown in analytics and Activity indicate their confidence
  and reconciliation state.
- Eval cases created from production failures carry trace evidence rich enough
  to explain the failure and support future trace judgment.
- Planning can proceed without deciding whether Langfuse replaces AWS or
  ThinkWork accounting; it is explicitly a separate workbench exploration.

---

## Scope Boundaries

- This does not make Langfuse, CloudWatch, or X-Ray the ThinkWork product source
  of truth for budgets.
- This does not require exposing raw prompt/tool payloads everywhere; redaction,
  retention, and role-based access remain planning concerns.
- This does not define the full UI for a trace/eval workbench; that is a
  separate exploration issue.
- This does not replace the simple thread history experience for users.
- This does not require exact real-time provider bills before a turn can
  complete; bill reconciliation can be asynchronous, but must become the
  accounting truth.
- This does not automatically reinterpret historical usage as exact if provider
  evidence is missing.

---

## Key Decisions

- **Trace-first substrate:** thread history should become a projection from
  richer trace/accounting evidence, not the canonical execution record.
- **Provider evidence wins:** runtime-reported usage is useful, but provider
  invocation logs and provider bills are required for trusted accounting.
- **AWS-native evidence, ThinkWork-native product surface:** AWS observability
  remains the deployment-native source of infrastructure evidence, while
  ThinkWork owns correlation, reconciliation, retention, redaction, and product
  projection.
- **Workbench split:** Langfuse-style trace/eval workbench exploration is a
  separate effort and cannot block the trusted accounting substrate.

---

## Dependencies / Assumptions

- AgentCore Observability and CloudWatch/X-Ray provide trace/span evidence that
  can be correlated back to ThinkWork turn identity when instrumentation and
  trace propagation are configured correctly.
- Bedrock invocation logs or equivalent provider-observed records are available
  with enough request identity to reconcile per-invocation usage.
- Provider billing exports or account-level cost records can be obtained on a
  schedule suitable for exact asynchronous reconciliation.
- Current trace/cost/eval sources to account for include `cost_events`,
  `thread_turns.usage_json`, `thread_turn_events`, runtime `agentcore_phase`
  logs, CloudWatch Bedrock invocation logs, eval dataset snapshots, and existing
  analytics/account-usage surfaces.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1-R4][Technical] What is the smallest canonical trace model that can
  represent turns, spans, observations/events, costs, and source-evidence
  references without overfitting to CloudWatch or Langfuse?
- [Affects R6][Needs research] Which Bedrock/AgentCore invocation records carry
  stable request IDs, token counts, cache-read counts, and model IDs for every
  model path ThinkWork uses?
- [Affects R7][Needs research] Which AWS billing export path should provide the
  exact provider-bill reconciliation baseline for deployed customer accounts?
- [Affects R9][Product/technical] What reconciliation confidence threshold is
  required for hard budget enforcement versus soft warnings?
- [Affects R12-R14][Technical] Which existing UI and CLI trace surfaces should
  be migrated first to canonical trace evidence?
- [Affects R15][Technical] What trace evidence should be copied into eval cases
  versus referenced by durable ID, given retention and deletion requirements?

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
