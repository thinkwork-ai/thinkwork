---
date: 2026-05-16
topic: thinkwork-computer-slack-workspace-app
---

# ThinkWork Computer Slack Workspace App

## Summary

A single ThinkWork Slack workspace app, installed once per Slack workspace, that lets each linked user invoke their own Computer from inside Slack via @mention, DM, the `/thinkwork` slash command, or the message-action shortcut. Responses post visibly in the originating thread (or DM) with attribution identifying whose Computer answered.

---

## Problem Frame

Today, the ThinkWork Computer is reachable from the mobile and admin web surfaces, but not from the place a lot of operator work actually happens — the team's Slack. The motivating scene: a financial statement gets dropped into a channel thread and the operator wants their Computer to analyze it and have the answer land in the same thread so teammates see it together. The current workaround is copying the document to mobile/admin, asking the Computer privately, and pasting a summary back — or skipping the analysis entirely. Both outcomes lose the moment when the team is already in the same room.

Beyond that one scene, every ThinkWork-using teammate hits the same disconnect: the Computer's value compounds when it can act on team-visible discussions, not just on private one-on-ones. Each operator who'd benefit from in-Slack invocation is currently siloed in their own front-door.

---

## Actors

- A1. Operator (Slack member with a linked ThinkWork account): invokes their Computer from any of the four Slack surfaces and reads the response in the same thread, channel, or DM.
- A2. Slack workspace admin: installs and approves the ThinkWork Slack app for the workspace; manages OAuth scopes; can uninstall.
- A3. Other channel participants (Slack members, with or without linked ThinkWork accounts): observe Computer responses in shared threads; cannot themselves invoke unless linked.
- A4. ThinkWork Computer (per-user Strands runtime): receives the inbound task, runs against the user's workspace, memory, and MCP tools, returns a response.
- A5. ThinkWork Slack app (single bot user per workspace): receives Slack events, resolves which user's Computer to route to, posts replies with per-message attribution.

---

## Key Flows

- F1. @mention in a channel thread (the financial-doc scene)
  - **Trigger:** A1 posts "@ThinkWork analyze this" in a thread that contains a message or file.
  - **Actors:** A1, A3, A4, A5
  - **Steps:** Slack app receives the `app_mention` event; resolves invoker A1 → linked ThinkWork user → that user's Computer; bundles visible thread context + file references; enqueues a computer task for A4; on completion posts a reply in the same thread, attributed to A1's Computer.
  - **Outcome:** A1 and all of A3 see the Computer's analysis in-thread, attributed to A1's Computer.
  - **Covered by:** R2, R5, R7, R10, R14, R15

- F2. DM to the bot (private 1:1)
  - **Trigger:** A1 opens a DM with the ThinkWork app and sends a message.
  - **Actors:** A1, A4, A5
  - **Steps:** Slack app receives the `message.im` event; routes to A1's Computer; reply posts back in the DM only.
  - **Outcome:** A1 has a private conversation surface with their Computer alongside mobile/admin.
  - **Covered by:** R3, R5, R7

- F3. Slash command `/thinkwork`
  - **Trigger:** A1 types `/thinkwork <prompt>` in any channel they're in.
  - **Actors:** A1, A4, A5
  - **Steps:** Slack app receives the slash command; defaults to an ephemeral response visible only to A1; response includes a "Post to channel" button that promotes the message to a public in-channel reply attributed to A1's Computer.
  - **Outcome:** A1 gets a private take first and chooses whether to share.
  - **Covered by:** R4, R7, R8

- F4. Message-action shortcut
  - **Trigger:** A1 uses Slack's "More actions → Send to ThinkWork" on any message or file.
  - **Actors:** A1, A4, A5
  - **Steps:** Slack app receives the `message_action` event with the source message and any attached files; optionally opens a modal for a follow-up prompt; bundles the source message and files to A1's Computer; reply posts back in the originating thread, attributed to A1's Computer.
  - **Outcome:** A1 captures a thread's message or file as a task without typing.
  - **Covered by:** R6, R7, R10

