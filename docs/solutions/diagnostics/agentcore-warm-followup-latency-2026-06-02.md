---
title: "AgentCore warm follow-up latency diagnostics"
date: 2026-06-02
status: active
---

# AgentCore Warm Follow-Up Latency Diagnostics

## Context

During the AgentCore-first Pi spike, the desktop app showed a first turn at
about 28s and a same-thread follow-up at about 10.5s. That strongly suggests a
warm AgentCore container and/or workspace hydrate cache benefit, but the
deployed UI and CLI did not expose enough phase detail to prove where the time
went.

## Baseline Observation

- Thread: `f4c13c1e-d5ff-4681-a4b1-5e0e440dc99b`.
- First turn: `a0927259-5a83-4126-a9b3-6d53e07f42bf`.
  - Started: `2026-06-02T16:43:44Z`.
  - Finished: `2026-06-02T16:44:12Z`.
  - Desktop display: `Worked for 28s`.
- Follow-up turn: `89432e84-23c5-466e-bec0-a5c070874daf`.
  - Started: `2026-06-02T16:56:55Z`.
  - Finished: `2026-06-02T16:57:05Z`.
  - Desktop display: `Worked for 10s`.
  - Expanded detail: `Manual chat · moonshotai.kimi-k2.5 · succeeded · 10.5s`.

## What Was Missing

- `thinkwork trace turn <turnId> --stage dev --json` returned a generic
  GraphQL `Unexpected error` for both measured turn ids.
- Runtime CloudWatch search did not find phase rows for the live follow-up in
  the expected AgentCore log groups, even though older phase logging exists in
  the runtime.
- Desktop turn activity showed aggregate duration and model, but not
  workspace hydrate counts or runtime phase durations.

## Durable Fix Pattern

- Normalize Bedrock invocation-log timestamps before GraphQL scalar
  serialization. CloudWatch/Bedrock rows may carry timestamp shapes that are
  not valid `AWSDateTime` strings.
- Persist safe runtime diagnostics into the existing finalize payload path,
  under `usage_json.diagnostics`, so UI inspection does not depend on
  CloudWatch availability.
- Use the existing `workspace_diagnostics` object for hydration data:
  `workspace_sync_ms`, `total_files`, `synced_files`, `skipped_files`,
  `deleted_files`, `cache_hit`, and `prefix`.
- Store runtime phase rows under `agentcore_phases`, using the same phase names
  the runtime already logs:
  `runtime.workspace_bootstrap`, `runtime.tool_assembly`,
  `runtime.session_store`, and `runtime.agent_loop`.

## Follow-Up Proof Checklist

After this branch deploys:

- Start a desktop AgentCore thread with a simple no-tool prompt.
- Send a same-thread follow-up within the AgentCore warm-window.
- Expand both turn activity rows and compare `Workspace sync` plus
  `AgentCore phases`.
- Expect the follow-up to show higher `skipped_files`, lower or zero
  `synced_files`, and a shorter `workspace bootstrap` phase if the warm hydrate
  cache is responsible for the speedup.
- Run `thinkwork trace turn <turnId> --stage dev` and confirm it exits 0 with
  normalized invocation rows or an explicit no-logs message.
