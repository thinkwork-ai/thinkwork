---
date: 2026-05-28
topic: desktop-local-pi-sidecar
---

# Desktop Local Pi Sidecar

## Problem Frame

ThinkWork's desktop app currently wraps `apps/spaces` in Electron while keeping all
agent execution in AWS. That was the right first desktop boundary, but it leaves
the future desktop product too dependent on hosted control loops. The desktop app
should begin moving toward a local agent posture: the installed app should own
the active orchestration loop when it can, use local app workspace resources
first, and delegate to managed AWS agents only when managed execution is
actually required.

The first version is not an offline LLM project and not an arbitrary local
filesystem agent. It is a **desktop-supervised Pi sidecar** that runs locally
inside the Electron app's trust boundary, reads the same rendered S3 workspace
for the active Agent + Space + User tuple, calls Bedrock and Hindsight through
cloud adapters, and can hand work to managed AWS agents as workers.

This matters because the local agent should eventually become the user's durable
desktop conductor: faster to dogfood, easier to inspect and control, cheaper for
work that does not need hosted computer-use resources, and ready for future
local model providers when offline/local LLM mode becomes viable.

---

## Actors

- A1. Desktop user: chats in `apps/desktop` and expects the installed app to own
  the live agent experience.
- A2. Local Pi sidecar: a supervised local runtime that handles desktop turns,
  reads rendered workspace context, calls model/memory adapters, and decides
  whether to delegate.
- A3. Electron shell: starts, supervises, stops, and talks to the sidecar through
  a narrow desktop-only bridge.
- A4. Managed AWS agent: an AgentCore-hosted worker used for cloud-isolated,
  long-running, credentialed, parallel, or otherwise managed work.
- A5. Platform API/runtime: resolves identity, permissions, rendered workspace
  prefixes, thread persistence, memory endpoints, and managed delegation.
- A6. Platform engineer: implements and debugs the local sidecar while preserving
  the existing AgentCore Pi runtime path.

---

## Key Flows

- F1. Desktop turn handled locally
  - **Trigger:** A signed-in user sends a message from the desktop app.
  - **Actors:** A1, A2, A3, A5
  - **Steps:** Electron ensures the local Pi sidecar is running; the app creates a
    trusted desktop invocation for the active Agent + Space + User + Thread; the
    sidecar reads or syncs the rendered S3 workspace for that tuple; Pi composes
    the system prompt and tool set; Pi calls Bedrock and Hindsight as needed;
    the final response and tool evidence are persisted back through the normal
    ThinkWork thread surface.
  - **Outcome:** The user experiences a normal ThinkWork response, but the
    orchestration loop ran locally.
  - **Covered by:** R1, R2, R3, R4, R5, R8, R9

- F2. Local Pi delegates to a managed AWS worker
  - **Trigger:** During a local turn, Pi determines that the work needs managed
    execution: cloud isolation, long runtime, special AWS credentials, hosted
    browser/sandbox capability, parallel workers, or user-approved expensive
    work.
  - **Actors:** A1, A2, A4, A5
  - **Steps:** Local Pi creates a managed delegation with the same tenant, Space,
    User, Thread, and rendered workspace context; the managed worker performs the
    requested subtask; results, costs, progress, and tool evidence return to the
    local Pi turn; local Pi incorporates or summarizes the result for the user.
  - **Outcome:** Local Pi remains the conductor while managed agents provide
    elastic execution.
  - **Covered by:** R6, R7, R10, R11, R12

- F3. Delegation becomes visible when it matters
  - **Trigger:** A managed delegation is expensive, risky, long-running,
    security-sensitive, destructive, or likely to need human steering.
  - **Actors:** A1, A2, A4, A5
  - **Steps:** Local Pi creates a visible worker thread or job instead of hiding
    the delegation inside the turn; the UI shows progress, status, and controls;
    the user can inspect, steer, pause, or resume the delegated work according to
    existing ThinkWork thread/job semantics.
  - **Outcome:** Routine delegation stays quiet; consequential delegation gives
    the user agency over cost, risk, time, and direction.
  - **Covered by:** R7, R12, R13

- F4. Sidecar failure falls back safely
  - **Trigger:** The desktop sidecar is unavailable, crashes, cannot start, loses
    required cloud credentials, or fails during a turn.
  - **Actors:** A1, A3, A5
  - **Steps:** Electron detects the failure, records useful diagnostics, and
    offers or performs a safe fallback to the existing managed runtime path when
    the request can still be served remotely.
  - **Outcome:** The desktop app remains usable and the user is not trapped by a
    broken local process.
  - **Covered by:** R14, R15

---

## Requirements

**Local orchestration**

- R1. In desktop mode, the default agent turn path must route through a local Pi
  sidecar when the sidecar is available and the user is signed in.
- R2. The local sidecar must be able to complete an ordinary desktop chat turn
  itself without creating a managed AWS worker.
