---
date: 2026-05-20
type: refactor
status: active
depth: deep
origin: docs/brainstorms/2026-05-20-spaces-as-agent-context-modules-template-removal-requirements.md
supersedes:
  - docs/plans/2026-05-20-002-fix-decouple-threads-from-spaces-plan.md
---

# refactor: Spaces as contextual workrooms and complete Template removal

## Summary

ThinkWork is hard-cutting Templates out of the product model. Agents will own runtime and operational configuration directly. Spaces become contextual workrooms: Dust-like context/tool/data configuration plus a lightweight channel-like user surface where threads live and agents can be invoked.

The product model is:

- **Agent = who acts.** Durable identity, runtime, model, guardrails, baseline policy, and local workspace files.
- **Space = where the agent acts.** Context, files, tools, connected data, MCP bindings, policy, room/thread organization, and future triggers.
- **Turn = Agent + Space + Thread + user request.** When `@sql-agent` is mentioned in Finance Space, the SQL agent keeps its durable identity, but the turn gets Finance Space context.

This replaces the prior "Spaces are admin-only context modules" plan. It also changes how to treat `docs/plans/2026-05-20-002-fix-decouple-threads-from-spaces-plan.md`: that document remains useful as an inventory of thread-space coupling, but it should not be implemented literally because Spaces are now intentionally present in the end-user app.

## Problem Frame

The current code has two mixed abstractions:

1. `agent_templates` define model, runtime, guardrail, tools, skills, MCP, knowledge bases, and workspace defaults.
2. `spaces` are partly chat rooms, partly workflow containers, partly local agent instruction containers, and partly integration/checklist objects.

The new direction preserves the useful part of both ideas without letting one noun do everything:

- Templates disappear.
- Agents are independent role/capability actors.
- Spaces keep their user-facing workroom value.
- Spaces also become the durable context and tool surface for work done in that room.
- Agents are invoked inside Spaces; they are not derived from Spaces.

## Requirements Trace

This plan implements the updated origin document:

- Product model: R1-R6
- Space configuration and navigation: R7-R11
- Agent in Space invocation: R12-R15
- Composition and runtime: R16-R20
- Template removal and migration: R21-R25
- Existing workflow reconciliation: R26-R29

Acceptance examples:

| Origin AE                                                            | Covered by |
| -------------------------------------------------------------------- | ---------- |
| AE1: Template runtime fields migrate onto agents                     | U5, U6, U8 |
| AE2: tenant editable `default` Space exists                          | U4, U6     |
| AE3: mentioning an agent in a Space injects namespaced Space context | U4, U7, U9 |
| AE4: Space source edits affect later Space turns                     | U7, U8     |
| AE5: agent baseline and Space policy compose restrictively           | U5, U7     |
| AE6: admin Space Studio is context-oriented                          | U10        |
| AE7: non-default Templates become Spaces                             | U6         |
| AE8: Computer app has Codex-like Space sidebar                       | U3         |

## Scope Boundaries

In scope:

- Remove Templates from schema, API, UI, generated clients, runtime config resolution, and migration assumptions.
- Migrate Template runtime fields onto Agents.
- Migrate Template context fields into Spaces.
- Keep Spaces in `apps/computer` as user-visible contextual workrooms.
- Replace the current Space UI with a Codex-like sidebar and Space/thread navigation.
- Replace the admin Space UI with Space Studio for context/tool/data/MCP/policy configuration.
- Preserve a thread-to-Space association, but remove old assumptions that every Space is a workflow/checklist/membership container.
- Compose effective turn context from agent baseline plus current Space.

Out of scope:

- Keeping Templates as a hidden compatibility layer.
- Deriving agents from Spaces.
- Mutating durable agent identity from Space context.
- Making Spaces merely Slack channels or general chat rooms with no context/tool meaning.
- Shipping Triggers as a v1 top-level Space Studio tab.
- Preserving customer onboarding/checklist behavior under the Space name without validating it fits the contextual workroom model.

## Current State Research

Database and GraphQL:

