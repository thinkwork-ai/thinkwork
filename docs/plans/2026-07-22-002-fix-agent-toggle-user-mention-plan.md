---
title: Toggle Off Agent When User Mentioned - Plan
type: fix
date: 2026-07-22
topic: agent-toggle-user-mention
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Toggle Off Agent When User Mentioned - Plan

## Goal Capsule

- **Objective:** When a composer draft @mentions another human user, the "Send to agent" toggle visibly unchecks by default — in every composer, including the web follow-up composer of a thread whose server Thread Mode is AGENT.
- **Product authority:** THINK-328 (Eric Odom); Thread Mode semantics pinned by THINK-136 remain authoritative for dispatch.
- **Open blockers:** none.

---

## Product Contract

### Summary

Fix the composer agent-toggle default so a draft mention of another human always unchecks "Send to agent". The server already suppresses AUTO dispatch for such messages; this change makes the client toggle tell the truth and keeps all existing override and agent-mention semantics intact.

### Problem Frame

Mentioning a human in a thread message means the message is directed at that human, so the agent should stay quiet by default. The shared derivation in `apps/web/src/lib/agent-mode.ts` already encodes this — but `deriveAgentDefault` short-circuits on a known server Thread Mode, ignoring draft mentions entirely. In the common case — an existing single-player thread (server mode AGENT) — mentioning a user in the follow-up composer leaves the toggle visibly checked (the state shown in the THINK-328 screenshot). The message then sends as AUTO and the server correctly does not dispatch the agent, so the UI lies in both directions: the sender believes the agent will reply when it won't, and a checked-but-silent toggle reads as the agent being broken.

### Key Decisions

- **A draft user-mention outranks the server-mode default on the client.** The server Thread Mode is a snapshot from before the draft existed; the draft mention is newer information, and the server itself will count that mention when the message lands (participants are inserted before dispatch-mode resolution in `sendMessage`). Client precedence becomes: agent-mention force-on > manual override > draft user-mention > server mode > local history heuristic.
- **Auto-uncheck is a default change, not a forced dispatch value.** The untouched toggle keeps sending `AUTO` so the server stays the dispatch authority; this fix does not emit `FORCE_OFF` on the user's behalf. Rejected alternative: hard-forcing `FORCE_OFF` on mention — it would break the manual re-check path and shift authority to the client.
- **No server changes.** The AUTO dispatch gate already derives Multiplayer from the freshly mentioned participant and suppresses the default agent turn; rejected alternative: re-fetching or subscribing to thread mode pre-send, which is heavier and solves nothing the client derivation can't.
- **Mobile stays on its legacy boolean.** Mobile already derives its toggle default from draft mentions; migrating it to the `agentDispatch` tri-state is a separate follow-up, not part of this fix.

### Requirements

**Toggle behavior (web)**

- R1. When the draft mentions another human user, the "Send to agent" toggle unchecks automatically in both web composers (new-thread and follow-up), including when the thread's server Thread Mode is AGENT.
- R2. Removing the mention from the draft before sending restores the derived default, provided the user has not manually toggled during this draft.
- R3. The auto-uncheck is a default change only: it must not mark the toggle as manually overridden, and an untouched toggle continues to send `AUTO`.
- R4. Manual override still wins in both directions: re-checking after an auto-uncheck dispatches the agent (`FORCE_ON`); manually unchecking keeps `FORCE_OFF`. Existing override persistence within a draft is unchanged.
- R5. A default-agent alias (`@agent`/`@think`) in the draft keeps the toggle forced ON regardless of user mentions, matching the server's mention-dispatch route.

**Mobile parity**

- R6. Mobile composers keep the same visible behavior: selecting a user mention unchecks the toggle, and the sent message does not trigger a default agent turn while agent-mention engagement still works.

**Typed-mention parity (should-have)**

- R7. A user mention typed as plain text that matches a known tenant mention target should also trigger the uncheck, so the toggle agrees with the server-side text scan that will parse it as a mention.

### Acceptance Examples

- AE1. **Covers R1, R3.** Given an existing single-player thread (server mode AGENT), when the user picks `@Bob` from the mention menu in the follow-up composer, then the toggle unchecks immediately; sending without touching the toggle produces no agent turn, and Bob is added as a subscribed participant and notified.
- AE2. **Covers R4.** Given AE1's state, when the user re-checks the toggle and sends, then the message carries `FORCE_ON` and the agent responds.
- AE3. **Covers R2.** Given AE1's state with no manual toggle, when the user deletes the `@Bob` text before sending, then the toggle re-checks to the single-player default.
- AE4. **Covers R5.** Given a draft containing both `@agent` and `@Bob`, then the toggle shows forced ON and sending dispatches the agent via the mention route.
- AE5. **Covers R6.** Given a mobile thread composer, when the user selects a mention from autocomplete, then the toggle unchecks and the sent message suppresses the default agent turn without affecting agent-mention dispatch.

### Scope Boundaries

- No server dispatch changes — the AUTO gate and mention-participant counting are already correct.
- No mobile migration from the legacy `agentRequested` boolean to the `agentDispatch` tri-state (separate follow-up).
- No detection of users mentioned in prior thread history who have not replied — server Thread Mode already covers that case.
- No changes to mention notifications, thread-participant behavior, or the Thread Mode model itself.

### Outstanding Questions

- **Deferred to Planning:** mechanism and cost for R7 (typed-mention detection against loaded mention targets vs. picker-only); if disproportionate, R7 may ship as a follow-up.

### Sources

- Shared default derivation and the serverMode short-circuit: `apps/web/src/lib/agent-mode.ts` (`deriveAgentDefault`, `deriveAgentDispatch`).
- Web follow-up composer wiring (passes `serverMode`, tracks `agentOverriddenRef`): `apps/web/src/components/workbench/TaskThreadView.tsx` (~3453–3560).
- Web new-thread composer (draft-mention derivation already works, no serverMode): `apps/web/src/components/workbench/SpacesComposer.tsx` (~170–215).
- Server AUTO gate counting freshly mentioned participants: `packages/api/src/graphql/resolvers/messages/sendMessage.mutation.ts` (post-commit Thread Mode block) and `sendMessage.agent-handling.ts` (`shouldDispatchDefaultAgentTurn`).
- Mobile derivation from draft mentions and legacy boolean send: `apps/mobile/app/thread/[threadId]/index.tsx` (~1019–1115).
