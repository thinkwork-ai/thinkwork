---
title: "feat: Expand Spaces documentation"
type: feat
status: active
date: 2026-05-26
origin: docs/brainstorms/2026-05-26-spaces-docs-expansion-requirements.md
---

# feat: Expand Spaces documentation

## Overview

Expand Spaces from two dense single pages into a first-class docs section. The concept docs will mirror the Agents section shape with a Spaces overview and focused leaf pages. The Admin docs will mirror the current Space Studio UI with pages for the Spaces list and each detail tab: Workspace, KBs, Triggers, Settings, and Members.

---

## Problem Frame

The current docs under `Components > Spaces` and `Applications > Admin > Spaces` lag the product. Spaces are now contextual workrooms for the tenant platform agent, but the docs still compress the concept and operator UI into one page each. The Admin page also contains stale vocabulary from the older Configuration, Memory, and Automations tab model. The requirements doc defines the desired shape: concept docs that teach the model, and Admin docs that map directly to the current operator surface (see origin: `docs/brainstorms/2026-05-26-spaces-docs-expansion-requirements.md`).

---

## Requirements Trace

- R1. `Components > Spaces` becomes a sidebar group with an Overview page and focused child pages.
- R2. The Spaces Overview defines Spaces as contextual workrooms that supply local workspace, access, knowledge, triggers, tools, memory, channels, and runtime policy to the tenant platform agent.
- R3. Concept pages make the Spaces/Agents/Threads relationship explicit.
- R4. Concept pages distinguish Spaces from folder specialists.
- R5. Concept pages cover model overview, workspace context, access and membership, triggers and channels, tools, knowledge and memory, runtime policy, and Spaces with Threads.
- R6. `Applications > Admin > Spaces` becomes a sidebar group with an Overview page, a Spaces list page, and detail-tab pages.
- R7. Admin docs use the current tab names and order: Workspace, KBs, Triggers, Settings, Members.
- R8. Admin docs state that `/spaces/:spaceId` redirects to Workspace and Workspace is the default landing tab.
- R9. The Workspace page explains Space-local workspace context.
- R10. The KBs page explains Space knowledge-base selection and avoids calling the tab Memory.
- R11. The Triggers page documents Schedule, Webhook, and Email rows.
- R12. The Settings page documents name, access mode, and description, without claiming retired runtime controls are current.
- R13. The Members page documents Private-Space-only access control.
- R14. Pages follow `docs/STYLE.md`.
- R15. Existing one-page Spaces docs become overview pages or naturally route readers to the expanded section.
- R16. Cross-links connect concept pages, Admin pages, and adjacent Agents, Threads, Tenant Agent, Knowledge, Automations, and Mobile Threads docs.
- Plan-added verification requirement. Space email examples in touched and adjacent docs use the current `space-slug@tenant-slug.thinkwork.ai` format from `deriveSpaceAddress`, not legacy `<tenant-slug>.<space-slug>@agents.thinkwork.ai`.

**Origin actors:** A1 tenant admin, A2 Space author, A3 operator or support engineer, A4 implementation agent.
**Origin flows:** F1 reader learns the Spaces model, F2 admin configures a Space.
**Origin acceptance examples:** AE1 sidebar expansion, AE2 current Admin tab vocabulary, AE3 KBs and Triggers placement, AE4 Space vs folder specialist distinction.

---

## Scope Boundaries

- Do not change product behavior or Admin UI code.
- Do not expand end-user Spaces/thread docs beyond cross-links or tiny consistency corrections.
- Do not add API reference coverage unless a page needs a brief under-the-hood pointer.
- Do not document retired tab names as current behavior.
- Do not claim Templates, legacy per-agent routes, or runtime controls are removed unless current UI and docs context verify the claim.

---

## Context & Research

### Relevant Code and Patterns

- `docs/astro.config.mjs` owns the Starlight sidebar and already models `Components > Agents` as a grouped overview plus child pages.
- `docs/src/content/docs/concepts/agents.mdx` and `docs/src/content/docs/concepts/agents/*` are the section shape to mirror.
- `docs/src/content/docs/concepts/spaces.mdx` and `docs/src/content/docs/applications/admin/spaces.mdx` are the current single-page Spaces docs to expand.
- Current Admin Spaces routes verified in code: `apps/admin/src/routes/_authed/_tenant/spaces/$spaceId_.workspace.tsx`, `$spaceId_.kbs.tsx`, `$spaceId_.triggers.tsx`, `$spaceId_.settings.tsx`, and `$spaceId_.members.tsx`.
- `apps/admin/src/components/spaces/SpaceDetailChrome.tsx` confirms the current tab order and behavior: Workspace, KBs, Triggers, Settings, Members, with Members only for Private Spaces.
- `packages/api/src/lib/email/space-address.ts` is the source of truth for Space email addresses: `space-slug@tenant-slug.thinkwork.ai`. Its test rejects legacy `tenant.space@agents.thinkwork.ai` recipients.

