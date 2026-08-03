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

- **U2 — chat-agent-invoke setup diet (THINK-583)**
- Branch: `feat/think-583-setup-diet`
- Worktree: `.claude/worktrees/agentcore-u2`
- Status: In progress

## Progress Log

| Date       | Unit                | Branch                                    | PR                                                           | Status                                | Verification                                                                                                                                                                                                                                                                                                                                                                                                      | Notes                                                                                                                                                                                                                                                                                                   |
| ---------- | ------------------- | ----------------------------------------- | ------------------------------------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-03 | U1 measurement pack | `feat/think-582-latency-measurement-pack` | [#4163](https://github.com/thinkwork-ai/thinkwork/pull/4163) | Merged and deployed (run 30857381970) | Pack reproduces dev baselines: chat-agent-invoke p50 10 308 ms / 59% cold; render p50 5 031 ms; agent_loop p50 9 609 ms; follow-up cohort (≤15 min gap) harness overhead **p50 12.9 s / p90 19.1 s**, first/idle p50 32.2 s; 75% of follow-ups arrive within 15 min. Baseline eval run `2c2ceb89-f637-4fed-b4dc-958698efb902`: 124 tests, 116 pass / 7 fail / 1 error (94.31%) — per-category table in THINK-582. | Cohort join: finalize→invoke by threadId (invoke.received has no threadTurnId), finalize→agent_loop by threadTurnId. Known-fail baseline: agentcore-smoke 0/1, flagged-thread 0/2 predate this project. Eval start needed admin-equivalent path (CLI session is api-key; no tenant-admin user session). |

## Blockers

- None.
