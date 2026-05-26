---
date: 2026-05-19
topic: spaces-customer-onboarding-v1
---

# Spaces Customer Onboarding V1

## Problem Frame

ThinkWork is moving the end-user app at `app.thinkwork.ai` away from the "Computer" metaphor and toward a collaborative workspace where people and role-based agents work together in Spaces. The first proof should not be a generic Slack clone. It should prove a real customer workflow: customer onboarding after a customer is ready to enter implementation.

In this workflow, a Customer Onboarding Space acts like a project/channel room. A manual start creates one onboarding Thread from a ThinkWork-native checklist template. The Thread becomes the case file: it is seeded with customer and opportunity context, asks a short set of intake questions, derives the required onboarding checklist, hosts human discussion, lets role-based agents help, and can be marked completed only after the required work is complete.

May 25 refresh: the first demo version intentionally keeps all checklist/task state inside ThinkWork. LastMile CRM, LastMile Tasks, and other external systems are phase-two integrations, not initial requirements.

---

## Actors

- A1. End user: participates in onboarding threads, discusses blockers, uploads or references documents, and completes assigned work.
- A2. Sales rep: initiates or is attached to the onboarding case when an opportunity is won.
- A3. Accounting/finance team member: completes back-office onboarding work such as tax exemption, ERP entry, and credit checks.
- A4. Space owner: owns the Customer Onboarding Space configuration, including available agents, checklist template, role mappings, and Space documents.
- A5. Tenant admin: creates global role-based agents, approves capabilities/tools/MCP access, and manages high-level governance in the admin app.
- A6. Coordinator agent: a global role-based agent assigned to the Customer Onboarding Space, auto-subscribed to onboarding threads, and responsible for process-management assistance.
- A7. External systems: later-phase systems such as CRM, DocuSign, Dun & Bradstreet, P21, and external task systems. These are represented as manual checklist steps in the first demo.

---

## Key Flows

- F1. Manual onboarding start creates a template-driven case
  - **Trigger:** A user starts onboarding from the Customer Onboarding Space.
  - **Actors:** A1, A2, A6
  - **Steps:** ThinkWork creates a new Thread in the Customer Onboarding Space; prompts for the intake answers; derives the required checklist from the Space template; posts a deterministic kickoff with customer facts, selected answers, required tasks, and missing fields; subscribes the coordinator agent; the coordinator posts triage guidance.
  - **Outcome:** The onboarding case is ready for humans to work from one Thread, with a ThinkWork-native checklist and a coordinator agent following along.
  - **Covered by:** R1, R7, R8, R9, R10, R11, R12, R14

- F2. Intake answers determine required checklist items
  - **Trigger:** The starter answers the onboarding questions.
  - **Actors:** A1, A2, A3, A6
  - **Steps:** ThinkWork records answers such as agricultural/sales-tax exemption and credit terms; required tasks are enabled, skipped, or marked conditional based on those answers.
  - **Outcome:** The Thread checklist reflects the customer, rather than showing irrelevant work.
  - **Covered by:** R8, R9, R13, R14, R15

- F3. Team works the onboarding case
  - **Trigger:** The onboarding Thread exists with its ThinkWork-native checklist.
  - **Actors:** A1, A2, A3, A6
  - **Steps:** Humans discuss questions in the Thread; task owners mark internal checklist items done; manual external work such as DocuSign, Dun & Bradstreet, credit review, tax exemption forms, and P21 entry is tracked as checklist progress; the coordinator summarizes progress, flags blockers, identifies missing information, and suggests next actions.
  - **Outcome:** The Thread remains the primary collaboration record and ThinkWork is the system of record for demo checklist state.
  - **Covered by:** R13, R15, R16, R17, R18, R19, R20

- F4. Completion
  - **Trigger:** All required ThinkWork checklist items are complete.
  - **Actors:** A1, A6
  - **Steps:** ThinkWork detects required checklist completion; the coordinator posts a final summary; a human confirms; the Thread status is marked completed.
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

- R7. A manual start path can create a Customer Onboarding Thread from the Space template without requiring any external connector.
- R8. The start flow captures intake answers that drive checklist applicability, including at minimum agricultural/sales-tax exemption and credit terms.
- R9. Every start uses the same Space workflow: seed context, intake answers, deterministic kickoff, ThinkWork-native checklist creation, coordinator subscription, and checklist display.
- R10. The Thread seed context includes enough customer/opportunity information for humans to begin work without hunting for context: customer/company, opportunity id/link, owner/sales rep, contacts, deal details, close date, onboarding notes, relevant documents/links, and special requirements when available.
- R11. The deterministic workflow posts the factual kickoff content and preserves source metadata/audit separate from model interpretation.
- R12. The coordinator agent follows the deterministic kickoff with triage notes, missing information, likely blockers, and next-step guidance.
- R12a. The first demo intake form includes a fuller realistic question set covering customer identity, contacts, billing/shipping, tax exemption, credit terms, DocuSign routing, Dun & Bradstreet/P21 identifiers when known, and special handling notes.

