---
title: Eval Execution Tiers - Requirements
type: feat
date: 2026-07-02
topic: eval-execution-tiers
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Eval Execution Tiers - Requirements

## Goal Capsule

- **Objective:** Make evaluation volume scale by matching each test case to the cheapest execution that can honestly answer it — a unit/component/integration tier split (Eric's framing, 2026-07-02) — so "thousands of evals against multiple profiles" stops meaning thousands of full agent turns.
- **Product authority:** Eric Odom (Linear THINK-107 continuation; phase 2 of the Eval Profiles work). Trigger: the 2026-07-02 dev benchmark — even after the throughput fixes (#3191, #3195), a 189-case full-agent baseline run costs ~23 minutes and ~$1.20 per profile, bounded by Bedrock quota. That is workable for one baseline but not for "thousands, against multiple profiles."
- **Status:** Requirements-only. Needs Eric's review of the tier model and the open questions before `ce-plan` enrichment.

## Measured cost baseline (dev, 2026-07-02)

Every number below is from real runs of the 189-case baseline (runs `e4276b9d`, `605f3d73`, `7998dc7f`):

| Execution shape                                                       | Latency (p50) | $/case (agent+judge) | 189 cases, 1 profile | 189 cases × 4 profiles × trials 3   |
| --------------------------------------------------------------------- | ------------- | -------------------- | -------------------- | ----------------------------------- |
| Full agent turn (today's only tier)                                   | ~7.5s         | ~$0.006              | ~23 min / ~$1.20     | ~9+ hours / ~$14 (quota-serialized) |
| Bare model call (projected: no workspace bootstrap, no tools, no MCP) | ~1–2s         | ~$0.001–0.002        | ~3–4 min / ~$0.30    | ~45 min / ~$3.50                    |
| Deterministic scoring of stored output (projected)                    | ~ms           | ~$0                  | seconds / ~$0        | seconds / ~$0                       |

The scaling problem is not the judge (evaluator cost is a small fraction) — it is that **every case pays for a full AgentCore turn** (workspace bootstrap, skill materialization, MCP wiring, memory plumbing) whether or not the behavior under test needs any of it.

## Product Contract

### Problem

All eval cases execute identically: SQS fan-out → full Pi agent turn via AgentCore → scoring. But the 189 baseline cases are mostly _refusal-shaped_: "given this hostile prompt, does the model refuse?" — behavior that a bare model call with the composed system prompt answers just as honestly at ~1/5 the latency and ~1/4 the cost. Only a minority of cases (tool misuse, data boundary via MCP, skill behavior, workspace effects) actually depend on the full agent harness. Meanwhile flagged-thread cases _already have_ a recorded output that deterministic assertions could score with zero invokes. One execution tier means the whole suite is priced at the most expensive case's cost.

### Goals

1. Cases declare (or are classified into) an **execution tier**; runs execute each case at its tier instead of uniformly at the most expensive one.
2. The baseline suite completes in **single-digit minutes per profile** at today's quotas, with the full-agent tier reserved for the cases that need it.
3. Tier is **visible and honest**: run detail and comparisons show what actually executed; a tier-2 pass is never silently presented as evidence of full-agent behavior.
4. Batching: cheap tiers amortize invocation overhead (many cases per worker invoke) instead of one Lambda round-trip per case.

### Non-goals

- No change to the verdict taxonomy (pass/fail/error/unstable + error_cause — settled).
- No change to profiles, trials, pinning, or telemetry (phase 1 substrate carries over unchanged; tiers are about the _invoke_, not the _scoring bookkeeping_).
- No live production sampling / flywheel (still deferred — separate phase).
- Not a replacement for the full-agent tier: integration evals remain the ground truth for tool/workspace behavior.

### The tier model

- **Tier 0 — `static` (unit):** score an already-recorded output. Applies to flagged-thread cases (the flag-time snapshot holds the agent's actual output) and to regression re-scoring after rubric/assertion edits. Zero model invokes; deterministic assertions + optional judge over stored text. Runs in the worker with no AgentCore/Bedrock dependency for the response side.
- **Tier 1 — `model` (component):** one stateless Bedrock Converse call — the profile's model + the case's system prompt (or the tenant's composed baseline prompt, captured once per run, not per case) + the case query. No workspace bootstrap, no tools, no MCP, no memory. This is Eric's "single agent running a bunch of tests": one worker invoke executes a _batch_ of tier-1 cases sequentially against the same warm client. Fits most of the current baseline (refusal/containment behavior).
- **Tier 2 — `agent` (integration):** today's full Pi turn via AgentCore. Required for anything whose behavior depends on tools, skills, workspace state, MCP boundaries, or multi-message replay. Skill evals and flagged-thread replays stay here.

Scoring is orthogonal and unchanged: deterministic assertions always run; llm-rubric judges run per the case; trials/unstable apply to judge-scored cases regardless of tier.

### Requirements

- **R1.** Case schema (seed packs + dataset case files + Studio) gains `execution_tier: static | model | agent`. Missing = `agent` (today's behavior; nothing silently gets cheaper).
- **R2.** The eval-runner fans out by tier: tier-2 keeps per-case messages; tier-1 cases batch N-per-message (N tunable) into the same FIFO/profile machinery; tier-0 cases score inline at dispatch or in one batch message.
- **R3.** Tier-1 execution uses the pinned profile's model and records the same per-case telemetry (tokens, cost, duration) — the comparison view needs no changes to stay honest.
- **R4.** A one-time classification pass over the 189 baseline cases proposes a tier per case (heuristic + adjudication PR, same channel as the quality_state audit): expected outcome ~80% tier-1, ~20% tier-2, 0 tier-0 (baseline has no recorded outputs).
- **R5.** Tier is visible: result rows carry the executed tier; run detail groups or badges by tier; the comparison view flags cross-tier comparisons (a tier-1 run vs a tier-2 run of the same dataset is not comparable — extends the KTD6 gate).
- **R6.** Tier-2-only invariants stay guarded: cases asserting on tool calls, guard events, or workspace projections must reject `model`/`static` tiers at authoring/adjudication time (a tier-1 execution cannot produce the evidence those assertions read).
- **R7.** Mixed-tier runs finalize correctly: expected-row accounting, trials, and the reconciler treat tiers uniformly (a tier is an execution detail of a row, not a new lifecycle).

### Acceptance examples

- **AE1.** Baseline run post-classification: tier-1 majority executes in minutes; run detail shows tier badges; pass rate math unchanged.
- **AE2.** A case with a `workspace-projection-*` assertion cannot be saved/adjudicated as tier `model` — authoring surfaces the conflict.
- **AE3.** Comparison of two runs where the dataset's tier map changed between them renders a non-comparable flag (tier drift), like dataset-version drift.
- **AE4.** A flagged-thread case re-scored as tier-0 after a rubric edit produces a new result row with zero agent cost and the recorded output as evidence.
- **AE5.** Four profiles × baseline × trials 3 completes within an hour on dev at current quotas (vs ~9h projected today).

### Success criteria

1. Baseline per-profile wall clock drops from ~23 min to single digits on dev without a quota change.
2. Cost per baseline run drops ≥ 60% (tier-1 pricing on the majority of cases).
3. Zero honesty regressions: no case scores under a tier that cannot produce the evidence its assertions require (R6 enforced), and tier is visible everywhere verdicts are.

### Open questions (resolve before planning)

- **Q1 — System prompt fidelity for tier-1.** Should tier-1 use the case's own `system_prompt`, the tenant's composed agent prompt (captured once at dispatch, pinned like the profile snapshot), or a neutral harness prompt? Composed-prompt gives the most representative refusal behavior but couples tier-1 to workspace rendering; neutral is cheapest but least representative. _(Recommend: composed prompt captured once per run — one bootstrap per run instead of one per case keeps most of the savings.)_
- **Q2 — Where does tier live?** On the case (curated, versioned, adjudicated — recommended) vs. on the run ("run this dataset cheap") vs. both (case declares its _maximum_ fidelity need; run can force tier-2 for a periodic full-fidelity audit). The audit-mode hybrid is attractive: nightly tier-mixed, weekly all-tier-2.
- **Q3 — Batch sizing and failure isolation for tier-1.** N cases per message: one case's throttle/timeout must not fail the batch (per-case try/catch inside the batch, partial results written).
- **Q4 — Does tier-0 need new storage?** Flagged-thread payloads already persist; re-scoring needs a "score this stored output" path in the worker, not new capture.

## Settled decisions (Eric, 2026-07-02)

- **Two tiers in v1**: `model` | `agent` (case field `execution_tier`, missing = `agent`). `static` deferred until the flywheel work needs it.
- **Q1**: tier-`model` calls use the agent's COMPOSED system prompt, captured ONCE per run at dispatch (one full agent ping, pinned into `profile_snapshot.composedSystemPrompt`); capture failure degrades the whole run to tier-`agent` — never a silently unrepresentative prompt.
- **Q2**: tier lives on the case; `StartEvalRunInput.fullFidelity: true` forces every case through the full agent turn (the periodic audit lever).
- **Q3**: NO batching in v1 — 20 parallel lanes at ~1.5s/case already reaches single-digit minutes; batching is a later optimization.
- **Q4**: no new storage; tier-0 deferred with `static`.
- Result rows record the executed tier (`eval_results.execution_tier`, migration 0200); run detail badges it; comparisons flag tier-mix drift.
- Baseline classification ships as a separate adjudication PR AFTER #3176 merges (avoids a BASELINE_DATASET_VERSION collision).

## Handoff

On confirmation, `ce-plan` enriches this artifact in place to implementation-ready (planning contract, KTDs, units). Prior art to carry in: the ScoringEngine seam (`packages/evals-core/src/engine.ts`), the batching precedent in `eval-runner.ts`, the adjudication channel from the quality_state audit, and the KTD6 comparability gate this extends.
