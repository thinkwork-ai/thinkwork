---
title: "Spaces Runtime Renderer Rollout"
date: 2026-05-22
status: draft
---

# Spaces Runtime Renderer Rollout

This historical rollout runbook is kept for renderer changes, but the canonical
shape is now covered by [Workspace Architecture Verification](./workspace-architecture-verification.md).
Use that runbook for source/runtime folder checks before changing runtime
prefixes.

## Scope

- Applies to the Space renderer path that writes a per-thread runtime manifest
  for an `(agent, space, user)` invocation.
- Does not remove legacy per-agent workspace prefixes.
- Does not manually mutate production data or bypass the normal deploy
  pipeline.

## Preconditions

- The renderer Lambda is deployed by the normal main-branch pipeline.
- `RENDERED_WORKSPACE_PREFIX_TEMPLATE` is unset on AgentCore runtime
  environments.
- Admin and API GraphQL checks pass against the deployed stage.
- Operators have access to CloudWatch logs for the renderer Lambda and
  AgentCore runtime.

## Rollout

1. Deploy the renderer with the runtime env unset.

   Confirm normal chat turns still use the legacy per-agent workspace prefix.
   This is the no-behavior-change stage.

2. Invoke the renderer for one known tenant, agent, Space, and requester user.

   Verify the invocation returns a rendered prefix and writes the expected
   `.hydrate_manifest.json` under the thread runtime prefix. The manifest should
   reference `Agent/...`, `Spaces/<space>/...`, and `User/...` source paths.

3. Enable rendered-prefix reads for one AgentCore runtime.

   Set `RENDERED_WORKSPACE_PREFIX_TEMPLATE` through the standard deploy/update
   path for one runtime only. Do not update every runtime in the same step.

4. Observe one thread in a non-default Space.

   Confirm the system prompt includes the rendered Space and requester context.
   Check that the runtime logs reference the rendered prefix rather than the
   legacy per-agent prefix. In the local `/workspace` sandbox, the Agent source
   should be at root, `USER.md` should be at root, and the active Space should
   appear as singular `Space/`.

5. Propagate to the remaining AgentCore runtimes.

   Roll through the same deploy/update path in small batches. Watch renderer
   latency, AgentCore bootstrap logs, and thread-turn failure rates.

6. Leave legacy prefixes in place.

   Legacy per-agent prefixes remain the rollback path for Plan A. Removing them
   belongs to the later destructive cleanup plan.

## Rollback

Unset `RENDERED_WORKSPACE_PREFIX_TEMPLATE` through the normal deploy/update
path and restart the affected runtime. New turns will fall back to the legacy
per-agent workspace prefix. Existing rendered prefixes may remain in S3.

## Verification

- Renderer logs show cache hits after the first render for the same tuple.
- AgentCore bootstrap logs show the rendered prefix for enabled runtimes.
- A non-default Space thread includes Space context in the system prompt and
  exposes it under `/workspace/Space`.
- Runtime smoke checks do not show top-level `/workspace/Agent`,
  `/workspace/Spaces`, `/workspace/User`, `/workspace/source`,
  `/workspace/workspace`, or `/workspace/workspace-archives`.
- Default-Space behavior remains unchanged.
- Thread-turn error rate does not increase after each batch.
