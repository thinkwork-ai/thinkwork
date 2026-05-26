---
date: 2026-05-26
topic: spaces-docs-expansion
---

# Spaces Docs Expansion

## Problem Frame

The Spaces documentation has fallen behind the product. `Components > Spaces` is still a single concept page while `Components > Agents` has a hub and focused leaf pages. `Applications > Admin > Spaces` also compresses the whole operator surface into one page, and some language still reflects older tab names such as Configuration, Memory, and Automations instead of the current Space Studio shape.

This work should turn Spaces into a first-class docs section: a concept hub that teaches the model, plus Admin Spaces pages that document the list page and each current detail tab.

---

## Actors

- A1. Tenant admin: creates and governs Spaces in the Admin app.
- A2. Space author: edits Space workspace context, knowledge bases, triggers, settings, and members.
- A3. Operator or support engineer: uses docs to explain why a Space behaved a certain way.
- A4. Implementation agent: updates the docs site without re-deciding the information architecture.

---

## Key Flows

- F1. Reader learns the Spaces model
  - **Trigger:** A reader opens `Components > Spaces`.
  - **Actors:** A1, A2, A3
  - **Steps:** The reader starts at a Spaces overview, learns that Spaces are contextual workrooms for the tenant platform agent, then follows leaf pages for workspace context, access and membership, triggers and channels, knowledge, runtime policy, and relationship to Threads and Agents.
  - **Outcome:** The reader can explain "Agents are who acts; Spaces are where that work happens" and knows which page to open for a specific Space concern.
  - **Covered by:** R1, R2, R3, R4, R5

- F2. Admin configures a Space
  - **Trigger:** A tenant admin or Space author opens Admin Spaces.
  - **Actors:** A1, A2
  - **Steps:** The reader sees the Spaces list page, creates or opens a Space, lands on Workspace, and can find separate docs for Workspace, KBs, Triggers, Settings, and Members.
  - **Outcome:** The docs match the current Admin UI and do not make the reader translate from retired tab names.
  - **Covered by:** R6, R7, R8, R9, R10, R11

---

## Requirements

**Concept section**

- R1. `Components > Spaces` must become a sidebar group with an Overview page and focused child pages, matching the navigable shape of `Components > Agents`.
- R2. The Spaces Overview must define a Space as a contextual workroom that supplies local workspace, access, knowledge, triggers, tools, memory, channels, and runtime policy to the tenant platform agent.
- R3. Concept pages must make the Spaces/Agents/Threads relationship explicit: Agents act, Spaces provide context and policy, Threads are the durable work records.
- R4. Concept pages must distinguish Spaces from folder specialists: use Spaces for workroom context, membership, channels, knowledge, triggers, and policy; use folder specialists for reusable delegated behavior.
- R5. The concept section should include pages for at least these topics: model overview, workspace context, access and membership, triggers and channels, knowledge and memory, runtime policy, and Spaces with Threads.

**Admin Spaces section**

- R6. `Applications > Admin > Spaces` must become a sidebar group with an Overview page, a Spaces list page, and detail-tab pages.
- R7. Admin docs must use the current Space Studio tab names and order: Workspace, KBs, Triggers, Settings, Members.
- R8. Admin docs must state that `/spaces/:spaceId` redirects to Workspace and that Workspace is the default landing tab.
- R9. The Workspace page must explain Space workspace files as context local to the workroom, not tenant-wide platform-agent defaults.
- R10. The KBs page must explain Space knowledge-base selection and avoid calling the tab Memory.
- R11. The Triggers page must document Schedule, Webhook, and Email trigger rows, including that Email is a single synthetic row backed by the Space email trigger toggle.
- R12. The Settings page must document name, access mode, and description. It must not describe retired Advanced runtime controls unless the current UI exposes them.
- R13. The Members page must document that Members appears only for Private Spaces and controls who can access the Space.

**Editorial and navigation**

- R14. The expanded pages must follow `docs/STYLE.md`: strong hook paragraphs, plain language first, honest known limits where needed, related-page links, and no marketing tone.
- R15. The old one-page Spaces docs must either become the relevant Overview pages or redirect readers naturally through sidebar and related links; the expansion must not leave duplicate contradictory explanations.
- R16. Cross-links must connect concept pages to Admin pages and to existing Agents, Threads, Tenant Agent, Knowledge, Automations, and Mobile Threads docs where relevant.

---

## Acceptance Examples

- AE1. **Covers R1, R5.** Given a reader opens the docs sidebar, when they expand `Components > Spaces`, then they see an Overview plus focused child pages instead of one flat Spaces page.
- AE2. **Covers R6, R7, R8.** Given a tenant admin opens `Applications > Admin > Spaces`, when they follow Space detail docs, then the docs use Workspace, KBs, Triggers, Settings, Members and identify Workspace as the landing tab.
- AE3. **Covers R10, R11.** Given a reader wants to configure Space knowledge or inbound work, when they scan the Admin Spaces pages, then knowledge-base selection is documented under KBs and Schedule/Webhook/Email are documented under Triggers.
- AE4. **Covers R3, R4.** Given a reader is deciding whether to create a Space or a folder specialist, when they read the concept docs, then they can identify which abstraction fits the job without relying on implementation details.

---

## Success Criteria

- A new operator can read the Spaces section and understand how Spaces shape tenant-platform-agent work without reading the Agents section first.
- A tenant admin can map every visible Admin Space tab to a docs page with matching vocabulary.
- Planning can proceed without re-deciding page structure, tab names, or whether end-user Spaces/thread docs are included in this pass.
- The docs build succeeds after the IA and content changes.

---

## Scope Boundaries

- Do not change product behavior or Admin UI code as part of this docs pass.
- Do not expand end-user Spaces/thread docs beyond related links and small cross-link corrections.
- Do not add new API reference coverage unless a page needs a brief under-the-hood pointer.
- Do not document retired tab names as current behavior.
- Do not claim Templates, legacy per-agent routes, or runtime controls are removed unless the current UI and docs context verify that claim.

---

## Key Decisions

- Expand both concept and Admin docs: the concept section teaches the model, while Admin pages document operator workflows.
- Keep end-user Spaces/thread docs out of this pass: link to them, but do not turn this into a user-app documentation rewrite.
- Use current Admin tab names: Workspace, KBs, Triggers, Settings, Members.
- Treat Email as part of Triggers documentation: the current Admin UI represents it as a trigger row, not as a Settings control.

---

## Dependencies / Assumptions

- Existing docs pattern to mirror: `docs/src/content/docs/concepts/agents.mdx` plus `docs/src/content/docs/concepts/agents/*`.
- Current single-page Spaces docs: `docs/src/content/docs/concepts/spaces.mdx` and `docs/src/content/docs/applications/admin/spaces.mdx`.
- Current Admin Spaces routes verified in code: `apps/admin/src/routes/_authed/_tenant/spaces/$spaceId_.workspace.tsx`, `$spaceId_.kbs.tsx`, `$spaceId_.triggers.tsx`, `$spaceId_.settings.tsx`, and `$spaceId_.members.tsx`.
- Current prior planning context: `docs/plans/2026-05-23-001-docs-space-architecture-agent-framework-user-docs-plan.md`.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1, R5][Editorial] Exact child-page titles may be adjusted during writing as long as the required topic coverage remains intact.
- [Affects R15][Navigation] Planning should decide whether to preserve existing slugs as Overview pages or introduce redirects for any renamed pages.

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
