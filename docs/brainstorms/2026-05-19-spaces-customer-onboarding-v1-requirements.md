---
date: 2026-05-19
topic: spaces-customer-onboarding-v1
---

# Spaces Customer Onboarding V1

## Problem Frame

ThinkWork is moving the end-user app at `app.thinkwork.ai` away from the "Computer" metaphor and toward a collaborative workspace where people and role-based agents work together in Spaces. The first proof should not be a generic Slack clone. It should prove a real customer workflow: customer onboarding after an opportunity is marked closed-won.

In this workflow, a Customer Onboarding Space acts like a project/channel room. A closed-won opportunity or manual start creates one onboarding Thread. That Thread becomes the case file: it is seeded with customer and opportunity context, shows linked LastMile checklist tasks, hosts human discussion, lets role-based agents help, and closes only after the required work is complete and a human confirms archival.

---

## Actors

- A1. End user: participates in onboarding threads, discusses blockers, uploads or references documents, and completes assigned work.
- A2. Sales rep: initiates or is attached to the onboarding case when an opportunity is won.
- A3. Accounting/finance team member: completes back-office onboarding work such as tax exemption, ERP entry, and credit checks.
- A4. Space owner: owns the Customer Onboarding Space configuration, including available agents, checklist template, role mappings, and LastMile task integration settings.
- A5. Tenant admin: creates global role-based agents, approves capabilities/tools/MCP access, and manages high-level governance in the admin app.
- A6. Coordinator agent: a global role-based agent assigned to the Customer Onboarding Space, auto-subscribed to onboarding threads, and responsible for process-management assistance.
- A7. LastMile CRM: source event system that can fire a closed-won webhook/action.
- A8. LastMile Tasks: external task system of record for onboarding checklist tasks.

---

## Key Flows

- F1. Closed-won opportunity starts onboarding

  - **Trigger:** A LastMile CRM action fires when an opportunity is marked won.
  - **Actors:** A2, A6, A7, A8
  - **Steps:** ThinkWork receives a rich CRM payload; creates a new Thread in the Customer Onboarding Space; posts a deterministic kickoff with customer/opportunity facts, documents, links, and missing fields; creates or links LastMile Tasks from the Space checklist template; subscribes the coordinator agent; the coordinator posts triage guidance.
  - **Outcome:** The onboarding case is ready for humans to work from one Thread, with linked external tasks and a coordinator agent following along.
  - **Covered by:** R1, R7, R8, R9, R10, R11, R12, R14

- F2. Manual onboarding start uses the same workflow

  - **Trigger:** A user manually starts an onboarding thread from the Customer Onboarding Space.
  - **Actors:** A1, A2, A6, A8
  - **Steps:** The user provides or selects opportunity/customer context; ThinkWork runs the same thread creation, kickoff, LastMile task creation/linking, and coordinator subscription workflow as the webhook path.
  - **Outcome:** Manual and automated starts produce the same user-visible case-file shape.
  - **Covered by:** R2, R7, R8, R9, R10, R11

- F3. Team works the onboarding case

  - **Trigger:** The onboarding Thread exists with linked LastMile checklist tasks.
  - **Actors:** A1, A2, A3, A6, A8
  - **Steps:** Humans discuss questions in the Thread; task owners complete work in LastMile Tasks; ThinkWork mirrors important task milestones into the Thread; the coordinator summarizes progress, flags blockers, identifies unassigned tasks, and suggests next actions; humans may mention agents for specific work.
  - **Outcome:** The Thread remains the primary collaboration record while LastMile Tasks remains the task system of record.
  - **Covered by:** R13, R15, R16, R17, R18, R19, R20

- F4. Completion and archive
  - **Trigger:** All required linked LastMile tasks are complete.
  - **Actors:** A1, A6, A8
  - **Steps:** ThinkWork detects completion through webhook sync or refresh; the coordinator posts a final summary and recommends archive; a human confirms; the Thread is archived.
  - **Outcome:** Completed onboarding work leaves behind a clear case-file record without agents silently closing customer work.
  - **Covered by:** R21, R22

---

## Requirements

**Spaces and agents**

