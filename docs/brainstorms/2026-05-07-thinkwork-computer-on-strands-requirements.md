---
date: 2026-05-07
topic: thinkwork-computer-on-strands
supersedes: docs/brainstorms/archived/2026-05-07-computer-generalist-and-coding-subagent-requirements.md
related:
  - docs/brainstorms/2026-05-06-thinkwork-computer-product-reframe-requirements.md
  - docs/brainstorms/2026-05-07-computer-first-connector-routing-requirements.md
  - docs/brainstorms/2026-05-03-flue-framework-pi-parallel-reframe-requirements.md
  - docs/solutions/architecture-patterns/flue-runtime-launch-2026-05-04.md
---

# ThinkWork Computer on Strands

## Summary

Build the ThinkWork Computer on the Strands agent loop as the single foundation stack. The top-level Computer agent and delegated workers both run on Strands. Ship a ThinkWork-owned **Computer Agent Standard Library** (Python) covering runtime/session, goal loop, planning/workpapers, workspace, Google Workspace, MCP brokerage, routines, memory/context, approvals/interruption, delegated workers, and observability/evals. Borrow patterns from Deep Agents (workpapers, todo planning, parallel workers, eval-driven improvement) but implement in the ThinkWork-owned library. Port a curated subset of the compound-engineering plugin's coding workflows as a **skills folder** loaded on demand by a delegated coding worker — not by installing the upstream plugin. v1 proves the architecture with one golden workflow on Eric's dev tenant: email-or-Linear arrival → plan → workspace notes → approval → external action → final thread update + audit.

```
+--- Connectors / scheduled triggers / mobile chat ---+
                            |
                            v
+--- ThinkWork Computer Strands agent (ECS+EFS, always-on per user) ---+
|  - Strands agent loop, Python container                                |
|  - Custom orchestrator system prompt; no CE plugin                     |
|  - Tools from packages/computer-stdlib (workspace, Google Workspace,  |
|    MCP, routines, memory, approvals, delegate, observability)          |
|  - Workpapers under /workspace/.thinkwork/workpapers/<task-id>/        |
|  - Owns goal loop, approval pause/resume, audit, budgets               |
+----------------------------|-------------------------------------------+
                             | delegate (Strands subagent / managed worker)
                             v
+--- Strands delegated worker (e.g., Coding Worker) -------------------+
|  - Strands agent, Python                                              |
|  - Tools from same stdlib + worker-specific tools                     |
|  - Coding worker only: skills folder + load_skill tool                |
|    (CE-derived workflows: lfg, plan, work, commit-push-pr, ...)       |
|  - Adapter shims translate Skill / AskUserQuestion / TaskCreate /     |
|    Agent calls in skill markdown to Strands equivalents               |
+----------------------------|-------------------------------------------+
                             | interrupt (approval / HITL)
                             v
   Computer surfaces to mobile (push + thread); resumes on user response
```

---

## Problem Frame

The 2026-05-06 ThinkWork Computer reframe makes the Computer the durable per-user product object: always-on, ECS+EFS, owns workspace + threads + tasks + events + approvals + delegation. Today, `packages/computer-runtime/` is a narrow TypeScript task-dispatcher (handles `noop`, `health_check`, `workspace_file_write`, `google_cli_smoke`, `google_workspace_auth_check`) — no model, no agent loop, no real tool surface. The Computer needs a real foundation.

Strands is already in production for ThinkWork's Managed Agents (`packages/agentcore-strands/`, Python). It is AWS-native and Bedrock-first, with first-class support for the agent loop, tool calling, streaming, interrupts, session management, MCP, and multi-agent patterns. Strands is the path of least resistance for the Computer.

Earlier brainstorms in this conversation explored a Flue+Pi+CE direction for the coding sub-task. That direction has been dropped: this brainstorm commits to Strands as the single foundation for the Computer and delegated workers, including the coding worker. Existing Marco / Flue infrastructure remains on a separate track and is not migrated by this work.

