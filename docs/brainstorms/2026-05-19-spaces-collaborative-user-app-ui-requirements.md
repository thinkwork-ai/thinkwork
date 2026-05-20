---
date: 2026-05-19
topic: spaces-collaborative-user-app-ui
---

# Spaces Collaborative User App UI

> Superseded as implementation direction by `docs/plans/2026-05-20-003-spaces-as-agent-contextual-workrooms-template-removal-plan.md`. This brainstorm is still useful background for people/agent collaboration, mentions, unread grouping, and the Codex/Dust-like sidebar feel. Its Space-as-room language should be read through the newer model: a Space is a contextual workroom that can also organize user conversations, not a generic collaboration room.

## Problem Frame

ThinkWork's end-user app needs to move from an operator/admin-shaped Spaces prototype toward a Dust-like collaboration surface where general users can ask agents for help and collaborate with other people in the same Thread.

The first useful version should not try to rebuild Slack. It should prove a focused interaction: a user opens Chat, sees a global Inbox across Spaces, opens or creates a Thread, and can `@mention` either a person or an agent so they become participants in that shared conversation. Spaces provide context, membership, available agents, and unread grouping, while Threads remain the durable collaboration records.

---

## Actors

- A1. General user: opens the app to ask agents for help, involve teammates, and keep track of unread collaborative work.
- A2. Mentioned teammate: is pulled into a Thread by `@mention`, then sees future unread activity in their Inbox.
- A3. Mentioned agent: is pulled into a Thread by `@mention`, wakes to help, and remains a participant for later turns.
- A4. Space member: browses Spaces, notices unread activity by Space, and opens Space-scoped Threads.
- A5. Tenant admin: can access Admin from the compact top navigation when permitted, but is not the primary v1 user.

---

## Key Flows

- F1. User lands in global Chat Inbox

  - **Trigger:** A general user opens the app.
  - **Actors:** A1
  - **Steps:** The app opens on the Chat tab; the left sidebar shows search, New, a global Inbox section, and Space nav entries with unread counts; Inbox items show the Thread title and Space label.
  - **Outcome:** The user can see urgent unread work across all Spaces before choosing a specific Space.
  - **Covered by:** R1, R2, R3, R4, R5

- F2. User switches to a Space

  - **Trigger:** The user selects a Space nav item or opens the Spaces tab.
  - **Actors:** A1, A4
  - **Steps:** The selected Space becomes the active context; Chat shows that Space's Threads and available context; unread counts remain visible so the user can move between Spaces without losing the global Inbox.
  - **Outcome:** The user can narrow their work to one Space while retaining awareness of unread activity elsewhere.
  - **Covered by:** R4, R5, R6, R7

- F3. User mentions a teammate or agent in a Thread

  - **Trigger:** The user types `@` in the composer and selects a person or agent.
  - **Actors:** A1, A2, A3
  - **Steps:** The composer shows matching people and agents available to the current Thread or Space; selecting a target inserts the mention; sending the message records the mention, adds the target as a Thread participant, and notifies or wakes them.
  - **Outcome:** People and agents can collaborate in one shared Thread, and mentioned participants receive future unread/inbox state.
  - **Covered by:** R8, R9, R10, R11, R12

- F4. User starts a new Thread
  - **Trigger:** The user clicks New from Chat.
  - **Actors:** A1
  - **Steps:** The user chooses or keeps the current Space, writes an opening message, optionally mentions people or agents, and creates a Thread in that Space.
  - **Outcome:** A new collaborative Thread exists with the right Space context and mentioned participants.
  - **Covered by:** R5, R6, R8, R9, R13

---

## Requirements

**Navigation shell**

- R1. The v1 user app should use a compact Dust-like top navigation with `Chat`, `Spaces`, and `Admin`.
- R2. `Chat` is the default landing area for general users.
- R3. `Admin` remains available in the top navigation for permitted users, but the default user experience should not feel like an admin console.
- R4. The Chat left sidebar must show a global Inbox section above Space-specific navigation.
- R5. Inbox is global across Spaces. Unread or mentioned Threads from any Space appear there, and each item shows which Space it belongs to.
- R6. The Chat sidebar must include a nav item for each Space with an unread count derived from unread activity in that Space.
- R7. Selecting a Space nav item scopes the Thread list and composer context to that Space without hiding the global Inbox.

**Spaces browser**

- R8. The `Spaces` top tab shows all Spaces the user can access, including each Space's unread count, basic activity signal, and enough identity to distinguish similar Spaces.
- R9. Opening a Space from the `Spaces` tab sets it as the active Chat context and exposes its Threads.
- R10. The first UI clone should borrow Dust's clarity and density, but ThinkWork should keep Space identity visible because unread work spans multiple Spaces.

**Collaborative Threads and mentions**