- `packages/database-pg/src/schema/agent-templates.ts` says templates define model, guardrail, blocked tools, skills, knowledge bases, and workspace.
- `packages/database-pg/src/schema/agents.ts` has a required `template_id` FK, while agents already carry direct runtime fields such as `runtime`, `adapter_config`, `runtime_config`, budget fields, and `system_prompt`.
- `packages/database-pg/src/schema/spaces.ts` and `packages/database-pg/graphql/types/spaces.graphql` describe Spaces as collaboration rooms with members, checklists, integrations, unread counts, and local agent instructions.
- `packages/database-pg/src/schema/computers.ts` requires `computers.template_id`.
- `packages/database-pg/src/schema/evaluations.ts` stores `agent_template_id` on eval test cases and runs.
- `packages/database-pg/src/schema/mcp-servers.ts` has `agent_template_mcp_servers`; Space-level MCP binding needs to replace template-level binding.

API and runtime:

- `packages/api/src/graphql/resolvers/templates/createAgentFromTemplate.mutation.ts` copies Template skills, knowledge bases, MCP servers, pinned versions, and workspace files into new agents.
- `packages/api/src/graphql/resolvers/agents/createAgent.mutation.ts` reads Template runtime when `runtime` is omitted and writes `template_id`.
- `packages/api/src/graphql/resolvers/agents/setAgentSkills.mutation.ts` uses `agent_templates.skills` as the permission ceiling.
- `packages/api/src/lib/workspace-bootstrap.ts` confirms the current pattern: materialize at write time into the agent S3 prefix; runtime never reads Templates directly.
- `packages/agentcore-flue/agent-container/src/runtime/bootstrap-workspace.ts` confirms runtime does flat S3 sync of `tenants/<tenant>/agents/<agent>/workspace/`.

UI:

- `apps/computer/src/routes/_authed/_shell/spaces.*`, `apps/computer/src/components/ComputerSidebar.tsx`, and `apps/computer/src/lib/graphql-queries.ts` already expose Spaces, but the shape needs to be rewritten around contextual workrooms.
- The Codex sidebar screenshot provides the preferred information architecture direction: global actions, pinned threads, collapsible Space/work areas, and recent threads.
- `apps/admin/src/routes/_authed/_tenant/spaces/$spaceId.tsx` is collaboration/workflow-shaped: Threads, Agents, Checklist, Members, Integrations, Config.
- `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.$tab.tsx` contains reusable Template editor affordances: workspace, MCP servers, tool toggles, Company Brain/context settings, model/runtime/guardrail fields.

Institutional learnings:

- `docs/solutions/architecture-patterns/workspace-skills-load-from-copied-agent-workspace-2026-04-28.md` says editable skills load from copied workspace files and built-in tools must not be disguised as workspace skills.
- `docs/solutions/design-patterns/gitkeep-materialization-s3-empty-folders-2026-05-13.md` is relevant when Space source folders are authored through `WorkspaceEditor`.
- `docs/solutions/conventions/admin-trim-ui-preserve-backend-mutations-2026-05-13.md` warns to avoid coupling UI removal with backend removal unless remaining callers are audited.

## Target Architecture

```text
Tenant
  ├─ default Space
  ├─ Finance Space
  └─ Engineering Space

Agent: sql-agent
  ├─ durable runtime fields
  ├─ durable local workspace
  └─ availability rules

Thread
  ├─ tenant_id
  ├─ space_id
  └─ messages / turns

Turn
  ├─ agent_id
  ├─ thread_id
  ├─ space_id
  └─ effective context
       agent baseline
       + current Space workspace/data/tools/MCP/policy
       + relevant thread history
```

Recommended S3/source model:

- Agent source: `tenants/<tenant>/agents/<agent>/source/`
- Space source: `tenants/<tenant>/spaces/<space>/source/`
- Rendered turn workspace or context packet: generated from agent source plus current Space source.
- Existing runtime workspace prefix may still be used as the generated output target when that is the least disruptive path.

## Key Decisions

### D1. Hard cut Templates

Templates are removed from schema, API, UI, generated clients, and runtime assumptions. No hidden `template_id` compatibility layer remains after migration.

### D2. Spaces are contextual workrooms

Spaces keep a user-facing room/channel flavor, but their durable product job is context: files, tools, connected data, MCP, policies, and relevant conversation history.

### D3. Agent in Space, not Agent from Space

