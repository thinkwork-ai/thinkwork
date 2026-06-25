---
title: "Trusted trace and cost accounting needs evidence-first projections"
date: 2026-06-25
category: observability
module: "trace-ledger / cost-events / eval snapshots"
problem_type: architecture_pattern
component: observability
severity: high
applies_when:
  - "A UI, CLI, budget, or eval feature needs to explain what happened during a turn"
  - "Runtime token usage, Bedrock invocation logs, and AWS billing exports may disagree"
  - "Historical cost rows predate canonical trace capture"
  - "Eval datasets need durable production-failure context without storing raw provider payloads"
related_components:
  - packages-api
  - packages-database-pg
  - apps-web
  - apps-cli
  - evals
  - budgets
tags:
  - thnk-74
  - trace-ledger
  - cost-events
  - reconciliation
  - eval-snapshots
  - observability
---

# Trusted trace and cost accounting needs evidence-first projections

## Context

THNK-74 replaced scattered trace and cost interpretations with a canonical
ledger:

- `trace_runs` identifies one execution trace for a turn.
- `trace_events` records model, tool, runtime, workspace, profile, and
  finalization observations.
- `trace_source_evidence` records where each observation came from.
- `trace_cost_reconciliation_facts` records runtime, provider, billing,
  mismatch, and operator-resolution facts over time.
- `cost_events` remains the compatibility projection for existing cost APIs,
  budget helpers, and analytics.

The critical product rule is that each surface projects from evidence; no
surface should infer higher confidence than the source can prove. Runtime usage
is useful, but it is not provider proof. Bedrock invocation logs can prove an
invocation, but not necessarily the AWS bill. Billing exports can prove spend at
the attribution level present in the export, but account-only evidence should
not mark individual turns as bill-reconciled.

## Guidance

Treat reconciliation state as part of the data model, not display decoration:

- `runtime-reported` means runtime/finalize observed usage or cost.
- `invocation-reconciled` means provider invocation evidence matched the
  request.
- `bill-reconciled` means billing export evidence supports the cost at the
  attributed level.
- `mismatch` means evidence sources disagree.
- `unreconciled/error` means evidence is missing, ambiguous, delayed, failed to
  load, or historical backfill.

When adding a new view or workflow, read trace details from the ledger and keep
source evidence visible. Use `cost_events` for compatibility totals, but use the
ledger facts to explain confidence and provenance.

Backfill historical data truthfully. Existing `cost_events` and
`thread_turns.usage_json` rows that predate the ledger should become
`source_type: "backfill"` observations with `unreconciled/error` facts. Do not
upgrade them to provider- or bill-reconciled unless independent provider or bill
evidence exists.

Eval snapshots should keep enough trace evidence to judge and debug a production
failure, but they should not copy uncontrolled raw prompt/tool/provider payloads.
Store safe summaries, event ids, source ids, reconciliation state, and explicit
gap metadata under the guarded eval-dataset payload prefix. If trace lookup
fails at flag time, either reject clearly or save a `lookup_failed` gap; silent
partial truth is worse than an honest gap.

## Operational Runbook

When a cost or trace looks wrong:

1. Start with the turn detail or CLI trace projection and note the latest
   reconciliation state.
2. If the state is `runtime-reported`, check whether Bedrock invocation logs are
   delayed or unavailable.
3. If the state is `mismatch`, compare runtime tokens, provider tokens, cached
   read tokens, and cost amounts in the latest reconciliation fact.
4. If the state is `bill-reconciled`, confirm the billing attribution level.
   Tenant-level evidence can support tenant cost; account-only evidence should
   remain aggregate review data.
5. If the state is `unreconciled/error` with `source_type: "backfill"`, treat it
   as a historical estimate. It is visible for continuity, not proof.
6. For eval cases flagged from production, inspect `trace-evidence.json` in the
   case payload prefix for event ids, source references, safe summaries, and any
   lookup/truncation gaps.

## Why This Matters

Budget enforcement, account usage, Activity, CLI trace commands, eval snapshots,
and analytics all answer different operator questions, but they must agree on
the source of truth. If one path treats runtime usage as bill-grade and another
path treats the same row as an estimate, operators cannot trust either one.

Evidence-first projections also keep old data honest. Historical costs remain
visible after the ledger rollout, but the UI and budget code can distinguish
them from newly reconciled provider or billing evidence.

Finally, eval snapshots need production context that survives source-thread
deletion. Capturing safe trace summaries plus source references gives future
judges and operators enough context to explain model/tool behavior without
copying raw sensitive payloads into long-lived datasets.

## When to Apply

Apply this pattern whenever code touches:

- trace detail GraphQL, web Activity, thread detail, or CLI trace commands;
- cost summaries, account usage, budget enforcement, or billing reconciliation;
- eval flagging, eval run snapshots, or replay payloads;
- migration/backfill of pre-ledger runtime or cost data.

Do not introduce a parallel cost-confidence vocabulary. Add source evidence and
reconciliation facts to the ledger, then project from there.
