---
date: 2026-05-09
topic: computer-customization-page
---

# Computer Customization Page — Connectors / Skills / Workflows

## Summary

A new `Customize` route in `apps/computer` lets a user browse a per-tenant catalog and toggle Connectors / Skills / Workflows on or off for their Computer. Toggles write to existing DB rows; a workspace renderer projects the active set onto the user's Computer EFS so the Strands runtime continues to read a flat declarative view at invocation. MCP servers fold under Connectors with a type badge; a 4th pill is not introduced.

---

## Problem Frame

`apps/computer` already exposes Computer / Tasks / Apps / Automations / Inbox in the sidebar, but offers the user no way to see or change which Connectors, Skills, or Workflows their Computer can use. Today those bindings are produced by template seeding plus admin-side tooling — invisible to the end user, and impossible to reason about from inside the product. Anyone wanting to know "what does my Computer have access to?" has no answer surface; anyone wanting to remove or add an integration has no path that does not require operator help.

The existing data model is split across many tables (`agent_skills`, `agent_mcp_servers`, `connectors`, `routines`, `tenant_mcp_servers`) that already model both catalog-style and bound-to-this-Computer state, but those distinctions are internal: from the user's seat, "give my Computer access to Slack" is one action whether the underlying row lives in `connectors` or `tenant_mcp_servers`. With enterprise scale (4 enterprises × 100+ agents × ~5 templates) imminent, the lack of an end-user customization surface forces every per-user variation back through admin or template work — a cost that grows linearly with users and prevents the product from feeling like the user's own Computer.

The Memory module already established a pattern for per-Computer settings rendered as header pill tabs (Brain / Pages / KBs); the Customize page is the second instance of that pattern, and Perplexity's Customization page provides a strong external visual reference for the segmented cards-with-categories layout.

---

## Actors

- A1. End user: opens `apps/computer` Customize page, browses available Connectors / Skills / Workflows for their tenant, toggles items on or off for their own Computer.
- A2. Tenant admin: seeds and curates the per-tenant catalog rows (out of v1 scope as a UI, in scope as the data shape).
- A3. ThinkWork Computer (Strands runtime): re-reads enabled bindings on next invocation via existing workspace bootstrap + `runtime_config` paths; sees customization through the projected workspace files.
- A4. apps/computer client: renders the Customize route, drives toggle mutations, optimistically updates Connected lists.

---

## Key Flows

- F1. User browses the Customize catalog
  - **Trigger:** A1 clicks "Customize" in the sidebar.
  - **Actors:** A1, A4.
  - **Steps:** Sidebar entry routes to `/customize` → page loads with the Connectors pill active by default → page fetches the user's Computer's currently-bound items and the per-tenant catalog for that pill → renders Discover / Connected / Available sections per the Perplexity-style layout, with a search box and a category filter at the top.
  - **Outcome:** User sees what their Computer has, and what is available to enable.
  - **Covered by:** R1, R2, R3, R5, R6, R8, R10.

- F2. User enables an item from the catalog
  - **Trigger:** A1 clicks a Connect / Enable action on a catalog card (e.g., a Connector card, a Skill card, a Workflow card).
  - **Actors:** A1, A4, A3.
  - **Steps:** Client fires the appropriate enable mutation → server inserts/updates the canonical row binding the catalog item to the user's Computer → workspace renderer regenerates the affected projected files on the user's Computer EFS → client refetches Connected list → next time A1 messages their Computer, the Strands runtime reads the new state at invocation.
  - **Outcome:** Item moves visibly from Available → Connected; the Computer can use it on the next turn.
  - **Covered by:** R4, R7, R11, R12, R13, R14.

- F3. User disables an item already bound to their Computer
  - **Trigger:** A1 toggles off an item shown in the Connected section.
  - **Actors:** A1, A4, A3.
  - **Steps:** Client fires the corresponding disable mutation → server soft-disables or removes the binding row → workspace renderer regenerates the projected files (item drops out) → client refetches Connected → on the next Computer turn, the runtime no longer sees the item.
  - **Outcome:** Item is no longer available to the Computer; remains discoverable in Available.
  - **Covered by:** R4, R7, R11, R12, R13.

