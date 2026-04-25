---
title: "Silent arch mismatch between CI builds and AgentCore runtime kept every Python-side sandbox PR dark on dev for a week"
module: .github/workflows/deploy.yml, packages/agentcore-strands/agent-container
date: 2026-04-24
problem_type: workflow_issue
component: deployment
severity: high
symptoms:
  - "All Python-side sandbox PRs between 2026-04-17 and 2026-04-23 merged, deployed, landed green in CI — and had no observable effect on dev"
  - "Every one of those PRs had code that changed container Python (sandbox_tool.py, preamble, invocation_env, server.py registration branch)"
  - "The runtime on dev was serving an image from 2026-04-17 the entire time"
  - "No CI signal indicated a problem — the deploy pipeline considered itself successful"
  - "The stale-image state was discovered only when a manual end-to-end verify of the sandbox feature was finally attempted"
root_cause: process_gap
resolution_type: ci_fix
related_components:
  - deployment
  - development_workflow
tags:
  - silent-failure
  - ci-gap
  - agentcore-runtime
  - arch-mismatch
  - arm64
  - meta-learning
last_updated: 2026-04-25
---

# Silent arch mismatch between CI builds and AgentCore runtime kept every Python-side sandbox PR dark on dev for a week

## Problem (meta-learning)

The sandbox substrate was built, reviewed, merged, and "deployed" across roughly 13 PRs between 2026-04-17 and 2026-04-23. Every one of those PRs went green in CI. The terraform stayed in sync. The Lambda `thinkwork-dev-agentcore` successfully picked up the new image each time (`update-function-code` succeeded). Every engineer touching the code assumed it was running on dev.

None of it was.

The AgentCore runtime had been pinned to an arm64 image from 2026-04-17. The CI built amd64. Every attempt to move the runtime since had either (a) not happened at all — `UpdateAgentRuntime` wasn't wired into the deploy pipeline (see related learning), or (b) silently failed — when manually attempted, the API returned `Architecture incompatible for uri ... Supported architectures: [arm64]`.

There were **two** deployment gaps compounding:
- The runtime doesn't auto-pull from ECR (see `agentcore-runtime-no-auto-repull-requires-explicit-update-2026-04-24.md`)
- Even if it did, the image was the wrong arch

Both gaps were invisible from CI. Both were invisible from "does terraform apply cleanly?". Both were invisible from "does the Lambda work?" — the Lambda ran on amd64 and was happy. The runtime was on a cached arm64 image from a week ago. The two paths looked identical from every vantage point the pipeline surfaces.

The fact that **a full feature's worth of PRs could land without exercising any path that would fail loud** is the learning here, more than the specific bugs. Every PR in the chain was individually correct. The collective state was broken.

2026-04-25 recurrence: PR #585 exposed a second-order version of the same failure shape. The runtime update step existed by then, but an earlier deploy with the entrypoint fix was cancelled; a later deploy skipped `build-container` because no container paths changed, leaving the active runtime on an image that predated the fix. The deploy summary still looked clean because it checked runtime/endpoint version agreement, not whether the active image contained the latest AgentCore container source SHA.

## Symptoms

- Every sandbox-related PR merged green: #431, #433, #437, #438, #439, #440, #441, #442, #443, #447, #461, #475, #477, #478, #485
- The deploy workflow on each successful main merge showed all jobs `success` or `skipped`
- `sandbox_invocations` stayed empty on dev — nobody was actually running execute_code, and even if they had, the runtime couldn't have served the code path
- `aws bedrock-agentcore-control get-agent-runtime --query 'agentRuntimeArtifact.containerConfiguration.containerUri'` pointed at `thinkwork-dev-agentcore:strands-evalattr-065303` — a 2026-04-17 tag that **no longer existed in ECR** by the time someone checked (lifecycle policy had pruned it)
- `lastUpdatedAt` on the runtime was 2026-04-17, same day as the stuck image — the deploy pipeline had literally never touched the runtime in the intervening week
- The gap surfaced only when a human ran the first real end-to-end invocation and the agent said "I don't have an execute_code tool"

