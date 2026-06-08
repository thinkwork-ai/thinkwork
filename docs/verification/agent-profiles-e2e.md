---
title: "Agent Profiles end-to-end verification"
date: 2026-06-07
status: active
---

# Agent Profiles End-to-End Verification

This runbook proves the customer-demo model-stacking path:

1. A user selects or inherits a parent model for the turn.
2. The parent delegates a bounded task to an available Agent Profile.
3. The profile runs as a Pi child session with its configured model and
   capabilities.
4. The parent summarizes the profile handoff.
5. Settings -> Activity shows the nested profile run with model, tokens, cost,
   duration, and status.
6. Settings -> Activity -> Traces shows the profile lane.
7. Raw child tools and MCP calls remain inspectable under the profile.

## Automated Hermetic Proof

Run these focused checks from the repository root:

```bash
pnpm --filter @thinkwork/agentcore-pi exec vitest run agent-container/tests/agent-profile-delegation.test.ts agent-container/tests/server.test.ts
pnpm --filter @thinkwork/api exec vitest run src/lib/chat-finalize/process-finalize.test.ts src/graphql/resolvers/observability/threadTraces.query.test.ts
pnpm --filter @thinkwork/web exec vitest run src/components/settings/SettingsActivityThreadDetail.test.tsx
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

## Live Research Demo

1. Open the web app on the deployed or local environment.
2. Start a new thread with a parent model different from Research, for example:
   `Who is the CEO of Stripe today? Search the web and cite the source.`
3. If natural delegation is not obvious, use the explicit slash form:
   `/agent research Who is the CEO of Stripe today? Search the web and cite the source.`
4. Wait for the parent response.
5. Open Settings -> Activity -> the new thread.
6. Expand the turn and confirm:
   - the parent turn model is the composer/default parent model;
   - a nested `Research` Agent Profile row is present;
   - the Research row shows its profile model, non-zero input/output tokens,
     duration, status, and cost when the profile cost row is available;
   - expanding Research shows the handoff summary and raw child
     `web_search` / `web_extract` calls.
7. Open Traces and confirm:
   - parent LLM cost appears in the parent lane;
   - Research LLM cost appears with `laneKey = profile:research`;
   - raw child tools remain child details, not separate model-stacking units.

## Analyst And Coding Checks

Analyst available:

```text
/agent analyst summarize this thread and list the assumptions.
```

Expected:

- Analyst profile runs on its configured model.
- Activity shows nested Analyst cost evidence.
- Traces show `profile:analyst`.

Coding restricted:

```text
/agent coding inspect the repository and suggest a patch.
```

Expected in a Space where Coding is unavailable:

- the turn fails or replies with a clear unavailable-profile message;
- no Coding profile cost row is recorded;
- Activity does not fabricate a Coding lane.

Reviewer available:

```text
#Reviewer review the previous answer against the user's request and say whether it should pass or be revised.
```

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
- whether child `web_search`, `web_extract`, or MCP calls were inspectable;
- whether any unavailable-profile negative path was tested.

## Cleanup

After a demo, remove only temporary demo data through normal tenant data
management paths. Keep built-in Research, Analyst, Coding, and Reviewer
profiles available unless the customer-specific setup intentionally restricts
them by Space.
