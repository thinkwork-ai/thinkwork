---
title: "Agent Profiles run bounded closed loops under parent orchestration"
date: 2026-06-08
last_updated: 2026-06-09
status: active
category: architecture-patterns
module: agentcore-pi
problem_type: architecture_pattern
component: assistant
severity: high
tags:
  - agent-profiles
  - closed-loops
  - reviewer
  - activity
  - traces
  - verification
---

# Agent Profiles run bounded closed loops under parent orchestration

## Context

Agent Profiles became ThinkWork's model-stacking boundary because a profile is
the unit that has its own model, capability bundle, runtime limits, cost story,
and handoff. The next issue was orchestration: a simple profile handoff was not
enough for tasks that need discovery, planning, execution, verification,
revision, and final answer ownership.

This pattern replaces two earlier false starts:

- tool-level model switching, where a raw tool/MCP call was treated as the
  model-stacking unit;
- external-only review, where Reviewer could accidentally look like the final
  answer author instead of a quality gate that reports back to the parent.

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

Do not install open-loop goal packages such as `@ramarivera/pi-goal` into the
in-turn runtime path yet. They are useful design input for objective state,
usage, and budgets, but ThinkWork v1 needs tenant-scoped storage, managed
continuation, model-catalog pricing, and finalization-controlled accounting.

## Runtime Contract

Specialist profiles follow this internal loop:

- Discovery: identify what the subtask needs.
- Planning: choose a concise execution path.
- Execution: call tools or use context within the configured profile
  capabilities.
- Verification: act as the internal Verifier/Reviewer for the profile run and
  check the result against the delegated task, evidence, constraints, and
  user-visible quality bar.
- Iteration: revise when the verifier verdict is revise/fail and budget
  remains.
- Handoff: return evidence, confidence, gaps, and a pass/revise/fail verdict.

Every profile run must consider these stages even when a stage is skipped. The
UI does not need to expose chain-of-thought, but it should expose stage-level
proof such as `Discovery: completed`, `Planning: skipped`, or `Verification:
completed` so operators can verify that the closed-loop policy ran.

The parent loop follows:

- plan delegation from the user goal;
- run Research/Coding/Analyst or another specialist;
- receive the specialist handoff;
- review internally;
- optionally delegate to Reviewer;
- retry the specialist with Reviewer feedback when policy allows;
- produce the final response or explain why the loop is blocked.

The parent sends the final user-visible response. Reviewer output is never
rendered as the assistant's answer by itself. When Reviewer returns `revise`,
the parent decides whether to re-run the specialist with Reviewer feedback,
continue with qualifications, or report a blocker according to policy.

## Observability Contract

Activity and Traces should show sequential ownership, not just raw tool order:

- parent delegate row immediately before the profile it starts;
- Research lane and child tools under Research;
- Reviewer delegate row after Research returns;
- Reviewer lane after its delegate row;
- final parent Agent row after Reviewer or after internal review passes;
- total tokens/cost include parent, profiles, reviewer, and retries;
- model badges use display names or `Mixed` where multiple models contribute.

The expanded profile row should include:

- profile name and slug;
- model id/display name;
- input/output/cache tokens;
- duration;
- cost;
- status;
- handoff verdict and summary;
- loop phase outcomes;
- child tools used during the profile run.

Avoid extra status badges on dense timeline rows when they steal space from the
core accounting story. Row-level metadata should prefer:

```text
tokens in -> tokens out | time | cost | model badge
```

Retry runs should appear as repeated specialist passes or clear iteration
segments, with feedback context visible enough to explain why the retry
happened.

Sequential profile runs must not look parallel. For example, if a user asks
Research and then Reviewer in one turn, the lane should read as:

```text
Agent
Tool: delegate_to_agent_profile
  Research
    Research: Discovery
    Research: Planning
    Research: Execution
    Tool: web_search
    Tool: web_extract
    Research: Verification
    Research: Iteration
    Research: Handoff
Tool: delegate_to_agent_profile
  Reviewer
    Reviewer: Discovery
    Reviewer: Planning
    Reviewer: Execution
    Reviewer: Verification
    Reviewer: Iteration
    Reviewer: Handoff
Agent
```

Draw a separate lane for each profile while preserving the start point where the
parent actually delegated to that profile. Reviewer starts after Research
returns; it should not branch from turn start unless future parallel execution
actually runs that way.

## Review Policy

Internal self-review is always part of parent and profile loops. External
Reviewer is policy-driven:

- `explicit`: run Reviewer when the user asks for `#Reviewer`.
- `profile_required`: run Reviewer when selected profile policy requires it.
- `always`: run Reviewer for every delegated candidate.
- `never`: skip external Reviewer unless policy changes.

Reviewer must never be the final assistant author. Its output is a review
handoff that the parent uses to decide next steps.

For the common customer-demo path, explicit `#Reviewer` is enough:

1. Research performs the work.
2. Parent receives the Research handoff.
3. Parent delegates the candidate answer/evidence to Reviewer.
4. Reviewer returns pass/revise/fail with feedback.
5. Parent retries or answers.

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

The 2026-06-09 validation pass proved the closed-loop trace shape with a live
thread where Research and Reviewer both ran inside one parent turn. The browser
DOM showed:

- `Agent Profile: Research` with Discovery, Planning, Execution,
  Verification, Iteration, and Handoff phase rows;
- `Agent Profile: Reviewer` with the same phase rows;
- Research model/cost evidence such as model `moonshotai.kimi-k2.5`, 13.4K
  input tokens, 85 output tokens, `$0.0083`, and `8s`;
- Reviewer model/cost evidence such as model `moonshotai.kimi-k2.5`, 1.4K
  input tokens, 644 output tokens, `$0.0027`, and `6s`;
- a `revise` reviewer verdict that the parent incorporated before sending the
  final response.

For retry proof, use a fixture or prompt that makes Reviewer request revision
and confirm the parent loops back to Research within `maxReviewLoops`.

Focused local checks used for the final UI/runtime closeout:

```bash
pnpm --filter @thinkwork/agentcore-pi exec vitest run agent-container/tests/server.test.ts
pnpm --filter @thinkwork/agentcore-pi typecheck
pnpm --filter @thinkwork/web exec vitest run src/components/settings/SettingsActivityThreadDetail.test.tsx
pnpm --filter @thinkwork/web typecheck
```

## Guardrails

- Do not reintroduce tool-level model switching as the product primitive.
- Do not let child profiles delegate to other profiles in v1.
- Do not expose raw Pi goal or subagent package controls outside ThinkWork
  policy.
- Do not let shortcuts such as `#Research` leak into profile tasks or final
  response text.
- Do not double-count profile costs; aggregate totals from distinct parent,
  profile, reviewer, and retry evidence.
- Do not hide loop phase evidence merely because the final handoff passed;
  customers need proof that Discovery, Planning, Execution, Verification,
  Iteration, and Handoff were considered.
- Do not render Reviewer as a parallel branch when it ran sequentially after a
  specialist handoff.
- Do not let Reviewer output bypass the parent answer path.

## Related

- `docs/solutions/agent-profiles-pi-subagent-model-stacking-2026-06-07.md`
- `docs/solutions/agent-profile-pi-goal-compatibility-2026-06-08.md`
- `docs/verification/agent-profiles-e2e.md`
- PR #2269: closed-loop phase traces
- PR #2272: removed dense-row loop status badge
