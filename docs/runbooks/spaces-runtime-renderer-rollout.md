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
- Assumes legacy per-agent workspace prefixes have already been removed from
  runtime compatibility paths.
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

   Confirm normal chat turns render a Thread runtime manifest without reading
   legacy per-agent `workspace/` prefixes.

2. Invoke the renderer for one known tenant, agent, Space, and requester user.

   Verify the invocation returns a rendered prefix and writes the expected
   `.hydrate_manifest.json` under the Thread runtime prefix. The manifest should
   reference Agent root files, `Spaces/<space>/...`, `User/...`, and `Thread/...`
   runtime paths.

3. Enable rendered-prefix reads for one AgentCore runtime.

   Set `RENDERED_WORKSPACE_PREFIX_TEMPLATE` through the standard deploy/update
   path for one runtime only. Do not update every runtime in the same step.

4. Observe one thread in a non-default Space.

   Confirm the system prompt includes the rendered Space and requester context.
   Check that the runtime logs reference the rendered prefix rather than any
   legacy per-agent prefix. In the local `/workspace` sandbox, the Agent source
   should be at root, requester context should be under `User/USER.md`, the
   active Space should appear under `Spaces/<active-space>/`, and generated
   progress should appear under `Thread/`.

5. Propagate to the remaining AgentCore runtimes.

   Roll through the same deploy/update path in small batches. Watch renderer
   latency, AgentCore bootstrap logs, and thread-turn failure rates.

6. Leave source prefixes in place.

   Agent, Space, User, and Thread source prefixes remain the authority. Legacy
   wrapper prefixes such as `workspace/`, `source/`, and `workspace-archives/`
   are not runtime rollback paths after the v1 cutover.

## Rollback

Rollback should go through the normal deploy/update path and restore the last
known-good renderer/runtime image. Do not re-enable legacy `workspace/`,
`source/`, or `workspace-archives/` reads as an emergency fallback.

## Verification

- Renderer logs show cache hits after the first render for the same tuple.
- AgentCore bootstrap logs show the rendered prefix for enabled runtimes.
- A non-default Space thread includes Space context in the system prompt and
  exposes it under `/workspace/Spaces/<active-space>`.
- Runtime smoke checks show `/workspace/User/USER.md`,
  `/workspace/Spaces/INDEX.md`, `/workspace/Spaces/<active-space>/`, and
  `/workspace/Thread/PROGRESS.md`.
- Runtime smoke checks do not show top-level `/workspace/Agent`,
  `/workspace/Space`, `/workspace/USER.md`, `/workspace/source`,
  `/workspace/workspace`, or `/workspace/workspace-archives`.
- Default-Space behavior remains unchanged.
- Thread-turn error rate does not increase after each batch.