What's missing — and what this brainstorm defines — is the ThinkWork-owned **Computer Agent Standard Library** that gives every Strands-based Computer (and any delegated Strands worker) a coherent, governed tool surface. Stock Strands gives us the loop and primitives; the standard library gives the Computer real work to do across email, calendar, files, MCP, routines, memory, and delegation, with approvals and audit baked in.

---

## Actors

- A1. Computer owner: the human user (Eric in v1; future per-user Computer owners). Sees thread, artifacts, audit through admin and mobile; receives push for HITL; approves or denies external mutations.
- A2. Tenant admin/operator: governs budgets, tool permissions, audit retention, tenant-isolation boundaries. Updates Computer tool policy.
- A3. ThinkWork Computer Strands agent: long-lived ECS+EFS process per user; runs Strands; consumes the standard library; owns orchestration, goal loop, approval pause/resume, and audit emission.
- A4. Strands delegated worker: per-task Strands agent (e.g., coding worker, research worker); consumes the same standard library; receives bounded delegations from the Computer.
- A5. Computer Agent Standard Library: shared Python package consumed by both A3 and A4; owns tool definitions, control-loop primitives, and the HITL bridge.
- A6. Mobile client: surfaces HITL questions; user response feeds back as the answer payload.
- A7. External connectors: Linear, Gmail, Calendar, CRM, etc.; route work to the Computer per `2026-05-07-computer-first-connector-routing-requirements.md`.
- A8. Existing Marco / Flue runtime: referenced as out-of-scope context; not migrated by this work.

---

## Key Flows

- F1. Connector or scheduled trigger arrives at the Computer
  - **Trigger:** A connector (Linear, Gmail watch, scheduled job) creates a Computer task/event.
  - **Actors:** A1, A3, A7
  - **Steps:** Connector records execution → creates a Computer task/event → Computer's runtime reads the task → loads owner, tenant, template, runtime config, workspace paths, memory briefing → instantiates a Strands session → agent reads goal and decides: handle directly, delegate, or ask for HITL.
  - **Outcome:** Computer-owned thread is created; structured task record + initial events emitted; the Strands session is running.
  - **Covered by:** R1, R2, R9, R12

- F2. Goal-driven multi-step workflow with approvals
  - **Trigger:** User asks the Computer to do something with one or more external mutations (e.g., handle inbox, schedule meeting, draft and share doc).
  - **Actors:** A1, A3, A6
  - **Steps:** Strands session reads the goal → uses workspace + memory + Google Workspace + MCP tools to gather context and draft work → writes intermediate state to workpapers under `.thinkwork/workpapers/<task-id>/` → at the first sensitive action (email send, calendar mutate, doc share, external write), raises a Strands interrupt → standard library converts the interrupt into a `needs_approval` `computer_event` → Computer pauses → mobile surfaces the question → user approves/denies/edits → standard library resumes the same Strands session with the response payload → agent applies action and continues until `done`.
  - **Outcome:** External action(s) applied or rejected; thread updated with what was done and what is waiting; durable facts retained in memory.
  - **Covered by:** R10, R14, R15, R17, R23, R24

- F3. Parallel research with workpapers
  - **Trigger:** User asks for a multi-track research artifact (e.g., due diligence report).
  - **Actors:** A1, A3, A4
  - **Steps:** Computer creates a workpaper folder → builds a todo plan covering independent research tracks → delegates each track to a Strands subagent with bounded scope, output schema, and budget → subagents write cited notes back to workpapers → Computer cross-checks contradictions, fills gaps from email/calendar/doc context → produces a final brief (optionally as a Google Doc, requiring approval to share).
  - **Outcome:** Final report cites sources, distinguishes public research from private workspace/email context, preserves workpapers for audit, attributes which subagent produced what.
  - **Covered by:** R14, R15, R22, R28

