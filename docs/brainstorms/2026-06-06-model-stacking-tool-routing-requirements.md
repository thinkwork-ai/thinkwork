---
date: 2026-06-06
topic: model-stacking-tool-routing
---

# Model Stacking and Tool Routing

## Problem Frame

ThinkWork's largest customer needs model stacking inside the Agent: users must be
able to choose from approved models for a thread turn, and the runtime must be
able to switch models for specific tool calls during that same turn to optimize
cost without hiding what actually ran.

The current product already has a model catalog with pricing and a Pi runtime
that accepts a turn-level model. The missing product capability is governed,
user-visible model choice plus deterministic tool-level model routing that fits
the "folder is the agent" architecture. The near-term demo must prove real
runtime model switching, not just policy display.

---

## Actors

- A1. Tenant admin: approves which model catalog entries a user may select and
  can inspect the resulting model/cost behavior.
- A2. Tenant user: starts new threads and follow-up turns with an approved model
  selected in the composer.
- A3. Agent author/operator: edits folder-owned policy files that define
  tool-level model routing.
- A4. Pi runtime: applies the effective model policy before each tool call and
  records trace/cost evidence.
- A5. Customer evaluator: watches the demo and needs to see both approved user
  choice and true within-turn model stacking.

---

## Key Flows

- F1. User selects a model for a turn
  - **Trigger:** A user starts a new thread or submits a follow-up message.
  - **Actors:** A1, A2, A4
  - **Steps:** The composer shows only models approved for that user. The user
    selects one model, sees human-readable model name and token cost context,
    then submits the turn. The backend validates the selected model against the
    user's approved model set and forwards it as the parent/planner model for the
    turn.
  - **Outcome:** The turn runs under the selected approved parent model, and the
    trace shows which parent model was requested and used.
  - **Covered by:** R1, R2, R3, R4, R10

- F2. Admin approves models for a user
  - **Trigger:** A tenant admin opens a user's profile settings.
  - **Actors:** A1
  - **Steps:** The Models section lists available model catalog entries with
    display name, provider, input/output token price, and an Approved switch.
    The admin enables or disables models for that user.
  - **Outcome:** The user's composer model picker reflects the approved set.
  - **Covered by:** R1, R5, R6

- F3. Runtime switches model for a tool call
  - **Trigger:** During a Pi turn, the parent model calls a tool with a matching
    effective `TOOLS.md` routing rule.
  - **Actors:** A3, A4, A5
  - **Steps:** The runtime resolves the effective `TOOLS.md` policy from agent,
    active Space, active workspace/folder, and user layers. Before executing the
    tool call, it finds the highest-precedence matching rule, validates the
    override model is approved for the requester, runs the tool-call path with
    the override model, and returns the child result to the parent turn.
  - **Outcome:** The trace shows a parent model plus a child tool-call model,
    with tokens, cost, rule source, and status for the routed call.
  - **Covered by:** R7, R8, R9, R10, R11, R12, R13

---

## Requirements

**Approved model selection**

- R1. User model approval must be per user and sourced from the existing model
  catalog, not a hard-coded UI list.
- R2. New-thread composer and follow-up composer must allow the user to select a
  model from their approved set.
- R3. Composer model options must show enough pricing context for cost-aware
  selection, including input and output token cost per million when available.
- R4. Turn submission must fail loudly if the selected model is not approved for
  that user or is no longer available in the model catalog.
- R5. User Profile Settings must add a Models section listing model catalog
  entries with an Approved switch.
- R6. The Models section must show model display name, provider, and token cost
  context so admins understand what they are approving.

**Tool-level model routing**

- R7. Tool-level model routing must be enforced by runtime policy, not by asking
  the parent model to follow prose instructions.
- R8. `TOOLS.md` is the ThinkWork-owned policy file for executable tool behavior,
  including tool-level model routing.
- R9. The runtime must check effective model routing before each tool call and
  choose the override model based on the winning rule.
- R10. A tool-level override may only select a model approved for the requesting
  user and available in the model catalog.
- R11. The first demo target for true model stacking is skill invocation through
  the `workspace_skill` tool: a rule can route a specific skill slug to an
  override model for child reasoning.
- R12. Model routing is by tool call, not only by skill, agent, Space, or whole
  turn.
- R13. If no matching `TOOLS.md` rule exists, the tool call runs under the
  normal parent-turn behavior.

**Policy layering**

- R14. Effective `TOOLS.md` policy resolves in this precedence order, from
  lowest to highest: agent root, active Space, active workspace/folder, user
  workspace.
- R15. Higher-precedence `TOOLS.md` files may override lower-precedence routing
  for the same tool match but cannot grant access to an unapproved model.
- R16. `AGENTS.md`, `SPACE.md` or Space `CONTEXT.md`, and `USER.md` may describe
  preferences or rationale, but the enforceable routing contract lives in
  `TOOLS.md`.
- R17. The policy format must contain a machine-readable section so the runtime
  does not parse natural-language prose to enforce model routing.