Agents are not created from Spaces and do not inherit durable identity from Spaces. A Space influences effective context for a turn.

### D4. Preserve thread-to-Space association, but remove legacy baggage

`threads.space_id` should remain or be reintroduced as an optional/clear workroom association if implementation finds it has already been removed. What should go away is the old required-room machinery, checklist coupling, and workflow-specific semantics that make every Space a customer onboarding room.

### D5. Admin configuration and user navigation are separate surfaces

The user app gets a Codex-like sidebar and thread navigation. Admin gets Space Studio. The two surfaces share the same Space entity but expose different affordances.

### D6. Most-restrictive policy wins

Effective turn tools are the union of agent baseline and Space grants. Restrictions compose restrictively. Irreconcilable conflicts block rendering/invocation with an operator-visible error.

## Sequencing Overview

1. Reconcile thread-space coupling around contextual workrooms.
2. Rebuild `apps/computer` Space navigation around a Codex-like sidebar.
3. Recast Space schema/API from workflow rooms to contextual workrooms.
4. Add direct Agent runtime and policy fields.
5. Backfill Templates into Agents and Spaces.
6. Build effective turn context rendering.
7. Remove Template API/schema/UI.
8. Replace admin Space UI with Space Studio.
9. Update agent admin UI around direct runtime fields and Space availability.
10. Repair Computers/evals/runtime manifests and generated clients.

## Implementation Units

### U1. Reconcile thread-space coupling for contextual workrooms

**Goal:** Convert old thread-space ownership into a clean workroom association.

**Requirements:** R4, R7, R12, R26

**Files:**

- `packages/database-pg/src/schema/threads.ts`
- `packages/database-pg/src/schema/thread-participants.ts`
- `packages/database-pg/src/schema/linked-tasks.ts`
- `packages/database-pg/graphql/types/threads.graphql`
- `packages/database-pg/graphql/types/linked-tasks.graphql`
- `packages/api/src/graphql/resolvers/threads/createThread.mutation.ts`
- `packages/api/src/graphql/resolvers/threads/threadsPaged.query.ts`
- `packages/api/src/graphql/resolvers/threads/types.ts`
- `packages/api/src/graphql/resolvers/messages/sendMessage.mutation.ts`
- `packages/api/src/lib/thread-helpers.ts`
- `packages/database-pg/src/lib/thread-helpers.ts`
- `packages/api/src/lib/brain/draft-review-writeback.ts`
- `packages/api/src/lib/slack/thread-mapping.ts`
- `packages/api/src/lib/linked-tasks/sync.ts`
- `packages/lambda/src/job-trigger.ts`
- `apps/computer/src/lib/graphql-queries.ts`
- `apps/admin/src/lib/graphql-queries.ts`

**Approach:**

Use `docs/plans/2026-05-20-002-fix-decouple-threads-from-spaces-plan.md` as an inventory, not as literal instructions.

Keep or restore a clear `Thread.spaceId` association for user workrooms. Remove the parts that are no longer valid:

- mandatory default Space lookup just to create any thread in low-level helpers
- trigger/check constraints that assume every thread must live in a legacy collaboration Space
- `linked_tasks.space_id`, `linked_task_events.space_id`, and `linked_tasks.checklist_item_id` if those only exist for customer onboarding workflow coupling
- wakeup payload assumptions that pass `spaceId` without using it for effective context

Thread listing should support:

- tenant-level/global recent threads
- threads scoped to a Space
- pinned threads independent of Space if the product supports global pins

**Tests:**

- `packages/database-pg/__tests__/thread-participants-schema.test.ts`
- `packages/database-pg/__tests__/linked-tasks-schema.test.ts`
- `packages/api/src/graphql/resolvers/threads/createThread.space.test.ts`
- `packages/api/src/graphql/resolvers/threads/threadsPaged.query.test.ts`
- `packages/api/src/graphql/resolvers/threads/types.test.ts`
- `packages/api/src/graphql/resolvers/messages/sendMessage.mutation.test.ts`
- `apps/computer/src/lib/graphql-queries.test.ts`

**Verification:**