- R11. Thread conversations must support both people and agents as participants in the same Thread.
- R12. Typing `@` in the composer must surface both mentionable people and mentionable agents.
- R13. Mentioning a person or agent adds them as a Thread participant rather than merely creating a one-time notification.
- R14. Mentioned participants receive future unread/inbox state for that Thread according to the default v1 notification behavior.
- R15. Mentioning an agent wakes or routes work to that agent in the same Thread, preserving the shared conversation as the collaboration record.
- R16. The composer should make the current Space context visible so users understand which Space the new message or Thread belongs to.

**Thread list and unread behavior**

- R17. The Chat sidebar should support a Dust-like Thread list with grouped recency sections such as Inbox, Today, Yesterday, and older periods.
- R18. Global Inbox items should be prioritized above recency-only Threads.
- R19. Space unread counts should update when a Thread in that Space receives unread activity for the current user.
- R20. Opening a Thread should make clear who is participating, which Space owns it, and whether agents are currently active or have been mentioned.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R4, R5, R6.** Given a user belongs to three Spaces and has unread Threads in two of them, when they open the app, then Chat opens first, the global Inbox shows unread Threads from both Spaces, and each Space nav item shows its unread count.
- AE2. **Covers R7, R8, R9.** Given a user selects a Space from the sidebar or Spaces tab, when the selection completes, then the Chat Thread list is scoped to that Space while the global Inbox remains visible.
- AE3. **Covers R11, R12, R13, R14.** Given a user types `@` in a Thread composer, when they select a teammate and send the message, then that teammate is added as a Thread participant and sees future unread activity for the Thread.
- AE4. **Covers R11, R12, R13, R15.** Given a user mentions an agent in a Thread, when the message sends, then the agent joins the Thread, wakes to help, and its response appears in the same shared conversation.
- AE5. **Covers R16, R20.** Given a user is composing inside a Space-scoped Thread, when they look at the composer and header, then they can tell which Space owns the conversation and who is participating.

---

## Success Criteria

- A general user can open the app and immediately see unread collaborative work across Spaces.
- A user can move between Spaces without losing awareness of global unread work.
- A user can bring both people and agents into a single Thread using `@mention`.
- Threads become the primary shared collaboration record for user-agent and user-user work.
- Downstream planning can implement the v1 UI without re-deciding the top nav, Inbox scope, Space unread model, or mention-participant behavior.

---

## Scope Boundaries

### Deferred for later

- Full Slack-like channel hierarchy.
- Reactions, emoji workflows, message threading inside Threads, and rich presence.
- Pinning, saved items, bookmarks, and advanced sidebar customization.
- Fine-grained per-user notification preference UI beyond the default mention/join behavior.
- General-purpose Space creation/configuration UX for all users.
- Full Space document library, file browser, and knowledge management views.
- Advanced agent marketplace or catalog UX beyond mentionable agents assigned to the Space.
- Cross-Space search beyond what is needed for the global Inbox and basic Thread discovery.

### Outside this product's identity

- ThinkWork is not trying to replace Slack as a general chat system.
- ThinkWork is not an admin-first console for the end-user app.
- ThinkWork is not a one-agent private chat app; collaboration among people and agents is the core surface.
- ThinkWork is not a generic notification inbox detached from Space and Thread context.

---

## Key Decisions

- **Dust-like compact top tabs:** Use `Chat`, `Spaces`, and `Admin` as the first-level navigation because the desired starting point is a basic Dust UI clone.
- **Global Inbox:** Inbox is across all Spaces because unread work belongs to the user, not to a single Space.
- **Space unread sidebar:** Each Space appears as a sidebar nav item with unread count so users can see where activity is happening.
- **Mention joins participant:** `@person` and `@agent` both add the target as a Thread participant, not just a one-time notification.
- **Threads are the collaboration record:** People and agents work in one Thread instead of splitting agent work into separate private runs.
- **Smallest proving slice:** V1 proves the product with a Thread list, global Inbox, Space switching, and a composer that can mention people and agents.

---

## Dependencies / Assumptions

- Assumes the current Spaces and Thread concepts remain the product nouns for the user-facing app.
- Assumes users may belong to multiple Spaces, even if the first dogfood proof starts with one seeded Space.
- Assumes each Thread belongs to exactly one Space for v1.
- Assumes mentionable people and agents are constrained by the current Space or Thread access model.
- Assumes existing unread/read state can be extended or interpreted to support global Inbox and per-Space unread counts.
- Assumes current mention support needs product and UI completion so `@mention` reliably works for both users and agents.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R5, R6, R19][Technical] Define the exact unread-count source of truth and read-marking behavior for global Inbox and Space nav counts.
- [Affects R12-R15][Technical] Verify and complete the mention target loading, structured mention submission, participant insertion, and agent wakeup path across the user app.
- [Affects R8-R10][Design] Decide the exact visual treatment for Space cards/list rows in the `Spaces` tab.
- [Affects R17][Design] Decide whether recency groups appear below Space nav, inside the selected Space view, or both.
- [Affects R20][Design] Decide the minimal participant/agent-active display in the Thread header.

---

## Next Steps

-> /ce-plan for structured implementation planning.