**Traceability and demo evidence**

- R18. Each turn trace must show the parent/planner model selected in the
  composer.
- R19. Each routed tool call must record tool name, match details, winning policy
  source, override model, token usage, cost, duration, and status when available.
- R20. The demo must show at least one turn where the parent model and a
  tool-call model are different and the trace makes that difference obvious.
- R21. Cost reporting must not collapse child model calls into a single opaque
  parent model; model-level spend should remain explainable.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R4.** Given Eric is approved for Sonnet and Haiku
  but not Opus, when he opens a new-thread composer, then Sonnet and Haiku are
  selectable with token cost context and Opus is not selectable.
- AE2. **Covers R5, R6.** Given an admin opens Eric's profile settings, when
  they view Models, then each available model catalog entry shows display name,
  provider, input/output token price, and an Approved switch.
- AE3. **Covers R7, R9, R10, R11, R18, R19, R20.** Given the parent turn model
  is Sonnet and `TOOLS.md` routes `workspace_skill` with
  `slug=financial-analysis` to Haiku, when the parent model invokes that skill,
  then the skill child call runs on Haiku and the trace shows Sonnet as parent
  plus Haiku for the routed skill call.
- AE4. **Covers R14, R15, R16.** Given agent root `TOOLS.md` routes
  `workspace_skill` to Haiku, active Space `TOOLS.md` routes the same skill to
  Sonnet, and user `TOOLS.md` routes it to Opus, when the user is not approved
  for Opus, then the Opus override is rejected and the runtime does not silently
  bypass approval.
- AE5. **Covers R12, R13.** Given `TOOLS.md` has no matching rule for
  `send_email`, when the parent model calls `send_email`, then no model override
  is applied for that tool call.

---

## Success Criteria

- A customer can see that users choose only approved models for new and follow-up
  turns.
- A customer can see one turn where a tool call genuinely runs on a different
  model than the parent turn.
- Admins and operators can explain why a routed tool call used a specific model
  by looking at the winning `TOOLS.md` rule and trace.
- Planning can proceed without inventing the policy file name, policy precedence,
  first demo target, or traceability promise.

---

## Scope Boundaries

- This does not require a full dynamic model optimizer that chooses models based
  on live token estimates or confidence.
- This does not require hot-swapping the parent Pi session model for every
  built-in SDK tool in v1.
- This does not make `AGENTS.md`, `SPACE.md`, `CONTEXT.md`, or `USER.md` the
  machine-enforced routing surface.
- This does not require an external `TOOLS.md` standard to exist; `TOOLS.md` is a
  ThinkWork-native contract.
- This does not require unapproved model requests to downgrade silently. Failing
  loud is preferred to misleading cost or trace evidence.
- This does not define customer-facing billing, invoices, or broad cost
  optimization recommendations beyond traceable model/cost behavior.

---

## Key Decisions

- **Policy file name:** Use `TOOLS.md`, because the enforced behavior is by tool
  call and may later cover more than model routing.
- **Policy source:** Keep enforceable routing in `TOOLS.md`; allow
  `AGENTS.md`, Space context, and `USER.md` to explain preferences only.
- **Policy layering:** Use agent root -> active Space -> active workspace/folder
  -> user workspace precedence, with user policy highest.
- **Approval gate:** User-approved models constrain both composer choices and
  tool-level overrides.
- **First stacking target:** Prove true model switching through
  `workspace_skill` with skill-slug matching.
- **Demo honesty:** The minimum viable demo must show actual child model
  execution and trace evidence, not simulated routing metadata.

---

## Dependencies / Assumptions

- `model_catalog` already exists and exposes display name, provider, and
  input/output token cost.
- The current GraphQL thread inputs need a way to carry a selected model for new
  and follow-up turns.
- The current Pi runtime already accepts a turn-level model, but tool-level
  model switching needs a runtime policy/checkpoint before tool execution.
- Public AI-agent conventions are stronger around `AGENTS.md` and `SKILL.md`
  than around any external `TOOLS.md` standard. Treat `TOOLS.md` as a
  ThinkWork-native contract.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1-R6][Technical] What is the smallest database/API shape for
  per-user model approval that fits existing tenant membership and model catalog
  patterns?
- [Affects R2-R4][Technical] Which composer surfaces need the model picker first:
  admin, Spaces, mobile, or all active thread composers?
- [Affects R7-R13][Technical] Where is the lowest-risk interception point in the
  Pi runtime to apply policy before each tool call and run an override model as
  a child invocation?
- [Affects R11][Technical] What is the minimal `workspace_skill` child-call
  contract: inputs, child prompt shape, parent result shape, and error behavior?
- [Affects R17][Technical] What exact machine-readable section format should
  `TOOLS.md` use for v1, and how should invalid policy be surfaced?
- [Affects R18-R21][Technical] Which existing trace/cost tables can represent
  parent/child model calls, and where is a new trace field required?

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
