---
date: 2026-06-30
topic: think-111-devin-style-automation-builder
linear_issue: THINK-111
---

# THINK-111 Devin-Style Automation Builder

## Problem Frame

ThinkWork's Automation creation flow is too confusing for the people it should
serve. The current creation surface asks users to choose between creation modes
and exposes advanced runtime controls through a side panel, which makes the
product feel like configuration machinery before the user has clearly described
what should happen.

The desired direction is to closely follow Devin's Automation creation UI: a
single page where a user names the Automation, adds triggers, defines
instructions, selects MCPs or connectors, optionally opens Advanced as an
in-page accordion, and creates the Automation. The default page should serve
routine operators and power users equally: common fields stay obvious, connector
and MCP wiring stays visible, and advanced runtime details are progressively
disclosed instead of pushed into a separate mode.

---

## Actors

- A1. Non-technical operator: Creates routine automations without wanting to
  understand runtime primitives, judge specs, workers, or loop policy.
- A2. Power user: Wires triggers, instructions, connectors, MCPs, and advanced
  controls when the automation needs explicit integration behavior.
- A3. Implementer or planner: Uses this document to replace the confusing
  creation UX without inventing a new runtime model.

---

## Key Flows

- F1. Create a routine Automation
  - **Trigger:** A non-technical operator wants recurring or manually started
    agent work.
  - **Actors:** A1
  - **Steps:** The operator opens New Automation, enters a name, adds a trigger,
    writes or edits the default instruction, leaves MCPs and Advanced alone if
    they are not needed, and clicks Create automation.
  - **Outcome:** The Automation is created without the operator choosing a
    creation mode or understanding internal runtime settings.
  - **Covered by:** R1, R2, R3, R4, R9

- F2. Wire a connector-heavy Automation
  - **Trigger:** A power user needs an Automation that reacts to or acts through
    a specific external system.
  - **Actors:** A2
  - **Steps:** The user adds a trigger, chooses a trigger family such as schedule
    or connector-backed event when available, adds one or more instructions,
    selects MCPs/connectors, adjusts instruction-specific settings, and creates
    the Automation.
  - **Outcome:** The user can compose integration behavior from visible blocks
    without falling into a separate advanced-first form.
  - **Covered by:** R2, R3, R5, R6, R7, R9, R10

- F3. Adjust advanced controls
  - **Trigger:** A user needs limits, identity, safety, or runtime behavior that
    is not part of the common path.
  - **Actors:** A1, A2
  - **Steps:** The user expands the Advanced accordion in place, edits only the
    relevant controls, collapses it if desired, and continues creating the
    Automation from the same page.
  - **Outcome:** Advanced settings are available without becoming a side panel
    mode or competing creation path.
  - **Covered by:** R8, R9, R13

---

## Requirements

**Primary creation model**

- R1. New Automation must use a single Devin-style builder page as the primary
  creation model, not Chat / Manual / Advanced mode tabs.
- R2. The first visible structure must be name, triggers, instructions, MCPs or
  connectors, Advanced, and Create automation, in that order unless planning
  finds a strong usability reason to adjust spacing or grouping.
- R3. Add trigger and Add instruction must be the obvious primary actions inside
  their sections; they should not feel like secondary controls hidden beside a
  form.
- R4. The default experience must work for an operator who only supplies a name,
  a trigger, and a plain-language instruction.
- R5. The default page must also work for a power user wiring connectors or MCPs;
  those controls should be visible in the main flow, not buried exclusively
  under Advanced.

**Composable blocks**

- R6. Trigger creation must use a menu or block interaction similar to Devin's
  reference: top-level trigger families first, then specific options such as
  recurring schedule choices where supported.
- R7. Instruction blocks must make the action type explicit, such as starting a
  session, messaging a session, or sending a notification when those actions are
  supported by ThinkWork.
- R8. Advanced settings must be an in-page accordion, not a side panel. The
  accordion should hold controls such as limits, worker/agent mode, identity,
  evidence, and safety policy as supported by the current product.
- R9. The page must preserve the underlying Automation runtime behavior:
  created Automations still save into the existing Automation/AgentLoop
  substrate and still run as normal ThinkWork automation runs.

