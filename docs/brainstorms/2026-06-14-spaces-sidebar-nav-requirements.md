---
date: 2026-06-14
topic: spaces-sidebar-nav
---

# Spaces Sidebar Nav

## Problem Frame

The main chat sidebar currently renders each non-default Space as its own collapsible section header. That works for a few Spaces, but it scales poorly as tenants add more customer, department, project, or workflow Spaces. The sidebar should move closer to Codex's compact project navigation model while keeping Thinkwork's Space identity: one `Spaces` section, with each visible Space represented as a compact row using the planet icon and expanding to reveal that Space's recent threads.

---

## Requirements

**Sidebar hierarchy**
- R1. The chat sidebar must render one top-level `Spaces` section instead of treating every Space as a peer section header.
- R2. The `Spaces` section should appear below the general `Threads` section and above lower sidebar destinations such as Settings.
- R3. The first pass should list only Spaces that have visible or recent thread activity in the sidebar, rather than every accessible Space.
- R4. Existing default/general chat behavior stays under `Threads`; default Spaces should not appear as separate rows under `Spaces`.

**Space rows**
- R5. Each listed Space must render as a compact row with an `IconPlanet` visual, the Space name, and any existing unread count signal.
- R6. A closed Space row must use a muted visual treatment for the planet icon and label.
- R7. An open or active Space row should be visually stronger than a closed row and should reveal that Space's recent threads directly underneath.
- R8. Space thread rows should keep the existing Space-scoped navigation behavior so opening a row lands in that Space's thread route.

**Section controls**
- R9. The `Spaces` section header must include an overflow `...` menu.
- R10. The first overflow menu action should be `Collapse all Spaces`.
- R11. `Collapse all Spaces` must close every open Space row in the `Spaces` section without changing the active route or deleting unread/filter state.

---

## Acceptance Examples

- AE1. **Covers R1, R3, R5.** Given the tenant has three contextual Spaces with recent threads, when the user opens the sidebar, then the sidebar shows one `Spaces` heading and three planet-labeled Space rows rather than three separate Space section headers.
- AE2. **Covers R3, R4.** Given a default/general Space and a customer Space exist, when the sidebar renders, then default/general threads remain under `Threads` and only the customer Space appears under `Spaces`.
- AE3. **Covers R6, R7, R8.** Given a Space row is closed, when the user opens it, then the planet/name treatment becomes active enough to read as open and the Space's recent thread links appear underneath with Space-scoped destinations.
- AE4. **Covers R9, R10, R11.** Given multiple Space rows are open, when the user selects `Collapse all Spaces` from the `Spaces` overflow menu, then every Space row closes while the current page remains unchanged.

---

## Success Criteria

- Users can scan multiple Spaces without the sidebar turning into one section header per Space.
- The sidebar feels closer to Codex's compact project navigation while preserving Thinkwork's Space concept and planet visual language.
- Planning can proceed without re-deciding whether to show all Spaces, what icon to use, or what the first `Spaces` overflow action should be.

---

## Scope Boundaries

- Do not build a full Space browser in the chat sidebar; all accessible Spaces can still live in dedicated Space/settings surfaces.
- Do not add drag-and-drop reordering, manual pinning, sorting controls, or folder-style project management in this pass.
- Do not redesign the top action nav, pinned threads, search, automations, or the general `Threads` section.
- Do not change Space membership, unread-count source of truth, or thread routing semantics.

---

## Key Decisions

- **Show active/recent Spaces only.** This is the smallest change that fixes sidebar scaling without turning the sidebar into a comprehensive Space directory.
- **Use `IconPlanet`, not folder icons.** Codex's folder/open-folder pattern is the inspiration, but Thinkwork should preserve Space-specific visual language.
- **Start with `Collapse all Spaces`.** The overflow menu creates the right extension point while avoiding premature organization/sort/archive behavior.
- **Keep recent thread children.** Open Space rows should reveal the same recent thread affordance users already have, just nested under one `Spaces` parent.

---

## Dependencies / Assumptions

- Verified context: the current sidebar surface lives in `apps/web/src/components/shell/ChatSidebar.tsx`.
- Verified context: the current sidebar already separates default/general threads from contextual Space threads.
- Verified context: current tests in `apps/web/src/components/shell/ChatSidebar.test.tsx` assert the older shape, including no `Spaces` heading and no `IconPlanet`, and will need to be updated with the new expected behavior.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R6, R7][Design] Decide the exact active/open/closed row styling while preserving sidebar density and readability.
- [Affects R11][Technical] Decide whether open/closed Space state should be transient component state or persisted as a sidebar preference.

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