- Creating a thread in a selected Space succeeds.
- Creating a tenant/global thread either assigns `default` Space at the API boundary or leaves `spaceId` null according to the final schema decision.
- Listing threads by Space returns only that Space's threads.
- Linked task schema no longer depends on Space checklist items unless a deliberate workflow model remains.

### U2. Rebuild `apps/computer` Space sidebar and routes

**Goal:** Make Spaces a first-class end-user workroom surface inspired by the Codex sidebar.

**Requirements:** R7, R12, R26, AE8

**Files:**

- `apps/computer/src/components/ComputerSidebar.tsx`
- `apps/computer/src/lib/computer-routes.ts`
- `apps/computer/src/lib/graphql-queries.ts`
- `apps/computer/src/routes/auth/callback.tsx`
- `apps/computer/src/routes/_authed/_shell/spaces.index.tsx`
- `apps/computer/src/routes/_authed/_shell/spaces.$spaceId.tsx`
- `apps/computer/src/routes/_authed/_shell/spaces.$spaceId.threads.$threadId.tsx`
- `apps/computer/src/routes/_authed/_shell/-spaces-route.test.tsx`
- `apps/computer/src/components/spaces/*`
- `apps/computer/src/routeTree.gen.ts`

**Approach:**

Replace the existing Space UI with a calmer sidebar model:

- Top global actions: New chat, Search, optional Plugins/Automations if those exist in the product.
- Pinned section: globally pinned threads or important workrooms.
- Spaces section: collapsible Spaces with recent threads under each Space.
- Default Space visible but not noisy.
- Active thread highlighted.
- New thread can be created globally or inside a selected Space.

If `MentionMenu` lives under `components/spaces` but is actually general mention UI, move it to a neutral path such as `components/mentions/MentionMenu.tsx`.

**Tests:**

- `apps/computer/src/routes/_authed/_shell/-spaces-route.test.tsx`
- `apps/computer/src/lib/graphql-queries.test.ts`
- Sidebar/component tests if a harness exists.

**Verification:**

- User can open a Space and see its recent threads.
- User can start a thread in a Space.
- User can mention an available agent in a Space.
- The layout matches the Codex-sidebar direction: global actions, pinned, collapsible Space sections, recent threads.

### U3. Recast Space schema/API as contextual workrooms

**Goal:** Keep Spaces as workrooms while removing customer-onboarding/checklist/template baggage.

**Requirements:** R4, R7-R13, R26-R27

**Files:**

- `packages/database-pg/src/schema/spaces.ts`
- `packages/database-pg/graphql/types/spaces.graphql`
- `packages/api/src/graphql/resolvers/spaces/*`
- `packages/api/src/graphql/utils.ts`
- `packages/database-pg/drizzle/NNNN_recast_spaces_as_contextual_workrooms.sql`
- `packages/database-pg/src/schema/mcp-servers.ts`

**Approach:**

Keep the base `spaces` table identity, slug/name/status, and user-visible workroom role. Rewrite comments and GraphQL descriptions around contextual workrooms.

Remove or remodel:

- checklist templates/items if they are customer-onboarding-specific
- workflow integrations that make every Space an onboarding workflow
- member semantics if user access is tenant/team-scoped instead
- unread counts if they are tied to old membership behavior rather than thread activity

Add or expose:

- purpose/description
- icon/category
- context config
- connected data
- tool policy
- MCP bindings
- agent availability
- render/invocation diagnostics

**Tests:**

- `packages/api/src/__tests__/graphql-contract.test.ts`
- Existing resolver tests under `packages/api/src/graphql/resolvers/spaces/`
- New Space CRUD, thread listing, and agent availability resolver tests.

**Verification:**

- GraphQL describes Spaces as contextual workrooms.
- End-user queries can list Spaces and Space threads.
- Admin queries can configure workspace/data/tools/MCP/agent availability.

### U4. Add direct Agent runtime and policy fields

**Goal:** Make Agents self-contained for durable runtime/operational configuration before deleting Template dependencies.

**Requirements:** R1-R2, R5-R6, R19-R22, AE1

**Files:**