- R3. The sidecar must consume the same core invocation context as the managed Pi
  runtime: tenant, agent, Space, user, thread, message history, selected model,
  memory preference, MCP/tool policy context, and rendered workspace prefix.
- R4. The sidecar must read or sync only the rendered ThinkWork app workspace for
  the active Agent + Space + User tuple. V1 must not grant arbitrary local
  filesystem, shell, clipboard, screenshot, browser, or OS automation access.
- R5. The sidecar must call Bedrock for model inference and Hindsight or the
  active memory adapter for memory. V1 does not require local model inference.

**Managed delegation**

- R6. The local sidecar must decide when to handle work locally and when to
  delegate to a managed AWS agent.
- R7. Delegation must use a hybrid visibility rule: routine subtasks can remain
  invisible and be summarized into the local response; expensive, risky,
  long-running, security-sensitive, destructive, or steerable work must become a
  visible managed job or worker thread.
- R8. Local Pi must remain the conversational conductor even when it delegates:
  it owns the user-facing plan, local context, final synthesis, and follow-up
  decisions.
- R9. Managed workers must receive enough shared context to act consistently
  with the local sidecar: tenant, Space, User when present, Thread, rendered
  workspace, tool policy, and relevant parent-turn instructions.
- R10. Managed worker results must return with status, errors, costs, tool
  evidence, and enough provenance for local Pi and the user to understand what
  happened.
- R11. Delegation must preserve existing ThinkWork safety and governance: tenant
  isolation, Space membership, tool-policy narrowing, per-user OAuth/MCP
  scoping, auditability, and cost attribution.

**Desktop host behavior**

- R12. Electron must supervise the sidecar as a separate local process rather
  than running the Pi loop in the renderer. The app must be able to start,
  health-check, restart, and stop the sidecar without giving the renderer Node
  access.
- R13. The desktop UI must surface local-vs-managed execution state where it
  affects user trust: sidecar unavailable, managed delegation started, managed
  delegation waiting for approval, long-running worker progress, and fallback to
  cloud runtime.
- R14. If the local sidecar is unavailable or fails, the desktop app must degrade
  to the existing managed runtime when safe, or explain why the request cannot
  continue.
- R15. Sidecar diagnostics must be inspectable by platform engineers without
  leaking secrets: process lifecycle, health status, current runtime version,
  delegation decisions, failed adapter calls, and redacted logs.

**Runtime reuse and parity**

- R16. The local sidecar should reuse the existing Pi runtime logic from
  `packages/agentcore-pi` wherever possible. Planning may split managed-hosting
  code from runtime-core code, but product behavior must remain aligned across
  local and AgentCore Pi.
- R17. The existing managed AgentCore Pi runtime remains supported. Local desktop
  Pi is an additional execution host, not a replacement.
- R18. Local and managed Pi must use compatible response evidence for messages,
  tools called, tool invocations, memory usage, costs, errors, and runtime
  metadata so existing thread surfaces can render both.

**Future readiness**

- R19. The v1 sidecar boundary must leave room for future local model providers,
  but v1 success must not depend on offline or local LLM inference.
- R20. The v1 sidecar boundary must leave room for future user-granted local
  folders and desktop automation, but those permissions are explicitly excluded
  from v1.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R4, R5, R18.** Given a signed-in desktop user opens a
  Thread in a Space and asks a normal question, when the sidecar is healthy,
  then the turn runs through local Pi, reads the rendered workspace for the
  active tuple, calls Bedrock/Hindsight as needed, persists the assistant
  response, and records runtime metadata showing `local-pi`.

- AE2. **Covers R6, R8, R9, R10, R11.** Given local Pi receives a request that
  requires a managed browser or sandbox capability, when it delegates to a
  managed AWS worker, then the worker receives the correct tenant/Space/User
  context and rendered workspace, returns tool evidence and cost metadata, and
  local Pi synthesizes the final answer.

- AE3. **Covers R7, R13.** Given local Pi determines a subtask will be expensive
  or long-running, when it starts the managed delegation, then the desktop UI
  shows a visible worker job or thread with status rather than hiding the work in
  a single spinner.

- AE4. **Covers R4, R20.** Given a user asks local Pi to inspect an arbitrary
  local folder on their Mac, when v1 sidecar handles the turn, then it refuses or
  asks to use a supported ThinkWork workspace path; it does not read local files
  outside the rendered app workspace.

- AE5. **Covers R12, R14, R15.** Given the sidecar crashes during startup, when
  the user sends a desktop message, then Electron records a redacted diagnostic,
  attempts restart or managed-runtime fallback, and surfaces a clear degraded
  state if fallback is not possible.

---

## Success Criteria

- A desktop chat turn can run end to end through local Pi, using Bedrock and
  Hindsight, without invoking an AgentCore-hosted Pi runtime.