- F4. User opens a Connector card backed by an MCP server
  - **Trigger:** A1 clicks a card on the Connectors pill that is fronted by an MCP server (e.g., a Slack MCP).
  - **Actors:** A1, A4.
  - **Steps:** Card renders with a "type: MCP" badge in addition to standard connector chrome → enabling triggers the MCP-server binding path (per-user OAuth handled by existing flows; this page does not own the OAuth UX) → on success, card flips to Connected.
  - **Outcome:** MCP servers are operable from the same surface as native connectors, without exposing the schema split to the user.
  - **Covered by:** R2, R6, R7.

---

## Requirements

**Page surface and navigation**

- R1. `apps/computer` exposes a new `Customize` route, accessible from the existing left sidebar, alongside Computer / Tasks / Apps / Automations / Inbox.
- R2. The Customize page uses a segmented pill control in its header (matching the Memory module's Brain / Pages / KBs visual pattern) with three pills in v1: Connectors, Skills, Workflows. There is no separate MCP Servers pill.
- R3. Within each pill tab, the layout follows the Perplexity-style structure: a page-level title and short description, a row of filter chips (e.g., Discover / All / Connected / Available), a category filter (e.g., "All categories"), a search box, and one or more category sections with horizontal cards and a "View all" affordance.
- R4. Each card shows at minimum: name, short description, an icon/avatar, type/category metadata, and a primary action (Connect / Enable / Disable / View) reflecting whether the item is currently bound to the user's Computer.

**Tabs and item types**

- R5. The Connectors pill renders both native connectors and MCP servers from the per-tenant catalog, unified into a single visual surface; MCP-backed cards carry a type badge so users can see the underlying mechanism without it driving the layout.
- R6. The Skills pill renders skills available to the user's Computer from the per-tenant catalog, surfaced as cards with the same Connect/Enable affordance.
- R7. The Workflows pill renders Workflows (backed by `routines`) available from the per-tenant catalog.

**Catalog source and binding**

- R8. The Customize page reads the **Connected** state per pill from the existing canonical tables — `agent_skills` / `agent_mcp_servers` / `connectors` / `routines` joined to the user's Computer — not from any new mirror.
- R9. The Customize page reads the **Available / Discover / Popular** state per pill from new per-tenant catalog tables introduced in this work; the catalog is real and per-tenant from day one, not a hard-coded stub.
- R10. The catalog is populated per tenant; v1 ships the schema and read path for the catalog tables. v1 does not require a tenant-admin UI for catalog management — seeding via migration or back-office tooling is acceptable for v1.

**Customization sink and projection**

- R11. Toggling a card writes to the canonical existing tables that already model the binding (`agent_skills`, `agent_mcp_servers`, `connectors`, `routines`); v1 does not introduce a parallel sink for the same state.
- R12. After a successful toggle, a workspace renderer projects the active set onto declarative files on the user's Computer EFS (e.g., the existing CAPABILITIES / SKILLS / MCP / workflow-related files the runtime already reads), so the Strands runtime continues to see customization through its current bootstrap + per-turn `runtime_config` paths without a new read mechanism.
- R13. Customization changes propagate to the agent on the next Computer invocation; v1 does not require an explicit restart or reload UX, and the renderer's job is to make the next workspace bootstrap reflect the change.
- R14. The Customize page edits exactly the caller's own Computer (the user's per-user Computer row); v1 has no controls for editing other users' Computers, templates, or tenant-wide defaults from this page.

**v1 user actions**

- R15. v1 supports browsing + enabling + disabling. "+ Custom connector / skill / workflow" actions may render as buttons on the page for visual completeness, but their authoring sub-flows are not in v1 scope; clicking them surfaces a non-blocking "coming soon" affordance rather than a working editor.
- R16. The page reflects the current Connected state via standard urql cache flow plus optimistic updates on toggle; v1 does not require live multi-client subscription updates on this page.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given the user has signed in to `apps/computer`, when they click "Customize" in the sidebar, then they land on the Customize route with the Connectors pill active, see Discover / Connected / Available filters and a search box, and see at least one category section with cards.
- AE2. **Covers R5, R6, R7.** Given the user's tenant has both native connectors and MCP servers in the catalog, when the user views the Connectors pill, then both render as cards in the same surface and only MCP-backed cards carry a type badge; switching to Skills shows skill cards and Workflows shows workflow cards.
- AE3. **Covers R4, R8, R11.** Given a connector exists in the tenant catalog and is not yet bound to the user's Computer, when the user clicks Connect, then a binding row is created in the canonical table, the card moves from Available to Connected, and the card's primary action flips to Disable.
- AE4. **Covers R12, R13.** Given the user has just enabled a skill, when the user next sends a message to their Computer, then the Strands runtime sees the skill at invocation through the projected workspace files (no manual restart was required).
- AE5. **Covers R6, R7, R11.** Given a skill is currently in the user's Computer's Connected list, when the user toggles it off, then the canonical binding is removed or soft-disabled, the card moves to Available, and a subsequent Computer invocation no longer surfaces that skill.
- AE6. **Covers R14.** Given another user in the same tenant has their own Computer, when the caller toggles items on their Customize page, then the other user's Computer bindings are unchanged.
- AE7. **Covers R15.** Given a "+ Custom connector" button is present, when the user clicks it in v1, then they see a non-blocking "coming soon" affordance and no authoring editor opens.

