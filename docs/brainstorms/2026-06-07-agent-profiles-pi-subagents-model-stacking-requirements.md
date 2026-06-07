---
date: 2026-06-07
topic: agent-profiles-pi-subagents-model-stacking
supersedes: 2026-06-06-model-stacking-tool-routing-requirements.md
---

# Agent Profiles and Pi Subagent Model Stacking

## Problem Frame

ThinkWork needs to demonstrate model stacking for enterprise customers, but the
right product boundary is not per-tool model switching. The model-stacking unit
should be a delegated Agent Profile: a task-specialized child Pi subagent that
runs inside the existing AgentCore turn, uses its own model and capability set,
returns a concise result to the parent, and records its own tokens, cost,
duration, and trace lane.

The previous `TOOLS.md` direction is superseded for model stacking. Raw tools
and MCP calls still need trace metadata, but they are not independent model
switching boundaries. A profile can own access to a focused bundle of default
tools, explicit tools/MCP servers, and skills; the profile's subagent loop then
uses those capabilities under the profile model.

This should make the customer demo easy to understand: the parent agent receives
a task, delegates research to a cheaper Research profile, summarizes the child
handoff, and Activity/Traces show the profile's model, tokens, cost, timing, and
lane.

---

## Actors

- A1. Tenant operator: configures the default agent and Agent Profiles under
  Settings.
- A2. Tenant user: chats with the parent agent and may invoke a profile manually.
- A3. Parent Pi agent: decides whether to answer directly or delegate a subtask
  to an Agent Profile.
- A4. Agent Profile / Pi subagent: focused child agent loop with its own model,
  instructions, skills, tools, and execution controls.
- A5. Customer evaluator: verifies that delegated subtasks are cost-attributed
  and observable.

---

## Key Flows

- F1. Configure Agent Profiles
  - **Trigger:** A tenant operator opens Settings -> Agents.
  - **Actors:** A1
  - **Steps:** The operator sees the tenant's default agent configuration,
    default tools, and available Agent Profiles. The operator edits or disables
    built-in profiles, creates custom profiles, selects a model, writes
    routing guidance, chooses skills/tools/MCP access, sets execution controls,
    and optionally restricts a profile to selected Spaces.
  - **Outcome:** Profiles are available globally unless restricted to selected
    Spaces, and the parent agent has clear routing targets for delegation.
  - **Covered by:** R1, R2, R3, R4, R5, R6, R7, R8

- F2. Parent auto-delegates to a profile
  - **Trigger:** A user asks the parent agent for work matching a profile's
    routing description.
  - **Actors:** A2, A3, A4
  - **Steps:** The parent identifies a suitable profile, launches it as a Pi
    subagent inside the existing AgentCore turn, gives it a bounded subtask, and
    receives a concise handoff summary. The parent uses that handoff to compose
    the final answer in the parent thread.
  - **Outcome:** The user sees one coherent answer while Activity and Traces
    preserve the delegated profile's model, cost, tokens, duration, status, and
    child details.
  - **Covered by:** R9, R10, R11, R12, R13, R14, R15

- F3. User manually invokes a profile
  - **Trigger:** A user enters `/agent <profile> <task>` in the composer.
  - **Actors:** A2, A3, A4
  - **Steps:** The composer recognizes the slash command, validates that the
    profile is available in the active Space, and launches that profile as the
    delegated subagent for the supplied task.
  - **Outcome:** Users can explicitly request specialized work without waiting
    for parent auto-routing.
  - **Covered by:** R9, R10, R16, R17

- F4. Inspect delegated profile work
  - **Trigger:** An operator opens Settings -> Activity -> Thread Detail after a
    turn with profile delegation.
  - **Actors:** A1, A5
  - **Steps:** The parent "Working..." / "Worked for" turn shows a nested Agent
    Profile step with model, tokens, duration, cost, status, and expandable
    details. The Trace UI preserves the existing Git-like multi-lane model, with
    each delegated profile/subagent visible in its own lane and annotated with
    thread-level timing, tokens, and cost.
  - **Outcome:** The customer can see both the high-level delegated step and the
    precise concurrency/causality view.
  - **Covered by:** R18, R19, R20, R21, R22

---

## Requirements

**Settings and configuration**

