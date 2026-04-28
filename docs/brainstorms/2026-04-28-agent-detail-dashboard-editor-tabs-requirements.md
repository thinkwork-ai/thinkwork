---
date: 2026-04-28
topic: agent-detail-dashboard-editor-tabs
---

# Agent Detail Dashboard / Editor Tabs

## Problem Frame

The agent workspace editor is currently reachable from Agent Detail through a small `Workspace` badge, then rendered as a separate builder page. That makes the editor feel secondary even though editing an agent's workspace is one of the core things an operator does on an agent.

Agent Detail should treat the current metrics/activity view and the workspace editor as peer modes of the same agent page. The page should follow the Agent Template detail pattern: a first-class segmented tab switcher near the top of the detail page, with the selected tab swapping the main content area.

---

## Actors

- A1. Operator: opens a specific agent to monitor performance and activity.
- A2. Agent author: opens a specific agent to edit its workspace files.

---

## Key Flows

- F1. Open an agent dashboard
  - **Trigger:** A1 navigates to an existing agent detail link.
  - **Actors:** A1
  - **Steps:** A1 opens `/agents/:agentId`; the page loads the agent header and marks `Dashboard` active; metrics and recent activity render in the main content area.
  - **Outcome:** Existing agent detail links keep working and land on the dashboard.
  - **Covered by:** R1, R2, R5

- F2. Switch from dashboard to editor
  - **Trigger:** A2 clicks the `Editor` tab on Agent Detail.
  - **Actors:** A2
  - **Steps:** The URL changes to `/agents/:agentId/editor`; the shared agent header remains; dashboard content is replaced by the workspace editor.
  - **Outcome:** The editor feels like a primary mode of the agent page, not a secondary badge destination.
  - **Covered by:** R1, R3, R4

- F3. Open an old workspace link
  - **Trigger:** A2 opens a bookmarked or internally linked `/agents/:agentId/workspace` URL.
  - **Actors:** A2
  - **Steps:** The app redirects to the new editor tab route and preserves any folder-selection search state.
  - **Outcome:** Existing deep links continue to work while the visible navigation moves to `Editor`.
  - **Covered by:** R6

---

## Requirements

**Navigation and hierarchy**

- R1. Agent Detail MUST expose a two-option tab switcher labeled `Dashboard` and `Editor`.
- R2. `/agents/:agentId` MUST remain the Dashboard route so existing links continue to land on the current metrics/activity view.
- R3. The Editor tab MUST be addressable at `/agents/:agentId/editor`.
- R4. The `Editor` tab MUST render the existing agent workspace editor in the Agent Detail content area, beneath the same agent header and tab switcher.
- R5. The current dashboard content MUST remain the Dashboard tab content: agent metrics, activity chart, cost summary, and recent activity.
- R6. The legacy `/agents/:agentId/workspace` route MUST redirect to `/agents/:agentId/editor` and preserve existing folder deep-link search state.

**Header and affordances**

- R7. The existing `Workspace` badge in the agent header MUST be removed. The Editor tab becomes the primary navigation affordance for workspace editing.
- R8. Non-editor header badges and controls, such as owner, budget, automations, versions, and email status, SHOULD remain in the header unless implementation discovers a direct conflict with the tab layout.
- R9. The tab switcher SHOULD visually align with the Agent Template detail tab pattern so operators learn one detail-page model.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R5.** Given an operator opens `/agents/fleet-caterpillar-456`, when the agent loads, `Dashboard` is active and the current metrics and recent activity view is shown.
- AE2. **Covers R3, R4.** Given an operator clicks `Editor`, when navigation completes, the URL is `/agents/fleet-caterpillar-456/editor` and the workspace editor replaces the dashboard content without leaving the agent detail context.
- AE3. **Covers R6.** Given an old link to `/agents/fleet-caterpillar-456/workspace?folder=skills`, when it is opened, the app lands on the Editor tab with the `skills` folder intent preserved.
- AE4. **Covers R7.** Given the Agent Detail header renders, when the new tabs are present, there is no separate `Workspace` badge linking to the same editor destination.

---

## Success Criteria

- Operators can see monitoring and editing as two peer modes of a single agent, matching the mental model already established by Agent Template detail.
- Existing dashboard links and old workspace deep links keep working.
- A downstream planning or implementation agent does not need to invent tab labels, URL behavior, badge behavior, or legacy-route behavior.

---

## Scope Boundaries

- Do not redesign the dashboard cards, charts, or recent activity list.
- Do not change workspace editor capabilities, file actions, import behavior, or folder semantics.
- Do not add new tabs for memory, knowledge, sub-agents, automations, or settings in this slice.
- Do not rename Agent Templates' `Workspace` tab as part of this change; the requested labels apply to Agent Detail only.
- Do not remove the existing non-dashboard agent subroutes unless planning separately decides to consolidate them.

---

## Key Decisions

- **Tab labels:** Use `Dashboard` / `Editor`, preserving the meaning of the current dashboard while elevating the editor.
- **URL model:** Keep `/agents/:agentId` as Dashboard and add `/agents/:agentId/editor` for Editor.
- **Badge hierarchy:** Remove the `Workspace` badge once the Editor tab exists.

---

## Dependencies / Assumptions

- The existing shared workspace editor remains the editor surface for agents.
- The Agent Template detail tab pattern is the visual and interaction precedent for this change.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R4, R9][Technical] Whether the shared agent header should be extracted into a route layout or duplicated minimally between Dashboard and Editor routes.
- [Affects R6][Technical] Whether the legacy workspace route should be a router-level redirect or a compatibility component that navigates on load.

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
