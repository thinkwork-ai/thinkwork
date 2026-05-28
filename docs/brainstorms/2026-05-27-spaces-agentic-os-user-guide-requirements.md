---
date: 2026-05-27
topic: spaces-agentic-os-user-guide
---

# Spaces Agentic OS User Guide

## Problem Frame

ThinkWork's Spaces documentation has the right foundation, but it no longer
matches what the product became after the Agentic OS refinement work. The
existing docs explain Spaces as contextual workrooms, but users now need a more
complete and humane guide to how Spaces actually help teams run work:

```text
Agent acts in a Space on behalf of a User toward a Goal.
```

That model is powerful, but it is also easy to misunderstand. Operators need to
know how to design useful Spaces. End users need to know how to start work,
collaborate with the agent, inspect progress, ask for changes, and get better
results. Everyone needs a clear explanation of what belongs in Space context,
what belongs in Thread conversation, what a Goal is, why files matter, and how
folder-native workflow state helps ThinkWork stay portable.

This documentation pass should create a full user guide for Spaces. It should
be practical first: how to build a Space, how to work in it, and how to get the
best results. It should document current behavior accurately while using
clearly labeled North Star callouts for partially implemented or emerging
concepts such as folder-native Goals, export-readiness, and maturity levels.

---

## Actors

- A1. Tenant operator: creates and maintains Spaces, workspace files, triggers,
  access, Goal templates, and operating guidance for teams.
- A2. Space author: writes the local context, instructions, examples, and
  workflow files that make a Space effective.
- A3. End user: starts Threads, collaborates with the agent, supplies missing
  information, reviews progress, and confirms or requests changes.
- A4. Goal owner or reviewer: is accountable for completion readiness and final
  review in structured workflows.
- A5. Coordinator agent: uses Space context, Thread history, User context, and
  Goal folders to drive workflow progress.
- A6. Support/operator teammate: explains why a Space or Thread behaved a
  certain way and uses the docs to troubleshoot user confusion.
- A7. Product/engineering planner: uses the documentation requirements to plan
  the docs implementation without re-deciding the product narrative.

---

## Key Flows

- F1. Operator learns the model and builds a useful Space
  - **Trigger:** A tenant operator wants to create or improve a Space such as
    Customer Onboarding, Finance, or an internal support room.
  - **Actors:** A1, A2, A6
  - **Steps:** The guide introduces the core model, explains when to create a
    Space, walks through workspace context, access, triggers, tools, knowledge,
    and files, then gives concrete patterns for writing effective Space
    instructions.
  - **Outcome:** The operator can create a Space that gives the agent enough
    local context to behave consistently without turning every workflow into a
    one-off prompt.
  - **Covered by:** R1, R2, R3, R4, R5, R8, R9, R10

- F2. Operator turns repeated work into a Goal-oriented workflow
  - **Trigger:** A repeated process, such as customer onboarding, needs more
    structure than ordinary chat.
  - **Actors:** A1, A2, A4, A5
  - **Steps:** The guide explains the difference between Thread intent and a
    promoted Goal, introduces the minimum Goal contract, describes progress,
    review, decisions, handoffs, and artifacts, and shows how Customer
    Onboarding acts as the reference pattern.
  - **Outcome:** The operator understands that a checklist is only one progress
    model inside a broader Goal contract, not the whole meaning of the
    workflow.
  - **Covered by:** R6, R7, R11, R12, R13, R14, R15

- F3. End user works inside a Space
  - **Trigger:** An end user opens Spaces on web or desktop, chooses a Space,
    starts a Thread, or joins an existing workflow.
  - **Actors:** A3, A4, A5
  - **Steps:** The guide shows how to choose the right Space, start the right
    kind of Thread, provide useful source information, use the composer, read
    progress, inspect files, request changes, and confirm completion when
    appropriate.
  - **Outcome:** The user understands what ThinkWork is doing, what the agent
    still needs, and how to collaborate without fighting the workflow model.
  - **Covered by:** R16, R17, R18, R19, R20, R21

- F4. Reader improves results through practical prompting and workflow habits
  - **Trigger:** A user or operator is getting vague, inconsistent, or
    incomplete results from a Space.
  - **Actors:** A1, A2, A3, A6
  - **Steps:** The guide provides best practices, anti-patterns, examples, and
    troubleshooting: use the right Space, give source facts, name the outcome,
    clarify Delegate vs Collaborate expectations, answer missing-information
    questions, keep durable decisions in files, and avoid treating the agent as
    a generic chatbot when the work should be a workflow.
  - **Outcome:** Readers have concrete habits for getting better output from
    ThinkWork, not only conceptual understanding.
  - **Covered by:** R22, R23, R24, R25, R26

