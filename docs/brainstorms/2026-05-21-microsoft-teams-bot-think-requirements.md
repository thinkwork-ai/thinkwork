---
date: 2026-05-21
topic: microsoft-teams-bot-think
---

# ThinkWork Microsoft Teams Bot — `@think` Invocation Requirements

## Summary

A Microsoft Teams bot that lets any linked Teams user invoke ThinkWork from a DM, group chat, or any channel the bot is added to by mentioning `@think <prompt>`. Each invocation creates a thread in the tenant's default `general` Space, carrying Teams context (channel id/name, parent activity, AAD requester) as metadata for the Spaces-side router to consume. The agent response streams back to the same Teams conversation; identity binds via AAD email match to a ThinkWork user, with a one-tap link card on no match.

---

## Problem Frame

ThinkWork's first enterprise customer requires that the platform be available inside Microsoft Teams — the chat surface their organization already lives in. ThinkWork today reaches users through the Computer web app, mobile, and a Slack workspace app. There is no Teams ingress.

The Slack precedent (`docs/brainstorms/2026-05-17-shared-computers-slack-requirements.md`) solved the same general problem against a tighter routing model — slug-named Spaces, explicit assignment, multiple-target pickers, attribution rules. For Teams, the customer's day-to-day need is general-purpose ("we want ThinkWork accessible from where our people already work"), not workflow-specific. Forcing the Slack-style picker and per-conversation binding ceremony into Teams adds setup friction that doesn't pay back on day one, and the team is concurrently building Spaces-side context routing that can decide thread placement after the fact. The right Teams v1 keeps invocation friction at zero on the Teams side and lets that server-side routing absorb the work the surface used to do.

---

## Actors

- A1. Teams requester: a Teams user mentioning `@think` from a DM, group chat, or channel where the bot is present.
- A2. Tenant admin: approves the multi-tenant ThinkWork bot for the customer's Azure AD and connects the Azure tenant to the ThinkWork tenant.
- A3. ThinkWork identity service: maps an AAD object id (and email) to an existing ThinkWork user; surfaces an account-link card when no match exists.
- A4. Teams ingress runtime: validates Bot Framework JWTs, normalizes Teams activities, attaches Teams context metadata, and creates threads.
- A5. Spaces-side context router: out of scope here; consumes the Teams metadata attached to threads and decides whether to re-target a thread away from `general`.
- A6. Default Space `general`: the tenant-wide default Space all Teams invocations land in initially.

---

## Key Flows

- F1. Tenant admin installs the bot
  - **Trigger:** Customer's Azure AD admin grants admin consent for the published multi-tenant ThinkWork Teams app; the Azure tenant is linked to a ThinkWork tenant.
  - **Actors:** A2
  - **Steps:** Admin approves the app in Azure / Teams App Store. A tenant-link record connects the customer's Azure AD tenant id to the ThinkWork tenant. Users can now add the bot to channels or DM it.
  - **Outcome:** The bot is discoverable by users in the customer's Teams org without being auto-installed in every channel.
  - **Covered by:** R1, R2, R3

- F2. End user adds the bot to a channel or DM
  - **Trigger:** A Teams user adds the bot to a channel or opens a DM/personal chat with it.
  - **Actors:** A1
  - **Steps:** Teams sends the install event to the ingress runtime. The bot posts a short welcome card naming the invocation pattern (`@think <prompt>`). No channel-to-Space binding is created.
  - **Outcome:** The bot is usable immediately via `@think <prompt>` in that conversation; no setup, picker, or binding step is required.
  - **Covered by:** R4, R5

- F3. First `@think` invocation by an unlinked user
  - **Trigger:** A Teams user `@think`s for the first time and their AAD identity does not match an existing ThinkWork user in the linked tenant.
  - **Actors:** A1, A3
  - **Steps:** The ingress runtime extracts the requester's AAD object id, looks up their email via Microsoft Graph, and finds no matching ThinkWork user. The bot replies with an adaptive "link your account" card carrying a signed time-bounded link to the ThinkWork sign-in flow. No thread is created until linking succeeds.
  - **Outcome:** The user completes account linking on the web; subsequent `@think` invocations are recognized as that ThinkWork user.
  - **Covered by:** R6, R7, R8, R9