**Template, checklist, and ICM workspace files**

- R13. The Customer Onboarding Space owns the onboarding checklist template and the initial checklist items are ThinkWork-native.
- R14. New onboarding Threads create their checklist deterministically from the Space template rather than relying on the coordinator agent to decide the required work.
- R15. Checklist tasks support applicability rules: always required, required when an intake answer is true, skipped when not applicable, or manual override by a human.
- R16. The first template includes the demo checklist: DocuSign contract sent/signed, Dun & Bradstreet check, credit check when credit terms are requested, tax exemption forms when applicable, and customer information entered into P21.
- R17. ThinkWork stores enough native checklist state to render progress: title, status, applicability, required flag, owner/role when present, notes, and completion metadata.
- R18. Checklist progress appears in the Thread/case view; no external task sync is required for the first demo.
- R19. The Thread is the preferred communication layer for onboarding questions, blockers, documents, status notes, coordinator summaries, and final completion.
- R20. The Space workspace should use ICM-style files: `CONTEXT.md` explains the operating contract, while a separate `docs/` markdown file holds the editable intake questions and checklist template.

**Completion**

- R21. When all required ThinkWork checklist items are complete, the coordinator agent recommends completion and posts a final summary.
- R22. A human must confirm completion; v1 does not silently complete onboarding Threads immediately on checklist completion.

---

## Demo Intake Template

The first version should seed a fuller realistic intake template, not only the two gating questions. This template should live as editable workspace content, likely `docs/customer-onboarding-intake.md`, with `CONTEXT.md` pointing agents and humans to it.

### Customer and Opportunity

- Customer legal name
- Customer display/common name
- Opportunity or quote identifier
- Sales owner
- Primary contact name, email, and phone
- Accounts payable contact name and email
- Target onboarding/completion date
- Notes or special requirements

### Billing and Shipping

- Billing address
- Shipping address
- Are billing and shipping the same?
- Required purchase order number, if any
- Preferred invoice delivery method

### Tax

- Are they agricultural/sales-tax exempt?
- If yes, which exemption type or jurisdiction?
- Has the exemption form already been received?
- If received, where is the form located?

### Credit Terms

- Do they want credit terms?
- Requested terms, if known
- Estimated first order value or credit exposure
- Existing credit approval or prior relationship notes

### Contract and Compliance

- DocuSign recipient name and email
- Contract/order form link, if already prepared
- Dun & Bradstreet identifier, if known
- Any required compliance or vendor onboarding portals

### ERP / P21 Setup

- P21 customer ID, if this is an existing customer
- Tax code or customer class, if known
- Sales territory or branch
- Required shipping method or freight terms
- Any account setup blockers

### Applicability Rules

- Always required: send/get DocuSign package, check Dun & Bradstreet information, enter customer information into P21, final onboarding review.
- Required when `creditTermsRequested = true`: run credit check.
- Required when `taxExempt = true`: collect and validate tax exemption forms.
- Required when a required answer is missing: add a "Resolve missing onboarding information" task.
- Optional/manual override: any item can be marked not applicable by a human with a note.

---

## Acceptance Examples

- AE1. **Covers R7, R9, R10, R11, R14.** Given a user manually starts onboarding with customer context, when ThinkWork creates the Thread, then the Thread includes a factual kickoff and a ThinkWork-native checklist derived from the Space template.
- AE2. **Covers R8, R9, R15.** Given the intake answer says the customer wants credit terms, when the checklist is generated, then the credit check item is required; when the answer says they do not want terms, the item is skipped or marked not applicable.
- AE3. **Covers R3, R4, R5, R6, R12.** Given the global `@coordinator` agent is assigned to Customer Onboarding with local onboarding behavior, when a new onboarding Thread is created, then `@coordinator` is subscribed and posts triage guidance based on that Space assignment.
- AE4. **Covers R13, R16, R17, R18.** Given the checklist includes DocuSign, Dun & Bradstreet, tax exemption, credit check, and P21 entry tasks, when users complete tasks in ThinkWork, then checklist progress updates in the onboarding Thread/case view.
- AE5. **Covers R19, R20.** Given a team discusses a blocked tax exemption task in the Thread, when the coordinator summarizes progress, then it references the Space contract and checklist template without needing an external task system.
- AE6. **Covers R21, R22.** Given every required ThinkWork checklist item is complete, when the coordinator detects completion, then it posts a final summary and asks a human to confirm completion rather than completing automatically.