- R1. `app.thinkwork.ai` centers the end-user experience on Spaces as channel/project rooms, not Computers.
- R2. The first v1 proof Space is Customer Onboarding, configured by seed/admin configuration rather than a general-purpose Space setup UI.
- R3. Agents are global role-based collaborators created and governed by tenant admins, such as `@coordinator`, `@analyst`, `@sales`, and `@search`.
- R4. Space owners can assign approved global agents into a Space.
- R5. Agent behavior in a Space is defined at the Space-agent assignment intersection: the global agent provides durable role/capabilities, while the Space assignment provides local role, subscription defaults, and local behavior constraints.
- R6. The Customer Onboarding Space auto-subscribes its assigned coordinator agent to every onboarding Thread created from the Space workflow.

**Onboarding thread creation**

- R7. A LastMile CRM closed-won action can start a new Customer Onboarding Thread through a webhook connector in v1.
- R8. A manual start path can create the same kind of Customer Onboarding Thread without requiring the CRM webhook.
- R9. Both manual and webhook starts use the same Space workflow: rich seed context, deterministic kickoff, LastMile task creation/linking, coordinator subscription, and task checklist display.
- R10. The Thread seed context includes enough customer/opportunity information for humans to begin work without hunting for context: customer/company, opportunity id/link, owner/sales rep, contacts, deal details, close date, onboarding notes, relevant documents/links, and special requirements when available.
- R11. The deterministic workflow posts the factual kickoff content and preserves source metadata/audit separate from model interpretation.
- R12. The coordinator agent follows the deterministic kickoff with triage notes, missing information, likely blockers, and next-step guidance.

**Tasks and LastMile**

- R13. ThinkWork Spaces own the onboarding checklist template, but LastMile Tasks owns the actual task records in v1.
- R14. New onboarding Threads create/link LastMile Tasks deterministically from the Space checklist template rather than relying on the coordinator agent to decide the required initial checklist.
- R15. Checklist tasks use role-based assignment with triage fallback: known roles resolve to owners where possible; ambiguous tasks are unassigned or assigned to a coordinator/triage owner and flagged by the coordinator agent.
- R16. ThinkWork stores enough mirrored task state to render a useful checklist: external task identity/link, current status, current assignee when readable, last synced time, and sync health.
- R17. LastMile task status flows back through webhook sync, with refresh fallback for missed, delayed, or suspect events.
- R18. ThinkWork mirrors important LastMile task milestones into the Thread, such as completion, blocked state, reassignment, due-date changes, and sync failures; it does not mirror full task chatter/activity in v1.
- R19. The Thread is the preferred communication layer for onboarding questions and coordination. LastMile task comments remain available, but ThinkWork does not duplicate every comment into the Thread.
- R20. External task writeback is configurable at the Space/integration level. V1 may write status updates, completion notes, or summary comments to LastMile when configured, but routine agent-written external comments require confirmation unless explicitly trusted.

**Completion**

- R21. When all required linked LastMile tasks are complete, the coordinator agent recommends archive and posts a final summary.
- R22. A human must confirm archive; v1 does not auto-archive onboarding Threads immediately on checklist completion.

---

## Acceptance Examples

- AE1. **Covers R7, R9, R10, R11, R14.** Given LastMile CRM sends a closed-won event with rich customer context, when ThinkWork receives it, then a Customer Onboarding Thread is created with a factual kickoff and linked LastMile checklist tasks.
- AE2. **Covers R8, R9.** Given a sales rep manually starts onboarding from the Customer Onboarding Space, when they provide the required customer/opportunity context, then the resulting Thread has the same shape as a webhook-created Thread.
- AE3. **Covers R3, R4, R5, R6, R12.** Given the global `@coordinator` agent is assigned to Customer Onboarding with local onboarding behavior, when a new onboarding Thread is created, then `@coordinator` is subscribed and posts triage guidance based on that Space assignment.
- AE4. **Covers R13, R15, R16, R17, R18.** Given the checklist includes DocuSign, tax exemption, ERP entry, and credit report tasks, when the workflow runs, then LastMile Tasks are created or linked, known role owners are assigned, ambiguous owners are flagged, and important task updates appear in the ThinkWork Thread.
- AE5. **Covers R19, R20.** Given a team discusses a blocked tax exemption task in the Thread, when external writeback is enabled, then ThinkWork may post a concise status/comment update to LastMile without mirroring the whole Thread.
- AE6. **Covers R21, R22.** Given every required linked LastMile task is complete, when the coordinator detects completion, then it posts a final summary and asks a human to confirm archive rather than archiving automatically.

---

## Success Criteria

