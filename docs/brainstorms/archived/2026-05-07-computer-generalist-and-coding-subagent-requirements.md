---
date: 2026-05-07
topic: computer-generalist-and-coding-subagent
status: superseded
superseded_by: docs/brainstorms/2026-05-07-thinkwork-computer-on-strands-requirements.md
superseded_reason: Direction changed within the same session — committed to Strands as the single foundation for the Computer (and delegated workers), dropping the Flue+Pi+CE coding-agent direction documented here.
related:
  - docs/brainstorms/2026-05-03-flue-framework-pi-parallel-reframe-requirements.md
  - docs/brainstorms/2026-05-06-thinkwork-computer-product-reframe-requirements.md
  - docs/brainstorms/2026-05-07-computer-first-connector-routing-requirements.md
  - docs/solutions/architecture-patterns/flue-fr9a-integration-spike-verdict-2026-05-03.md
  - docs/solutions/architecture-patterns/flue-runtime-launch-2026-05-04.md
---

# Computer Generalist Agent and Coding Subagent

## Summary

Build a two-Flue-agent architecture: a generalist **Computer Pi+Flue agent** on ECS+EFS that owns user context, orchestration, and the outer keep-going-until-done loop, plus a **Flue+Pi+CE coding Managed Agent** on Bedrock AgentCore Runtime that runs `/lfg` end-to-end per delegation. Both agents consume a shared `flue-stdlib` package from day one. v1 proves the architecture with a Linear-bug-fix workflow on Eric's dev tenant: Linear issue → Computer claims → delegates non-blockingly → coding agent ships a green draft PR via `/lfg` → Computer re-evaluates Linear state → done.

```
+--- Linear connector / mobile chat / scheduled triggers ---+
                            |
                            v
+--- Computer Pi+Flue agent (ECS+EFS, always-on per user) ---+
|  - Pi WITHOUT compound-engineering plugin                   |
|  - Custom orchestrator system prompt                        |
|  - Tools: workspace (EFS-direct), memory, thread, events,   |
|           approvals, agent.delegate, mcp brokerage          |
|  - Owns outer keep-going-until-done loop                    |
+----------------------------|--------------------------------+
                             | agent.delegate(coding, ...)
                             | non-blocking via computer_events
                             v
+--- Coding agent (Pi+CE+Flue, Bedrock AgentCore, 8h cap) ---+
|  - Pi WITH compound-engineering plugin                      |
|  - /lfg end-to-end (plan→work→test→commit→push→PR→CI→fix)   |
|  - Tools: sandbox.exec (AgentCore CI), workspace, memory,   |
|           thread, events, approvals, mcp (GH/Linear/Hindsight) |
+----------------------------|--------------------------------+
                             | approvals.request (HITL)
                             v
   Computer surfaces to mobile (push + thread); resumes on response
```

---

## Problem Frame

The 2026-05-06 ThinkWork Computer reframe makes the Computer the durable per-user product object: always-on, ECS+EFS, owns workspace + threads + tasks + events + approvals + delegation. Today, `packages/computer-runtime/` is a narrow task-dispatcher (handles `noop`, `health_check`, `workspace_file_write`, `google_cli_smoke`, `google_workspace_auth_check`) — no model, no agent loop, no real tool surface. To deliver on the reframe's promise — "more than a chat agent: a governed, persistent workplace for AI work" — the Computer needs a real agent harness with a real tool catalog and the ability to delegate heavy work without blocking.

Separately, the 2026-05-03 Flue brainstorm and the FR-9a green verdict have established Bedrock AgentCore Runtime + AgentCore Code Interpreter as the production substrate for managed Flue agents. Marco answers chat end-to-end on dev with a deploy-time smoke gate. What's missing is the first concrete Managed Agent that justifies that substrate at production scale: a coding agent that runs `/lfg` against the user's repos.

The two needs converge here. The Computer needs delegation; the coding agent needs an orchestrator. Stock Flue is a minimal harness (handlers, sessions, tools, MCP, sandbox, sub-agent task delegation) — useful, but too thin to make either agent feel real on its own. A shared `flue-stdlib` is the layer that gives both agents a coherent tool surface (workspace, memory, thread, events, approvals, mcp brokerage, control-loop status, mobile HITL bridge), without forcing each consumer to reimplement common plumbing.

---

## Actors

