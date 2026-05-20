---
date: 2026-05-20
topic: spaces-as-contextual-workrooms-template-removal
---

# Spaces as Contextual Workrooms and Template Removal

## Problem Frame

ThinkWork originally used Agent Templates because the product expected many per-user agents that needed shared fleet configuration. The product direction has changed: agents are durable role/capability actors such as `sql-agent`, `report-agent`, or `coordinator-agent`, and reusable context belongs in Spaces rather than in a live template hierarchy.

Templates now mix runtime policy, workspace files, skills, MCP/tool bindings, knowledge, and starter metadata into one abstraction. That makes the data model harder to explain and puts context controls in the wrong place. ThinkWork should remove Templates completely and make Spaces the contextual workroom for agents: a Dust-like context/tool/data configuration surface that can also organize user conversations.

This document supersedes the old Space-as-template-parent framing and the pure Space-as-collaboration-room framing where they conflict with this direction. The target mental model is **Agent in Space**, not **Agent from Space**. Agents are durable role/capability actors. Spaces provide situational context, files, tools, data, policy, and room/thread organization when those agents are invoked.

Spaces have two surfaces:

- Admin/operator Space Studio for configuring context, tools, data, MCP, policies, and agent availability.
- End-user Space navigation in `apps/computer` for starting/resuming work in a contextual workroom.

---

## Actors

- A1. Tenant admin: creates role/capability agents, governs runtime policy, and manages default context.
- A2. Space author: configures contextual workrooms with files, skills, tools, data, MCP servers, and policy.
- A3. End user: opens a Space, starts or resumes threads, and mentions agents inside that Space.
- A4. Agent operator: audits which Spaces can provide context to which agents.
- A5. Agent runtime: receives effective turn context from the agent baseline plus the current Space, then executes with no template dependency.
- A6. Migrator/backfill process: hard-cuts existing template data into agent fields and Spaces.
- A7. Planning/implementation agent: uses this document to remove Templates without reinventing product behavior.

---

## Key Flows

- F1. Tenant baseline Space is seeded
  - **Trigger:** A tenant is created or migrated.
  - **Actors:** A1, A6
  - **Steps:** ThinkWork creates a tenant-owned editable `default` Space from platform defaults. It contains baseline workspace files, skills folder, memory folder, capabilities, guardrails, platform context, and other default context content. New threads start in this Space unless the user selects another Space.
  - **Outcome:** Tenant defaults become visible, editable context rather than a hidden template/default layer.
  - **Covered by:** R1, R2, R3

- F2. Admin configures a Space
  - **Trigger:** A tenant admin or Space author opens Space configuration.
  - **Actors:** A1, A2
  - **Steps:** The admin UI presents a Space Studio inspired by Dust: Overview, Workspace, Connected Data, Tools, MCP Servers, Agents, and Settings. The author edits workspace files, installs or edits skills, connects data, grants tools/MCP servers, defines context policy, and controls which agents are available in the Space.
  - **Outcome:** The Space is a reusable, auditable context package and a user-visible workroom.
  - **Covered by:** R4, R5, R6, R8, R9, R10, R11, R13

- F3. User invokes an agent inside a Space
  - **Trigger:** A user opens a Space and mentions or selects an agent in a thread.
  - **Actors:** A3, A5
  - **Steps:** The agent keeps its durable identity, runtime settings, and local workspace. For this turn, the current Space injects its workspace files, connected data, tools, MCP bindings, policies, and relevant Space/thread context. The effective policy resolves by most-restrictive-wins.
  - **Outcome:** The same agent can operate differently in Sales, Engineering, or Finance because the current Space provides situational context without deriving or mutating the agent.
  - **Covered by:** R6, R12, R13, R14, R15, R16, R17, R18, R19, R20

- F4. User navigates Spaces in the Computer app
  - **Trigger:** An end user opens `apps/computer`.
  - **Actors:** A3
  - **Steps:** The app shows a Codex-like sidebar with global actions, pinned threads, collapsible Space sections, and recent threads under each Space. Users can collapse/expand Spaces and start a new thread within a Space.
  - **Outcome:** Spaces act as understandable workrooms without requiring users to understand the admin configuration model.
  - **Covered by:** R7, R26

- F5. Runtime workspace or context packet is materialized
  - **Trigger:** A user invokes an agent inside a Space, or Space/agent source context changes.
  - **Actors:** A5
  - **Steps:** A renderer composes the agent-local source workspace plus the current Space into the effective runtime workspace/context packet. Space files appear under a namespaced `spaces/<space-slug>/` folder or equivalent context bundle. The generated root map explains the current Space, tool provenance, and policy constraints.
  - **Outcome:** The runtime continues using the existing flat workspace sync model where practical while seeing deterministic effective context for the turn.
  - **Covered by:** R14, R15, R16, R17, R18

