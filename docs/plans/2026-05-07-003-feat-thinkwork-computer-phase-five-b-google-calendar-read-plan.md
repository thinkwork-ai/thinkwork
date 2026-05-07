---
title: ThinkWork Computer Phase 5b Google Calendar Read Proof
status: completed
created: 2026-05-07
origin: docs/plans/2026-05-07-002-feat-thinkwork-computer-phase-five-google-workspace-proof-plan.md
---

# feat: ThinkWork Computer phase 5b Google Calendar read proof

## Overview

Phase 5a proved that a running ThinkWork Computer can safely ask the API whether its owner has a Google Workspace connection and whether the canonical OAuth resolver can produce a fresh token. Phase 5b should turn that proof into the first useful read-only Google action: a browser-queued Computer task that returns the owner's upcoming Calendar events without exposing OAuth token material to ECS task output, Computer events, workspace files, or logs.

This is intentionally a small product slice. The Computer remains the durable orchestrator and executes the Google Workspace CLI (`gws`) inside the ECS runtime. The API resolves the Computer owner's OAuth token through the canonical resolver and returns it only over the service-auth runtime channel; the runtime passes it to `gws` as an ephemeral child-process environment variable, sanitizes the CLI JSON output, and completes the task with a displayable result.

## Problem Frame

The Computers page is now organized enough to show runtime work, but the work is still mostly diagnostic. A real Computer needs proof that it can perform user-owned, credential-aware work. Calendar read is the best next step because it is useful immediately, read-only, and less risky than Gmail body access or write actions.

## Requirements Trace

- From Phase 5a goal: keep OAuth tokens out of task output, event payloads, durable workspace, and ECS environment.
- From Phase 5a non-goals: do not add Gmail/Calendar mutations, new credential stores, or token injection into the runtime.
- From the current product direction: Computers should be visibly useful from the Dashboard, not just a static config shell.
- From the user's Phase 5b ask: continue the Computer feature toward real Google Workspace value.

## Scope Boundaries

### In Scope

- Add a `GOOGLE_CALENDAR_UPCOMING` / `google_calendar_upcoming` Computer task type.
- Add task input normalization for a bounded upcoming-event window and result count.
- Add a service-auth runtime API endpoint that resolves the Computer owner's Google token for the ECS runtime.
- Execute Google Calendar read-only work through `gws` inside the Computer runtime.
- Return sanitized event summaries to task output.
- Surface a `Calendar` button and readable task summary in the admin Computer Live Runtime panel.
- Unit tests for API input normalization, runtime API Google Calendar helper, Lambda routing, runtime task handling, and admin source assertions.

### Out of Scope

- Gmail read, Gmail bodies, Gmail draft/write actions.
- Calendar create/update/delete.
- Persisting OAuth tokens in ECS environment variables, task output, events, or EFS.
- Rich task composer UI or arbitrary query input.
- Delegated AgentCore worker execution.

## Key Technical Decisions

1. **Use `googleworkspace/cli` inside the Computer runtime.**
   The product reframe selected `gws` as the preferred Google Workspace CLI if the token-based smoke passes. Phase 5b should prove the Computer can invoke `gws`, not just call Google REST APIs from Lambda.

2. **Use Calendar read-only as the first useful action.**
   Calendar upcoming events are useful enough for product proof, have a simple bounded API shape, and avoid the privacy blast radius of Gmail body access.

3. **Use a short-lived token handoff only for the CLI child process.**
   The API may return the fresh access token to the ECS runtime over the existing service-auth channel. The runtime must not write it to EFS, task output, events, or logs, and must pass it only to the `gws` child process via `GOOGLE_WORKSPACE_CLI_TOKEN`.

4. **Return sanitized event metadata.**
   The task output may include event `id`, `summary`, `status`, `start`, `end`, `location`, `htmlLink`, and `attendeeCount`, but not attendees, descriptions, raw API payloads, or token material.

5. **Use conservative defaults.**
   The admin button queues the next 24 hours with a small max result count. API normalization clamps caller-provided windows and counts so browser/runtime misuse cannot create unbounded reads.

## Implementation Units