**Progressive power**

- R10. MCPs/connectors must be visible as part of the builder, but an empty state
  should not block routine automation creation.
- R11. Chat assistance may remain available as an optional helper, but it must
  not be the default creation mode or a required step before creating an
  Automation.
- R12. Templates or presets may remain available, but they should prefill the
  same single-page builder rather than opening a separate creation experience.
- R13. Existing advanced capabilities should be retained where practical, but
  moved into the page structure so users do not have to switch mental models.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R8.** Given a user opens New Automation, when the page
  loads, they see the Devin-style block builder and an Advanced accordion, not
  Chat / Manual / Advanced tabs or an Advanced side panel.
- AE2. **Covers R3, R6.** Given a user clicks Add trigger, when the menu opens,
  the first choice is a clear trigger family or common trigger option rather
  than a raw runtime field.
- AE3. **Covers R4, R9.** Given a user creates an Automation with a name,
  schedule trigger, and one start-session instruction, when they save it, the
  resulting Automation is a normal ThinkWork Automation backed by the existing
  runtime.
- AE4. **Covers R10, R11.** Given no MCPs are available, when a user creates a
  routine Automation, the MCP empty state is visible but does not require them
  to resolve MCP setup or start a chat builder.
- AE5. **Covers R5, R10.** Given a power user needs connector or MCP access,
  when they scan the default builder, they can identify where to wire those
  tools without opening Advanced first.

---

## Success Criteria

- A non-technical operator and a power user can both understand the New
  Automation page at a glance: when it runs, what it does, what tools it can
  use, and where optional advanced controls live.
- Connector/MCP wiring belongs in the primary builder, while advanced runtime
  details are progressively disclosed.
- Planning does not need to decide whether the primary model is chat-first,
  form-mode-first, or Devin-style; the answer is Devin-style primary.
- The implementation can preserve the current runtime substrate while replacing
  the creation surface.

---

## Scope Boundaries

- Do not introduce a visual workflow canvas.
- Do not rename database tables or require a broad AgentLoop-to-Automation
  runtime migration as part of this UX change.
- Do not make chat setup the default creation flow.
- Do not require MCPs/connectors before an Automation can be created.
- Do not remove advanced runtime controls solely because they are no longer in a
  side panel.
- Do not block this work on adding every Devin trigger or instruction type if
  ThinkWork does not yet support it; unsupported types should be omitted or
  deferred rather than faked.

---

## Key Decisions

- Devin-style builder is primary: The user explicitly wants to copy the Devin UI
  shape instead of designing a new flow.
- Actor model is an equal split with progressive disclosure: The same default
  page must work for routine operators and connector/MCP power users, with only
  deeper runtime controls hidden behind Advanced.
- Advanced is in-page: The side panel is part of the confusion; an accordion
  keeps optional controls in the same mental model as the rest of creation.
- Chat is optional: It may help generate or refine a draft, but creation should
  not start by choosing Chat as a mode.

---

## Dependencies / Assumptions

- `docs/plans/2026-06-23-001-feat-prompt-first-automations-plan.md` established
  prompt-first Automations, but THINK-111 supersedes the default creation-shape
  decision for the New Automation page.
- The current web creation form lives under `apps/web/src/components/agent-loops/`
  and already includes Automation language, mode tabs, Easy form components, and
  Advanced side-panel components that planning should evaluate for reuse or
  replacement.
- Current runtime support appears strongest for manual and schedule triggers.
  Connector-backed triggers and instruction action types should be mapped to
  real ThinkWork capabilities during planning rather than assumed.
- The Linear ticket includes Devin reference screenshots and the brainstorm
  added current-state screenshots showing the confusing ThinkWork page.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R6, R7][Technical] Which Devin trigger and instruction action types
  map to existing ThinkWork runtime capabilities today, and which should be
  deferred?
- [Affects R10][Technical] Should the MCPs section bind to existing connector,
  plugin, MCP, or worker tool-hint data in the first implementation?
- [Affects R11][Product/technical] Where should optional chat assistance live if
  it remains: a small helper button, a template generator, or a later follow-up?

---

## Next Steps

-> /ce-plan for structured implementation planning.