### Institutional Learnings

- `docs/STYLE.md` sets the documentation quality bar: strong hook paragraphs, plain language first, honest known limits, related links, and no marketing tone.
- `docs/plans/2026-05-23-001-docs-space-architecture-agent-framework-user-docs-plan.md` established the earlier user-docs direction around tenant platform agent and Spaces, but the current pass is narrower and more detailed.
- `docs/brainstorms/2026-05-26-admin-spaces-ui-cleanup-requirements.md` confirms the current Admin tab vocabulary and Email-as-trigger row decision.

### External References

- External research is not needed. This is a docs IA and content update using local product behavior and established Starlight patterns.

---

## Key Technical Decisions

- Preserve existing overview slugs: keep `docs/src/content/docs/concepts/spaces.mdx` and `docs/src/content/docs/applications/admin/spaces.mdx` as the overview pages so existing links remain valid.
- Add child pages under existing section directories: create `docs/src/content/docs/concepts/spaces/*` and `docs/src/content/docs/applications/admin/spaces/*` for focused topics.
- Lock sidebar order and labels during implementation so navigation is reviewable, not invented while writing.
- Use current Admin UI vocabulary only: Workspace, KBs, Triggers, Settings, Members.
- Treat docs build as the main verification path because the change is static content and sidebar configuration.

---

## Open Questions

### Resolved During Planning

- Should existing `spaces.mdx` pages move or redirect? Preserve them as overview pages to avoid breaking links.
- Should end-user Spaces/thread docs be expanded? No. The requirements explicitly keep them out of scope except for related links.

### Deferred to Implementation

- Exact page headings may be polished during writing, but sidebar labels are locked in the plan below.

---

## Output Structure

```text
docs/src/content/docs/concepts/
├── spaces.mdx
└── spaces/
    ├── workspace-context.mdx
    ├── access-and-membership.mdx
    ├── triggers-and-channels.mdx
    ├── tools.mdx
    ├── knowledge-and-memory.mdx
    ├── runtime-policy.mdx
    └── spaces-and-threads.mdx

docs/src/content/docs/applications/admin/
├── spaces.mdx
└── spaces/
    ├── list.mdx
    ├── workspace.mdx
    ├── kbs.mdx
    ├── triggers.mdx
    ├── settings.mdx
    └── members.mdx
```

This tree declares the intended output shape. The implementing agent may adjust page titles if writing reveals a clearer label, but the sidebar should still expose the required concept topics and current Admin tabs.

Sidebar labels are locked as:

- `Components > Spaces`: Overview, Workspace Context, Access and Membership, Triggers and Channels, Tools, Knowledge and Memory, Runtime Policy, Spaces and Threads.
- `Applications > Admin > Spaces`: Overview, Spaces list, Workspace, KBs, Triggers, Settings, Members.

---

## Implementation Units

- U1. **Sidebar information architecture**

**Goal:** Turn Spaces into grouped sidebar sections under both Components and Applications > Admin after the referenced pages exist.

**Requirements:** R1, R6, R7, R15, R16; covers AE1 and AE2.

**Dependencies:** U2, U3.

**Files:**
- Modify: `docs/astro.config.mjs`

**Approach:**
- Replace the flat `Components > Spaces` item with a collapsed group whose Overview slug remains `concepts/spaces`.
- Replace the flat Admin Platform `Spaces` item with a collapsed group whose Overview slug remains `applications/admin/spaces`.
- Add child sidebar entries for the concept topics and Admin pages created in U2 and U3, using the locked labels and order from Output Structure.
- Preserve existing unrelated sidebar ordering and labels.

**Patterns to follow:**
- `Components > Agents` in `docs/astro.config.mjs`.
- `Components > Threads` in `docs/astro.config.mjs` for a smaller grouped section.

**Test scenarios:**
- Happy path: running the docs build with the new sidebar slugs resolves every new page.
- Edge case: existing links to `/concepts/spaces/` and `/applications/admin/spaces/` continue to resolve because the overview slugs are unchanged.

**Verification:**
- The sidebar contains grouped Spaces sections in both target locations.
- No stale Admin tab labels appear in the Spaces sidebar entries.

---

- U2. **Concept Spaces pages**

**Goal:** Expand `Components > Spaces` into a model-first section that teaches what Spaces are and when to use them.