- F4. `@think` invocation in a channel, group chat, or DM
  - **Trigger:** A linked Teams user mentions `@think <prompt>` in any conversation containing the bot.
  - **Actors:** A1, A4, A6
  - **Steps:** Bot Framework JWT is validated. The ingress runtime strips the `@think` mention, captures Teams context (Azure tenant id, conversation id, channel id and display name when available, parent activity id when a reply, AAD object id, display name, email), and creates a thread in the tenant's `general` default Space attributed to the linked ThinkWork user as requester. The Teams context is persisted on the thread so the Spaces-side router can re-target later. The agent response streams back to the same Teams conversation via an adaptive card update.
  - **Outcome:** The user gets a streamed reply in place; the thread is browsable in ThinkWork exactly as if it had been created from the web app, with Teams provenance on every message.
  - **Covered by:** R10, R11, R12, R13, R14, R15, R16

- F5. Private-Space content surfaces in a public Teams channel
  - **Trigger:** A linked user with access to a private Space `@think`s in a Teams channel that includes non-Space-members.
  - **Actors:** A1
  - **Steps:** The thread is created in `general` because Teams-side routing always lands there. If the Spaces-side router later re-targets the thread to a private Space the requester has access to, the thread becomes private in ThinkWork — but the original Teams reply was already posted in the public Teams channel and is not retroactively redacted.
  - **Outcome:** Cross-surface visibility differs from Space access. Behavior is explicit so neither the product nor users assume Teams channel membership and Space membership are the same access boundary.
  - **Covered by:** R17, R18

---

## Requirements

**Installation and identity**
- R1. The Teams bot must be implemented as a single multi-tenant Bot Framework app (one Microsoft App ID for all ThinkWork customer tenants), not per-tenant app registrations.
- R2. Bot Framework JWT validation must accept tokens from the standard Microsoft service URLs (`smba.trafficmanager.net` and its regional variants) and reject all others.
- R3. A tenant-link record must connect a customer's Azure AD tenant id to a ThinkWork tenant id; activities from an unlinked Azure tenant must be rejected.
- R4. The bot manifest must declare `personal`, `team`, and `groupChat` scopes (DM, channel, group chat).
- R5. The bot must not require channel ↔ Space binding or any per-channel setup step before `@think` is usable.
- R6. The first `@think` from an unrecognized AAD identity must respond with an account-link card and must not create a thread until linking completes.
- R7. Identity resolution must look up the requester's email via Microsoft Graph (`/users/{aadObjectId}`) and match to an existing ThinkWork user by email within the linked tenant.
- R8. A successful account link must store the AAD object id against the ThinkWork user so subsequent invocations skip the link step.
- R9. The account-link card must carry a signed, time-bounded link; the link must not be reusable across users.

**Invocation and threading**
- R10. The bot must accept `@think <prompt>` from DMs, group chats, and any channel the bot has been added to, with no additional invocation prefix or argument.
- R11. The bot must strip the `@think` mention (Teams `<at>` XML tags) from the prompt before forwarding it as user input.
- R12. The mention syntax must not support `+agent`, `+space`, or any explicit selector. A leading `+token` in the prompt must be treated as prompt content, not as a selector.
- R13. Every invocation must create a thread in the tenant's `general` default Space attributed to the linked ThinkWork user as requester.
- R14. Every thread created from Teams must persist Teams context metadata: customer Azure tenant id, Teams conversation id, channel id and display name when available, parent activity id when a reply-in-thread, AAD object id, AAD display name, requester email.
- R15. The Spaces-side context router (out of scope here) must be able to read the persisted Teams metadata from the thread and re-target the thread to another Space without any additional Teams-side data fetch.
- R16. Streamed agent responses must update a single adaptive card in the same Teams conversation, terminating in a final response card with inline footnotes/citations.