- `packages/database-pg/src/schema/agents.ts`
- `packages/database-pg/graphql/types/agents.graphql`
- `packages/api/src/graphql/resolvers/agents/createAgent.mutation.ts`
- `packages/api/src/graphql/resolvers/agents/updateAgent.mutation.ts`
- `packages/api/src/graphql/resolvers/agents/types.ts`
- `packages/api/src/graphql/resolvers/agents/runtime.ts`
- `packages/api/src/lib/resolve-agent-runtime-config.ts`
- `apps/admin/src/components/agents/AgentFormDialog.tsx`
- `packages/database-pg/drizzle/NNNN_agents_own_runtime_fields.sql`

**Approach:**

Add direct columns for runtime fields currently carried by Templates:

- `model`
- `guardrail_id`
- `blocked_tools`
- `sandbox`
- `browser`
- `web_search`
- `send_email`
- `context_engine`
- any budget/policy fields not already direct

Update `CreateAgentInput` and `UpdateAgentInput` to remove `templateId` and accept direct runtime/ops fields. Stop falling back to `agentTemplates.runtime`.

**Tests:**

- `packages/api/src/graphql/resolvers/agents/createAgent.mutation.test.ts`
- `packages/api/src/graphql/resolvers/agents/updateAgent.mutation.test.ts`
- `packages/api/src/lib/resolve-agent-runtime-config.test.ts`

**Verification:**

- Creating an agent without `templateId` succeeds.
- Agent runtime config resolution does not join `agent_templates`.

### U5. Migrate Templates into Agents and Spaces

**Goal:** Preserve existing behavior while deleting Template as a live concept.

**Requirements:** R3, R21-R25, AE1, AE2, AE7

**Files:**

- `packages/database-pg/drizzle/NNNN_migrate_templates_to_agents_and_spaces.sql`
- `packages/database-pg/drizzle/NNNN_drop_agent_templates.sql`
- `packages/api/src/lib/spaces/default-space.ts`
- `packages/api/src/lib/spaces/template-migration.ts`
- `packages/api/src/lib/workspace-bootstrap.ts`
- `packages/api/src/lib/pinned-versions.ts`
- `packages/database-pg/src/schema/agent-templates.ts`
- `packages/database-pg/src/schema/agents.ts`
- `packages/database-pg/src/schema/spaces.ts`
- `packages/database-pg/src/schema/mcp-servers.ts`

**Approach:**

Backfill:

- Create a tenant `default` Space for every tenant if missing.
- Copy Template runtime fields onto each linked Agent.
- Convert meaningful non-default Template context into Spaces.
- Convert Template/default workspace files into Space source files.
- Convert `agent_template_mcp_servers` rows into Space-level MCP bindings.
- Convert Template skills, knowledge base IDs, and built-in tool toggles into Space context configuration.
- Preserve migration provenance in metadata.

Do not model migrated Spaces as parents of agents. Instead, make relevant agents available in those Spaces or preserve compatibility metadata for operator review.

S3 migration must be idempotent and separate from SQL.

**Tests:**

- `packages/database-pg/__tests__/agent-template-removal-schema.test.ts`
- `packages/api/src/__tests__/workspace-bootstrap.test.ts`
- `packages/api/src/__tests__/workspace-files-handler.test.ts`
- New `packages/api/src/lib/spaces/template-migration.test.ts`
- New `packages/api/src/lib/spaces/default-space.test.ts`

**Verification:**

- Every tenant has `default`.
- Existing agents have direct runtime fields.
- Template workspace files are available as Space source files.
- No final FK references `agent_templates`.

### U6. Build effective turn context rendering

**Goal:** Compose agent baseline plus current Space into deterministic runtime context for each Space turn.

**Requirements:** R12-R20, AE3-AE5

**Files:**

- `packages/api/src/lib/workspace-bootstrap.ts`
- `packages/api/src/lib/workspace-map-generator.ts`
- `packages/api/src/lib/workspace-manifest.ts`
- `packages/api/src/lib/workspace-renderer.ts` (new)
- `packages/api/src/lib/turn-context-renderer.ts` (new)
- `packages/api/src/lib/workspace-policy.ts` (new)
- `packages/api/src/lib/agent-snapshot.ts`
- `packages/api/src/lib/context-engine/providers/workspace-files.ts`
- workspace files Lambda handler
- `packages/agentcore-flue/agent-container/src/runtime/bootstrap-workspace.ts`
- `packages/agentcore-strands/agent-container/server.py` only if the runtime must accept a new context packet shape.

