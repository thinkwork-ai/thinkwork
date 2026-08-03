---
title: "AgentCore harness autopilot status"
date: 2026-08-03
status: active
---

# AgentCore Harness Autopilot Status

Plan: `docs/plans/2026-08-03-001-feat-thread-agent-agentcore-runtime-warm-sessions-plan.md`

Linear project: Thread Agent on AgentCore Runtime (Warm Per-Thread Sessions) — THINK-582..THINK-591.

Target branch: `main`. All live verification points at the **dev** stage. Eric's UI validation runs the web app locally against dev on port 5174 (`pnpm --filter @thinkwork/web dev -- --host 127.0.0.1 --port 5174`); units U2, U6, U7, and U10 pause after dev deploy with a "ready for UI validation at localhost:5174" note before being marked complete.

## Baselines (dev, 2026-08-03, 14-day CloudWatch window)

| Metric                                    | Value    |
| ----------------------------------------- | -------- |
| `chat-agent-invoke` handler p50           | 10.3 s   |
| — of which synchronous workspace render   | 5.0 s    |
| `chat-agent-invoke` cold-invocation ratio | 59%      |
| Pi Lambda cold init                       | 3–6 s    |
| `runtime.tool_assembly` p50               | ~1.2 s   |
| `runtime.agent_loop` p50                  | 9.6 s    |
| Derived harness overhead per turn         | ~15–20 s |

Reproduce with `scripts/latency-dashboard.sh --stage dev` (U1). Baseline full eval-suite run: recorded in the U1 evidence row below once captured.

## Current Unit

- **U1 — Baseline latency dashboards and measurement pack (THINK-582)**
- Branch: `feat/think-582-latency-measurement-pack`
- Worktree: `.claude/worktrees/agentcore-u1`
- Status: In progress

## Progress Log

| Date | Unit | Branch | PR  | Status | Verification | Notes |
| ---- | ---- | ------ | --- | ------ | ------------ | ----- |

## Blockers

- None.
