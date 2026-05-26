---
date: 2026-05-21
topic: admin-space-studio-simplification
status: superseded
superseded_by: docs/brainstorms/2026-05-26-admin-spaces-ui-cleanup-requirements.md
---

# Admin Space Studio Simplification

## Problem Frame

The admin Spaces surface has the right underlying direction, but the UI still exposes older implementation concepts: `kind`, counts for configuration internals, split Connected Data / Tools / MCP tabs, `slug`, raw JSON config, and workflow-era settings. Operators need Space configuration to feel like a small product surface: name the Space, choose access, manage workspace files, choose knowledge bases, choose tools, and see the Space's scheduled or webhook-driven automations.

This brainstorm inherits the current product model from `docs/brainstorms/2026-05-20-spaces-as-agent-context-modules-template-removal-requirements.md`: **Agent = who acts; Space = where the agent acts; Turn = Agent + Space + Thread + request.** It narrows that model into a cleaner admin Space Studio UI.

---

## Actors

- A1. Tenant admin: configures Spaces and wants quick, low-ambiguity controls.
- A2. Agent runtime / context renderer: consumes Space workspace, memory, tool, MCP, and automation choices during work.
- A3. Planner / implementer: translates this UI cleanup into API, data model, and migration work without preserving old workflow-era concepts by accident.

---

## Key Flows

- F1. Configure a Space

  - **Trigger:** A tenant admin opens a Space from the Spaces list.
  - **Actors:** A1
  - **Steps:** The detail page lands on Configuration. The admin edits the Space name, description, and access mode. Internal identifiers, raw JSON, category, trigger config, and diagnostic/config blocks are not visible.
  - **Outcome:** The Space's human-facing configuration is clear and saveable without exposing implementation metadata.
  - **Covered by:** R4, R6, R7

- F2. Attach context to a Space

  - **Trigger:** A tenant admin wants the Space to affect future agent turns.
  - **Actors:** A1, A2
  - **Steps:** The admin uses Workspace for files, Memory for knowledge-base selection, and Tools for built-in tools plus MCP server selection.
  - **Outcome:** Future Space-scoped work has the selected files, knowledge bases, built-in tools, and MCP servers available according to policy.
  - **Covered by:** R5, R8, R9, R10

- F3. Review Space automations
  - **Trigger:** A tenant admin opens the Space Automations tab.
  - **Actors:** A1
  - **Steps:** The admin sees scheduled jobs and webhooks in one table filtered to this Space. Type, status, schedule or trigger, last run, and next run / delivery state make the small set of entries scannable.
  - **Outcome:** Space-specific recurring work and inbound triggers are managed together instead of scattered across multiple tabs.
  - **Covered by:** R11, R12, R13

---

## Requirements

**Global terminology and navigation**

- R1. The admin navigation label currently framed as "Skills and Tools" becomes "Tools" everywhere user-visible in the admin app.
- R2. The Tools navigation icon changes to Lucide's `PocketKnife` icon.

**Spaces list**

- R3. The Spaces list page removes the subtitle under the "Spaces" heading.
- R4. The Spaces table only shows columns that help select or triage a Space: Space, Access, Status, and Updated. The Kind, Agents, MCP, Tools, and Connected Data columns are removed.

**Space detail information architecture**

- R5. Space detail tabs appear in this exact order: Configuration, Workspace, Tools, Memory, Automations.
- R6. The base Space detail route opens Configuration by default.
- R7. Configuration is a friendly edit surface for the Space's human-facing settings only: name, description, and access. It does not show slug, category/kind, status metadata, created timestamp, raw config, context config, connected data config, agent availability policy, trigger config, or render diagnostics.

**Memory**

- R8. Memory is knowledge bases only for this pass. The tab uses a multi-select control to choose one or more tenant knowledge bases for the Space.
- R9. The Memory tab does not expose Hindsight memory, wiki pages, raw source context, namespaces, adapter JSON, or future memory-resource types. Those are deferred until the product has a clearer resource model.

**Tools**

- R10. Tools is one simple selection page with two multi-select groups: built-in tools and MCP servers. It replaces the current split between Tools and MCP Servers and avoids raw policy JSON.

**Automations and webhooks**