- F4. Computer delegates a coding task to the Strands coding worker
  - **Trigger:** Computer's goal loop decides the work needs autonomous coding (e.g., from a Linear issue or user request).
  - **Actors:** A3, A4
  - **Steps:** Computer prepares a delegation payload (issue context, repo, branch, output schema, budget) → calls `delegate_worker(coding, payload)` → standard library spawns the coding worker (Strands subagent or external Strands managed agent — substrate choice deferred to planning) → coding worker uses `load_skill('lfg')` to pull in the autonomous coding workflow markdown → adapter shims translate `AskUserQuestion`/`TaskCreate`/`Skill`/`Agent` calls in the skill content to Strands equivalents → coding worker runs plan → work → test → commit → push → open draft PR → watch CI → fix-until-green, raising interrupts for any sensitive action → returns compact result + changed files + PR URL → Computer reviews and updates thread.
  - **Outcome:** Green draft PR opened with attribution to the delegated worker; Computer remains owner of the workflow and audit.
  - **Covered by:** R22, R25, R26, R27

- F5. Approval interrupt and resume (cross-cutting)
  - **Trigger:** Any agent (Computer or worker) needs human approval for a sensitive action.
  - **Actors:** A1, A3, A4, A6
  - **Steps:** Strands raises an interrupt with action summary, payload, risk, and suggested options → standard library creates a `needs_approval` `computer_event` and a ThinkWork approval record → Computer task enters `needs_approval` state → mobile surfaces a thread message + push notification with the question → user approves, denies, or edits in mobile/admin → response is recorded as the answer payload → standard library resumes the same Strands session with the response → agent continues from where it left off.
  - **Outcome:** Action is applied or rejected; resumed action has full audit context; approval survives runtime restart.
  - **Covered by:** R10, R23, R24

---

## Requirements

**Substrate and architecture**
- R1. Strands is the single foundation stack for the Computer agent and delegated workers in v1. No Flue / Pi / Hermes / Deep Agents as primary v1 foundation.
- R2. The Computer runs as a long-lived per-user process on ECS+EFS, with EFS mounted as `/workspace`. Workpapers live at `/workspace/.thinkwork/workpapers/<task-id>/`.
- R3. ThinkWork remains the source of truth for the product control plane: Computer identity, tenant auth, user OAuth, tasks, threads, events, approvals, budgets, memory policy, workspace ownership, audit, deployment.
- R4. Borrow Deep Agents patterns (workpapers, todo planning, context offloading, parallel workers, eval-driven improvement) into ThinkWork-owned implementations. Do not depend on Deep Agents itself as a runtime dependency.
- R5. Existing Marco / Flue runtime stays on a separate track. Migration of existing Flue work to Strands is out of scope here.

**Computer Agent Standard Library**
- R6. A new Python package `packages/computer-stdlib/` is introduced as a shared library consumed by both the Computer container and any delegated Strands worker container.
- R7. The standard library provides eleven modules: runtime/session, goal loop, planning/workpapers, workspace, Google Workspace, MCP broker, routines, memory/context, approvals/interruption, delegated workers, observability/evals.
- R8. The standard library reuses ThinkWork APIs for OAuth, tokens, approvals, events, and persistence. It does not duplicate auth or persistence layers.

**Goal loop and session**
- R9. On session start, the standard library loads Computer task, thread, owner, tenant, template, runtime config, workspace paths, available tools, approval policy, and a concise memory briefing.
- R10. Session state persists durably enough to resume after approval, retry, or runtime restart. A paused session reloads on the same Computer (or a successor process) without losing context.
- R11. The standard library streams model messages, tool calls, approvals, retries, failures, and progress events into `computer_events` for audit and observability.
- R12. The goal loop supports structured turn status `continue | done | needs_approval | blocked | failed` and enforces budget, time, tool-call, and retry limits.
- R13. Final outputs land as Computer-owned thread updates plus structured task records.

