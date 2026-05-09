---
title: "ThinkWork Computer v1 autopilot status"
type: status
status: active
date: 2026-05-09
plan: docs/plans/2026-05-08-014-feat-thinkwork-computer-v1-consolidated-plan.md
---

# ThinkWork Computer v1 autopilot status

This file records implementation decisions, blockers, and follow-up notes while executing the consolidated Computer v1 plan without stopping for interactive questions.

## 2026-05-09

- **Decision:** Computer thread turns must force the Python Strands runtime whenever `computerId` and `computerTaskId` are present, even if the backing `agents.runtime` row still says `flue`. This avoids the legacy TypeScript/Flue path and lets Strands complete the `computer_tasks` row and persist the assistant response.
- **Verification note:** After the Strands routing fix deployed, a fresh deployed GraphQL-created thread produced a `thread_turn_dispatched` event with `runtime: "strands"`, a completed `computer_tasks` row, and an assistant message from `sender_type=computer`.
- **Blocker worked around:** Computer Use could not reacquire the browser window after deployment because the macOS accessibility bridge returned `cgWindowNotFound`. The deployed path was verified through GraphQL/API/DB and CloudWatch instead. Continue to use Computer Use again when the bridge is healthy.
- **Decision:** Keep `apps/computer` approval routes available for push deep-links, but do not expose Approvals/Inbox as sidebar destinations. Pending `computer_approval` count belongs on the Computer nav item per the latest UX direction.
- **Decision:** The dashboard refresh UI must stop simulating progress with timers. The next M5 unit wires `apps/computer` to `dashboardArtifact(id)` and `refreshDashboardArtifact(id)` so the refresh bar reflects the real Computer task state. Runtime execution of `dashboard_artifact_refresh` is tracked as the next remaining gap after this UI/API wiring.
- **Verification note:** Browser-level smoke for the dashboard artifact route passed on `http://127.0.0.1:5180` using a temporary Playwright browser with mocked tenant/GraphQL responses: the artifact loaded, the deterministic refresh copy rendered, clicking Refresh called the refresh mutation once, and the bar showed `Queued`.
- **Decision:** Execute `dashboard_artifact_refresh` deterministically inside the API mutation for v1, then complete/fail the Computer task there. This avoids depending on the legacy TypeScript `packages/computer-runtime` container while preserving task auditability and the UI's task-state contract.
- **Verification note:** API refresh executor coverage passes for success and S3 failure paths; `refreshDashboardArtifact` now writes the refreshed manifest, completes the Computer task with deterministic refresh metadata, or marks the task failed before surfacing the error.
- **Blocker worked around:** Computer Use still cannot inspect Brave or Chrome (`cgWindowNotFound` from the macOS accessibility bridge). Streaming verification continues with automated browser/unit coverage until Computer Use can reacquire browser windows.
- **Decision:** apps/computer must use the explicit `VITE_GRAPHQL_WS_URL` AppSync realtime endpoint for subscriptions while keeping the AppSync authorization `host` set to the GraphQL API host from `VITE_GRAPHQL_URL`. The build already writes both env vars; the client was only reading `VITE_GRAPHQL_URL`, which could route live subscriptions to the wrong host and make token streaming appear dead.
- **Decision:** AppSync subscription `start` payloads must send a printed GraphQL document string. `urql` can pass a `DocumentNode` through `forwardSubscription`, so apps/computer now serializes subscription queries before opening the AppSync realtime operation.