**Access and visibility**
- R17. Space access (public/private) must be enforced by the requester's membership at thread creation, exactly as in-app invocation enforces it; Teams channel membership must not grant or deny Space access.
- R18. The Teams reply must post to the Teams conversation regardless of whether the thread is later re-targeted to a private Space; no retroactive redaction of Teams messages is performed.

**Failure surfaces**
- R19. If the requester's Azure tenant is not linked to a ThinkWork tenant, the bot must reply with an admin-action prompt naming the connection requirement and must not create a thread.
- R20. If Microsoft Graph email lookup fails or returns no email, the bot must surface a clear error and must not create a thread or attempt to match by display name.
- R21. Bot Framework adapter errors must surface a user-visible error reply and must log the underlying error server-side with the Teams activity id for correlation.

---

## Acceptance Examples

- AE1. **Covers R6, R7, R8.** Given an Azure AD user whose email matches no ThinkWork user in their tenant, when they `@think` in any Teams conversation, then the bot replies with an account-link card and no thread is created. After they complete linking and `@think` again, a thread is created and they are attributed as the requester.
- AE2. **Covers R10, R13, R14.** Given a linked user in a Teams channel named `sales-deals`, when they post `@think summarize this account`, then a thread is created in the tenant's `general` Space attributed to that user, with Teams metadata that includes the channel id, channel name `sales-deals`, AAD object id, and requester email.
- AE3. **Covers R10, R13.** Given a linked user in a DM with the bot, when they post `@think what's on my calendar today`, then a thread is created in the tenant's `general` Space with DM-conversation metadata and the response streams back into the DM.
- AE4. **Covers R12.** Given a linked user posts `@think +sales summarize this account`, when the message is processed, then `+sales` is treated as part of the prompt content (not as a selector) and routing remains the default `general` Space.
- AE5. **Covers R5.** Given the bot is freshly added to a channel and no admin has configured anything, when a linked user `@think`s, then the invocation succeeds without any setup card, picker, or binding step.
- AE6. **Covers R17, R18.** Given a linked user is a member of a private Space `engineering-secrets` and they `@think summarize last week's incidents` in a public Teams channel, when the Spaces-side router later re-targets the resulting thread to `engineering-secrets`, then the thread is private in ThinkWork but the original Teams reply remains visible in the public Teams channel.
- AE7. **Covers R19.** Given the bot is mentioned by a user from an Azure tenant that is not linked to any ThinkWork tenant, when they `@think`, then the bot replies with text directing them to ask their admin to complete the ThinkWork connection and no thread is created.

---

## Success Criteria

- A linked Teams user can `@think <prompt>` in a channel, group chat, or DM and get a streamed reply, with the resulting thread visible in the Computer web app exactly as if they had typed it there.
- The customer's Azure AD admin needs to perform exactly one consent action; per-user adoption (adding the bot to channels, DMing it) is then self-service.
- Threads created from Teams carry enough Teams metadata that the Spaces-side context router can re-target them without any additional Teams-side data fetch.
- A reviewer can trace any Teams thread back to a Teams conversation id, channel name, and requester AAD identity from the thread alone.
- Planning can begin without inventing user-facing invocation syntax, identity-link UX, or thread routing rules — those are pinned in this doc.

---

## Scope Boundaries

- No channel ↔ Space binding, picker, or "select your Space" affordance in v1.
- No `+agent`, `+space`, or any prefix selector in the mention syntax.
- No outbound posting from Spaces to Teams — agent results are posted in reply to the originating Teams invocation only; no proactive cards pushed to other channels.
- No file attachment, image, or rich-content ingestion from Teams in v1.
- No interactive tool-approval cards in Teams in v1; tool approvals continue to use the in-app surface.
- No slash commands, message extensions, app home tabs, or messaging-extension search.
- No Microsoft Graph directory sync, channel-roster reads, member sync, or AAD writeback. The bot reads only the requester's email and display name.
- No retroactive redaction or deletion of Teams replies when a thread is later re-targeted to a private Space.
- No per-tenant bot registrations or per-tenant manifest variants — one multi-tenant published app serves all customers.
- No automatic provisioning of ThinkWork users from AAD identities — unmatched users must explicitly link.