**Planning and workspace**
- R14. The standard library provides `write_todos`, `update_todos`, `complete_todo` tools and a workpaper convention under `/workspace/.thinkwork/workpapers/<task-id>/`. Large observations, research notes, draft emails, decision logs, and artifacts are saved to files instead of bloating model context; summaries are returned to thread and memory.
- R15. The standard library provides workspace read/write/search with safe path validation, shell/code execution where permitted, artifact creation/registration, and optional S3 snapshots for audit/durability.

**Tool surface**
- R16. Google Workspace: Gmail search/read/summarize/draft + send-with-approval; Calendar availability + event create/update/cancel-with-approval; Drive search/read; Docs create/update/comment where permitted; Sheets read/update where permitted.
- R17. Google tokens are resolved through ThinkWork user OAuth at tool-call time. Raw long-lived tokens never live in workpapers, prompts, or workspace files.
- R18. The MCP broker resolves tenant/user-approved MCP connections, exposes only policy-allowed tools per Computer/tool policy, isolates OAuth/tokens through ThinkWork service APIs, and records every MCP tool use in `computer_events`.
- R19. Routines: trigger approved routines, poll status, attach outputs to thread/workpapers, apply approval gates for destructive or externally visible routine actions.
- R20. Memory: Hindsight is the primary recall + retain backend. AgentCore Memory and Wiki are recall-only (admin-curated). A concise memory briefing is injected at run start. Durable facts/decisions/preferences/project state are retained after runs; transient noise and sensitive raw content are not.
- R21. The Hindsight async-wrapper pattern (`arecall`/`areflect`/fresh client/`aclose`/retry) used elsewhere in the project is preserved.

**Delegated workers**
- R22. The standard library provides bounded delegation to Strands subagents: explicit inputs, output schema, budget, workspace path, attribution. Workers return compact results, changed files, artifacts, and unresolved questions. Audit records which worker performed which work.

**Approvals and interruption**
- R23. Strands interrupts map to ThinkWork HITL approval records. The standard library creates a `needs_approval` `computer_event`, pauses the Computer task/thread, surfaces the question to mobile (thread message + push), and resumes the same Strands session with the user's response.
- R24. Approval is required by default for: email send, calendar mutation, file deletion, repo write, external API mutation, routine trigger, high-cost actions. The default approval set is policy-controlled by tenant admin (R29).

**CE skills port (coding worker only)**
- R25. The Strands coding worker ships with a skills folder at `packages/computer-stdlib/skills/coding/` containing curated CE-derived workflow skills (e.g., `lfg.md`, `plan.md`, `work.md`, `commit-push-pr.md`, `debug.md`, `resolve-pr-feedback.md`, plus 3-4 review-persona skills). Skills are vendored as a snapshot, not pulled live from the upstream EveryInc plugin.
- R26. The standard library provides a `load_skill(name)` Strands tool that reads a skill file and returns its content as a system-message-shaped string for the agent's next turn.
- R27. The standard library provides adapter shim tools that translate Claude Code-shaped tool references in skill markdown to Strands equivalents: `Skill` → `load_skill` (recursive), `AskUserQuestion` → Strands interrupt → ThinkWork approval/HITL → resume, `TaskCreate`/`TaskGet`/`TaskList` → Strands tools backed by ThinkWork's task system, `Agent` → Strands multi-agent delegation. Standard tools (`Bash`, `Read`, `Write`, `Edit`, `Grep`, `Glob`) map to Strands equivalents that already exist.

**Governance, isolation, budgets**
- R28. The Computer's ECS task IAM role is per-tenant. The Computer cannot read another tenant's repos, secrets, memories, or files. Delegated worker IAM roles are per-tenant equivalently.
- R29. Tenant admin can update Computer tool policy and budgets. Active tasks pick up policy changes on the next step. Attempts to use disabled tools produce explicit blocked events. Admin can inspect recent tool use and approvals.
- R30. Budgets are enforced by the goal loop: max delegations per task, max model spend per task, max wall-clock per task, max tool calls per task. Concrete defaults are TBD in planning.

