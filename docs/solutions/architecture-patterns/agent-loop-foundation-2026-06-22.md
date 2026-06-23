---
title: "AgentLoop foundation owns autonomous loop identity above scheduler plumbing"
date: 2026-06-22
category: architecture-patterns
module: agent-loops
problem_type: architecture_pattern
component: product_ledger
severity: high
applies_when:
  - "Adding recurring or manually rerunnable autonomous agent work"
  - "Connecting AWS Scheduler, EventBridge, n8n, or another trigger source to agent execution"
  - "Projecting Pi goal-mode completion evidence into a durable product ledger"
  - "Designing verification, event-driven, or hill-climbing loop phases"
related_components:
  - packages/agent-loops-core
  - packages/api
  - packages/lambda
  - packages/database-pg
  - apps/web
tags:
  - agent-loops
  - scheduled-jobs
  - goal-mode
  - judgment
  - evidence
  - thnk-46
---

# AgentLoop Foundation Owns Autonomous Loop Identity

## Supersession Note

Follow-up planning on 2026-06-23 moved the user-facing noun back to
**Automations**. AgentLoop remains the internal runtime, version, run,
judgment, and evidence contract. UI and docs should teach Automations while
engineering code can continue to use AgentLoop names where they describe the
backing substrate.

The prompt-first Automations follow-up also changed the expected product shape:
creation starts from Chat or Manual prompt flows, every Automation persists an
execution Space, hidden builder threads live in a system-managed Automation
Builder Space, and actual runs create ordinary execution threads in the selected
Space. Advanced AgentLoop settings remain available through inspectors, not as
the default authoring surface.

## Context

THNK-46 landed AgentLoop as the first-class automation primitive for
autonomous goal/policy loops. Before this work, ThinkWork had strong substrate
pieces but no product object that tied them together:

- `scheduled_jobs` and AWS Scheduler could wake work.
- Pi goal mode could express a worker goal and return `goal_run` evidence.
- Workflow run ledgers provided a pattern for inspectable execution state.
- Agent Profile closed loops showed why bounded policy and review evidence
  matter.

The risk was building another "Automation" surface that meant "a scheduled
prompt" or "some EventBridge rule" instead of a durable autonomous contract. The
foundation keeps the product identity above the plumbing:

```text
AgentLoop definition/version
        |
        v
AgentLoopRun + iteration ledger
        |
        v
worker wakeup through Pi goal mode
        |
        v
JudgmentResult + evidence projection
        |
        v
complete, continue, fail, budget-stop, or escalate
```

## Decision

Treat AgentLoop as the owning record for autonomous loop state, policy,
judgment, and evidence. Reuse scheduler, wakeup, and goal-mode infrastructure,
but do not let any of those systems become the source of truth for a loop.

This creates four practical boundaries.

### 1. Scheduler Rows Are Plumbing

`scheduled_jobs` exists so AWS Scheduler can reliably fire a target and so
ThinkWork can reconcile cloud state. It should point back to the AgentLoop that
owns the durable contract. Operators should debug the AgentLoopRun first, and
only inspect Scheduler/EventBridge when no run was created.

Do not add new product fields only to `scheduled_jobs` when they describe loop
intent, goal criteria, judgment, or policy. Those belong on the AgentLoop
definition/version snapshot.

### 2. Manual And Scheduled Runs Share One Dispatcher

Manual "Run now" and scheduled fires must create the same ledger shape:

- AgentLoopRun row;
- first iteration row;
- wakeup request with AgentLoop metadata and `goalMode`;
- later thread turn link;
- judgment/evidence projection.

This keeps local/manual proving and scheduled production behavior aligned.
Future trigger families should call the same dispatcher with different trigger
metadata, not create a new run path.

### 3. Goal-Mode Evidence Becomes Judgment Evidence

Pi goal mode is the worker execution channel. It should not own continuation
policy. The finalize projection reads worker completion evidence and converts it
into a bounded `JudgmentResult`:

- `complete` when completion criteria are satisfied;
- `continue` when policy allows another iteration;
- `failed` when worker/finalization evidence says the work failed;
- `budget_stopped` when policy limits are exhausted;
- `needs_human_approval` when Phase 1 human approval is required.

That projection should be idempotent and best-effort around normal chat
finalization: a projection failure must not corrupt the thread turn, but it
should leave visible AgentLoop failure evidence when the database is reachable.

### 4. JudgeSpec Is Shared, But Executable Modes Are Phased

The shared `JudgeSpec`/`JudgmentResult` shape reserves room for model judges,
reviewer-agent judges, eval-threshold judges, and future learning promotion
judgments. Phase 1 should only execute self-check and human-approval escalation.

Validation should reject unsupported executable modes even if the shared enum
already names them. That keeps future phases compatible without pretending
Phase 1 can safely run independent verification loops.

## Product Taxonomy

Use these boundaries in docs and UI copy:

- **Automation:** user-facing autonomous work object with prompt, Space,
  trigger, run thread, setup history, run state, and evidence.
- **AgentLoop:** internal autonomous goal/policy loop runtime with trigger,
  worker, judge, policy, run state, and evidence.
- **Workflow:** explicit multi-step orchestration with a known graph of steps,
  branching, retries, and HITL waits.
- **Evaluation:** scoring/test-case product for measuring behavior. It may
  share judgment primitives with the AgentLoop runtime but remains a separate
  product.
- **scheduled_jobs/EventBridge/AWS Scheduler:** operational wake plumbing, not
  a user-facing automation product.

## Verification Checklist

When touching AgentLoop foundations, verify:

- GraphQL contract exposes AgentLoop definitions, versions, runs, iterations,
  judgments, and evidence.
- Consumer codegen is regenerated for web, mobile, and CLI.
- Manual and scheduled dispatch tests assert the same run/iteration shape.
- Wakeup-processor parity tests include AgentLoop metadata and `goal_mode`.
- Finalize projection tests cover terminal reason, continuation, budget stop,
  human approval escalation, and projection failure recovery.
- UI/docs present Automations as the v1 product concept and avoid exposing
  AgentLoop as a competing user-facing product.
- Creation UI defaults to Chat or Manual prompt-first flows, not the Advanced
  AgentLoop inspector.
- Manual and scheduled execution tests prove runs create threads in the
  configured Automation Space.

## Extension Guidance

Phase 2 verification loops should add executable model/reviewer judges on top
of the existing JudgeSpec, not create a second review ledger.

Phase 3 event-driven loops and n8n participation should treat external systems
as trigger or integration surfaces. ThinkWork must still own AgentLoopRun state,
judgment, idempotency, and evidence.

Phase 4 hill-climbing should write promotion and rollback decisions as
JudgeSpec-compatible judgments with evidence, then compound accepted learnings
through the memory/wiki systems.