- U1. **Add Calendar task contract and input normalization**
  - Files:
    - `packages/database-pg/graphql/types/computers.graphql`
    - `packages/api/src/lib/computers/tasks.ts`
    - `packages/api/src/lib/computers/tasks.test.ts`
  - Work:
    - Add `GOOGLE_CALENDAR_UPCOMING` to the GraphQL enum.
    - Add `google_calendar_upcoming` to `COMPUTER_TASK_TYPES`.
    - Normalize optional `timeMin`, `timeMax`, and `maxResults` with safe defaults and clamps.
  - Tests:
    - Parse uppercase/lowercase task types.
    - Default calendar input is bounded to a future window.
    - Reject invalid dates and clamp excessive `maxResults`.

- U2. **Add server-side Google Workspace CLI token helper and runtime endpoint**
  - Files:
    - `packages/api/src/lib/computers/runtime-api.ts`
    - `packages/api/src/lib/computers/runtime-api.test.ts`
    - `packages/api/src/handlers/computer-runtime.ts`
    - `packages/api/src/handlers/computer-runtime.test.ts`
  - Work:
    - Add `resolveGoogleWorkspaceCliToken` beside `checkGoogleWorkspaceConnection`.
    - Resolve the Computer owner connection and token through existing OAuth helpers.
    - Return safe status outcomes: no connection, token unavailable, or token resolved.
    - Add `POST /api/computers/runtime/google-workspace/cli-token`.
  - Tests:
    - No connection returns safe empty metadata.
    - Token resolution success returns token material only on the service-auth endpoint/helper.
    - Handler validates UUIDs and routes the endpoint.

- U3. **Teach the ECS runtime to execute the Calendar task**
  - Files:
    - `packages/computer-runtime/Dockerfile`
    - `packages/computer-runtime/src/api-client.ts`
    - `packages/computer-runtime/src/google-cli-smoke.ts`
    - `packages/computer-runtime/src/google-workspace-cli.ts`
    - `packages/computer-runtime/src/task-loop.ts`
    - `packages/computer-runtime/src/task-loop.test.ts`
  - Work:
    - Install pinned `@googleworkspace/cli` in the runtime image.
    - Default CLI smoke to the `gws` binary.
    - Add client method for the new runtime token endpoint.
    - Add `google_calendar_upcoming` task handling.
    - Invoke `gws calendar events list --params ...` with `GOOGLE_WORKSPACE_CLI_TOKEN` in the child-process environment.
    - Sanitize the CLI response before task completion.
    - Append a non-sensitive `google_calendar_upcoming_checked` event with counts/status only.
  - Tests:
    - Runtime invokes the token endpoint and `gws` wrapper, appends a safe event, and completes with sanitized calendar output.
    - Missing API dependency fails through existing task failure path.

- U4. **Expose the action in the Computer Dashboard**
  - Files:
    - `apps/admin/src/routes/_authed/_tenant/computers/-components/ComputerLiveTasksPanel.tsx`
    - `apps/admin/src/routes/_authed/_tenant/computers/-computers-route.test.ts`
    - Generated GraphQL files in `apps/admin/src/gql/`, `apps/cli/src/gql/`, `apps/mobile/lib/gql/`, and any package codegen outputs touched by the schema build.
  - Work:
    - Add a Calendar button to queue the new task with a next-24-hours input.
    - Render summaries such as `3 events in next 24h`, `Google Calendar not connected`, or `Google Calendar token unavailable`.
    - Keep Dashboard layout stable; no new large panels.
  - Tests:
    - Source assertion for the new task type/button and output summary branch.

## Verification Plan

- `pnpm --filter @thinkwork/api test -- src/lib/computers/tasks.test.ts src/lib/computers/runtime-api.test.ts src/handlers/computer-runtime.test.ts`
- `pnpm --filter @thinkwork/computer-runtime test -- src/task-loop.test.ts`
- `pnpm --filter @thinkwork/admin test -- src/routes/_authed/_tenant/computers/-computers-route.test.ts`
- `pnpm --filter @thinkwork/admin build`
- Browser verification on the Computer detail Dashboard to confirm the Calendar action appears without layout regression.

## Rollout Notes

- This is read-only and token-safe, so rollout can follow the existing main deploy path.
- The first dogfood check should use Marco/Eric's Computer and verify the task output contains only sanitized calendar event metadata.
- If Calendar API scopes are missing for an existing Google connection, the safe outcome should be a task output reason rather than a runtime crash.