**Observability and evals**
- R31. Structured events are emitted for model messages, tool calls, approvals, retries, failures, and completion. Schema is shared between Computer and delegated workers.
- R32. The standard library supports golden-workflow evals tracking goal success, tool correctness, approval quality, latency, cost, and failure modes.

**v1 acceptance**
- R33. v1 acceptance proves one golden workflow on Eric's dev tenant: email or Linear arrival → plan → workspace notes → approval → external action → final thread update + audit.
- R34. v1 priority sequence: (a) Strands Computer runtime skeleton on ECS+EFS; (b) `computer-stdlib` initialization + event streaming; (c) workspace tools + workpaper conventions; (d) memory recall briefing; (e) Gmail read/search + draft; (f) Calendar availability + event create-with-approval; (g) Strands interrupts mapped to ThinkWork approval/resume; (h) routine trigger + status; (i) basic delegated worker pattern; (j) one golden workflow.

---

## Acceptance Examples

- AE1. **Email Triage and Draft Reply (Use Case 1).** **Covers R10, R16, R17, R23, R24.** Given user asks "handle the important emails from this morning," when the Computer drafts replies, no email is sent without approval; the user can inspect, approve, reject, or edit each draft; all actions are recorded in `computer_events`.
- AE2. **Calendar Scheduling (Use Case 2).** **Covers R16, R23, R24.** Given user asks "find a time next week with Sarah and schedule the roadmap review," when the Computer drafts event details, calendar mutation requires approval; the created event includes useful context and is traceable back to the Computer task.
- AE3. **Linear Issue Intake to Work Plan (Use Case 3).** **Covers R1, R7, R22.** Given the Linear connector creates a Computer task for an issue with the configured label, when the Computer reads the issue and either creates a task plan or delegates coding work, the visible owner is the Computer (not a raw connector execution or direct agent), and any delegated work is attributed.
- AE4. **Routine Trigger From Natural Language (Use Case 4).** **Covers R19.** Given user asks "run the weekly customer intelligence routine for Acme and send me the summary," when the Computer resolves the routine, checks budget/policy, and triggers it, the routine execution is auditable, bounded, and visible from the Computer task.
- AE5. **Company Due Diligence Report (Use Case 5).** **Covers R14, R22, R32.** Given user asks "research Acme Corp before my meeting tomorrow," when the Computer launches parallel research subagents and writes cited notes into workpapers, the final report cites sources, distinguishes public research from private workspace/email context, preserves workpapers for audit, and attributes which subagent produced what.
- AE6. **Personal Daily Briefing (Use Case 6).** **Covers R20.** Given a scheduled morning job, when the Computer recalls active projects, checks calendar/email/pending approvals, and produces a briefing, the briefing is useful without being noisy and is grounded in real calendar/email/task state. The Computer does not mutate external systems unless explicitly approved.
- AE7. **Inbox-to-Task Conversion (Use Case 7).** **Covers R16, R18, R23.** Given user asks "turn action items from my inbox into tasks," when the Computer identifies action items and proposes tasks, external task creation requires approval; duplicates are detected where possible.
- AE8. **Workspace Coding Task (Use Case 8).** **Covers R22, R23, R25, R26, R27.** Given user asks "fix the failing import in the repo and open a PR," when the Computer delegates implementation to a Strands coding worker which runs the `lfg` skill, no unapproved push or PR happens; changed files and tests are recorded; the Computer remains the owner of the workflow.
- AE9. **Google Docs Drafting Workflow (Use Case 9).** **Covers R16, R23.** Given user asks "draft a project update doc from the last week of work," when the Computer drafts in workspace and refines into a Google Doc, the Computer distinguishes draft creation from external sharing; sharing or notifying anyone requires approval.
- AE10. **Approval Resume (Use Case 10).** **Covers R10, R23.** Given the Computer raises an interrupt for an external mutation, when the user approves, denies, or edits the proposed action, the runtime resumes the same Strands session with the user's response; approval survives runtime restart; the resumed action has full audit context.
- AE11. **Memory Conditioning (Use Case 11).** **Covers R20.** Given an idle or nightly scheduled job, when the Computer reflects on completed tasks, approvals, user edits, and important thread outcomes, future runs improve from past work without polluting memory; user corrections become stable guidance; secrets, transient chatter, and sensitive raw content are not retained.
- AE12. **MCP Tool Orchestration (Use Case 12).** **Covers R18, R23.** Given user asks "update the CRM based on this email thread," when the Computer prepares a CRM update payload through an MCP tool, MCP tokens stay isolated; tool permissions are enforced; external writes require approval.
- AE13. **Multi-Step Customer Follow-Up (Use Case 13).** **Covers R16, R23.** Given a CRM/Linear/email connector creates a follow-up task, when the Computer drafts an email and proposes a meeting slot, the Computer coordinates across systems while preserving human control; sends and event creations require approval.
- AE14. **Failed Task Recovery (Use Case 14).** **Covers R12, R29, R31.** Given a Computer task fails or a tool call errors, when the Computer diagnoses, retries are bounded by budget; if blocked, the Computer writes a clear blocked state with the next required human action; failures are visible, not silent; the Computer does not loop forever.
- AE15. **Enterprise Governance Workflow (Use Case 15).** **Covers R8, R18, R28, R29.** Given the tenant admin changes Computer tool policy or budget, when active tasks step, sensitive tools become unavailable or approval-gated; explicit blocked events are emitted on disabled tool use; admin can inspect recent tool use and approvals.