- R1. Settings must gain a dedicated Settings -> Agents page.
- R2. The existing default Agent configuration currently shown in Settings ->
  General must move to Settings -> Agents.
- R3. Settings -> Agents must include an Agent Profiles section for viewing,
  creating, editing, disabling, and deleting profiles.
- R4. V1 must ship with built-in Agent Profiles for Research, Coding, and
  Analyst, alongside support for custom profiles.
- R5. Agent Profiles are globally defined. They may be restricted to selected
  Spaces, but the profile itself cannot be customized per Space.
- R6. If a profile has no Space assignments, it is available everywhere.
- R7. A profile definition must include name, description/routing guidance,
  model, instructions, skills, tools/MCP access, and Space availability.
- R8. A profile definition must include execution controls: thinking level where
  supported, max runtime, max tokens or cost budget, and whether background
  execution is allowed.

**Capability bundling**

- R9. Agent Profiles are task-specialized bundles of instructions, model,
  skills, tools, MCP server access, and execution controls.
- R10. Profiles must receive the platform's default safe tools plus explicit
  profile-specific tool/MCP additions.
- R11. Profile tool access must be controlled at the profile level. Individual
  raw tool calls are not the model-stacking boundary.
- R12. MCP access may be granted by MCP server as the tool boundary. Planning
  may refine whether individual MCP operations can be hidden or surfaced, but
  the profile assignment should not depend on matching specific MCP operation
  names.

**Delegation behavior**

- R13. A profile runs as a Pi subagent inside the existing AgentCore thread and
  turn, not as a separate AgentCore instance.
- R14. The parent agent may automatically delegate to a profile when the task
  matches that profile's routing guidance and the profile is available in the
  active Space.
- R15. A delegated profile returns a summary-only handoff to the parent by
  default. The full child transcript, tool calls, and trace evidence remain
  available in Activity/Traces.
- R16. Users may manually invoke available profiles with `/agent <profile>
  <task>`.
- R17. Slash-command profile invocation must fail clearly when the profile does
  not exist, is disabled, or is unavailable in the active Space.

**Activity, traces, and cost attribution**

- R18. The parent turn's Activity view must show each delegated Agent Profile as
  a nested step inside the "Working..." / "Worked for" parent turn.
- R19. Each nested profile step must display model, input/output tokens where
  available, duration, cost, status, and expandable details.
- R20. Settings -> Activity -> Thread Detail must preserve the multi-lane Trace
  UI, with one lane per delegated profile/subagent execution where applicable.
- R21. Trace lanes must show timing, tokens, cost, model, and status for the
  delegated profile, not only for the parent turn.
- R22. Raw tool and MCP calls inside a profile must remain inspectable as child
  details of that profile execution. They should support trace metadata, but
  they do not need independent model override semantics.

**Authoring experience**

- R23. The profile editor should be hybrid: a structured Settings form for model,
  tools, skills, limits, availability, and status; and an "open workspace" or
  editor path for richer profile instructions/context.
- R24. The editor must make default tools, explicit tool/MCP additions, and
  assigned skills visible enough that operators understand what capabilities a
  profile can use.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given an operator opens Settings -> Agents, they
  see the tenant's default Agent runtime/model configuration that previously
  lived in Settings -> General, plus an Agent Profiles section.
- AE2. **Covers R4, R7, R8.** Given the first demo build, Research, Coding, and
  Analyst profiles exist with model, instructions, routing description,
  capability access, and execution controls.
- AE3. **Covers R5, R6, R14.** Given the Coding profile is restricted to the
  Engineering Space, when a user is in a Sales Space, the parent agent cannot
  auto-delegate to Coding and `/agent coding ...` fails with a clear
  availability message. Given Research has no Space assignment, it is available
  in every Space.
- AE4. **Covers R13, R15, R18, R19.** Given a parent turn uses the default model
  and delegates research to the Research profile on a cheaper model, when the
  turn completes, the parent answer incorporates the Research summary handoff
  and the Activity parent turn shows a nested Research profile step with model,
  tokens, cost, duration, and status.
- AE5. **Covers R16, R17.** Given Research is enabled and available in the active
  Space, when a user sends `/agent research find the latest source for X`, the
  Research profile runs as a delegated subagent. Given the same profile is
  disabled, the slash command fails clearly before execution.
