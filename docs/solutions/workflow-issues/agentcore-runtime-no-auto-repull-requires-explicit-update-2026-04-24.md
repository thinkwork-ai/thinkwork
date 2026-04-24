---
title: "Bedrock AgentCore runtime doesn't auto-repull; ECR push alone is invisible"
module: terraform/modules/app/agentcore-runtime, .github/workflows/deploy.yml
date: 2026-04-24
problem_type: workflow_issue
component: deployment
severity: high
symptoms:
  - "ECR image pushed successfully by CI (`thinkwork-dev-agentcore:${sha}` and `:latest` tags updated on every merge)"
  - "`aws lambda get-function-configuration` shows the Lambda picked up the new image"
  - "AgentCore runtime keeps serving a days- or weeks-old image — confirmed by log output referencing deleted modules, missing tools, stale behavior"
  - "`aws bedrock-agentcore-control get-agent-runtime` shows `lastUpdatedAt` from the initial terraform apply and has never moved since"
  - "`agentRuntimeArtifact.containerConfiguration.containerUri` points at a tag that may no longer exist in ECR at all — cold restart would fail"
root_cause: incomplete_setup
resolution_type: ci_fix
related_components:
  - deployment
  - development_workflow
tags:
  - agentcore-runtime
  - bedrock-agentcore
  - deployment
  - ci-gap
  - runtime-pinning
  - silent-failure
last_updated: 2026-04-24
---

# Bedrock AgentCore runtime doesn't auto-repull; ECR push alone is invisible

## Problem

Bedrock AgentCore Runtime resolves `agentRuntimeArtifact.containerConfiguration.containerUri` at `UpdateAgentRuntime` time, not per-invocation. The runtime does **not** re-check ECR for a newer image under the same tag. Whatever `containerUri` was set on the last successful `UpdateAgentRuntime` is what serves every future invocation — indefinitely, through cold starts, through re-deploys, until another `UpdateAgentRuntime` writes a new URI.

This means a deploy pipeline that pushes `thinkwork-dev-agentcore:${sha}` + `:latest` to ECR and calls `aws lambda update-function-code` is **sufficient for the Lambda** (thinkwork-dev-agentcore) and **invisible to the AgentCore runtime**. Unless you also call `UpdateAgentRuntime`, the runtime keeps its pin.

The symptom during this session: the Strands runtime was still serving an image from 2026-04-17. Every sandbox PR merged between April 17 and April 23 pushed new images to ECR; the runtime never saw any of them. The pinned tag (`strands-evalattr-065303`) had been garbage-collected from ECR entirely — a runtime cold restart would have failed to pull its own image.

## Symptoms

- CI pipeline succeeds end-to-end (`lint`, `test`, `typecheck`, `Build Container`, `Terraform Apply`, `Build & Deploy Admin`, `Deploy Summary`)
- ECR has new image tags at the expected SHAs
- `aws lambda get-function-configuration --function-name thinkwork-dev-agentcore --query 'Code.ImageUri'` shows the fresh SHA
- AgentCore runtime continues running a commit from days or weeks ago — confirmed by `aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id <id> --query 'agentRuntimeArtifact.containerConfiguration.containerUri'`
- CloudWatch logs from `/thinkwork/${stage}/agentcore` reference modules or log strings that exist only in the stale commit
- The agent reports features-missing that the code clearly added ("I don't have an `execute_code` tool" while the latest commit registers it)
- In the worst case, `aws ecr describe-images --image-ids imageTag=<old-pinned-tag>` returns `ImageNotFoundException` — the runtime is pinned to a tag ECR has already pruned

## What Didn't Work

- **"The `:latest` tag covers it."** It doesn't. Lambda resolves `image-uri` at `update-function-code` time — new push + `update-function-code` gets new code into the Lambda. AgentCore runtime doesn't have an analogous `update-function-code`; it has `UpdateAgentRuntime`, which must be called explicitly with the new URI.
- **"Re-running the deploy will fix it."** Re-running the same deploy.yml doesn't help — `build-container` pushes to ECR and updates Lambda, but nothing in that job calls `UpdateAgentRuntime`.
- **"Check the Lambda logs."** Misleading. The Lambda (`thinkwork-dev-agentcore`) runs the same image as the runtime, so its logs match whatever the Lambda pulled last. They can diverge from the runtime for days. To see what the runtime is actually running, `get-agent-runtime` is the only source of truth.
- **"Check the runtime status."** `status: READY` is also misleading. READY means the runtime is healthy and accepting invocations — against whatever image it was last told about. It says nothing about whether that image is current.

## Resolution

Add an `aws bedrock-agentcore-control update-agent-runtime` step to `.github/workflows/deploy.yml`'s `build-container` job, after the ECR push and the Lambda `update-function-code`. Read the runtime id from SSM (`/thinkwork/${stage}/agentcore/runtime-id-strands`), fetch current `roleArn`/`networkConfiguration`/`protocolConfiguration` via `get-agent-runtime` (preserves terraform-managed config without drift), swap `containerConfiguration.containerUri` to the new SHA-tagged image.

Implemented in PR #489. See `.github/workflows/deploy.yml` — the `Update AgentCore Runtime` step under the `build-container` job.

Guard the step to skip cleanly on greenfield stages where the SSM param hasn't been written yet (first terraform-apply creates the runtime + publishes the id; the deploy that ran *before* that runs a no-op `exit 0`).

## Prevention

1. **CI assertion**: after `UpdateAgentRuntime` returns, compare the response's `agentRuntimeVersion` to the previous version. A version bump confirms the runtime moved. No bump → surface a loud warning so an operator can investigate.
2. **Post-deploy smoke**: a lightweight CloudWatch query (or a dedicated health endpoint) that greps the runtime's most recent log stream for a version marker injected at build time. If the deployed commit SHA doesn't match the marker, fail the deploy.
3. **ECR lifecycle policy vs. runtime pinning**: the April 17 pin being pruned from ECR is a cold-restart footgun. Either bump the ECR retention or have the `UpdateAgentRuntime` step use immutable SHA-tagged URIs (already implemented in #489 — `${github.sha}-arm64` not `:latest`) so a pruned tag fails the deploy loud rather than waiting for a runtime recycle.

## Related Learnings

- `docs/solutions/build-errors/multi-arch-image-lambda-vs-agentcore-split-tags-2026-04-24.md` — the arch mismatch that kept `UpdateAgentRuntime` *failing silently* when we did start calling it, before the split-tag fix.