---

## Success Criteria

- A real Computer task on Eric's dev tenant proves the v1 golden workflow end-to-end: email or Linear arrival → plan → workspace notes → at least one approval round-trip through mobile → external action applied or rejected → final thread update with audit.
- The Computer demonstrably orchestrates and delegates without conflating ownership: the visible owner is always the Computer, not a connector execution or a raw delegated agent.
- The standard library is consumed by both the Computer container and at least one delegated Strands worker (the coding worker); no implementation of any stdlib tool is duplicated across consumers.
- The CE skills port spike (see Outstanding Questions) confirms that at least one curated skill (e.g., `lfg`) runs cleanly on Strands with the four adapter shims and minor textual adaptations — or names the gap if it doesn't.
- A pending HITL approval is observable in `computer_events`, surfaced on mobile within the Computer thread, and survives a runtime restart.
- Downstream `/ce-plan` has enough scope clarity to break this work into shippable units without inventing product behavior, harness semantics, or v1 acceptance criteria.

---

## Scope Boundaries

- Realtime voice / BidiAgent mode.
- Generic desktop replacement UI for the Computer.
- Arbitrary unapproved external mutations.
- Multiple Computers per user.
- Customer-uploaded arbitrary worker runtimes.
- Full self-modifying skill or code installation without approval.
- Replacing existing AgentCore Managed Agents (Marco, etc.) immediately.
- Migrating existing Flue work to Strands.
- The compound-engineering plugin installed wholesale on either the Computer or the coding worker (curated skill snapshot only).
- The `/lfg` slash-command UX (Strands users invoke by goal, not by `/foo`).
- Plugin auto-update / live-pull from the upstream EveryInc compound-engineering plugin (skills are vendored).
- Skills folder for the Computer agent (Computer is generalist without CE skills; selective skill add-back is a post-v1 deliberation).
- Browser / computer-use hooks.
- Generalist coding for the coding worker beyond bug-fix-style scope (refactor, feature implementation, code review). Wider coding scope is a deliberate post-v1 decision.
- PR-merge automation by the coding worker (v1 stops at green draft PR; merge stays human).
- Multi-delegation persistent workspace cache across coding-worker invocations.
- Marketing positioning of "ThinkWork has a coding agent" (separate doc if pursued).
- Adopting Deep Agents itself as a runtime dependency.
- Adopting Hermes or other generalist agent harnesses as a v1 foundation.
- Rewriting `packages/computer-runtime/` (TypeScript task-dispatcher) in place; it is retired or repurposed as a thin sidecar in v1.
- AgentCore Memory and Wiki as writable memory surfaces from either agent (recall-only).

