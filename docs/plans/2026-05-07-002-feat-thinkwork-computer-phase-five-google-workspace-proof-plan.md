# ThinkWork Computer Phase Five — Google Workspace Proof

## Goal

Prove that a ThinkWork Computer can safely perform credential-aware, user-owned
work without placing OAuth tokens in task output, event payloads, or the durable
workspace.

Phase 4 made the Computer runtime visible through browser-triggered tasks and
events. Phase 5 starts the bridge from visibility to useful work by letting the
running ECS worker ask the API to verify the Computer owner's Google Workspace
connection.

## Phase 5 Slice

- Add a `GOOGLE_WORKSPACE_AUTH_CHECK` Computer task.
- Resolve the Computer owner's active `google_productivity` connection
  server-side.
- Reuse the existing OAuth token resolver so refresh/expiry behavior stays in
  the canonical credential path.
- Return only safe connection status metadata to the runtime.
- Surface the action in the Computer Live Runtime panel.

## Non-Goals

- No Gmail, Calendar, Drive, or Docs mutation yet.
- No OAuth token injection into ECS environment variables, EFS, logs, task
  output, or event payloads.
- No new credential store.
- No Google CLI authenticated command execution yet.

## Acceptance

- Operators can queue a Google Workspace auth check from the Computer detail
  page.
- The runtime can complete the task with one of three visible outcomes:
  connected and token resolved, connected but token unavailable, or no active
  Google Workspace connection.
- Unit tests cover task parsing/input normalization, runtime handler routing,
  and the server-side credential status helper.