- A1. Computer owner: the human user (Eric in v1; future per-user Computer owners). Receives mobile push notifications when HITL is needed; sees threads, artifacts, and audit through admin and mobile.
- A2. Tenant admin/operator: governs budgets, tool permissions, audit retention, and tenant-isolation boundaries. Configures GitHub App installs and Linear connector bindings.
- A3. Computer Pi+Flue agent: long-lived ECS+EFS process per user; runs Pi without the CE plugin; consumes `flue-stdlib`; owns orchestration and the outer keep-going loop.
- A4. Coding Flue+Pi+CE Managed Agent: per-delegation Bedrock AgentCore Runtime invocation; runs Pi with the CE plugin; consumes `flue-stdlib`; runs `/lfg` end-to-end.
- A5. `flue-stdlib` package: shared TypeScript package both A3 and A4 import from; owns the Flue tool definitions, control-loop primitives, and HITL bridge.
- A6. Mobile client: surfaces HITL questions; user response feeds back as the answer payload.
- A7. Linear connector: v1 trigger source; routes Linear issues to the Computer per `2026-05-07-computer-first-connector-routing-requirements.md`.

---

## Key Flows

- F1. Linear issue routes to the Computer
  - **Trigger:** A Linear issue matches the connector's project/label gate.
  - **Actors:** A1, A3, A7
  - **Steps:** Connector records execution → creates a Computer task/event → Computer's task-listener receives the event → Computer Pi+Flue agent reads memory, workspace, and Linear context → decides to handle directly, delegate, or ask for HITL.
  - **Outcome:** Computer-owned thread is created; an outer-loop session is started.
  - **Covered by:** R1, R6, R8, R23

- F2. Computer delegates the coding task non-blockingly
  - **Trigger:** Computer's outer-loop session decides the issue needs `/lfg`.
  - **Actors:** A3, A4
  - **Steps:** Computer calls `agent.delegate(coding, { taskPayload, threadId, ... })` → stdlib invokes Bedrock AgentCore `InvokeAgentRuntime` → returns immediately with a delegation ID → Computer's session yields and frees the ECS task to handle other events.
  - **Outcome:** Coding agent is running; Computer is unblocked.
  - **Covered by:** R2, R10, R16, R24

- F3. Coding subagent runs `/lfg` end-to-end
  - **Trigger:** AgentCore Runtime invocation starts.
  - **Actors:** A4
  - **Steps:** Trusted handler resolves per-tenant Code Interpreter, GitHub App token, MCP servers (GitHub/Linear/Hindsight), Hindsight memory tools, Aurora SessionStore → `init()` Flue with all of the above → Pi+CE runs `/lfg` (plan → work → test → commit → push → open draft PR → watch CI → fix until green) → emits `computer_events` throughout for audit → returns a structured status payload to the Computer.
  - **Outcome:** Green draft PR opened; structured status returned.
  - **Covered by:** R3, R11, R12, R13, R14, R26, R27

- F4. HITL question raised inside `/lfg` surfaces to mobile
  - **Trigger:** A CE skill or `/lfg` step calls an `AskUserQuestion`-shape inside the coding agent.
  - **Actors:** A1, A3, A4, A6
  - **Steps:** Coding agent's stdlib `approvals.request` tool emits a `needs_approval` `computer_event` → Computer Pi+Flue agent surfaces the question to mobile (thread message + push) → user responds on mobile → response is recorded as the answer payload → coding agent's `approvals.request` blocking call unblocks → Pi resumes inside `/lfg`.
  - **Outcome:** Coding agent receives the user's answer and continues.
  - **Covered by:** R18, R19, R20

- F5. Outer keep-going loop re-evaluates after each `/lfg` cycle
  - **Trigger:** Coding agent's delegation completes with status `done | continue | needs_approval | blocked`.
  - **Actors:** A3
  - **Steps:** Computer's outer-loop session wakes on the completion event → reads Linear state, PR comments, CI status, user replies → decides done, re-delegate (next `/lfg` cycle), or escalate to HITL → if re-delegating, calls `agent.delegate(coding, ...)` again with updated context → if budget cap reached, surfaces a needs_approval question instead.
  - **Outcome:** Linear task is either marked done by the Computer or another `/lfg` cycle starts.
  - **Covered by:** R21, R22, R28

---

## Requirements