---

## Key Decisions

- **Strands is the single foundation.** AWS-native, Bedrock-first, already in production for Marco, has interrupts/MCP/multi-agent built in. Picks the path with the least new substrate to learn and the most prior production experience.
- **Computer container is Python-primary.** Strands is Python-native; the existing TS `packages/computer-runtime/` is retired or repurposed as a thin sidecar. The new home is `packages/computer-strands/` (or an extension of `packages/agentcore-strands/`).
- **Borrow Deep Agents patterns; do not adopt Deep Agents.** ThinkWork owns the implementation so we can evolve it without depending on a third-party runtime.
- **Existing Marco / Flue stays separate.** Migration is real cost; this brainstorm doesn't pay it. Flue work continues for whatever Managed Agents stay on it.
- **`flue-stdlib` from the prior brainstorm is dropped; `computer-stdlib` is the v1 layer.** Same goal — shared standard library — different substrate.
- **Skills-folder pattern for CE-derived coding workflows.** Keeps the autonomous coding capability without depending on the Claude Code host. Adapter shims translate Claude Code-shaped tool references in skill markdown to Strands equivalents. Skills are vendored as a snapshot.
- **Skills folder ships only with the coding worker, not the Computer.** CE's gravity is hands-on coding; the Computer dispatches, it doesn't implement. Selective skill add-back for the Computer (e.g., `ce-brainstorm`, `ce-plan`) is a post-v1 deliberation, not a v1 commitment.
- **Hindsight is the primary memory backend.** AgentCore Memory and Wiki are recall-only (admin-curated). The existing async-wrapper pattern is preserved.
- **One golden workflow as v1 acceptance.** Prove the architecture before broadening; bug-fix-style coding only for the coding worker in v1.
- **Outer goal loop owned by the Computer; delegated workers are bounded.** Workers run a single delegation with explicit inputs, output schema, budget. Re-delegation across cycles, when needed, lives at the Computer's loop.
- **Approvals through Strands interrupts mapped to `computer_events`.** Same persistence layer as audit; no separate HITL store.

---

## Dependencies / Assumptions

- *[Verified by code read]* `packages/agentcore-strands/agent-container/server.py` is the existing Python Strands runtime; `packages/computer-runtime/` is the existing TS task-dispatcher.
- *[Verified by code read]* Aurora `computer_tasks` and `computer_events` tables exist (`packages/database-pg/src/schema/computers.ts`).
- *[Verified by docs]* Bedrock AgentCore Runtime supports synchronous invocations of up to ~8h; sufficient for long-running Computer tasks.
- *[Verified by docs]* The Hindsight async-wrapper pattern (`arecall`/`areflect`/fresh client/`aclose`/retry) is the established memory-tool shape across the project.
- *[Assumption, requires spike]* CE skill markdown ports to Strands with minor textual adaptations + four adapter shims (`Skill`, `AskUserQuestion`, `TaskCreate/Get/List`, `Agent`). Spike target: one curated skill (`lfg.md`) running end-to-end on a Strands worker.
- *[Assumption]* Strands' interrupt/resume mechanism survives ECS task restart given persisted session state in Aurora; verified at planning time.
- *[Assumption]* Per-user OAuth credentials for Google Workspace, MCP servers, and other connectors continue to flow through ThinkWork's existing OAuth service; no new credential pathways are introduced for v1.
- *[Assumption]* Tenant-level MCP connection policy is already (or trivially) representable in ThinkWork's policy layer; v1 does not require a new policy schema.
- *[Assumption]* The coding worker can run as a Strands subagent inside the Computer's process, OR as an external Strands managed agent invoked via existing AgentCore plumbing. Substrate choice is planning-time.
- *[Assumption]* `packages/computer-stdlib/` (Python) can coexist alongside the existing TS monorepo (pnpm workspaces); per the project's tooling rules, `uv` manages Python; the workspace root is already configured for Python sub-packages.