- F5. Linking a Slack identity to a ThinkWork account (one-time per user)
  - **Trigger:** A1 invokes the app for the first time from any surface, or explicitly initiates linking from the mobile app.
  - **Actors:** A1, A5
  - **Steps:** Slack app DMs A1 a link to ThinkWork sign-in; A1 authenticates with their tenant Cognito identity; binding persists per Slack workspace.
  - **Outcome:** A1 can invoke their Computer from any Slack surface going forward.
  - **Covered by:** R9, R11

- F6. Workspace install (one-time per Slack workspace)
  - **Trigger:** A2 installs the ThinkWork Slack app from the app directory or a deep link.
  - **Actors:** A2
  - **Steps:** Slack OAuth flow; app binds the workspace to one ThinkWork tenant (one tenant may already have other workspaces bound); admin grants the v1 scopes.
  - **Outcome:** Workspace is wired; users can begin linking individually within that workspace.
  - **Covered by:** R1, R12, R13, R16

---

## Requirements

**App install and workspace binding**
- R1. The ThinkWork Slack app is installed once per Slack workspace as a single bot user in that workspace.
- R12. Workspace installation binds a Slack workspace to a ThinkWork tenant; a single tenant may have multiple Slack workspaces bound to it (e.g., a company with separate Slack workspaces per business unit), but a single Slack workspace binds to exactly one tenant.
- R13. The app requests only the Slack OAuth scopes needed for the v1 trigger surfaces and per-message attribution (notably `chat:write.customize`, required by R7); any scope expansion in later versions is opt-in by the workspace admin.
- R16. A ThinkWork user may have linked Slack identities in multiple Slack workspaces, provided each of those workspaces is bound to that user's tenant. Each (Slack workspace ID, Slack user ID) → ThinkWork user binding is independent.

**Per-user identity linking**
- R9. Each Slack user must link their Slack identity to a ThinkWork account in the same tenant before any invocation will succeed; the binding is self-serve and managed from the mobile app, not from the admin SPA.
- R11. Unlinked invocations return a one-time DM from the bot to the invoking Slack user with a link to complete the binding, plus a brief in-place reply acknowledging the request can't yet be acted on.

**Invocation surfaces (v1)**
- R2. The bot responds to @mention in any channel or thread it has been invited to.
- R3. The bot responds to direct messages from linked users.
- R4. The bot exposes a `/thinkwork` slash command in any channel where the app is installed.
- R6. The bot exposes a message-action shortcut on messages and files.

The four surfaces differ on visibility and context, which is what makes them complementary in v1:

| Surface | Default visibility | Context bundled with the task |
|---|---|---|
| @mention | Public in the thread it was posted in | Visible thread history + attached files at the moment of invocation |
| DM | Private to invoker | The DM conversation history |
| `/thinkwork` slash command | Ephemeral to invoker, with one-tap promote-to-public | Just the prompt typed by the user (no channel context auto-bundled) |
| Message-action shortcut | Public in the originating thread | The source message + any attached files (plus optional modal prompt) |