**Requirements:** R1, R2, R3, R4, R5, R14, R15, R16; covers F1, AE1, and AE4.

**Dependencies:** U1.

**Files:**
- Modify: `docs/src/content/docs/concepts/spaces.mdx`
- Create: `docs/src/content/docs/concepts/spaces/workspace-context.mdx`
- Create: `docs/src/content/docs/concepts/spaces/access-and-membership.mdx`
- Create: `docs/src/content/docs/concepts/spaces/triggers-and-channels.mdx`
- Create: `docs/src/content/docs/concepts/spaces/tools.mdx`
- Create: `docs/src/content/docs/concepts/spaces/knowledge-and-memory.mdx`
- Create: `docs/src/content/docs/concepts/spaces/runtime-policy.mdx`
- Create: `docs/src/content/docs/concepts/spaces/spaces-and-threads.mdx`

**Approach:**
- Rewrite `concepts/spaces.mdx` as the overview hub: hook paragraph, 2-3 mental-model paragraphs, compact relationship table, CardGrid of child pages, and related links.
- Keep concept pages plain-language first and avoid implementation details unless a short under-the-hood pointer is useful.
- Make the Space vs folder specialist distinction explicit in the overview and reinforce it where relevant.
- Use adjacent concept links to Agents, Threads, Tenant Agent, Runtime Configuration, Company Brain, Automations, and Mobile Threads.
- Cover Space tools explicitly as a concept page or a clearly named concept section. Keep this concept-level unless the current Admin UI exposes a Tools tab.

**Patterns to follow:**
- `docs/src/content/docs/concepts/knowledge.mdx` for CardGrid hub shape.
- `docs/src/content/docs/concepts/threads.mdx` for hub prose plus child links.
- `docs/src/content/docs/concepts/agents.mdx` for tenant platform agent and folder specialist vocabulary.

**Test scenarios:**
- Happy path: a reader opening the overview can identify the child page for workspace context, access, triggers, tools, knowledge, runtime policy, or Threads.
- Happy path: the concept docs explain Spaces/Agents/Threads without requiring the reader to start in the Agents section.
- Edge case: the docs do not present a Space as a folder specialist or as a replacement for the tenant platform agent.

**Verification:**
- Every concept page has frontmatter title and description, a strong opening paragraph, and related links.
- The overview and child pages use canonical names from `docs/STYLE.md`.

---

- U3. **Admin Spaces pages**

**Goal:** Split `Applications > Admin > Spaces` into operator pages that match the current Admin Spaces UI.

**Requirements:** R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16; covers F2, AE2, and AE3.

**Dependencies:** U1.

**Files:**
- Modify: `docs/src/content/docs/applications/admin/spaces.mdx`
- Create: `docs/src/content/docs/applications/admin/spaces/list.mdx`
- Create: `docs/src/content/docs/applications/admin/spaces/workspace.mdx`
- Create: `docs/src/content/docs/applications/admin/spaces/kbs.mdx`
- Create: `docs/src/content/docs/applications/admin/spaces/triggers.mdx`
- Create: `docs/src/content/docs/applications/admin/spaces/settings.mdx`
- Create: `docs/src/content/docs/applications/admin/spaces/members.mdx`

**Approach:**
- Rewrite `applications/admin/spaces.mdx` as the Admin Spaces overview: list route, detail redirect behavior, tab order, and CardGrid/links to child pages.
- Document the list page separately so creation, table columns, and row navigation do not crowd the overview.
- Document each Space Studio tab with current names and behavior.
- On Triggers, explain Schedule, Webhook, and Email lifecycle exactly: `Add > Email` enables the Space email trigger; once enabled, Email appears as a single row with a copyable address; clicking the row opens the disable confirmation. Token-bearing replies are distinct from cold-contact email.
- On Settings, document only the fields current UI exposes: name, access, and description.
- On Members, state that Members is hidden for Public Spaces, available only for Private Spaces, and direct `/spaces/:spaceId/members` access for a Public Space redirects to Workspace.

**Patterns to follow:**
- Existing `docs/src/content/docs/applications/admin/spaces.mdx` for operator route-style writing, updated to current behavior.
- `docs/src/content/docs/applications/admin/automations.mdx` for route-oriented Admin docs.
- Current Admin route/component files listed in Context & Research.

**Test scenarios:**
- Happy path: a tenant admin can map each visible Admin tab to a page with the same label.
- Happy path: the Admin overview states that `/spaces/:spaceId` lands on Workspace.
- Edge case: the Settings page does not describe retired Advanced runtime controls as current UI.
- Edge case: the KBs page avoids renaming the tab to Memory.
- Edge case: the Members page documents the Public Space redirect behavior for direct members-route access.