---

## Outstanding Questions

### Resolve Before Planning

(none — direction is locked)

### Deferred to Planning

- **[Affects R25, R26, R27][Needs research]** CE skill port spike: pick `lfg.md` (the highest-leverage skill), translate Claude Code tool references through the four adapter shims, run it on a Strands worker against a real coding task, capture the verdict.
- **[Affects R6][Technical]** Concrete Python package layout for `computer-stdlib`: one package or a small set of focused sub-packages? Test layout? `uv` workspace integration?
- **[Affects R10, R23][Technical]** Concrete persistence + IPC mechanism for Strands session pause/resume: where does paused session state live (Aurora? S3?), and how is it loaded by a successor process if the original ECS task restarts?
- **[Affects R22][Technical]** Coding worker substrate choice: in-process Strands subagent vs. external Strands managed agent invoked via existing AgentCore plumbing. Affects budgets, scaling, isolation, and whether the coding worker shares EFS with the Computer.
- **[Affects R2][Technical]** EFS layout: per-user persistent root, scoping for sub-projects, how delegated worker workspace relates (if at all) to the Computer's EFS root.
- **[Affects R30][User decision]** Concrete default budgets: max delegations per task, max model spend, max wall-clock, max tool calls.
- **[Affects R24, R29][User decision]** Default approval set tuning: which actions require approval out of the box vs. which are tenant-policy opt-in. Starting point is the R24 list; refinements are tenant-policy decisions.
- **[Affects R20][Technical]** Memory retention shape: how does the Computer distinguish durable facts from transient noise? Hindsight reflection layer already does some of this; what additional discipline is needed?
- **[Affects R31][Technical]** Event schema for streaming model/tool/progress events into `computer_events`: shared with delegated workers; needs a stable contract.
- **[Affects R33, R34][User decision]** When v1 ships and exits acceptance, what's the next golden workflow to add to evals? (Ordering of use cases beyond v1 acceptance.)
- **[Affects R34i][Technical]** Subagent / delegated worker pattern: do we use Strands' native `Agent` tool, a thin custom subagent abstraction, or both?
- **[Affects R5][User decision]** When (if ever) does Marco migrate from Flue to Strands? Separate decision; not a v1 blocker.

---

## Next Steps

1. **CE skill port spike.** Pick `lfg.md` from the upstream EveryInc compound-engineering plugin, translate Claude Code tool references through the four adapter shims, run it on a Strands worker against a real coding task on Eric's dev tenant. Capture verdict to `docs/solutions/architecture-patterns/`.
2. **`/ce-doc-review`** this brainstorm to surface persona-shaped gaps (security, architecture, scope, design lens, feasibility) before planning.
3. **`/ce-plan`** for structured implementation planning. The plan should sequence: (a) `computer-stdlib` package skeleton + event streaming; (b) Strands Computer runtime skeleton on ECS+EFS; (c) workspace + workpapers; (d) memory recall briefing; (e) Gmail read/search + draft; (f) Calendar availability + create-with-approval; (g) Strands interrupts → ThinkWork approval/resume; (h) routine trigger/status; (i) basic delegated worker pattern; (j) coding worker with skills folder + load_skill tool + four adapter shims; (k) one golden workflow.