## What Didn't Work

- **Trust green CI.** Every CI check passed. Every merge succeeded. Nothing in the pipeline was surfacing the divergence — *because the divergence existed between components the pipeline doesn't compare*. CI green says "your diff compiles, tests pass, terraform plans, the image builds, the Lambda takes it." It says nothing about "the AgentCore runtime moved to the new image."
- **Trust `Deploy Summary: success`.** The summary aggregates the status of jobs it ran. It doesn't run a job that asserts the runtime image moved.
- **Rely on manual verification "every now and then."** Works for features someone exercises manually. Doesn't work for backend-only features where the whole point is that you shouldn't have to click around to know it works.

## Resolution (the fixes)

Five PRs to unclog the path end-to-end:

| PR | Fix |
|----|-----|
| #489 | Add explicit `UpdateAgentRuntime` step to deploy.yml; switch build to multi-arch |
| #490 | Split to two single-platform tags (Lambda wants single-platform, runtime wants arm64) |
| #491 | server.py `apply_invocation_env` call dropped sandbox fields |
| #492 | bedrock-agentcore `code_session` signature is `(region, identifier=...)` not `(interpreter_id)` |
| #493 | Runtime role missing `bedrock-agentcore:StartCodeInterpreterSession` perms |
| #495 | Replace SDK wrapper with raw boto3 client — stop guessing at version-dependent method names |
| #496 | Stream consumer for MCP-shaped tool results (`result.content[]` + `result.structuredContent`) |
| #585 | Add source-SHA runtime image drift detection; force container rebuild when the active AgentCore image is stale |

Each of those has its own solutions doc in this directory.

## Prevention (the meta-fix)

The point of this doc isn't the specific bugs — each has its own entry. The point is: **multi-component deployments need a cross-component assertion that the surface actually works after each deploy.**

Candidates:

1. **Post-deploy smoke invocation.** After `Terraform Apply` + runtime update, run an actual chat-agent-invoke against a canary thread and assert a known response shape. Runs ~30 seconds. Fails loud if the runtime is stale, the code is broken, IAM is wrong, or the container doesn't boot.
2. **Container-level commit-SHA marker.** Container boot logs its own commit SHA. Post-deploy CI compares the runtime log's most-recent marker against `github.sha`. A mismatch means the runtime didn't pick up the new code.
3. **Source-SHA image audit.** Deploy CI compares the active runtime image tag's source SHA with the latest commit touching `packages/agentcore-strands/**`, `packages/agentcore/**`, or `.github/workflows/deploy.yml`. A stale image should force `build-container`, even when the current push did not touch those paths.
4. **Regular image-age audit.** Weekly CI cron that calls `get-agent-runtime`, compares `lastUpdatedAt` against the most recent main merge that touched `packages/agentcore-strands/**`, and surfaces a warning if they diverge by more than a day. Catches the silent-pin scenario *before* a feature PR is written on top of it.

#489 + #490 made the happy path possible. #585 made one core invariant verified: the active runtime image must include the required AgentCore source SHA. A full product-path canary is still future work.

## Related Learnings

- `docs/solutions/workflow-issues/agentcore-runtime-no-auto-repull-requires-explicit-update-2026-04-24.md`
- `docs/solutions/runtime-errors/stale-agentcore-runtime-image-entrypoint-not-found-2026-04-25.md`
- `docs/solutions/build-errors/multi-arch-image-lambda-vs-agentcore-split-tags-2026-04-24.md`
- `docs/solutions/integration-issues/agentcore-runtime-role-missing-code-interpreter-perms-2026-04-24.md`
- `docs/solutions/patterns/apply-invocation-env-field-passthrough-2026-04-24.md`
- `docs/solutions/best-practices/bedrock-agentcore-sdk-version-drift-prefer-raw-boto3-2026-04-24.md`
- `docs/solutions/best-practices/invoke-code-interpreter-stream-mcp-shape-2026-04-24.md`
