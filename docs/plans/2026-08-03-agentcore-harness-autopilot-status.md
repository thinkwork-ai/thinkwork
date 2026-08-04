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

- **U6 live verification → U7 — Pi container warm-session fast path (THINK-586)**
- U2/U3 verified complete (R2 met: warm setup 1.2–1.5 s); **paused for Eric's UI validation at localhost:5174** before final sign-off.
- U6 (#4177) merged; live verification (flag flip on the dogfood agent + runtime turn) after its deploy.
- Status: In progress

## Progress Log

| Date       | Unit                | Branch                                    | PR                                                           | Status                                | Verification                                                                                                                                                                                                                                                                                                                                                                                                      | Notes                                                                                                                                                                                                                                                                                                   |
| ---------- | ------------------- | ----------------------------------------- | ------------------------------------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-03 | U1 measurement pack | `feat/think-582-latency-measurement-pack` | [#4163](https://github.com/thinkwork-ai/thinkwork/pull/4163) | Merged and deployed (run 30857381970) | Pack reproduces dev baselines: chat-agent-invoke p50 10 308 ms / 59% cold; render p50 5 031 ms; agent_loop p50 9 609 ms; follow-up cohort (≤15 min gap) harness overhead **p50 12.9 s / p90 19.1 s**, first/idle p50 32.2 s; 75% of follow-ups arrive within 15 min. Baseline eval run `2c2ceb89-f637-4fed-b4dc-958698efb902`: 124 tests, 116 pass / 7 fail / 1 error (94.31%) — per-category table in THINK-582. | Cohort join: finalize→invoke by threadId (invoke.received has no threadTurnId), finalize→agent_loop by threadTurnId. Known-fail baseline: agentcore-smoke 0/1, flagged-thread 0/2 predate this project. Eval start needed admin-equivalent path (CLI session is api-key; no tenant-admin user session). |

| 2026-08-03 | U2 setup diet | `feat/think-583-setup-diet` (+`perf/think-583-runtime-config-diet`) | [#4165](https://github.com/thinkwork-ai/thinkwork/pull/4165), [#4167](https://github.com/thinkwork-ai/thinkwork/pull/4167), [#4169](https://github.com/thinkwork-ai/thinkwork/pull/4169) | Merged; #4169 deploy in progress (run 30867923053) | Live after #4165+#4167: render skip path 7 320 ms → 40–238 ms (marker + hoisted S3 probe/routing signature); warm setup 10.3 s → 3 167 ms. Remaining 2 217 ms is `resolveAgentRuntimeConfig`, addressed by #4169 — re-measure after deploy targets setup < 2 s p50 (R2). Dogfood turns on thread `911b368a` all `succeeded` (35.9 s cold / 11.3 s / 8.7 s warm). | Render-skip is fail-closed (marker + S3 probe + routing signature + config fingerprint, 6 h TTL). Pause for UI validation at localhost:5174 before marking complete. |
| 2026-08-03 | U3 provisioned concurrency | `feat/think-583-provisioned-concurrency` | [#4168](https://github.com/thinkwork-ai/thinkwork/pull/4168) | CI re-running after test-count fix; auto-merge armed | Pending merge+deploy: verify PC READY on `:live` aliases for chat-agent-invoke + workspace-renderer, alias-qualified invokes, cold ratio drop from 59%. | First CI run failed only `scripts/release/__tests__/terraform-vars.test.ts` exact-count pin (58 → 60 after adding the PC variable pair); fixed in `01180e586`. |
| 2026-08-03 | U4 OKF EFS removal (PR 1) | `feat/think-589-okf-efs-removal` | [#4166](https://github.com/thinkwork-ai/thinkwork/pull/4166) | Merged and deployed (destructive-flag run 30865444948) | Live: `thinkwork-dev-agentcore-pi` has `FileSystemConfigs: null`, `VpcConfig.SubnetIds: []`, no OKF/EFS env vars. Destroy set was 9 resources, all OKF-scoped (access points ×2, mount targets ×2, SGs ×2, SG rules ×2, VPC-access IAM attachment) — reviewed before flag flip. Filesystem `fs-0f7fe906a0f73bb97` retained for PR 2. | Normal deploy refused the destructive plan (guard working as designed); re-dispatched with `allow_destructive_terraform=true` after plan review. PR 2 (filesystem delete + `brainArtifactManifests` DROP) stays behind the plan's evidence gates. |

| 2026-08-04 | U2/U3 completion | (multiple) | [#4171](https://github.com/thinkwork-ai/thinkwork/pull/4171), [#4175](https://github.com/thinkwork-ai/thinkwork/pull/4175), [#4176](https://github.com/thinkwork-ai/thinkwork/pull/4176) | Merged and deployed | **R2 gate met**: warm follow-up setup (invoke.received → dispatch) 1529 ms / 1165 ms vs 10 308 ms baseline; resolver 533–622 ms. Root cause of slow parallel legs was CPU starvation at 256 MB (~1/7 vCPU) — #4176 gives chat-agent-invoke + workspace-renderer 1769 MB (1 vCPU). U3 PC READY 1/1 both fns on `:live`, retry-0 on the alias qualifier. | Stage timing (#4171) + per-leg timing (#4175) attributed the cost definitively. **Paused: ready for UI validation at localhost:5174.** 48 h cold-ratio observation rolls into U8. |
| 2026-08-04 | U5 runtime provisioning hardening | `feat/think-584-runtime-provisioning-hardening`, `fix/think-584-digest-verify-ancestry` | [#4172](https://github.com/thinkwork-ai/thinkwork/pull/4172), [#4173](https://github.com/thinkwork-ai/thinkwork/pull/4173), [#4174](https://github.com/thinkwork-ai/thinkwork/pull/4174) | Merged and deployed | Dev: update-agentcore-runtimes passes atomic env-mirror + digest-pin assertions; runtime serving `repo@sha256:78a7aa…`. Live `InvokeAgentRuntime` smoke: microVM boots, container validates and 400s a bogus envelope (first live proof of the runtime path). Runner gained the customer runtime-update step (bundled `reconcile_pi_runtime.mjs`, digest-pinned, secrets on stdin); post-U5 runner.py seeded to TEI + McPherson evidence buckets with backups. | Digest-verify design flaw caught by its own first live run (deploy 30872795807): digest equality across rebuilds of identical source is wrong — #4174 switched to tag-recovered ancestry. KTD1 session-header probe deferred to U6's container-side verification. TEI canary blocked on the next release bundle build (needs `reconcile_pi_runtime.js` in-bundle). |
| 2026-08-04 | U6 dispatch migration | `feat/think-585-runtime-dispatch` | [#4177](https://github.com/thinkwork-ai/thinkwork/pull/4177) | Merged; deploy in progress | Pending live verification: dispatcher + DLQ + ESM exist; flip `agents.agentcore_runtime_dispatch` on the dogfood agent; turn runs through the runtime (phase log + finalize + DLQ empty). Migration 0283 applied to dev. | Dispatcher (900 s, retries 0, SSE-KMS DLQ ≤24 h), idempotent redrive consumer, KTD1 per-thread sessions verified container-side (403 on mismatch), stage kill-switch + per-agent flag, `legacy_lambda_dispatch` sentinel. Dark by default everywhere; dev stage flag on via terraform-vars. |

## Blockers

- None.