---

## Success Criteria

- The customer can use one Customer Onboarding Space to coordinate onboarding cases across sales, accounting, finance, and operations without relying on scattered Slack messages or manual checklist recreation.
- Each onboarding Thread reads like a complete case file: source context, intake answers, checklist progress, human discussion, coordinator summaries, relevant docs/links, and final completion summary.
- ThinkWork is the system of record for initial checklist state; external task and CRM systems are deferred.
- The v1 slice proves Spaces, role-based agents, Thread-centered collaboration, ICM-style workspace files, and template-driven checklists without requiring full Space management UI, native task boards, or generalized connector infrastructure.
- A downstream planner can implement the first slice without inventing product behavior around Space orientation, intake answers, task applicability, ICM file placement, or completion semantics.

---

## Scope Boundaries

### Deferred for later

- General-purpose Space creation and configuration UI for end users.
- General role-agent catalog/marketplace UX beyond admin-created global agents.
- LastMile CRM webhook start and LastMile Tasks integration.
- Multi-provider task integration.
- Full external task comment/activity mirroring.
- Native task boards, subtasks, estimates, dependencies, bulk planning, and custom workflows.
- Ambient Space-wide agent autonomy where agents jump into any conversation without mention, subscription, trigger, or schedule.
- Automatic archive without human confirmation.
- Deep Space-level document library and knowledge management UI.
- Generic CRM connector framework.
- Fully automated onboarding task completion by agents; v1 starts with coordination and selective mentioned-agent help.

### Outside this product's identity

- ThinkWork is not replacing dedicated task systems long term; the first demo uses a native checklist to prove the workflow before external integrations.
- ThinkWork is not a fleet of personal Computers or personal assistants.
- ThinkWork is not a Slack message mirror; the Thread is the durable case-file collaboration record.
- ThinkWork is not a free-running autonomous process monitor in v1; agent participation is controlled through mention, assignment, subscription, trigger, or schedule.

---

## Key Decisions

- **Spaces are the app center:** `app.thinkwork.ai` should orient around Spaces as channel/project rooms.
- **Agents are global role collaborators:** Admins create governed global agents; Space owners assign approved agents into Spaces.
- **Space-agent assignment carries local behavior:** This avoids forking global agents per Space while still letting `@coordinator` behave specifically in Customer Onboarding.
- **Customer Onboarding is the first proof:** It exercises Spaces, Threads, members, agents, ICM-style workspace files, template-driven checklists, and completion flow in one concrete customer workflow.
- **ThinkWork owns the initial process template and checklist state:** External task systems are deferred until the workflow is demonstrable inside ThinkWork.
- **Initial checklist creation is deterministic:** Required onboarding tasks should be reliably created from intake answers and the Space checklist template; the coordinator agent assists rather than inventing the required checklist.
- **Template content lives in workspace files:** `CONTEXT.md` should route and explain the Space operating contract; editable intake questions and checklist rules should live in a separate markdown file under `docs/`.
- **Thread is the case file:** It is the main place for communication, status, documents/links, agent summaries, and final audit-friendly context.
- **Human-confirmed completion:** Completion can be detected, but closing customer onboarding remains a human confirmation in v1.

---

## Dependencies / Assumptions

- Customer onboarding can be demonstrated with manual start and ThinkWork-native checklist state before external integrations are connected.
- Space/checklist configuration can initially be seed/admin configured rather than fully user-configurable.
- The fuller demo question set is acceptable even if some answers are optional or unknown; missing required answers should become visible checklist/context gaps, not blockers to creating the Thread.
- Global role-based agents and Space-agent assignment can be represented in product and data model without preserving the Computer ontology as a user-facing concept.
- The current `apps/computer` package and internal `Computer` terminology may remain as compatibility scaffolding while the user-facing product moves to `app.thinkwork.ai` and Spaces.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R2, R13, R14, R20][Technical] Decide the exact workspace file names for the Customer Onboarding Space contract and checklist template, likely `CONTEXT.md` plus `docs/customer-onboarding-intake.md`.
- [Affects R5, R6][Technical] Define the minimal data model and runtime contract for Space-agent assignment, local prompt/behavior, and auto-subscription defaults.
- [Affects R17, R21, R22][Technical] Define the native checklist state model and completion detector for "all required ThinkWork checklist items complete."
- [Affects R21, R22][Technical] Define whether the UI labels the terminal state "completed", "archived", or "completed and archived" for tomorrow's demo.

---

## Next Steps

-> /ce-plan for structured implementation planning.