- R11. Automations is a unified Space-scoped table that includes both scheduled automations and webhooks, filtered to the current Space.
- R12. The unified table distinguishes entries by Type, with schedule-like rows and webhook-like rows sharing common columns where possible: Name, Type, Schedule / Trigger, Status, Last Run, and Next Run / Last Delivery.
- R13. Space automations are framed around Space outcomes, not generic agent plumbing. A representative automation is: every morning at 6am, inspect Space work for blocking tasks and email the responsible user or team.

**Data model cleanup**

- R14. Product-obsolete Space fields should stop being first-class admin concepts. Planning must audit remaining callers before deleting database fields, but the target state should not preserve old workflow-era baggage only because the current UI happens to display it.
- R15. Slug and other internal identifiers may remain as internal routing or compatibility fields when needed, but they are not operator-facing configuration.

---

## Acceptance Examples

- AE1. **Covers R1, R2.** Given an admin opens the main navigation, the relevant item reads "Tools" and renders the `PocketKnife` icon, with no visible "Skills and Tools" label.
- AE2. **Covers R3, R4.** Given the Spaces list has several Spaces, the page header has no descriptive subtitle and the table headers are Space, Access, Status, and Updated.
- AE3. **Covers R5, R6, R7.** Given an admin opens `/spaces/:spaceId`, the page lands on Configuration and shows editable name, description, and access controls only. It does not show slug, raw config, trigger config, or internal metadata panels.
- AE4. **Covers R8, R9.** Given the tenant has knowledge bases, the Memory tab lets the admin select multiple knowledge bases. No other memory source type appears.
- AE5. **Covers R10.** Given the admin opens Tools, built-in tools and MCP servers are chosen from two multi-select groups on the same page. The page does not render raw tool or MCP policy JSON.
- AE6. **Covers R11, R12, R13.** Given a Space has one webhook and one 6am blocking-task automation, the Automations tab shows both rows in the same table with distinct Type values and useful run/delivery status.

---

## Success Criteria

- Admin Spaces feels like configuring a workroom, not inspecting a database row.
- A planner can proceed without inventing tab order, list columns, memory scope, tool grouping, or whether webhooks belong with automations.
- Removed UI does not imply unsafe blind database deletion; planning carries the audit explicitly.

---

## Scope Boundaries

- No end-user Spaces app changes are included here.
- No general memory resource model beyond knowledge bases is included.
- No new automation builder UX is required beyond showing and filtering Space-scoped scheduled jobs and webhooks.
- No LastMile checklist/customer-onboarding workflow revival is included.
- No raw JSON editor or advanced policy inspector belongs in the default Space detail UI.
- Database removal is not a UI-only decision; fields can be removed only after planning verifies there are no remaining API, runtime, migration, seed, or compatibility callers.

---

## Key Decisions

- Use a unified Automations table for schedules and webhooks. The expected row count per Space is small, and one table keeps "things that cause Space work to happen" in one mental bucket.
- Keep Memory intentionally narrow: knowledge bases only. This makes the tab useful now while avoiding premature design of a generalized memory resource picker.
- Combine built-in tools and MCP servers under Tools. Operators choose capabilities; they should not have to understand the old split between tool policy and MCP policy to configure a Space.
- Remove internal metadata from Configuration. Slug, raw config, trigger config, and diagnostic fields are implementation concerns unless a specific support/debug workflow later earns an advanced view.
- Treat database deletion as a planning audit, not a brainstorm promise. The product target is cleanup, but the implementation must respect existing callers and migrations.

---

## Dependencies / Assumptions

- Existing admin pages for knowledge bases, built-in tools, MCP servers, scheduled jobs, and webhooks remain the canonical places to create those resources globally.
- Space detail configuration references or selects already-created resources; it does not need to author every resource inline.
- Existing Spaces data includes fields that may still be used by API or runtime code. Planning must verify before removing or migrating them.
- The current Spaces rearchitecture work remains active and is the source of truth for the broader Agent / Space / Turn model.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R8][Technical] Should Space knowledge-base assignment use a dedicated Space-to-KB association or a policy/config projection over existing knowledge-base records?
- [Affects R10][Technical] What is the cleanest API contract for built-in tool selection so the UI can avoid editing raw `toolPolicy` JSON?
- [Affects R11, R12][Technical] Should Space scoping be added directly to scheduled jobs and webhooks, or represented through a shared automation target model?
- [Affects R14][Technical] Which Space database fields are safe to remove, which should become internal-only, and which need a compatibility migration?

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