---

## Requirements

**Information architecture**

- R1. The documentation must become a full Spaces user guide, not only a
  concept reference. It should remain connected to the existing Spaces concept
  and Admin Spaces pages while adding a practical operator-to-user journey.
- R2. The guide must optimize around this journey: operator builds or improves
  a Space first, then end users work inside that Space.
- R3. The guide must document current shipped behavior as the main path and
  clearly label North Star or emerging behavior where the product model is ahead
  of the current UI.
- R4. The guide must avoid splitting readers between contradictory explanations
  of Spaces. Existing pages should either be expanded, cross-linked, or
  repositioned so the canonical story is easy to find.
- R5. The guide should use plain, human-readable sections with examples,
  checklists, and "when to use this" guidance rather than architecture-only
  prose.

**Core model**

- R6. The guide must teach the canonical model: Agent acts in a Space on behalf
  of a User toward a Goal.
- R7. The guide must explain the difference between Agents, Spaces, Users,
  Threads, Goals, workspace files, and Company Brain in everyday language.
- R8. The guide must preserve the existing distinction between Spaces and
  folder specialists: Spaces are workrooms and policy/context boundaries;
  folder specialists are reusable delegated capabilities.
- R9. The guide must teach the maturity ladder from simple chat to agentic
  workflow: ask in a Space, use context/tools, promote repeated work into
  Goals, template the workflow, then compound completed work into Company
  Brain.
- R10. The guide must explain Delegate vs Collaborate as a top-level mental
  model for how users and agents share responsibility.

**Operator guidance**

- R11. The guide must show operators how to decide when a Space is warranted:
  team, customer, project, workflow, inbox, channel, or context boundary.
- R12. The guide must show what belongs in Space workspace files: operating
  context, procedures, examples, guardrails, intake expectations, source links,
  and workflow-specific instructions.
- R13. The guide must explain Goal-oriented workflows with Customer Onboarding
  as the reference example, including outcome, owner, mode, progress model,
  completion rule, and review policy.
- R14. The guide must explain that S3-backed markdown files are part of the
  operating substrate, not decorative exports. Use "folder-native" and
  "portable" language carefully: visible as doctrine, without promising export
  UI in v1.
- R15. The guide must document what stays structured versus narrative: Aurora
  owns indexed workflow state such as task status and review; markdown files
  carry Goal contracts, progress briefings, decisions, handoffs, artifacts, and
  agent-readable context.

**End-user guidance**

- R16. The guide must show end users how to pick the right Space before
  starting work, especially when different Spaces have different context,
  tools, triggers, or composers.
- R17. The guide must explain how Threads relate to Spaces and Goals: a Thread
  is the collaboration record, while a Goal is the structured outcome contract
  when the work needs one.
- R18. The guide must explain the right-side info panel in human terms:
  progress, review state, required completion, task status, attachments, and
  thread metadata.
- R19. The guide must explain the Files / workspace editor experience: Goal
  Folder for thread-local workflow state, Space Workspace for the parent
  operating context.
- R20. The guide must explain review actions such as confirming completion and
  requesting changes, including why human review exists in team workflows.
- R21. The guide must include web and desktop expectations where relevant,
  especially that Desktop packages the shared Spaces app and receives updates
  through desktop releases.

**Best-practice guidance**

- R22. The guide must include concrete "getting best results" advice for users:
  state the outcome, provide source facts, answer missing-information prompts,
  use the right Space, and tell the agent whether to delegate or collaborate.
- R23. The guide must include concrete "getting best results" advice for
  operators: keep Space files short and specific, document intake requirements,
  write examples, encode repeated work as Goals, and keep review policy clear.
- R24. The guide must include common failure modes and fixes: wrong Space,
  missing source data, ambiguous owner, unclear completion criteria, stale
  workspace context, and expecting a workflow Space to behave like generic chat.
- R25. The guide must include language for ad hoc tasks: users can create or
  mention tasks in the Thread, but structured workflow progress should remain
  tied back to the Goal or Thread state when possible.
- R26. The guide must include examples of good and bad prompts/messages in
  Spaces, written for non-technical users.

**Editorial quality**

- R27. The guide must be detailed and human-readable. It should favor short
  explanations, examples, and practical framing over jargon.
- R28. The guide must make complexity feel manageable: every conceptual section
  should answer "why this exists" and "what should I do with it?"
- R29. The guide must distinguish "current behavior" from "North Star" callouts
  in a consistent visual or editorial pattern.