- F6. Existing Templates are hard-cut away
  - **Trigger:** The migration ships.
  - **Actors:** A6, A7
  - **Steps:** Runtime/operational fields from linked Templates are copied onto Agents. Template context/workspace/tool/MCP/skill/knowledge content is converted into Spaces. Platform/default template behavior folds into the tenant `default` Space where appropriate. Template UI/API/schema/runtime concepts are removed rather than hidden.
  - **Outcome:** No remaining product, API, or runtime path depends on Templates.
  - **Covered by:** R21, R22, R23, R24, R25

---

## Requirements

**Product model**

- R1. ThinkWork must remove Templates as a first-class product and runtime concept. Templates must not remain as a live parent, inheritance layer, or hidden runtime dependency.
- R2. Agents must own runtime and operational fields directly, including model, runtime, guardrail, budget/policy, status, ownership, schedule/email/API identity, and role/capability metadata.
- R3. Every tenant must have a tenant-owned editable `default` Space seeded from platform defaults. New threads should start in the tenant `default` Space unless the user selects another Space.
- R4. Spaces must be defined as contextual workrooms: reusable context modules that also organize end-user conversation. A Space owns context, files, skills, data, tools, MCP bindings, policy, room/thread organization, and future event bindings.
- R5. Agents must retain their own local source workspace for identity/personality/role files such as `SOUL.md`, `IDENTITY.md`, and `CONTEXT.md`. Spaces do not replace the agent's own workspace; they augment it per turn.
- R6. Agents must not be derived from Spaces. A Space can influence an agent's effective context for a turn, but it must not mutate the agent's durable identity, runtime, or baseline workspace.

**Space configuration and navigation**

- R7. `apps/computer` must include an end-user Space navigation surface. The preferred shape is a Codex-like sidebar with global actions, pinned threads, and collapsible Space sections containing recent threads.
- R8. The admin Space configuration surface must be a Space Studio with context-oriented sections. The v1 navigation should include Overview, Workspace, Connected Data, Tools, MCP Servers, Agents, and Settings.
- R9. Space Studio should reuse and rename existing Template UI where practical: Template Workspace becomes Space Workspace, Template MCP Servers becomes Space MCP Servers, Template skill/workspace handling becomes Space Skills/Workspace, and Template Company Brain/tool toggles become Space Connected Data/Tools.
- R10. Space Studio should borrow Dust's context categories where they fit: Connected Data, Folders/Workspace, Websites or web-connected knowledge, Tools, and MCP-backed resources.
- R11. Triggers must be supported as a future concept in the data model and architecture, but they must not be a headline v1 Space Studio navigation item. V1 should be trigger-ready, not trigger-led.

**Agent in Space invocation**

- R12. Mentioning or selecting an agent inside a Space must invoke the agent with effective context equal to the agent baseline plus the current Space context.
- R13. Space-to-agent availability must be governable. Admins can decide which agents are available in a Space, and agent pages can show which Spaces can invoke them.
- R14. Space context must be namespaced under generated runtime folders such as `spaces/<space-slug>/` or equivalent context bundles. It must not be blindly merged into the agent root.
- R15. The generated root map must describe the current Space and guide progressive discovery so the agent starts with a high-level index and reads Space context when relevant.

**Composition and runtime**

- R16. Source trees and rendered runtime workspaces must be separate. Agent-local source files and Space source files are authored state; effective runtime workspace/context is generated output.
- R17. Current Space context must materialize into the agent's existing runtime workspace path or equivalent turn context packet so the runtime can continue using the current flat workspace sync behavior where practical.
- R18. The generated runtime workspace must include a root `AGENTS.md` or equivalent root map that lists the current Space, describes its purpose, and records tool/data/policy provenance.
- R19. Tools available to the agent during a Space turn must be the union of the agent baseline and tools granted by the current Space, with provenance preserved so the agent and operator can see which source grants each tool.
- R20. Policy conflicts between the agent baseline and current Space must resolve by most-restrictive-wins where possible. Irreconcilable conflicts must become validation errors rather than silent ordering-dependent behavior.

**Template removal and migration**