**Architecture and substrates**
- R1. Connector events route to the Computer first; the Computer then decides delegation. Direct connector → coding agent dispatch is not part of v1 (per `docs/brainstorms/2026-05-07-computer-first-connector-routing-requirements.md`).
- R2. Long-running coding work runs on a separate compute substrate from the Computer. The Computer's main agent loop is never blocked by `/lfg`.
- R3. The coding subagent runs on Bedrock AgentCore Runtime with the AgentCore Code Interpreter sandbox.
- R4. The Computer agent runs on ECS+EFS, with EFS mounted as the Computer's live `/workspace`.
- R5. Local Flue `session.task()` subagents are documented as a future extension point. They are not built or exercised in v1; the architecture stays open for the second sub-task type to land cleanly later.

**Computer Pi+Flue agent**
- R6. The Computer's brain is Pi running in a Flue harness. The compound-engineering plugin is NOT installed on the Computer in v1.
- R7. The Computer has a custom orchestrator system prompt and a purpose-built tool set. Selective CE skill add-back (e.g., ce-brainstorm, ce-plan, ce-doc-review) stays a post-v1 deliberation, not a v1 commitment.
- R8. The Computer's v1 tool surface includes: workspace read/write/search (EFS-direct), memory recall/retain (Hindsight), thread append, events emit, approvals request (mobile HITL), `agent.delegate` (coding), MCP brokerage, control-loop status. Gmail/Calendar/Drive/Docs/Slack tools are out of v1 (they belong on a later plan).
- R9. The Computer's task-listener and Flue agent loop run in the same long-lived ECS Node.js process. Tools access EFS directly via `fs`, not via S3 round-trip.
- R10. The Computer can have multiple Flue sessions in flight concurrently in one ECS task: one session waiting on a delegation completion event, another handling a chat turn, another reacting to a connector event.

**Coding Flue+Pi+CE Managed Agent**
- R11. The coding agent's brain is Pi running in a Flue harness with the compound-engineering plugin baked into the AgentCore Flue ECR image.
- R12. The coding agent's v1 inner workflow is `/lfg` end-to-end: plan → work → test → commit → push → open draft PR → watch CI → fix-until-green. CI watch and fix-until-green are not trimmed; the 8h AgentCore Runtime cap is sufficient.
- R13. The coding agent's v1 scope is bug-fix-style work driven by Linear issues. Generalist coding (refactor, feature implementation, code review) is out of v1.
- R14. The coding agent's v1 artifact returned to the Computer is a green draft PR plus a structured status payload (PR URL, branch, files changed, test status, summary).
- R15. The coding agent's v1 tool surface includes: sandbox.exec (AgentCore CI), workspace read/write (sandbox-scoped, ephemeral), memory recall/retain (Hindsight), thread append (writes to the Computer-owned thread), events emit (writes to Computer-owned events), approvals request (HITL bridge through the Computer), MCP brokerage (GitHub, Linear, Hindsight only), control-loop status. Plus everything the CE plugin already provides.

**Shared `flue-stdlib`**
- R16. A new package `packages/flue-stdlib/` is introduced as a shared TypeScript package consumed by both `packages/computer-runtime/` and the coding agent's container code at `packages/agentcore-flue/agent-container/`.
- R17. `flue-stdlib` exposes Flue `ToolDef[]` factories for: workspace, memory, thread, events, approvals, `agent.delegate`, mcp brokerage, sandbox.exec, control-loop status. Each tool is tagged with which consumer can use it (Computer-only / coding-only / both).
- R18. `flue-stdlib` exposes the structured turn-status type `done | continue | needs_approval | blocked` and the helpers both agents use to emit it.

**HITL bridge**
- R19. Any `AskUserQuestion`-shape call inside any CE skill or `/lfg` step in the coding agent surfaces to the user's mobile device through the Computer. The HITL surface supports single-select, multi-select, and prose question shapes.
- R20. While a coding agent is paused on HITL, its AgentCore Runtime invocation remains alive (within the 8h cap). The user's response unblocks the coding agent's `approvals.request` blocking call without restarting `/lfg`.