**Approach:**

Renderer inputs:

- agent source files
- current Space source files
- Space tool/MCP/data bindings
- agent runtime/policy fields
- thread/turn metadata

Renderer outputs:

- agent-local files at runtime root
- current Space files under `spaces/<space-slug>/`
- generated root map
- effective tool/policy manifest
- render diagnostics/provenance

The renderer should not permanently copy Space context into the agent's durable source. It may write generated output to the existing agent runtime prefix if that is the least disruptive runtime path.

**Tests:**

- `packages/api/src/__tests__/workspace-files-handler.test.ts`
- `packages/api/src/__tests__/workspace-bootstrap.test.ts`
- New `packages/api/src/lib/turn-context-renderer.test.ts`
- New `packages/api/src/lib/workspace-policy.test.ts`

**Verification:**

- Mentioning `@sql-agent` in Finance produces a runtime context with `spaces/finance/`.
- Mentioning the same agent in Engineering produces Engineering context instead.
- Agent-local identity files remain unchanged.
- Policy conflicts block invocation or surface validation.

### U7. Remove Template GraphQL/API/resolver surface

**Goal:** Delete Template product APIs after replacements exist.

**Requirements:** R1, R21-R25, R28-R29

**Files:**

- `packages/database-pg/graphql/types/agent-templates.graphql`
- `packages/api/src/graphql/resolvers/templates/*`
- `packages/api/src/graphql/resolvers/agents/acceptTemplateUpdate.mutation.ts`
- `packages/api/src/graphql/resolvers/agents/agentPinStatus.query.ts`
- `packages/api/src/graphql/resolvers/runtime/runtimeManifestsByTemplate.query.ts`
- `packages/api/src/graphql/resolvers/evaluations/index.ts`
- `packages/api/src/lib/templates/*`
- `packages/admin-ops/src/templates.ts`
- `packages/admin-ops/src/agents.ts`
- GraphQL codegen outputs in `apps/admin`, `apps/mobile`, `apps/cli`, `packages/api`

**Approach:**

Remove Template types, queries, mutations, sync diff types, create-from-template flows, sync flows, and Template update acceptance. Recast pin/update behavior as Space source/render impact, not Template sync.

**Tests:**

- Delete or replace `packages/api/src/__tests__/templates-authz.test.ts`.
- Delete or replace `packages/api/src/__tests__/accept-template-update.test.ts`.
- Update `packages/api/src/__tests__/runtime-manifests-resolvers.test.ts`.
- Update `packages/api/src/__tests__/graphql-contract.test.ts`.

**Verification:**

- GraphQL schema has no Template query/mutation/type.
- API typecheck passes without `agent_templates` imports.

### U8. Replace admin Space UI with Space Studio

**Goal:** Replace the collaboration/workflow admin UI with context/tool/data configuration.

**Requirements:** R8-R13, R19-R20, AE6

**Files:**

- `apps/admin/src/routes/_authed/_tenant/spaces/index.tsx`
- `apps/admin/src/routes/_authed/_tenant/spaces/$spaceId.tsx`
- `apps/admin/src/routes/_authed/_tenant/spaces/$spaceId.$tab.tsx` if introduced
- `apps/admin/src/routes/_authed/_tenant/agent-templates/*`
- `apps/admin/src/components/agent-builder/WorkspaceEditor.tsx`
- `apps/admin/src/components/spaces/*`
- `apps/admin/src/lib/graphql-queries.ts`
- `apps/admin/src/components/Sidebar.tsx`

**Approach:**

Delete `/agent-templates` admin routes and replace old Space detail tabs with:

- Overview
- Workspace
- Connected Data
- Tools
- MCP Servers
- Agents
- Settings

Do not carry forward Threads, Checklist, Members, or Integrations as admin configuration tabs unless they are explicitly redesigned for contextual workrooms.

Reuse Template editor pieces by extracting neutral components:

- Template Workspace -> Space Workspace
- Template MCP Servers -> Space MCP Servers
- Template built-in toggles -> Space Tools
- Template Company Brain/context setting -> Space Connected Data

**Tests:**

- Admin route/component tests if existing.
- GraphQL query tests if present.
- Admin typecheck.