- R21. Existing Template runtime fields must migrate onto linked Agents.
- R22. Existing Template context fields must migrate into Spaces, including workspace files, skills, knowledge base assignments, MCP assignments, Company Brain/context provider settings, built-in tool toggles, and related context configuration.
- R23. Existing default/template default workspace content must fold into the tenant `default` Space where it represents baseline context.
- R24. Former non-default Templates with meaningful context should become tenant Spaces. Agents that previously referenced those Templates should become available in or compatible with the migrated Spaces where appropriate, without being derived from them.
- R25. Template-specific sync, linked-agent, pinned-update, create-from-template, and template-management UI/API concepts must be removed or recast as Space rendering/availability impact previews. They must not preserve Template as a named abstraction.

**Existing workflow reconciliation**

- R26. Existing collaboration-room Space docs and UI surfaces must be audited and rewritten to the contextual workroom model. User-facing room/channel behavior is valid only when it is clearly tied to Space context and turn invocation.
- R27. Customer onboarding/checklist behavior that still needs a workflow container must be evaluated separately. It may live inside Spaces only if it supports the contextual workroom model rather than becoming a separate workflow product hidden under the Space name.
- R28. Computer-specific template dependencies must be audited during planning. If Computers still require starter configuration, that behavior should be recast as agent/computer fields plus default Space context, not preserved as Computer Templates.
- R29. Evaluation/test-case flows that currently reference `agentTemplateId` must be migrated to reference an explicit agent, runtime config snapshot, or Space set, depending on their actual purpose.

---

## Visual: Target Relationship Model

```text
Tenant
  ├─ default Space (editable baseline context + default workroom)
  ├─ Sales Space
  └─ Engineering Space

Agent: sql-agent
  ├─ runtime fields
  │    model, runtime, guardrail, budget, status
  ├─ local source workspace
  │    SOUL.md, IDENTITY.md, CONTEXT.md, ...
  └─ available in Spaces
       default, Sales, Engineering

Turn: @sql-agent mentioned in Finance Space
  └─ effective context = sql-agent baseline + Finance Space context

Rendered turn workspace/context
  ├─ AGENTS.md              # generated root map
  ├─ SOUL.md                # agent-local
  ├─ IDENTITY.md            # agent-local
  ├─ CONTEXT.md             # agent-local role/capability
  └─ spaces/
       └─ finance/
```

---

## Acceptance Examples

- AE1. **Covers R1, R2, R21.** Given an agent currently references a Template with model/runtime/guardrail fields, when migration completes, then the agent row directly carries the equivalent runtime configuration and no runtime path reads the Template.
- AE2. **Covers R3, R23.** Given a tenant is migrated, when an admin or user opens Spaces, then a `default` Space exists, is tenant-owned/editable by admins, and contains the baseline context that previously lived in defaults/template defaults.
- AE3. **Covers R12, R13, R14, R15.** Given a user mentions `sql-agent` in `finance`, when the rendered turn workspace is inspected, then Finance Space context appears under `spaces/finance/` and the generated root map describes when to use it.
- AE4. **Covers R16, R17, R18.** Given a Space source file changes, when the renderer runs for the next Space turn, then the effective runtime workspace/context updates without requiring the runtime to learn a Template-fetching mechanism.
- AE5. **Covers R19, R20.** Given an agent baseline grants SQL tools and the current Space restricts SQL to read-only, when the effective tool policy is generated for the turn, then the SQL tools remain available only under the stricter read-only policy with provenance shown.
- AE6. **Covers R8, R9, R10, R11.** Given an admin opens Space Studio, when they configure a Space, then they see context-oriented sections for workspace, connected data, tools/MCP, agents, and settings, but no v1 top-level Triggers section.
- AE7. **Covers R24, R25.** Given an existing non-default Template has workspace files, skills, and MCP assignments, when migration completes, then a corresponding Space exists with that context and relevant agents can be made available in that Space without deriving from it.
- AE8. **Covers R7.** Given the end-user `apps/computer` application after this work, when a user opens the app, then they see a Codex-like sidebar with global actions, pinned threads, and collapsible Space sections with recent threads.

---

## Success Criteria

- Operators and users can explain the model as: "Agents are who acts; Spaces are where the agent is acting."
- There is no Template concept left for operators, GraphQL/API consumers, or runtime code to understand.
- Every tenant has a default Space, and sensitive context can be audited from both the Space and agent directions.
- Runtime behavior stays deterministic: a rendered workspace/context packet shows exactly what the agent saw for a Space turn.
- Planning can proceed without re-deciding whether Agents derive from Spaces, whether Templates survive, how Space context enters an agent turn, or where tools/MCP/skills belong.

---

## Scope Boundaries