**Routing and response**
- R5. Every invocation routes to the invoking user's own Computer (not a tenant-shared one) and runs against that user's memory, workspace, and MCP tools.
- R7. Every Computer-authored Slack message uses per-message `username` and `icon_url` overrides (via Slack's `chat:write.customize` scope) so each message visually identifies whose Computer produced it — e.g., username "Eric's Computer" with a distinguishing avatar. Constant bot-identity fallback patterns (body prefix or context-block footer) are not used in v1.
- R8. When a slash-command response is shown ephemerally, it includes a one-tap affordance to promote the message to a public in-channel reply attributed to the invoker's Computer.
- R10. When invoked in a thread (F1) or via a message-action (F4), the Computer receives the surrounding thread context — the source message and the visible thread history at the time of invocation — without ambient access to the rest of the channel.

**Operational guarantees**
- R14. Inbound Slack events are enqueued through the platform's computer-task substrate (consistent with the existing "automations enqueue computer tasks, never agent wakeup requests" rule); user-driven lookups during invocation use blocking calls and surface errors rather than fire-and-forget.
- R15. The bot acknowledges every invocation within Slack's 3-second window — e.g., an ephemeral "thinking…" placeholder for visible responses, or a deferred `response_url` reply for slash commands — and then edits/replaces the placeholder when the real response is ready.

---

## Acceptance Examples

- AE1. **Covers R5, R7.** Given two Slack workspace members A and B who are both linked ThinkWork users in the same tenant, when A @mentions the bot in #finance, the response posts in-thread attributed to A's Computer, routed to A's per-user Computer with A's memory and MCP tools; the response is unaffected by B's existence in the same channel.
- AE2. **Covers R9, R11.** Given Slack workspace member C who has not yet linked a ThinkWork account, when C @mentions the bot, the bot replies in-thread with a brief "I can't act for you yet" message and DMs C a link to complete account linking; after C completes linking, subsequent invocations from any surface proceed normally.
- AE3. **Covers R4, R8.** Given linked user A invokes `/thinkwork what was Q3 revenue?` in #finance, when the Computer responds, the message is visible only to A and includes a "Post to channel" button; clicking the button posts a public in-channel message attributed to A's Computer.
- AE4. **Covers R10.** Given a thread in #board-prep containing four prior messages and a PDF attachment, when A @mentions the bot in that thread, the Computer receives the four messages and a reference to the PDF as input context, and does not receive other channel messages outside that thread.
- AE5. **Covers R1, R12, R16.** Given Tenant T1 has installed the app in Workspace W1, when a Slack admin in Workspace W2 installs the app and binds it to T1, both workspaces are bound to T1 with independent bot users in each workspace. A ThinkWork user U who is a member of both W1 and W2 may link in either or both; an invocation from W1 uses the W1 binding for identity resolution, while invoking from W2 uses the W2 binding.
- AE6. **Covers R15.** Given any v1 trigger surface, when invocation latency exceeds Slack's 3-second window, the bot has already acknowledged the request (placeholder or deferred response) before the window expires, and the actual answer arrives by editing/replacing the placeholder.

---

## Success Criteria

- Operators can, from inside Slack, invoke their Computer on a thread's content and have the response land where the team is already looking — measured by qualitative confirmation that the financial-doc scene (and analogues) becomes a one-step action rather than a copy-paste round trip.
- Enterprise Slack admins (and their IT review) accept the install footprint as "one app, standard OAuth scopes" — no per-user bot proliferation in the workspace.
- Per-user identity, memory, and MCP isolation is preserved end-to-end: a Computer invoked from Slack behaves identically to the same Computer invoked from mobile or admin in terms of access, memory, and capability.
- A downstream planner can read this doc and produce a build plan without re-deciding which triggers ship, how attribution surfaces, or how unlinked Slack users are handled.

---

## Scope Boundaries

- No ambient channel reading and no channel-scoped memory — every Computer post is in direct response to an explicit invocation. The "channel-resident analyst" pattern (Approach D in brainstorm dialogue) is a deliberate follow-on once trust and UX patterns are proven.
- No auto-volunteered responses on file drops, channel events, or message keywords.
- No per-user Slack bots (Approach A) — single bot user per workspace, even when a tenant spans multiple workspaces.
- No cross-workspace context: a Computer invocation runs against the user's per-user Computer (same memory and MCP tools regardless of which workspace they invoked from), but the Slack-side context bundled into the task (thread history, files) is scoped to the workspace where the invocation happened.
- No rendering of TSX or interactive artifacts inside Slack; responses are markdown, Slack Block Kit, or file attachments only. The richer artifact substrate stays in the mobile/admin Computer surface.
- No Slack-side configuration UI in the admin SPA beyond what's required for workspace install; per-user linking is self-serve from mobile (per the existing "user opt-in over admin config" pattern).
- No Slack Connect / shared-channel / external-org handling in v1 — restricted to the installing workspace's own members.
- No new Slack-side admin reporting or audit surface in v1; invocations are observable through ThinkWork's existing audit/compliance event log.

---

## Key Decisions

- **Single tenant-shared bot over per-user bots (Approach B over A):** enterprise IT can't tolerate N-bots-per-workspace at the scale of 4 enterprises × 100+ users; attribution-in-copy is the acceptable trade-off.
- **Many Slack workspaces per ThinkWork tenant is supported in v1:** at least one imminent enterprise pilot has users spread across multiple Slack workspaces who share a tenant; supporting this in v1 avoids a hard re-architecture later. Each workspace install is independent; per-user linking is per-workspace.
- **All four trigger surfaces in v1:** bundles the install / permissions / OAuth fight into a single shipment and avoids a "second v1 for the remaining triggers" cycle.
- **Per-user Computer identity preserved end-to-end:** a Slack invocation runs against the same Computer the user reaches from mobile/admin; no Slack-specific Computer flavor.
- **Per-user linking is self-serve from mobile, not configured by tenant admins:** workspace install is necessarily admin-mediated (Slack requirement), but everything beyond that follows the established "user opt-in over admin config" pattern.
- **DM mode is in v1 even though it makes Slack a third full Computer client surface alongside mobile/admin:** the cost is accepted; the user explicitly chose this scope in dialogue.
- **Slack output substrate is text/markdown/Block Kit/files only:** the richer TSX-artifact vocabulary stays in the Computer surface; not duplicated into Slack.
- **Per-message attribution via username + avatar overrides:** preferred for visual distinctness in multi-Computer channels; accepted cost is requiring the `chat:write.customize` scope, which a small subset of enterprise IT reviews historically flag (mitigation: keep the username always-suffixed with "'s Computer" so there's no ambiguity it's a bot).

---

## Dependencies / Assumptions

- Assumes the existing per-user Slack OAuth/MCP credential model (per the 2026-05-14 connectors-retirement brainstorm) can be extended to host a new workspace-level app install alongside per-user tokens. Not verified against current code — flagged for planning.
- Assumes the platform's computer-task enqueue + completion-callback path is the right wakeup substrate for inbound Slack events, consistent with the established rule that automation triggers must enqueue computer tasks rather than agent wakeup requests.
- Assumes Slack's per-message attribution affordances (`username` + `icon_url` overrides on `chat.postMessage`, or an in-body prefix) are sufficient to disambiguate "whose Computer answered" in shared channels. Concrete visual pattern is a planning question.
- Assumes the existing Cognito tenant identity (mobile-managed) is the system of record for the Slack ↔ ThinkWork user binding, keyed on (Slack workspace ID, Slack user ID).

---

## Outstanding Questions

### Resolve Before Planning

_None — all blocking decisions resolved during brainstorm._

### Deferred to Planning

- [Affects R14][Technical] Should the inbound Slack-events handler be a new Lambda + API Gateway endpoint, or reuse the existing webhook-ingest path? Affects deployment, retry policy, and idempotency story.
- [Affects R3, R14][Technical] How do Slack-DM threads coexist with the user's existing mobile/admin Computer threads in storage? Same thread record, separate but memory-aggregated, or fully separate threads? Memory aggregates per user (established rule); the thread surface is open.
- [Affects R15][Needs research] Confirm Slack's acknowledgement requirements across all four trigger types and which deferred-response pattern fits each (`response_url` for slash commands, `chat.postMessage` placeholder vs Block Kit loading states for events).
- [Affects R7, R13][Needs research] Enumerate the minimum-viable Slack OAuth scopes for v1 (`app_mentions:read`, `chat:write`, `chat:write.customize` for R7 attribution overrides, `im:history`, `commands`, `files:read` at minimum) and pre-draft the IT-review-friendly justification for `chat:write.customize` since that scope is the most likely friction point.
- [Affects R10][Technical] How much thread history is bundled as Computer input — entire thread, last N messages, attachments-only, or token-budgeted slice? Affects context size and privacy footprint.
- [Affects R7][Technical] How are linked-user identities surfaced inside the Computer's task context — Slack user ID, email, display name, all three? Needed for the Computer to compose attribution prefixes and to memory-key per-invocation context.
