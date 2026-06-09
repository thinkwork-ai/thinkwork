---
title: "Agent Profiles end-to-end verification"
date: 2026-06-07
status: active
---

# Agent Profiles End-to-End Verification

This runbook proves the customer-demo Agent Profile model-stacking path and the
closed-loop Research -> Reviewer -> parent-answer path:

1. A user selects or inherits a parent model for the turn.
2. The parent delegates a bounded task to an available Agent Profile.
3. The profile runs as a Pi child session with its configured model,
   capabilities, loop policy, and self-review requirement.
4. The parent receives the profile handoff, optionally delegates to Reviewer,
   and owns the final user-facing response.
5. Settings -> Activity shows the nested profile run with model, tokens, cost,
   duration, and status.
6. Settings -> Activity -> Traces shows the profile lane.
7. Raw child tools and MCP calls remain inspectable under the profile.
8. Retry/revision loops stay bounded by profile execution controls.

## Automated Hermetic Proof

Run these focused checks from the repository root:

```bash
pnpm --filter @thinkwork/agentcore-pi exec vitest run agent-container/tests/agent-profile-delegation.test.ts agent-container/tests/server.test.ts
pnpm --filter @thinkwork/api exec vitest run src/lib/chat-finalize/process-finalize.test.ts src/graphql/resolvers/observability/threadTraces.query.test.ts
pnpm --filter @thinkwork/web exec vitest run src/components/settings/SettingsActivityThreadDetail.test.tsx src/components/workbench/TaskThreadView.test.tsx src/components/settings/SettingsAgents.test.tsx
```

The proof uses real runtime/finalize/UI modules and deterministic fixtures. It
does not mutate a deployed tenant.

## Demo Configuration

Use the normal merge/deploy pipeline before running live verification. Do not
manually deploy or mutate production outside approved demo-tenant setup.

1. In Settings -> Agents, keep the parent Default Agent on the intended parent
   model.
2. Configure the Research profile:
   - status: enabled
   - model: cheaper approved model, for example
     `us.anthropic.claude-haiku-4-5-20251001-v1:0`
   - tools: `web_search`, `web_extract`
   - skills/MCP servers: only those needed for the demo task
   - Space access: leave empty for all Spaces, or restrict to the demo Space
3. Configure Analyst, Coding, and Reviewer similarly if they are part of the
   demo. If Coding is restricted to Engineering, verify that it is unavailable
   elsewhere.
4. Confirm the demo user has approval for both the parent model and every
   profile model used in the run.

## Live Closed-Loop Research Demo

1. Open the web app on the deployed or local environment.
2. Start a new thread with a parent model different from Research.
3. Send:
   `#Research find the current CEO of Stripe today and cite one source. Keep it concise. Please use #Reviewer to verify.`
4. Wait for the parent response. The final assistant message should be authored
   by ThinkWork/the parent Agent, not by Research or Reviewer.
5. Open Settings -> Activity -> the new thread.
6. Expand the turn and confirm:
   - the parent turn model is the composer/default parent model;
   - `delegate_to_agent_profile` appears immediately before the `Research`
     lane;
   - the Research row shows its profile model, non-zero input/output tokens,
     duration, status/verdict, and cost;
   - expanding Research shows the handoff summary and raw child
     `web_search` / `web_extract` calls;
   - a second `delegate_to_agent_profile` appears after Research returns and
     immediately before the `Reviewer` lane;
   - Reviewer shows its configured model, input/output tokens, duration,
     review verdict, and cost;
   - the final parent Agent row appears after Reviewer and contains the final
     answer preview.
7. Open Traces and confirm:
   - parent LLM cost appears in the parent lane;
   - Research LLM cost appears with `laneKey = profile:research`;
   - Reviewer LLM cost appears with `laneKey = profile:reviewer`;
   - raw child tools remain child details, not separate model-stacking units;
   - the total turn tokens and cost include parent, Research, Reviewer, and any
     retry work.

## Retry / Negative Review Demo

Use a fixture, local test harness, or a prompt that reliably asks Reviewer to
request revision. The exact prompt can change by demo data, but it should force
an answer with a missing citation, stale date, or insufficient evidence.

Expected:

- Research runs first and returns a candidate handoff.
- Reviewer runs after Research and returns a `revise` or `fail` verdict with
  actionable feedback.
- The parent delegates back to Research with Reviewer feedback while
  `maxReviewLoops` allows it.
- The retry lane is shown as a second Research pass, not merged into the first
  pass.
- When the retry passes, the parent sends the final answer.
- When the retry budget is exhausted, the parent follows the configured
  failure behavior: return a blocker, or return a best-effort answer with an
  explicit warning.

## Closed-Loop Policy Checks

Internal self-review is part of every parent/profile loop. External Reviewer is
optional and policy-driven:

- `externalReviewerPolicy = explicit`: use Reviewer when the user mentions
  `#Reviewer`.
- `externalReviewerPolicy = profile_required`: use Reviewer when the selected
  profile requires a review gate.
- `externalReviewerPolicy = always`: use Reviewer for every delegated profile
  candidate.
- `externalReviewerPolicy = never`: do not delegate to Reviewer unless a future
  operator override explicitly changes the policy.

## Analyst And Coding Checks

Analyst available:

Type `#Analyst summarize this thread and list the assumptions.`

Expected:

- Analyst profile runs on its configured model.
- Activity shows nested Analyst cost evidence.
- Traces show `profile:analyst`.

Coding restricted:

Type `#Coding inspect the repository and suggest a patch.`

Expected in a Space where Coding is unavailable:

- the turn fails or replies with a clear unavailable-profile message;
- no Coding profile cost row is recorded;
- Activity does not fabricate a Coding lane.

Reviewer available:

Type `#Reviewer review the previous answer against the user's request and say whether it should pass or be revised.`

Expected:

- Reviewer profile runs on its configured model.
- Activity shows nested Reviewer cost evidence.
- Traces show `profile:reviewer`.
- Reviewer execution controls include `reviewGate: true` and
  `maxReviewLoops: 2`; the parent retry gate should consume those controls when
  review-loop enforcement is enabled.

## Evidence Checklist For PRs

When a PR ships profile model-stacking behavior or UI, include:

- the focused commands from **Automated Hermetic Proof**;
- a `:5174` local web smoke or deployed browser proof for Settings -> Activity;
- the thread id used for any live demo validation;
- parent model, profile model, profile slug, and profile lane observed;
- whether the final answer came from the parent Agent;
- whether Research -> Reviewer -> parent ordering was visible;
- whether child `web_search`, `web_extract`, or MCP calls were inspectable;
- whether any unavailable-profile negative path was tested.

## Cleanup

After a demo, remove only temporary demo data through normal tenant data
management paths. Keep built-in Research, Analyst, Coding, and Reviewer
profiles available unless the customer-specific setup intentionally restricts
them by Space.