**Verification:**

- Admin `/spaces` configures context/tool/data/MCP/agent availability.
- No `/agent-templates` navigation or route remains.

### U9. Update admin Agent UI for direct runtime fields and Space availability

**Goal:** Make Agent creation/editing match Agent-in-Space.

**Requirements:** R2, R5-R6, R12-R13

**Files:**

- `apps/admin/src/components/agents/AgentFormDialog.tsx`
- `apps/admin/src/routes/_authed/_tenant/agents/$agentId.tsx`
- `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.skills.tsx`
- `apps/admin/src/routes/_authed/_tenant/agents/*`
- `apps/admin/src/lib/graphql-queries.ts`
- `packages/api/src/graphql/resolvers/agents/*`
- `packages/api/src/graphql/resolvers/spaces/*`

**Approach:**

Remove Template dropdowns from Agent create/edit. Replace with:

- Agent name/role/capability metadata.
- Runtime/model/guardrail/budget fields.
- Space availability panel.
- Local workspace editor for agent source files.

Agent pages should show which Spaces can invoke the agent. Space pages should show which agents are available in the Space.

**Tests:**

- `packages/api/src/graphql/resolvers/agents/createAgent.mutation.test.ts`
- `packages/api/src/graphql/resolvers/agents/updateAgent.mutation.test.ts`
- Space assignment/availability resolver tests.

**Verification:**

- New agent creation does not require Template selection.
- Admin can make an agent available in a Space.
- End-user mention UI respects availability.

### U10. Repair Computers, evals, runtime manifests, and operational callers

**Goal:** Remove remaining non-agent Template dependencies.

**Requirements:** R1, R28-R29

**Files:**

- `packages/database-pg/src/schema/computers.ts`
- `packages/database-pg/graphql/types/computers.graphql`
- `packages/api/src/graphql/resolvers/computers/createComputer.mutation.ts`
- `packages/api/src/graphql/resolvers/computers/updateComputer.mutation.ts`
- `packages/api/src/graphql/resolvers/templates/computerTemplates.query.ts`
- `apps/admin/src/components/computers/ComputerFormDialog.tsx`
- `packages/database-pg/src/schema/evaluations.ts`
- `packages/database-pg/graphql/types/evaluations.graphql`
- `packages/api/src/graphql/resolvers/evaluations/index.ts`
- `packages/api/src/lib/evals/eval-agent-provisioning.ts`
- `packages/api/src/graphql/resolvers/runtime/runtimeManifestsByTemplate.query.ts`
- `packages/api/src/lib/agent-snapshot.ts`

**Approach:**

Computers:

- Replace `computers.template_id` with direct Computer defaults, `primary_agent_id`, or default Space behavior depending on the caller.
- Remove `computerTemplates` query.

Evaluations:

- Replace `agent_template_id` with an explicit agent, runtime config snapshot, or Space set.

Operational callers:

- Audit `packages/admin-ops`, CLI commands, bootstrap user flows, seed flows, and eval worker paths.
- Replace "default template" bootstrap with `default` Space plus direct agent defaults.

**Tests:**

- `packages/api/src/graphql/resolvers/computers/createComputer.mutation.test.ts`
- `packages/api/src/graphql/resolvers/computers/updateComputer.mutation.test.ts`
- `packages/api/src/lib/evals/eval-agent-provisioning.test.ts`
- `packages/api/src/__tests__/runtime-manifests-resolvers.test.ts`

**Verification:**

- Computers can be created without Template records.
- Evals can run without `agent_template_id`.

### U11. Generated clients, docs, and stale-plan cleanup

**Goal:** Finish the hard cut across generated code, docs, and plan breadcrumbs.

**Requirements:** R1, R25-R29

**Files:**

- `apps/admin/src/gql/*`
- `apps/mobile/src/gql/*`
- `apps/cli/src/gql/*`
- `packages/api/src/generated/*` if present
- `terraform/schema.graphql`
- `docs/brainstorms/2026-05-19-spaces-collaborative-user-app-ui-requirements.md`
- Related `docs/plans/2026-05-19-*spaces*`
- `docs/plans/2026-05-20-002-fix-decouple-threads-from-spaces-plan.md`

