---
title: "Mobile Pi smoke matrix"
date: 2026-05-30
category: docs/solutions/testing/
module: mobile-agent-runtime
problem_type: superseded_test_matrix
component: mobile
severity: historical
tags:
  - mobile
  - pi
  - testing
  - superseded
superseded_by: docs/plans/2026-06-02-001-refactor-agentcore-first-pi-execution-plan.md
---

# Mobile Pi Smoke Matrix

## Superseded Status

This matrix is superseded. The executable mobile harness script it referenced
has been deleted, and mobile no longer runs local Pi or `just-bash` flows.

Current mobile proof should verify the managed path:

- the mobile app can create or continue a thread;
- the API creates a managed AgentCore turn;
- AppSync shows queued/running progress before the assistant response;
- the AgentCore runtime finalizes exactly one assistant response;
- no mobile harness, `just-bash`, or local Pi entrypoint is present.

## Historical Context

The old matrix measured a Hermes-native mobile host across local tests,
simulator checks, deployed-stage harness runs, background handoff, attachments,
MCP, web search, and managed AgentCore fallback.

That design was intentionally retired because it kept mobile as a second agent
execution substrate. The June 2026 AgentCore-first plan made mobile a client for
managed AgentCore execution instead.

## Current Verification

Use the current guard and managed-routing tests instead of the deleted smoke
commands:

```bash
pnpm --filter @thinkwork/mobile test -- lib/agentcore-first-mobile.test.ts
pnpm --filter @thinkwork/mobile test -- components/threads/ActivityTimeline.test.ts
pnpm --filter @thinkwork/api test -- src/handlers/chat-agent-invoke.runtime-routing.test.ts
```