**Outer keep-going loop**
- R21. After each `/lfg` cycle completes, the Computer evaluates whether the Linear task is complete by reading Linear state, PR comments, CI status, and user replies; it then either declares done or re-delegates with updated context.
- R22. Re-delegation by the Computer uses the same `agent.delegate(coding, ...)` primitive; each cycle is one fresh AgentCore Runtime invocation with one fresh AgentCore CI sandbox.
- R23. Non-blocking delegation: `agent.delegate` returns immediately with a delegation ID; completion is delivered as a `computer_event` the caller's session wakes on.

**Auth, isolation, and budgets**
- R24. Repo authorization for the coding agent uses a per-tenant GitHub App token, not the user's PAT. Force-push is blocked. Pushes targeting `main` (or any configured protected branch) are blocked. Branch naming for `/lfg` includes the Linear issue ID for traceability.
- R25. AgentCore Code Interpreter resources are scoped per tenant: one `codeInterpreterIdentifier` per tenant; the trusted handler resolves the right one from invocation context. Cross-tenant access is impossible by IAM.
- R26. The Computer's ECS task IAM role is per-tenant; the Computer cannot read another tenant's repos, secrets, memories, or files. The coding agent's AgentCore Runtime IAM role is per-tenant equivalently.
- R27. The Computer's outer loop owns budget enforcement: max delegations per Linear task, max model spend per task, max wall-clock per task. The coding agent does not enforce its own budgets internally.

**Scope of v1 demo**
- R28. The v1 acceptance flow is: Linear bug-fix issue routed to Eric's Computer on dev → Computer claims → delegates non-blockingly to coding agent → coding agent runs `/lfg` end-to-end → green draft PR opened → Computer re-evaluates Linear state → declares done OR re-delegates within budget.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R10, R23.** Given a Linear issue routed to Eric's Computer, when the Computer's outer-loop session calls `agent.delegate(coding, ...)`, the call returns a delegation ID within seconds and the Computer's ECS process remains free to handle other events (e.g., a mobile chat turn) before `/lfg` completes.
- AE2. **Covers R3, R11, R12, R14.** Given the coding agent receives a delegation, when `/lfg` runs end-to-end against the target repo, the agent opens a draft PR with green CI and returns a structured status payload (PR URL, branch, files changed, summary) to the Computer.
- AE3. **Covers R6, R7.** Given the Computer is asked to perform a coding task, when the Computer agent acts, it does NOT attempt to run `/lfg`, `/ce-work`, or any other CE skill itself; instead it delegates to the coding subagent.
- AE4. **Covers R19, R20.** Given `/lfg` reaches a step that calls `AskUserQuestion`-shape, when the coding agent emits `approvals.request`, the user receives a thread message + push notification on mobile; on user response, the coding agent's blocking call unblocks within the same AgentCore Runtime invocation and `/lfg` continues.
- AE5. **Covers R21, R22, R27.** Given a `/lfg` cycle completes with a green draft PR, when the Computer's outer-loop session evaluates the Linear task and decides it is not done (e.g., new comment requesting changes), it re-delegates to the coding agent within the budget cap, or surfaces a needs_approval question if the budget cap is reached.
- AE6. **Covers R24, R25, R26.** Given a tenant-A delegation is in flight, when an attacker-controlled prompt attempts to read tenant-B's repo, files, or memories, the GitHub App token, AgentCore CI session, and ECS/AgentCore IAM roles each independently fail closed.

---

## Success Criteria

- A real Linear bug-fix issue routed to Eric's Computer on dev produces a real green draft PR within budget, end-to-end, with thread + audit visible in admin and an HITL question surfaced and resolved through mobile during at least one cycle.
- The Computer agent demonstrably orchestrates without running `/lfg` itself; the coding agent demonstrably runs `/lfg` without orchestrating outside its scope.
- `flue-stdlib` is consumed by both `packages/computer-runtime/` and `packages/agentcore-flue/agent-container/`; no implementation of any stdlib tool is duplicated across the two consumers.
- A pending HITL question is observable in `computer_events` and the deploy-time smoke gate covers at least one HITL round-trip.
- Downstream `/ce-plan` has enough scope clarity to break this work into shippable units without inventing product behavior, harness semantics, or v1 acceptance criteria.

---

## Scope Boundaries