**Verification:**
- No current Admin Spaces page uses Configuration, Memory, or Automations as active tab names.
- Related links connect each Admin tab page to the corresponding concept page where useful, and the Admin overview links to Tenant Agent.

---

- U4. **Consistency cleanup and build verification**

**Goal:** Remove contradictions introduced by the split and verify the docs site builds.

**Requirements:** R14, R15, R16.

**Dependencies:** U1, U2, U3.

**Files:**
- Modify: `docs/src/content/docs/concepts/spaces.mdx`
- Modify: `docs/src/content/docs/applications/admin/spaces.mdx`
- Modify as needed: adjacent docs under `docs/src/content/docs/concepts/agents.mdx`, `docs/src/content/docs/concepts/threads.mdx`, `docs/src/content/docs/concepts/threads/routing-and-metadata.mdx`, `docs/src/content/docs/applications/admin/agents.mdx`, `docs/src/content/docs/applications/admin/index.mdx`, or `docs/src/content/docs/applications/mobile/threads-and-chat.mdx`
- Test: docs build for `@thinkwork/docs`

**Approach:**
- Search the touched docs area for stale Spaces tab names and contradictory Space definitions.
- Replace stale Space email address examples in docs with `space-slug@tenant-slug.thinkwork.ai` when they describe Space cold-contact addresses.
- Keep adjacent-doc edits minimal and only update cross-links or stale references that would undermine the new section.
- Run the docs build and fix broken links, invalid imports, frontmatter mistakes, or Starlight component issues.

**Patterns to follow:**
- `docs/STYLE.md` for final editorial checks.
- Existing Starlight component imports in nearby docs.

**Test scenarios:**
- Happy path: docs build completes with all new pages and sidebar entries.
- Edge case: existing overview URLs remain valid.
- Edge case: old Space email examples such as `<tenant-slug>.<space-slug>@agents.thinkwork.ai` no longer appear in docs source.
- Error path: if the build reports broken links or component import errors, fix the docs source rather than disabling the build check.

**Verification:**
- `@thinkwork/docs` build succeeds.
- `rg` finds no stale active-tab naming in the expanded Spaces docs or adjacent Admin pages.
- `rg "agents\\.thinkwork|<tenant-slug>\\.<space-slug>" docs/src/content/docs` no longer finds Space cold-contact address examples that should use the current Space address format.
- Manual read-through checklist passes: both Spaces sidebar groups expand correctly, overview CardGrid links match sidebar entries, Admin overview routes readers to list/detail pages, each tab page links to its matching concept page, and old overview URLs still orient returning readers.

---

## System-Wide Impact

- **Interaction graph:** Static docs and sidebar only. No runtime, API, database, or Admin UI behavior changes.
- **Error propagation:** Build errors surface through Astro/Starlight during docs build.
- **State lifecycle risks:** None.
- **API surface parity:** Existing docs URLs for the two overview pages stay valid.
- **Integration coverage:** Docs build is the integration check for frontmatter, MDX, imports, and sidebar slugs.
- **Unchanged invariants:** Admin route behavior, GraphQL schema, and user-facing Spaces/thread behavior remain unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| New pages duplicate or contradict the overview pages | Convert existing pages into hubs and keep each child page focused on one concern |
| Docs drift from current Admin UI | Ground tab vocabulary and behavior in `SpaceDetailChrome.tsx` and route files |
| Broken sidebar slugs or MDX imports | Create pages before wiring final sidebar entries, then run the docs build after implementation |
| Scope grows into end-user Spaces docs | Keep end-user docs to related links and small consistency corrections only |

---

## Documentation / Operational Notes

- This plan is itself a documentation change. No rollout notes are needed beyond the docs build.
- If future product work adds runtime controls back to Space Settings, document that in a follow-up tied to the UI change rather than pre-documenting it here.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-26-spaces-docs-expansion-requirements.md](../brainstorms/2026-05-26-spaces-docs-expansion-requirements.md)
- Current Spaces concept page: `docs/src/content/docs/concepts/spaces.mdx`
- Current Admin Spaces page: `docs/src/content/docs/applications/admin/spaces.mdx`
- Sidebar config: `docs/astro.config.mjs`
- Docs style guide: `docs/STYLE.md`
- Prior docs plan: `docs/plans/2026-05-23-001-docs-space-architecture-agent-framework-user-docs-plan.md`
- Admin Spaces UI cleanup requirements: `docs/brainstorms/2026-05-26-admin-spaces-ui-cleanup-requirements.md`