---

## Key Decisions

- **`@think` everywhere, no per-conversation setup.** Maximizes adoption surface and minimizes admin/user friction. The Spaces-side context router earns the per-thread targeting decision that channel binding would have made structural.
- **Default Space `general` catches every invocation.** Reuses the existing tenant default and existing thread substrate; no Teams-specific Space concept is introduced.
- **Multi-tenant published Bot Framework app, admin-consent install path (customer-confirmed 2026-05-21).** The customer's Azure AD admin will grant admin-consent for the published ThinkWork Teams app; sideloaded tenant-private app packages are not on the table for v1. Mirrors the Dust Teams app shape (the dust repo's `connectors/teams-app-package/manifest.json` is a reference, not a dependency) and reduces per-customer onboarding to a single Azure AD admin consent.
- **AAD email-match with link-card fallback.** Matches the Slack precedent's identity-binding pattern (email is the join key) while accepting that some users may not have email in their AAD profile and need an explicit link flow.
- **Public/private Space access stays a property of the requester's Space membership, not Teams channel membership.** Avoids inventing a cross-surface access model. Cross-surface visibility — a public Teams channel revealing private-Space content — is named explicitly rather than blocked, because blocking it would require reading channel rosters and overriding the requester's own access.
- **Defer outbound posting and file attachments.** Each is a non-trivial surface that adds week-class scope without serving the day-one "available in Teams" requirement.

---

## Dependencies / Assumptions

- The Spaces-side context router that decides whether a thread stays in `general` or moves elsewhere is already in place ahead of this Teams bot (confirmed 2026-05-21). Teams threads will be re-targeted out of `general` from day one; no Teams-side hint is required to manage user expectations about the landing state.
- The customer's Azure AD admin will grant admin consent for the published multi-tenant ThinkWork app (customer-confirmed 2026-05-21). No sideloaded variant is required.
- AAD profiles for the customer's users include a non-empty `mail` field reachable via Microsoft Graph `/users/{aadObjectId}`. Users without a Graph-accessible email cannot link.
- The existing default Space (`general`, defined in `packages/api/src/lib/spaces/default-space.ts`) is the correct landing target. If "default Space" semantics change (e.g., per-user default), R13 changes.
- The ThinkWork user model can carry an AAD object id per user (one-to-one with the ThinkWork user, mirroring `slack_user_links` from `packages/database-pg/src/schema/slack.ts`).
- Microsoft 365 Agents SDK (`@microsoft/agents-hosting` + `@microsoft/agents-hosting-extensions-teams`) is the runtime dependency for Bot Framework JWT validation and Teams scope handling, replacing the now-archived `botbuilder-js` (archived 2026-01-05). `AgentApplication` is the activity-handler class used (not the soft-deprecated `ActivityHandler`).

---

## Outstanding Questions

### Deferred to Planning

- [Affects R7, R8][Technical] AAD object id storage — extend an existing identity table or add a new `teams_user_links` table mirroring `slack_user_links`?
- [Affects R14][Technical] Exact shape of the Teams metadata persisted on the thread — typed column on `threads` vs JSON in an existing `metadata` field vs a side `teams_thread_origins` table — and which existing thread-write path receives it.
- [Affects R9][Technical] Account-link card token format and signing approach. Slack's existing user-link flow may be the right model to extend rather than introduce a new one.
- [Affects R16][Technical] Adaptive card streaming pattern — single card with replace-on-update vs append-only thread of cards. The Dust `createStreamingAdaptiveCard` pattern at `connectors/src/api/webhooks/teams/adaptive_cards.ts` in the dust repo is the reference implementation to evaluate.
- [Affects R2, R21][Needs research] Whether to host the Teams ingress as a new Lambda handler (mirroring `packages/lambda/*` patterns) or as a route on the existing HTTP API surface. Bot Framework expects synchronous turn-by-turn responses and may push for a dedicated handler.
- [Affects R19][Technical] Whether and how to expose tenant-link state to admin so they can see / debug "Teams is connected" vs "needs admin consent."
