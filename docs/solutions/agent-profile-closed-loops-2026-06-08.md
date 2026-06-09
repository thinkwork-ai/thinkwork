---
title: "Agent Profiles run bounded closed loops under parent orchestration"
date: 2026-06-08
status: active
category: architecture-patterns
module: agentcore-pi
problem_type: architecture_decision
component: assistant
severity: high
tags:
  - agent-profiles
  - closed-loops
  - reviewer
  - activity
  - traces
---

# Agent Profiles run bounded closed loops under parent orchestration

## Context

Agent Profiles became ThinkWork's model-stacking boundary because a profile is
the unit that has its own model, capability bundle, runtime limits, cost story,
and handoff. The next issue was orchestration: a simple profile handoff was not
enough for tasks that need discovery, planning, execution, verification,
revision, and final answer ownership.

The product direction is a bounded closed loop:

1. The parent Agent owns the user goal and final response.
2. A specialist profile owns narrow work and returns a structured handoff.
3. The parent reviews the handoff and may ask Reviewer for an external verdict.
4. Reviewer returns feedback to the parent, not to the user.
5. The parent either answers, retries the specialist with feedback, or reports a
   blocker according to policy.

## Decision

Keep the loop contract ThinkWork-owned and compile it into Pi child-session
prompts, runtime config, evidence, Activity rows, and Settings controls.

Each profile receives a normalized `loopPolicy` from `executionControls`:

- `mode = closed`
- `enabled`
- `maxIterations`
- `reviewGate`
- `externalReviewerPolicy`
- `maxReviewLoops`
- `failBehavior`
- optional runtime/token bounds

The parent Agent is the orchestrator. Explicit shortcuts such as `#Research`
and `#Reviewer` select profiles, but they are stripped from profile task text
and user-visible titles/messages. Single-profile requests still return through
the parent. Multi-profile requests execute sequentially in mention order unless
a future policy explicitly marks them parallel.

## Runtime Contract

Specialist profiles follow this internal loop:

- Discovery: identify what the subtask needs.
- Planning: choose a concise execution path.
- Execution: call tools or use context.
- Self-review: check the result against the assigned goal.
- Iteration: revise while budget remains.
- Handoff: return evidence, confidence, gaps, and a pass/revise/fail verdict.

The parent loop follows:

- plan delegation from the user goal;
- run Research/Coding/Analyst or another specialist;
- receive the specialist handoff;
- review internally;
- optionally delegate to Reviewer;
- retry the specialist with Reviewer feedback when policy allows;
- produce the final response or explain why the loop is blocked.

## Observability Contract

Activity and Traces should show sequential ownership, not just raw tool order:

- parent delegate row immediately before the profile it starts;
- Research lane and child tools under Research;
- Reviewer delegate row after Research returns;
- Reviewer lane after its delegate row;
- final parent Agent row after Reviewer or after internal review passes;
- total tokens/cost include parent, profiles, reviewer, and retries;
- model badges use display names or `Mixed` where multiple models contribute.

Retry runs should appear as repeated specialist passes or clear iteration
segments, with feedback context visible enough to explain why the retry
happened.

## Review Policy

Internal self-review is always part of parent and profile loops. External
Reviewer is policy-driven:

- `explicit`: run Reviewer when the user asks for `#Reviewer`.
- `profile_required`: run Reviewer when selected profile policy requires it.
- `always`: run Reviewer for every delegated candidate.
- `never`: skip external Reviewer unless policy changes.

Reviewer must never be the final assistant author. Its output is a review
handoff that the parent uses to decide next steps.

## Verification

Use `docs/verification/agent-profiles-e2e.md` for live proof. The primary demo
prompt is:

```text
#Research find the current CEO of Stripe today and cite one source. Keep it concise. Please use #Reviewer to verify.
```

The expected final shape is:

```text
delegate -> Research lane/tools -> delegate -> Reviewer lane -> parent answer
```

For retry proof, use a fixture or prompt that makes Reviewer request revision
and confirm the parent loops back to Research within `maxReviewLoops`.

## Guardrails

- Do not reintroduce tool-level model switching as the product primitive.
- Do not let child profiles delegate to other profiles in v1.
- Do not expose raw Pi goal or subagent package controls outside ThinkWork
  policy.
- Do not let shortcuts such as `#Research` leak into profile tasks or final
  response text.
- Do not double-count profile costs; aggregate totals from distinct parent,
  profile, reviewer, and retry evidence.