---

## Success Criteria

- A user opening `apps/computer` can see, on the Customize page, a complete and accurate picture of which Connectors / Skills / Workflows their Computer currently has — without operator help.
- A user can enable and disable items from the catalog and observe the change reflected on their next Computer turn (the Computer can or cannot use the item, matching the toggle).
- The Computer's Strands runtime continues to read customization through its existing workspace + `runtime_config` paths; no new runtime-side read mechanism is required.
- The catalog tables are per-tenant and authoritative, so two tenants with different installed Connectors / Skills / Workflows see different Available cards on the same UI build.
- A downstream `ce-plan` agent can sequence implementation against this doc without inventing the catalog table shape rationale, the canonical-vs-projection split, the action scope (browse + toggle, no authoring), or the MCP fold-under-Connectors decision.

---

## Scope Boundaries

- A 4th MCP Servers pill on the Customize page — MCP folds into Connectors with a type badge.
- Custom-authoring sub-flows in v1 (custom connector wizard, skill markdown editor, workflow ASL paste/visual editor) — buttons may stub, content does not ship.
- A tenant-admin UI in `apps/admin` for managing per-tenant catalog rows — out of v1 unless explicitly pulled back in; assume seed migrations or back-office tooling for catalog population in v1.
- A public/shared catalog or marketplace beyond per-tenant rows (cross-tenant catalog sharing, public connectors directory).
- Cross-Computer or template-level customization edits from this page — Customize edits exactly one user's Computer.
- Live multi-client subscription updates on the Customize page (real-time push of toggle state changes from other clients).
- Mobile parity — Customize is web-only in v1, consistent with `apps/computer` as the web Computer surface.
- Surfacing generated Apps / applets on this page — they continue to live in the existing Apps tab.
- Replacing or merging the existing Automations route — Workflows tab here reads/toggles `routines` rows but does not subsume the Automations page's responsibilities.
- Authoring or editing OAuth flows on this page — MCP cards trigger existing per-user OAuth paths (mobile-driven today); the Customize page is not the OAuth UX owner in v1.
- Surfacing Computer-level budget, model, or guardrail customization — those belong to other surfaces and are not part of this page in v1.

---

## Key Decisions

- **Customize is browse + toggle, not authoring, in v1.** Rationale: shipping the page itself is the unblocking move; authoring sub-flows multiply the surface area and can land independently behind their respective + buttons later.
- **Toggles write existing canonical tables; a workspace renderer projects to EFS.** Rationale: the existing tables already model the bindings (`agent_skills`, `agent_mcp_servers`, `connectors`, `routines`) and the Strands runtime already reads workspace files plus `runtime_config` per turn — adding a parallel sink would fork state without removing either reader. The renderer is the single seam between structured DB state and the prompt-readable view the agent already expects.
- **Per-tenant catalog tables from day one — no static stub.** Rationale: enterprise scale (4 enterprises × 100+ agents × ~5 templates) makes per-tenant variation a v1 reality, not a v2 polish; a hard-coded stub would either lie about variation or block the second tenant.
- **MCP servers fold under Connectors with a type badge.** Rationale: from the user's seat, "give my Computer access to Slack" is one action; surfacing the schema split as two pill tabs leaks an internal distinction users do not need to learn.
- **Header pill control matching Memory's pattern.** Rationale: this is the second instance of "page-level segmented control inside `apps/computer`"; reusing the Memory shape (Brain / Pages / KBs) preserves visual consistency rather than introducing a Perplexity-style underlined tab bar.
- **Customize edits the caller's own Computer only.** Rationale: per-user Computers are the unit of personalization in this product; cross-user editing belongs to admin tooling, not to a self-serve customization page.
- **Apps / generated applets are not part of Customize.** Rationale: Apps is its own existing tab and is agent-generated rather than catalog-enabled; folding it in would conflate two different production paths.
- **No live multi-client subscription updates in v1.** Rationale: the page is single-user-focused; optimistic mutation + standard urql cache invalidation is sufficient and avoids a subscription channel for a low-collision surface.