- Local Pi can complete simple requests itself and delegate at least one managed
  AWS worker task when managed execution is required.
- The user can tell when consequential work has been delegated, and routine
  delegation does not clutter the normal conversation.
- Platform engineers can inspect local sidecar lifecycle and delegation
  decisions faster than debugging the same behavior only through cloud logs.
- A downstream `ce-plan` can split the work into package extraction, desktop
  supervision, invocation routing, workspace sync, cloud adapters, delegation,
  UI state, and fallback without reopening the product shape.

---

## Scope Boundaries

- No local/offline LLM inference in v1.
- No arbitrary local filesystem access, folder picker, shell commands,
  screenshots, clipboard access, local browser control, or OS automation in v1.
- No replacement or retirement of AgentCore-hosted Pi or Strands runtimes.
- No mobile support. Local Pi is only for the Electron desktop shell.
- No `apps/spaces` browser-tab local agent path. This depends on Electron.
- No requirement that all managed tools be locally reimplemented. Managed
  Browser, Code Interpreter, cloud credentials, long-running workers, and
  parallel workers can remain hosted.
- No full workflow/project-management UI for delegations beyond what is needed
  to show visible managed jobs or threads when the hybrid visibility rule
  requires it.

---

## Key Decisions

- **Desktop Pi sidecar over main-process Pi.** A supervised child process gives
  crash isolation, restart control, cleaner diagnostics, and a future home for
  local model providers. Running Pi inside Electron's main process is only
  suitable for a throwaway spike.
- **Local Pi is the default conductor.** The desktop app should not be a thin
  router to cloud agents. Local Pi owns the request unless managed execution is
  required.
- **App workspace only in v1.** The sidecar reads the rendered S3 workspace for
  Agent + Space + User. Broader desktop resources come later behind explicit
  permissions.
- **Cloud adapters stay in v1.** Bedrock and Hindsight remain cloud-backed for
  now. This gets control-loop locality without turning v1 into an offline model
  project.
- **Managed agents are workers.** AWS agents are still core to the architecture,
  but they are invoked by the local sidecar for work that benefits from managed
  execution.
- **Hybrid delegation visibility.** Delegation starts invisible, but becomes
  inspectable whenever the user would reasonably want agency over cost, risk,
  time, or direction.

---

## Dependencies / Assumptions

- `apps/desktop` already exists as an Electron shell with a typed IPC bridge and
  secure renderer posture. This brainstorm intentionally revisits the earlier
  v1 boundary that excluded embedded local backend behavior.
- `packages/agentcore-pi` already contains a Node/TypeScript Pi runtime with
  Bedrock, Hindsight, MCP, workspace sync, browser automation, sandbox, and
  response evidence concepts. Planning should verify which parts are reusable as
  local runtime core and which are AgentCore-host-specific.
- Rendered per-tuple workspaces are already part of the ThinkWork direction in
  `docs/brainstorms/2026-05-22-one-platform-agent-spaces-runtime-requirements.md`
  and folder-native goals build on the same S3 file substrate in
  `docs/brainstorms/2026-05-27-agentic-os-folder-native-goals-requirements.md`.
- Desktop users have network access to ThinkWork APIs, S3-mediated workspace
  content, Bedrock credentials via approved server-issued or local AWS auth
  flow, and Hindsight endpoints. The exact credential strategy is deferred to
  planning.
- The managed delegation path can reuse or extend existing AgentCore invocation
  plumbing rather than creating a separate worker product.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R1, R12][Technical] Define the sidecar transport between Electron and
  local Pi: stdio, localhost HTTP, Unix domain socket/named pipe, or another
  supervised IPC shape.
- [Affects R3, R16][Technical] Decide how to split `packages/agentcore-pi` into
  reusable runtime core versus AgentCore HTTP container host.
- [Affects R4][Technical] Define the desktop workspace sync/read strategy for
  rendered S3 prefixes, including cache location, invalidation, cleanup, and
  tenant/user isolation on a shared machine.
- [Affects R5][Security] Define how the sidecar obtains authority to call
  Bedrock and Hindsight without exposing long-lived AWS or service credentials
  to the renderer.
- [Affects R6-R11][Technical] Define the managed delegation contract: request
  shape, worker selection, visibility threshold, cancellation, progress events,
  result merge, and cost attribution.
- [Affects R13][Design] Define the smallest desktop UI states needed for local
  runtime health and managed delegation without turning chat into an operations
  dashboard.
- [Affects R14][Technical] Define fallback rules: when to retry local, when to
  fall back to managed runtime automatically, and when to ask the user.
- [Affects R15][Security] Define redaction and local log retention for sidecar
  diagnostics.
- [Affects R19][Technical] Preserve a future model-provider adapter boundary for
  local LLMs while keeping Bedrock as the v1 inference path.

---

## Next Steps

-> /ce-plan for structured implementation planning of the desktop local Pi
sidecar.