- R30. The guide must cross-link to existing concept and application docs:
  Spaces, Threads, Folder Is the Agent, Desktop, Mobile Threads, Admin Spaces,
  Knowledge/Memory, Automations, and Customer Onboarding runbook where useful.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R11, R12.** Given a tenant operator wants to create a
  Customer Onboarding Space, when they read the guide, then they understand
  what context to put in the Space, what to leave out, and how end users will
  experience the resulting workflow.
- AE2. **Covers R6, R7, R9, R10.** Given a new reader asks "what is ThinkWork
  doing here?", when they read the model section, then they can explain:
  "An agent acts in a Space on behalf of a User toward a Goal," and can
  distinguish chat, collaboration, delegated workflow, and completed learning.
- AE3. **Covers R13, R15, R18, R20.** Given a Customer Onboarding Thread is
  ready for review, when a user reads the guide, then they understand why the
  info panel shows progress and review, why confirmation is required, and why
  the agent should not silently close the Goal.
- AE4. **Covers R14, R19.** Given a user opens Files mode in a Thread, when
  they read the guide, then they understand that Goal Folder files are
  thread-local workflow state and Space Workspace files are parent context.
- AE5. **Covers R22, R24, R26.** Given a user gets a poor result from a Space,
  when they read the best-practices section, then they can identify whether the
  problem was wrong Space, missing source data, vague outcome, unclear owner, or
  treating a workflow as generic chat.

---

## Success Criteria

- A new operator can read the guide and confidently build or improve a Space
  without needing an engineer to explain the Agentic OS model.
- A new end user can read the guide and understand how to start work, follow
  progress, inspect files, request changes, and confirm completion.
- A support teammate can point confused users to a specific section for common
  questions such as "what is a Space?", "what is a Goal?", "why is review
  required?", or "why did the agent ask for missing information?"
- A downstream planner can implement the docs pass without inventing the
  information architecture, audience priority, current-vs-North-Star stance, or
  required best-practice topics.
- The resulting docs build succeeds and does not leave duplicate or
  contradictory Spaces explanations.

---

## Scope Boundaries

- Do not change product behavior as part of this documentation pass.
- Do not promise export UI, local runner support, automatic template
  improvement, or full project-management features as shipped behavior.
- Do not document database schema, resolver internals, or S3 key conventions in
  the user guide except at a high level needed to explain portability and source
  of truth.
- Do not make the guide an API reference. Link to API docs only when readers
  need a technical pointer.
- Do not treat Customer Onboarding as the only possible Space pattern. It is
  the reference example, not the entire product.
- Do not hide current limitations. If a behavior is aspirational or emerging,
  label it clearly.

---

## Key Decisions

- Full user guide: The pass should go beyond concept docs and become a practical
  guide for operators and end users.
- Operator-first journey: Teach how to build a Space before teaching how users
  work inside it.
- Current plus North Star: Document shipped behavior first, with clearly
  labeled callouts for Agentic OS direction.
- Goal model is central: The docs should teach Goals as the missing structure
  that makes Spaces more than contextual chat.
- Folder-native doctrine matters: Files and folders are part of the agent
  architecture and portability story, not merely debug output.
- Best practices are required: The guide must actively teach users how to get
  better results from Spaces.

---

## Dependencies / Assumptions

- Existing Spaces concept docs live under `docs/src/content/docs/concepts/`.
- Existing Admin Spaces docs live under `docs/src/content/docs/applications/admin/spaces`.
- Existing Desktop docs live at `docs/src/content/docs/applications/desktop/index.mdx`.
- Prior Spaces docs expansion requirements live at
  `docs/brainstorms/2026-05-26-spaces-docs-expansion-requirements.md`.
- Agentic OS / folder-native Goals requirements live at
  `docs/brainstorms/2026-05-27-agentic-os-folder-native-goals-requirements.md`.
- Thread Goal folder editor requirements live at
  `docs/brainstorms/2026-05-27-thread-goal-folder-file-editor-requirements.md`.
- Customer Onboarding runbook lives at `docs/runbooks/customer-onboarding-space-runbook.md`.
- The implementation planner should verify current UI labels and routes before
  writing final user-facing text, because Spaces changed quickly today.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R1-R5][Editorial] Decide whether the guide should be one long page,
  a new guide section, or a curated path through existing concept/application
  pages with new best-practice pages.
- [Affects R29][Editorial] Choose the exact visual treatment for "Current
  behavior" vs "North Star" callouts using existing Starlight components.
- [Affects R18-R21][Needs verification] Verify the final shipped Spaces UI
  labels for the info panel, Files mode, Space detail navigation, and Desktop
  header before publishing screenshots or exact instructions.
- [Affects R26][Editorial] Decide how many concrete prompt/message examples to
  include in v1 without making the docs feel like a prompt cookbook.

---

## Next Steps

-> /ce-plan for structured implementation planning.