---

## Dependencies / Assumptions

- The user's per-Computer ECS task already has an EFS volume mounted at a stable path; the workspace renderer writes to that mount on toggle. (Verify the mount/path conventions at planning.)
- The Strands runtime continues to read workspace files at invocation and `runtime_config` per turn; this brainstorm assumes both paths remain load-bearing and does not propose changing them. (Per `feedback_completion_callback_snapshot_pattern`, env reads are snapshotted at agent-coroutine entry — the renderer's writes target the workspace files the bootstrap already reads, not env vars.)
- The Memory module's header pill component is reusable from `@thinkwork/ui` (or similar shared location); planning will confirm whether to reuse or to extract a small shared component.
- The existing canonical tables (`agent_skills`, `agent_mcp_servers`, `connectors`, `routines`) carry enough metadata (display name, description, icon/category) to render cards directly, or the catalog rows carry that display metadata centrally. Planning will resolve which side owns display fields.
- Per-user MCP OAuth flows continue to live in their existing surfaces (mobile self-serve per `feedback_user_opt_in_over_admin_config`); the Customize page initiates them but does not own them.
- No Cognito / authz changes are needed — the user editing their own Computer is the existing authorization shape.

---

## Outstanding Questions

### Resolve Before Planning

- None — the synthesis was confirmed.

### Deferred to Planning

- [Affects R9, R10][Technical] Catalog table shape — one polymorphic `tenant_customize_catalog` table with a `kind` discriminator, or per-category tables (`tenant_connector_catalog`, `tenant_skill_catalog`, `tenant_workflow_catalog`). Settled at planning against query patterns and the per-card metadata each kind needs.
- [Affects R8, R9][Technical] Display-metadata ownership — does the catalog row own `display_name`, `description`, `icon_url`, `category`, or do the canonical binding tables own them and the catalog only references by id? Settled at planning against the existing rows' coverage.
- [Affects R12, R13][Technical] Workspace renderer trigger — does the toggle mutation invoke the renderer synchronously, enqueue an event (S3-event orchestration substrate per `project_s3_event_orchestration_decision`), or rely on the next bootstrap to re-derive from DB? Settled at planning against latency and consistency goals.
- [Affects R12][Technical] Exact projected-file set per pill — which existing workspace files the renderer writes for Connectors vs Skills vs Workflows (CAPABILITIES.md / SKILLS.md / MCP.md / a new file?). Settled at planning against the runtime's current reads.
- [Affects R3][Needs research] Filter-chip and category taxonomy per pill — the Perplexity reference shows Discover / All / Connected / Available chips plus a category dropdown; the exact set per pill (and whether Skills and Workflows reuse the same chips) is a UX decision deferred to planning.
- [Affects R4, R7][Technical] Workflow card affordances — Workflows have schedule/run state in addition to enabled/disabled; v1 may need to surface that or may treat the card as enable-only with run state living elsewhere. Settled at planning against the existing Automations page's responsibilities.
- [Affects R15][Product] Whether the "+ Custom" buttons render at all in v1, or are hidden until their authoring flow ships. Could go either way; recommended to hide if the "coming soon" affordance feels like noise on first use.
- [Affects R5][Technical] Whether MCP cards on the Connectors pill share the exact same card component as native connectors with a badge prop, or use a small subclass. Settled at implementation.
- [Affects R10][Product] Initial seeding strategy for the per-tenant catalog — repo-checked-in YAML/JSON imported by migration vs. per-tenant SQL inserts vs. a tenant-bootstrap step on Computer creation. Settled at planning against existing seeding patterns.
- [Affects R16][Technical] Whether to use AppSync subscriptions for catalog/binding changes in a follow-on PR; v1 stays optimistic + urql cache invalidation, but the subscription seam should be considered when shaping mutations so it can be added without redesigning them.