**Approach:**

Run codegen for every consumer with a `codegen` script after GraphQL changes:

- `apps/cli`
- `apps/admin`
- `apps/mobile`
- `packages/api`

Update stale Space docs so they point to contextual workrooms. Keep `docs/plans/2026-05-20-002-fix-decouple-threads-from-spaces-plan.md` marked superseded, with an added note that it is an inventory rather than an implementation plan under the new direction.

**Tests:**

- `pnpm schema:build`
- `pnpm -r --if-present typecheck`
- Focused package tests from prior units.

**Verification:**

- No generated clients expose Template operations.
- Stale Space docs are not marked active without supersession notes.

## Migration Strategy

Use a staged hard cut:

1. Add new Agent/Space fields and Space workroom semantics.
2. Backfill direct Agent fields and Space rows while Templates still exist.
3. Migrate Template/default workspace source into Space source and agent source.
4. Update API/UI to use Agents and Spaces only.
5. Regenerate clients and verify no live Template consumers.
6. Drop Template FKs/tables/GraphQL/API/UI.

Rollback posture:

- Before final Template drop, rollback can point API/UI back to Templates if necessary.
- After final Template drop, rollback is database restore or forward-fix only.
- S3 migration must be idempotent and preserve source provenance.

## Risk Register

| Risk                                                                             | Mitigation                                                                                          |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Space becomes an overloaded noun again                                           | Keep the crisp rule: Space is where work happens and what context applies; Agent is who acts        |
| Old thread-space decoupling work removes a relationship now needed for workrooms | Treat plan `002` as inventory only; preserve clean `Thread.spaceId`                                 |
| Dropping Templates before all consumers are removed breaks generated clients     | Gate final drop on `rg` audit plus full GraphQL codegen/typecheck                                   |
| S3 migration overwrites tenant-authored workspace edits                          | Use source/rendered separation and preserve-existing behavior                                       |
| Runtime sees stale Space context                                                 | Render effective turn context on invocation or invalidate generated context on Space source changes |
| Sidebar becomes visually noisy                                                   | Follow Codex-like grouping: global actions, pinned, collapsible Spaces, recent threads              |
| Space policy silently weakens agent baseline                                     | Centralize effective policy composition and use most-restrictive-wins                               |

## Test Plan

Run focused tests per unit first, then final gates:

- `pnpm --filter @thinkwork/database-pg test`
- `pnpm --filter @thinkwork/api test`
- `pnpm --filter @thinkwork/admin typecheck`
- `pnpm --filter @thinkwork/computer typecheck`
- `pnpm --filter @thinkwork/mobile codegen`
- `pnpm --filter @thinkwork/cli codegen`
- `pnpm schema:build`
- `pnpm -r --if-present typecheck`
- `pnpm db:migrate-manual` after hand-rolled migrations are applied to dev

Manual verification:

- User can navigate Spaces in the Computer app via a Codex-like sidebar.
- User can start a Space thread and mention an available agent.
- The invoked agent receives agent baseline plus current Space context.
- Admin can configure Space workspace, connected data, tools, MCP, and agent availability.
- Agents can be created and operated without Templates.

## Open Implementation Questions

- Should `threads.space_id` be required with a default Space, or nullable for global threads? Preferred: required at the user/API boundary with default Space fallback, but not enforced by low-level helper magic.
- Should Space source render into the existing agent workspace prefix per invocation, or pass as an explicit turn context packet? Preferred: use existing prefix first if runtime changes would be large.
- Are Space members needed in v1, or is tenant/team access enough? Preferred: avoid per-Space membership until a real permission case appears.
- Should migrated non-default Templates automatically make their former agents available in the created Space, or require admin review? Preferred: make available but surface migration provenance.
- How much of customer onboarding/checklist remains inside Spaces? Preferred: only keep what clearly supports contextual workrooms.

## Handoff Notes

Recommended first implementation slice:

1. U1 and U2 together: establish the workroom thread model and sidebar.
2. U3-U6: establish Space context and Template migration foundations.
3. U7-U11: remove Template surfaces and clean dependent systems.

Do not start by deleting `apps/computer` Spaces. Under this direction, the end-user Space surface is part of the product, not a leftover.