- ECS+EFS for the coding agent (rejected; AgentCore Runtime is the substrate).
- Bedrock AgentCore Runtime for the Computer agent (rejected; ECS+EFS is the substrate).
- Daytona sandbox.
- Local Flue `session.task()` subagents *built and exercised* in v1 (architecture stays open for future).
- Computer agent's Gmail / Calendar / Drive / Docs / Slack tool surface in v1.
- Browser / computer-use hooks.
- Generalist coding for the coding agent: refactor, feature implementation, code review.
- PR-merge automation (v1 stops at green draft PR; merge stays human).
- Multi-delegation persistent workspace cache across coding-agent invocations.
- Routine triggers fired from inside the coding agent.
- Nested `agent.delegate` from the coding agent to other Managed Agents.
- The compound-engineering plugin installed on the Computer.
- Slack and Google Workspace MCP servers wired into the coding agent.
- AgentCore Memory and Wiki as writable memory surfaces from either agent (recall-only).
- Marketing positioning of "ThinkWork has a coding agent" (separate doc if pursued).
- Parallel `/lfg` sub-agent fan-out testing in v1 acceptance (planning-time spike if required).

---

## Key Decisions

- **Two substrates, one harness.** Computer on ECS+EFS, coding agent on Bedrock AgentCore Runtime. Both run Flue. The substrate split is driven by what each agent needs (long-lived live workspace vs. per-delegation managed sandbox), not by harness preference.
- **Pi without CE on the Computer; Pi with CE on the coding agent.** CE's gravity is hands-on coding; the Computer dispatches, it does not implement. Selective CE skill add-back stays a post-v1 deliberation rather than installing the whole plugin on the Computer.
- **Shared `flue-stdlib` from day one.** Both consumers exist in v1, so the second-consumer-extraction trigger has already fired. Stdlib is designed for both consumers; tools tagged Computer-only / coding-only / both. This supersedes the earlier coding-agent-first synthesis answer.
- **Outer keep-going loop owned by the Computer, not the coding agent.** The "is the Linear task done?" judgment requires fuzzy reading of Linear comments, PR state, CI, and user replies — a model-driven call that belongs in the orchestrator. Each `/lfg` cycle is one fresh AgentCore Runtime invocation; multi-cycle continuity lives at the Computer.
- **Non-blocking delegation through completion events.** `agent.delegate` returns immediately with a delegation ID; completion fires a `computer_event` the caller's session wakes on. Multiple Computer sessions can be in flight without resource contention.
- **HITL bridge through `computer_events`.** A pending HITL question is a `needs_approval` `computer_event`; mobile reads from `computer_events`; user response writes the answer back; the coding agent's blocking call unblocks. Same persistence layer as audit; no separate HITL store.
- **Per-tenant GitHub App for coding-agent repo auth.** Force-push and protected-branch pushes are blocked structurally. User PATs are not required for the coding agent.
- **`/lfg` end-to-end in v1, including CI watch + fix-until-green.** AgentCore Runtime's 8h cap covers realistic CI cycles. The earlier-considered CI-watch trim is not needed.
- **v1 = bug-fix coding only.** Wider coding scope (refactor / feature / review) is a deliberate post-v1 decision to keep the v1 acceptance bar legible.

---

## Dependencies / Assumptions

- *[Verified by code read]* `packages/agentcore-flue/agent-container/src/` already implements handler-context, MCP, MCP-connect, Aurora SessionStore, bearer-scrub, and scrubbing-fetch.
- *[Verified by code read]* `packages/computer-runtime/` exists today as a narrow task-dispatcher; upgrading it to a Flue agent host is in scope here.
- *[Verified by code read]* Aurora `computer_tasks` and `computer_events` tables exist (`packages/database-pg/src/schema/computers.ts`).
- *[Verified by docs]* Bedrock AgentCore Runtime + AgentCore Code Interpreter is production-shipping on dev with a deploy-time smoke gate (`docs/solutions/architecture-patterns/flue-runtime-launch-2026-05-04.md`).
- *[Verified by FR-9a verdict]* AgentCore Code Interpreter has full bash semantics on Amazon Linux 2023 (kernel 6.1.158); Bedrock model routing works via inference-profile-prefixed model IDs.
- *[Assumption, requires spike]* The compound-engineering plugin runs unmodified inside Pi running inside Flue, especially `AskUserQuestion`-shape semantics inside `/lfg`. Sibling spike to FR-9; required before plan revision.
- *[Assumption, per AWS docs]* Bedrock AgentCore Runtime supports synchronous invocations of up to ~8h. Sufficient for `/lfg` end-to-end including CI watch.
- *[Assumption]* Per-tenant GitHub Apps can be installed and managed via existing tenant-onboarding paths or a small extension to them; specific extension scope is planning-time.
- *[Assumption]* `/lfg` can complete with `git push` + CI watch + fix-until-green within one AgentCore Runtime invocation in realistic cases (CI typically 5–15 min; multi-cycle fix loops typically <1h).
- *[Assumption]* Concurrent file ops inside one AgentCore Code Interpreter session serialize cleanly enough that `/lfg`'s parallel sub-agent fan-out (e.g., parallel persona reviewers) does not break in v1; behavioral test deferred to planning if a v1 use case relies on it.
- *[Assumption]* Per-tenant `codeInterpreterIdentifier` provisioning extends current Terraform patterns (`terraform/modules/app/agentcore-code-interpreter/`) cleanly.