- The customer can use one Customer Onboarding Space to coordinate closed-won onboarding cases across sales, accounting, and finance without relying on scattered Slack messages or manual task recreation.
- Each onboarding Thread reads like a complete case file: source context, linked task progress, human discussion, coordinator summaries, relevant docs/links, and final completion summary.
- LastMile Tasks remains the task system of record while ThinkWork becomes the collaboration and agent-assistance layer.
- The v1 slice proves Spaces, role-based agents, Thread-centered collaboration, and linked external tasks without requiring full Space management UI, task boards, or generalized connector infrastructure.
- A downstream planner can implement the first slice without inventing product behavior around Space orientation, agent assignment, task ownership, webhook/manual parity, or archive semantics.

---

## Scope Boundaries

### Deferred for later

- General-purpose Space creation and configuration UI for end users.
- General role-agent catalog/marketplace UX beyond admin-created global agents.
- Multi-provider task integration beyond LastMile Tasks.
- Full external task comment/activity mirroring.
- Native task boards, subtasks, estimates, dependencies, bulk planning, and custom workflows.
- Ambient Space-wide agent autonomy where agents jump into any conversation without mention, subscription, trigger, or schedule.
- Automatic archive without human confirmation.
- Deep Space-level document library and knowledge management UI.
- Generic CRM connector framework beyond the LastMile CRM closed-won trigger needed for v1.
- Fully automated onboarding task completion by agents; v1 starts with coordination and selective mentioned-agent help.

### Outside this product's identity

- ThinkWork is not replacing LastMile Tasks, Jira, Linear, or other task systems of record.
- ThinkWork is not a fleet of personal Computers or personal assistants.
- ThinkWork is not a Slack message mirror; the Thread is the durable case-file collaboration record.
- ThinkWork is not a free-running autonomous process monitor in v1; agent participation is controlled through mention, assignment, subscription, trigger, or schedule.

---

## Key Decisions

- **Spaces are the app center:** `app.thinkwork.ai` should orient around Spaces as channel/project rooms.
- **Agents are global role collaborators:** Admins create governed global agents; Space owners assign approved agents into Spaces.
- **Space-agent assignment carries local behavior:** This avoids forking global agents per Space while still letting `@coordinator` behave specifically in Customer Onboarding.
- **Customer Onboarding is the first proof:** It exercises Spaces, Threads, members, agents, task links, files/context, webhook/manual starts, and completion flow in one concrete customer workflow.
- **ThinkWork owns process template, LastMile owns tasks:** Space configuration defines the checklist; LastMile Tasks stores the actual task records.
- **Initial checklist creation is deterministic:** Required onboarding tasks should be reliably created from the Space workflow; the coordinator agent assists rather than inventing the required checklist.
- **Thread is the case file:** It is the main place for communication, status, documents/links, agent summaries, and final audit-friendly context.
- **Human-confirmed archive:** Completion can be detected, but closing customer onboarding remains a human confirmation in v1.

---

## Dependencies / Assumptions

- LastMile CRM can fire an action/webhook when an opportunity is marked won and can include rich customer/opportunity context.
- LastMile Tasks exposes MCP tools or equivalent API capability for creating, linking, reading, and updating task status.
- ThinkWork can receive LastMile task update webhooks or otherwise refresh task state from LastMile.
- Space/checklist configuration can initially be seed/admin configured rather than fully user-configurable.
- Global role-based agents and Space-agent assignment can be represented in product and data model without preserving the Computer ontology as a user-facing concept.
- The current `apps/computer` package and internal `Computer` terminology may remain as compatibility scaffolding while the user-facing product moves to `app.thinkwork.ai` and Spaces.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R2, R13, R14][Technical] Decide where seed/admin Customer Onboarding Space configuration lives for v1 and how it is safely edited or deployed.
- [Affects R5, R6][Technical] Define the minimal data model and runtime contract for Space-agent assignment, local prompt/behavior, and auto-subscription defaults.
- [Affects R7, R9, R10][Technical] Define the LastMile CRM webhook payload contract and idempotency behavior for duplicate closed-won events.
- [Affects R13-R18][Technical] Define the LastMile Tasks MCP/API tool contract for create/link/status/read/update and the mirrored task-state model in ThinkWork.
- [Affects R17, R18][Technical] Decide which LastMile task events are important enough to mirror into Thread activity and how refresh fallback detects drift.
- [Affects R20][Product/technical] Decide the exact v1 writeback settings and defaults for status updates, summary comments, and agent-generated comments.
- [Affects R21, R22][Technical] Define the completion detector for "all required linked tasks complete" and the human archive confirmation UX.

---

## Next Steps

-> /ce-plan for structured implementation planning.