- Do not preserve Templates as hidden compatibility infrastructure after the hard cut.
- Do not make Spaces merely collaboration rooms, Slack channels, or general-purpose chat containers; their durable product role is contextual workroom.
- Do not remove Spaces from `apps/computer`; the end-user app needs a lightweight Space navigation and thread surface.
- Do not preserve the current collaboration-shaped `apps/admin` Space UI unchanged; replace it with admin Space Studio for context/tool/data configuration.
- Do not put Triggers in the v1 Space Studio navigation, even though the architecture should leave room for them.
- Do not merge Space context directly into the root workspace where file/tool/policy collisions become invisible.
- Do not remove the agent's own local workspace; agents still need identity/personality/role files.
- Do not move runtime model/guardrail/budget configuration into Spaces; those are agent-owned unless a later product decision creates a separate policy layer.
- Do not build a new runtime composition system if the existing flat workspace sync can consume generated output or a turn context packet.
- Do not keep old collaborative Space plans active without reconciling them with this contextual workroom direction.

---

## Key Decisions

- **Hard-cut Templates:** Simpler data model beats preserving an abstraction built for the older per-user-agent assumption.
- **Space equals contextual workroom:** This borrows Dust's context/tool configuration while preserving a channel-like user surface.
- **Agent in Space, not Agent from Space:** Spaces influence turn context; they do not derive, clone, or mutate durable agents.
- **Tenant-owned editable default Space:** Baseline context becomes visible and editable instead of hidden under defaults/templates.
- **Agent-local workspace remains:** Agents need their own `SOUL.md`, `IDENTITY.md`, `CONTEXT.md`, and role-specific files.
- **Namespaced Space folders:** Current Space context renders under `spaces/<slug>/` to avoid collisions and support progressive discovery.
- **Generated root map:** The agent gets a concise index of the current Space, tool provenance, and restrictive policies.
- **Separate source and rendered runtime workspace/context:** Authored files stay clean; generated runtime output stays auditable.
- **Union tools with most-restrictive policy:** Agent baseline and Space-granted tools compose while governance remains deterministic.
- **Bidirectional availability UI:** Operators can audit from either the agent or Space perspective which Spaces can invoke which agents.
- **Trigger-ready, not trigger-led:** Event bindings are a future extension, not a v1 headline.

---

## Dependencies / Assumptions

- Current code confirms that `agent_templates` mix runtime fields with context fields in `packages/database-pg/graphql/types/agent-templates.graphql`.
- Current Space schema, admin UI, and end-user app routes are collaboration/workflow-shaped in `packages/database-pg/graphql/types/spaces.graphql`, `apps/admin/src/routes/_authed/_tenant/spaces/$spaceId.tsx`, and `apps/computer/src/routes/_authed/_shell/spaces.*`; these surfaces need to be rewritten around contextual workrooms.
- Current Template UI has reusable Workspace, MCP, tool toggle, and Company Brain sections in `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.$tab.tsx`.
- Current runtime workspace behavior favors materialized flat sync over read-time template composition, per `packages/api/src/lib/workspace-bootstrap.ts` and `packages/agentcore-flue/agent-container/src/runtime/bootstrap-workspace.ts`.
- Dust's Space IA supports the context-module half of the model, especially Connected Data, Folders, Websites, Tools, and Triggers in `front/lib/spaces.ts` in the local Dust checkout.
- The Codex sidebar screenshot is a strong directional reference for `apps/computer`: global actions, pinned threads, collapsible work areas, and recent threads under each area.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R21-R25][Technical] Define the exact migration order and rollback plan for deleting Template tables, GraphQL types, generated clients, admin routes, runtime config reads, and foreign keys.
- [Affects R16-R20][Technical] Define the turn-context renderer contract: inputs, generated files/context packet, idempotency, render triggers, conflict diagnostics, and audit/snapshot behavior.
- [Affects R3, R23][Technical] Define how platform defaults seed and update the tenant `default` Space without silently overwriting tenant edits.
- [Affects R19, R20][Technical] Define the policy model for most-restrictive-wins across Space-granted tools, MCP servers, data, and built-in tools.
- [Affects R26-R27][Product/technical] Decide what to keep inside Spaces versus remodel separately for customer onboarding workflow containers.
- [Affects R28][Technical] Audit Computer creation/runtime paths that require Templates and define the replacement shape.
- [Affects R29][Technical] Audit evaluation flows and decide whether each former template reference becomes an agent reference, runtime snapshot, or Space set.
- [Affects R7-R11][Design] Define both the end-user Space sidebar IA and the admin Space Studio IA. The end-user sidebar should explore a Codex-like layout with global actions, pinned threads, collapsible Space sections, and recent threads.

---

## Next Steps

-> /ce-plan to update the implementation plan around contextual workrooms.