---

## Outstanding Questions

### Resolve Before Planning

(none — all product questions resolved during brainstorm)

### Deferred to Planning

- **[Affects R11, R12][Needs research]** Does the compound-engineering plugin run unmodified inside Pi inside Flue, especially `AskUserQuestion`-shape semantics inside `/lfg`? Spike sibling to FR-9.
- **[Affects R16, R17][Technical]** Migration shape for the existing AgentCore-flue plumbing (handler-context, MCP, sessionstore-aurora, bearer-scrub, scrubbing-fetch) into `flue-stdlib`: extract entirely vs. keep some modules at the agentcore-flue boundary.
- **[Affects R8, R9, R10][Technical]** Computer ECS process model: how do multiple in-flight Flue sessions share the process (worker_threads vs cooperative async vs separate Node child processes)?
- **[Affects R19, R20, R23][Technical]** Concrete persistence + IPC mechanism for non-blocking delegation completion and HITL pause/resume: `computer_events` polling, EventBridge, SQS, or Aurora notifications.
- **[Affects R12, R15][Technical]** AgentCore Code Interpreter session lifecycle for `/lfg`: confirm one session-per-invocation is the right pattern; verify the connector's lazy-create/cleanup behavior is compatible with multi-step `/lfg` runs (long-lived single session across CI watch loops).
- **[Affects R24][Needs research]** Per-tenant GitHub App installation flow: how does a new tenant onboard a GitHub App? What scopes are required for `/lfg`-style branch push + draft PR open + PR comment read?
- **[Affects R8][Technical]** EFS layout for the Computer's `/workspace`: per-user persistent root, scoping for sub-projects, how the sandbox-scoped coding-agent workspace relates (if at all) to the Computer's EFS.
- **[Affects R27][User decision]** Concrete budget defaults: max delegations per Linear task, max model spend per task, max wall-clock per task.
- **[Affects R13][User decision]** When v1 ships and exits acceptance, what is the next coding-scope expansion (refactor? feature? review? all three)? Sequencing decision; not a v1 blocker.
- **[Affects R12][Technical]** Concurrent file ops inside one AgentCore CI session and `/lfg` parallel sub-agent fan-out: behavioral test before any v1 use case relies on it.
- **[Affects R5][Technical]** When a second sub-task type lands (e.g., a "summarize this thread" subagent), what registry shape decides local Flue `session.task()` vs. external `InvokeAgentRuntime` substrate? Architecture stays open for this.
- **[Affects R19][UX]** Mobile UX for HITL: thread-rendered question vs. full-screen modal vs. a mix; relationship between push notification and in-app surface; behavior when user dismisses the push without responding.

---

## Next Steps

1. **Sibling spike to FR-9: CE-plugin-on-Pi-on-Flue compatibility.** Verify the compound-engineering plugin runs unmodified inside Pi inside Flue, especially `AskUserQuestion`-shape semantics inside `/lfg`. Capture verdict to `docs/solutions/`.
2. **`/ce-doc-review`** this brainstorm to surface persona-shaped gaps (security, architecture, scope, design lens) before planning.
3. **`/ce-plan`** for structured implementation planning. The plan should sequence: (a) `flue-stdlib` package creation; (b) coding-agent container with CE plugin baked in + per-tenant Code Interpreter scoping; (c) Computer ECS+EFS upgrade from task-dispatcher to Flue agent host; (d) HITL bridge end-to-end; (e) outer keep-going loop; (f) v1 demo against Eric's dev tenant.