- AE6. **Covers R20, R21, R22.** Given a delegated Research profile used web
  search and extraction tools, when an operator opens the Trace UI, they see the
  Research lane with its own time/tokens/cost/model and can expand the profile
  details to inspect the underlying tool calls.

---

## Success Criteria

- A customer can watch a parent agent delegate a research subtask to a cheaper
  Research profile, then see the parent summarize the result.
- Activity makes delegated profile cost attribution obvious without requiring a
  user to inspect raw traces.
- The multi-lane Trace UI still shows each delegated profile/subagent lane so
  timing and causality remain inspectable.
- Operators can explain what a profile is allowed to do by looking at Settings
  -> Agents: model, instructions, tools/MCP access, skills, limits, and Space
  availability.
- Planning can proceed without inventing the product primitive, v1 built-ins,
  invocation syntax, Space availability behavior, handoff model, or trace
  expectations.

---

## Scope Boundaries

- V1 does not switch models per raw tool call.
- V1 does not use `TOOLS.md` as the model-stacking policy surface.
- V1 does not create separate AgentCore instances for profile execution.
- V1 does not make profiles independent long-running agents with their own
  lifecycle. Heavier delegation to a separate AgentCore instance is deferred for
  long-running jobs.
- V1 does not require Hermes-style isolated profile state, memory, credentials,
  sessions, gateways, or process supervision.
- V1 does not require per-Space profile customization. A profile may be
  available in a Space or not; its definition is global.
- V1 does not require full transcript handoff from child profile to parent. The
  parent receives a concise summary handoff by default.
- V1 does not need to collapse Settings pages for Skills, Built-in Tools, or MCP
  Servers, though Settings -> Agents should surface the relevant selections for
  profile configuration.

---

## Key Decisions

- **Product noun:** Use "Agent Profiles" in the UI and requirements. "Pi
  subagent" is the execution mechanism.
- **Execution boundary:** A profile runs as a lightweight Pi subagent inside the
  existing AgentCore thread and turn.
- **Model stacking boundary:** Stack models by delegated profile/subtask, not by
  individual raw tool call.
- **Manual invocation:** Use `/agent <profile> <task>` for explicit user
  delegation.
- **Automatic invocation:** Allow the parent to auto-delegate when profile
  routing guidance matches and the profile is available in the active Space.
- **Scope:** Profiles are globally defined and optionally restricted to Spaces;
  no per-Space overrides in v1.
- **Built-ins:** Ship Research, Coding, and Analyst as the initial built-in
  profiles.
- **Handoff:** Use summary-only child-to-parent handoff while preserving full
  child observability in Activity/Traces.

---

## Dependencies / Assumptions

- Pi Subagents provides a useful reference model for child Pi sessions with
  per-agent model, tools, skills, prompt, and context controls.
- Hermes Profiles provides useful product language around profiles, but its
  heavier isolation model is intentionally out of scope for ThinkWork v1 Agent
  Profiles.
- The existing Activity/Trace direction already includes a Git-like multi-lane
  concept for subagent execution; this brainstorm preserves that product shape.
- Existing Settings pages for Skills, Built-in Tools, MCP Servers, Spaces, and
  Activity can be referenced by planning when deciding exact UI reuse.

---

## References

- Pi Subagents package: https://pi.dev/packages/pi-subagents
- Hermes Agent profiles guide: https://hermes-agent.nousresearch.com/docs/user-guide/profiles
- Superseded brainstorm: `docs/brainstorms/2026-06-06-model-stacking-tool-routing-requirements.md`
- Related subagent architecture brainstorm: `docs/brainstorms/2026-04-24-fat-folder-sub-agents-and-workspace-consolidation-requirements.md`

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R8][Technical] Confirm which execution controls are directly
  enforceable in the current Pi runtime and which should render as disabled or
  future controls in the first UI.
- [Affects R10, R12][Technical] Decide the exact representation for default
  tools, explicit built-in tools, MCP server access, and skill access in the
  Settings -> Agents editor.
- [Affects R20, R21][Technical] Map delegated profile executions onto the
  existing Activity/Trace data model without losing raw tool call inspection.

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
