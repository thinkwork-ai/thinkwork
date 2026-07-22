---
title: Toggle Off Agent When User Mentioned - Plan
type: fix
date: 2026-07-22
topic: agent-toggle-user-mention
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
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
- AE6. **Covers R7.** Given a follow-up composer in an AGENT-mode thread, when the user types another user's display name as plain text (`@Bob` typed fully, no picker selection), then the toggle unchecks; deleting the text before sending re-checks it to the single-player default.

### Scope Boundaries

- No server dispatch changes — the AUTO gate and mention-participant counting are already correct.
- No mobile migration from the legacy `agentRequested` boolean to the `agentDispatch` tri-state (separate follow-up).
- No detection of users mentioned in prior thread history who have not replied — server Thread Mode already covers that case.
- No changes to mention notifications, thread-participant behavior, or the Thread Mode model itself.

### Outstanding Questions

- None. The one question deferred from Brainstorming (mechanism/cost for R7 typed-mention detection) is resolved in the Planning Contract: KTD3 ships R7 in scope via a client-side mirror of the server text scan.

### Sources

- Shared default derivation and the serverMode short-circuit: `apps/web/src/lib/agent-mode.ts` (`deriveAgentDefault`, `deriveAgentDispatch`).
- Web follow-up composer wiring (passes `serverMode`, tracks `agentOverriddenRef`): `apps/web/src/components/workbench/TaskThreadView.tsx` (`FollowUpComposer`, ~3450–3560).
- Web new-thread composer (draft-mention derivation already works, no serverMode): `apps/web/src/components/workbench/SpacesComposer.tsx` (~170–215).
- Server AUTO gate counting freshly mentioned participants: `packages/api/src/graphql/resolvers/messages/sendMessage.mutation.ts` (post-commit Thread Mode block) and `sendMessage.agent-handling.ts` (`shouldDispatchDefaultAgentTurn`).
- Server typed-mention text scan the client must mirror for R7: `packages/api/src/lib/mentions/parse-message-mentions.ts` (`findTextMentions` — boundary-anchored, case-insensitive match of `@` + displayName/alias).
- Web mention target shape and picker filter: `apps/web/src/components/spaces/MentionMenu.tsx` (`MentionTarget`, `filterMentionTargets`).
- Mobile derivation from draft mentions and legacy boolean send: `apps/mobile/app/thread/[threadId]/index.tsx` (~1019–1115).

---

## Planning Contract

Product Contract preservation: unchanged. R7 (typed-mention parity, should-have) is resolved **in scope** — see KTD3.

### Key Technical Decisions

- KTD1. **Reorder precedence inside `deriveAgentDefault`, not in the composers.** The draft-user-mention check moves ahead of the `serverMode` short-circuit in `apps/web/src/lib/agent-mode.ts`: draft mentions another human → `multi`/off; otherwise `serverMode` wins; otherwise the history heuristic. A draft user-mention can only ever force `multi` (uncheck) — it never converts a `MULTIPLAYER` thread to `single`, so `serverMode: MULTIPLAYER` behavior is untouched. Both web composers share this helper, so the fix lands once and cannot drift between them.
- KTD2. **Derive draft mentions from the live text, not raw picker state.** Both composers currently pass their `mentions` state to `deriveAgentDefault` unfiltered; stale entries survive after the user deletes the `@Name` text (they are filtered only at submit via `content.includes(mention.rawText)`). R2/AE3 (deleting the mention restores the default) requires applying that same rawText-presence filter at derivation time. A new shared helper owns this so both composers stay identical.
- KTD3. **R7 ships in scope via a client-side mirror of the server text scan.** `findTextMentions` on the server is a small boundary-anchored, case-insensitive regex over each target's displayName + aliases (`(^|\s)@alias(?=$|\s|[.,!?;:])`). The web composers already hold `mentionTargets` carrying the same `displayName`/`aliases` fields, so the client mirror is a ~30-line pure function — proportionate, not a follow-up. Scanning only USER-type targets (excluding the current user) keeps agent aliases on their existing force-on path. Client/server parity means any over- or under-match is at least *consistent* with what the server will parse at send.
- KTD4. **`agent-mode.ts` stays import-free of composer modules.** The new helper takes a minimal structural mention-target shape (`targetType`, `targetId`, `displayName`, `aliases`), structurally satisfied by `MentionMenu.tsx`'s `MentionTarget`, preserving the file's existing dependency philosophy.
- KTD5. **Component tests only where a harness already exists.** `apps/web/src/components/workbench/SpacesComposer.test.tsx` is an existing @testing-library/react harness that already asserts agent-toggle behavior ("passes agent opt-out through submit", "forces agent handling on for @agent and @think aliases") — U2 extends it with a user-mention-unchecks case and must keep its existing toggle tests green. `FollowUpComposer` (inside `TaskThreadView.tsx`) has no equivalent render harness; its wiring is proven by the browser Verification Contract, and introducing a first-ever harness for it is out of scope. The derivation logic itself is covered by `agent-mode.test.ts`.

### Assumptions (headless run — recorded, not user-confirmed)

- No child Linear issues: the change is one small client-only PR (one lib file, two composer wirings plus prop plumbing, two test files); implementation proceeds on THINK-328 directly. A child split would duplicate the parent.
- U1 and U2 land in a single PR (justification in U2) — U1's helpers are dead code without the composer wiring, and the defect is only observable with both in place.

---

## Implementation Units

### U1. Precedence fix + draft-mention resolution helpers in agent-mode lib

**Goal:** `deriveAgentDefault` honors draft user-mentions ahead of `serverMode`, and a new shared helper resolves the effective draft mentions (live-text-filtered structured mentions + typed plain-text matches).

**Requirements:** R1, R2, R3, R5, R7 (logic layer). KTD1–KTD4.

**Dependencies:** none.

**Files:**
- `apps/web/src/lib/agent-mode.ts` (modify)
- `apps/web/src/lib/agent-mode.test.ts` (extend)

**Approach:**
- In `deriveAgentDefault`, evaluate the draft-mentions-another-user predicate (already in `deriveAgentMode`) before the `serverMode` short-circuit; when true return `multi`/off. All other paths unchanged, including `deriveAgentDispatch`.
- Add an exported helper that both composers call to build `draftMentions`, taking `{ text, structuredMentions, mentionTargets, currentUserId }` with minimal structural types: (a) keeps structured mentions whose `rawText` still appears in `text` (mirror of the submit-time filter), (b) scans `text` for typed matches against USER-type mention targets' displayName/aliases using the same boundary-anchored case-insensitive pattern as the server's `findTextMentions`, excluding the current user. Returns `AgentModeMention[]`.

**Test scenarios** (in `apps/web/src/lib/agent-mode.test.ts`):
- Covers AE1. `serverMode: "AGENT"` + draft mention of another user → `{ mode: "multi", agentDefaultOn: false }` (the THINK-328 defect).
- `serverMode: "AGENT"` + draft self-mention only → single/on. + agent or agent-profile mention only → single/on (R5 boundary).
- `serverMode: "MULTIPLAYER"` + no draft mentions → multi/off (unchanged).
- `serverMode` absent → all existing heuristic tests still pass unchanged.
- Helper: structured mention whose rawText was deleted from the text is dropped (R2); partial deletion (rawText no longer a substring) also drops it.
- Helper typed-scan: `@Bob Smith` matches display name case-insensitively at start/whitespace boundary; `email@bob.com` does not match (no boundary before `@`); `@Bobby` does not match target `Bob` (trailing-boundary lookahead); alias match works; the current user's own name never matches; AGENT/AGENT_PROFILE targets are never returned; punctuation terminator (`@Bob,`) matches.
- Helper merge: structured + typed mention of the same target dedupes to one entry.
- Unknown `currentUserId` (null/undefined): typed USER-target matches still count as other-user mentions (pins the existing `deriveAgentMode` semantics, where any user mention is "other" when the current user is unknown).

**Verification:** `npx vitest run src/lib/agent-mode.test.ts` green from `apps/web`; typecheck green.

### U2. Wire both web composers through the shared helper

**Goal:** The follow-up composer (`FollowUpComposer`) and new-thread composer (`SpacesComposer`) derive `draftMentions` from the U1 helper, making the toggle uncheck on picked or typed user mentions in every web composer, including AGENT-mode threads.

**Requirements:** R1, R2, R3, R4, R5, R7 (surface layer). AE1–AE4.

**Dependencies:** U1.

**Files:**
- `apps/web/src/components/workbench/TaskThreadView.tsx` (modify `FollowUpComposer`'s `agentDefaultOn` memo, ~3453)
- `apps/web/src/components/workbench/SpacesComposer.tsx` (modify `agentDefaultOn` memo, ~172; accept a `currentUserId` prop)
- `apps/web/src/components/workbench/SpacesWorkbench.tsx` (pass `currentUserId` at the `<SpacesComposer>` render site)
- `apps/web/src/components/workbench/SpacesComposer.test.tsx` (extend)

**Approach:** Replace the raw `mentions.map(...)` in each composer's `agentDefaultOn` memo with the U1 helper called on the live composer text, structured mentions state, `mentionTargets`, and `currentUserId`. `SpacesComposer` has no `currentUserId` in scope today and its render site (`SpacesWorkbench.tsx`) carries no user identity — resolve the signed-in user's id there via the web auth lib (`getCurrentUser()` in `apps/web/src/lib/auth.ts`, the same identity `TaskThreadView`'s route plumbs) and pass it down as a prop. Memo dependencies gain the text and mention-target inputs. Nothing else changes: `agentOverriddenRef` semantics (R4), `agentForcedOn` force-on (R5), the `deriveAgentDispatch` mapping and the untouched→AUTO contract (R3), and the thread-switch reset all stay as-is.

**Test scenarios** (in `apps/web/src/components/workbench/SpacesComposer.test.tsx`, per KTD5):
- A draft holding a USER mention (picked or typed display-name text) renders the "Send to agent" toggle unchecked.
- Existing agent-toggle tests ("passes agent opt-out through submit", "forces agent handling on for @agent and @think aliases") stay green.
- `FollowUpComposer` wiring: no render harness (KTD5); proven by browser flows V1–V5.

**Verification:** browser flows V1–V6 below pass on a dev-connected web build.

**Checkpoint PR boundary:** U1 + U2 ship as **one PR** (grouped-unit justification: U1 alone is dead code with no observable behavior; the fix is only verifiable with the wiring in place; combined diff is ~4 source files + 2 test files).

### U3. End-to-end verification on deployed dev (no code)

**Goal:** Prove the shipped behavior with real browser flows against the dev stack and record evidence on THINK-328.

**Requirements:** AE1–AE5, R6.

**Dependencies:** U1+U2 PR merged.

**Files:** none (evidence only).

**Approach:** Run the flows in the Verification Contract from a dev-connected browser session; capture screenshots for the toggle states and the resulting thread behavior (agent silent vs. responding). R6/AE5 (mobile) is a no-regression assertion: this change touches no mobile code, so evidence is the diff itself plus a spot-check that mobile's existing mention-uncheck behavior is unaffected on the current build; a full mobile E2E pass is not required.

**Verification:** all V-flows below observed and screenshot-evidenced in the Linear Progress document / handoff comment.

---

## Verification Contract

Quality gates (run from repo root before the PR; per repo rules the full suite, not just the touched package):

- `pnpm -r --if-present typecheck`
- `pnpm -r --if-present lint`
- `pnpm -r --if-present test` (must include the extended `apps/web/src/lib/agent-mode.test.ts`)
- `pnpm format:check`

Browser flows (drive in a real browser against deployed dev — worktree web dev server on a Cognito-allowlisted port, e.g. `pnpm --filter @thinkwork/web dev -- --host 127.0.0.1 --port 5180`, after copying `apps/web/.env` from the main checkout; Google OAuth sign-in):

- V1 (AE1 — the defect flow). Open an existing single-player thread (server Thread Mode AGENT). In the follow-up composer, pick another user from the `@` mention picker. The "Send to agent" toggle unchecks immediately. Send without touching the toggle: no agent turn starts; the mentioned user appears as a participant.
- V2 (AE2). Repeat V1's draft, then manually re-check the toggle and send: the agent responds (FORCE_ON path).
- V3 (AE3). Repeat V1's draft, then delete the `@Name` text before sending: the toggle re-checks to the single-player default.
- V4 (AE4). Draft containing both `@agent` and a user mention: toggle shows forced ON; sending dispatches the agent via the mention route.
- V5 (R7). In the follow-up composer of an AGENT-mode thread, type another user's display name as plain text (`@Bob` typed fully, no picker selection): the toggle unchecks; deleting the text re-checks it.
- V6 (R1, new-thread surface). In the new-thread composer, mention another user: the toggle unchecks before the thread is created; regression-check that an unmentioned new-thread draft keeps the toggle checked.
- V7 (AE5/R6, mobile no-regression). Confirm the merged diff touches no `apps/mobile` files; spot-check on the current mobile build that selecting a mention still unchecks the toggle.

---

## Definition of Done

- U1+U2 PR merged to main with all checks green; branch deleted.
- All Verification Contract quality gates green locally before the PR.
- V1–V7 observed against dev with evidence recorded on THINK-328.
- No server, database, terraform, or mobile changes in the diff (scope guard).
- No leftover experimental code; the diff contains only the precedence fix, the helper, the two composer wirings, and tests.

### Rollout notes

- Client-only web change: no flags, no migrations, no server deploys. Merge to main deploys nothing user-visible by itself — the dev web app ships on the desktop-v canary tag process, so U3 verification runs from a local dev server bound to a Cognito-allowlisted port against the deployed dev backend (standard dogfood path).
- Revert is a clean single-PR revert with no data or config coupling.

### Risks

- Typed-scan over-matching on short display names (e.g. a user named "Al"): the boundary-anchored pattern limits this, and any residual match mirrors what the server will parse at send — client/server agreement is the contract, so a surprising uncheck still tells the truth about dispatch.
- Per-keystroke regex scan over tenant mention targets: bounded (tenant user list is small) and memoized in the existing `agentDefaultOn` memo; no measurable cost expected.
- `FollowUpComposer` memo dependency growth (`composer.text` joins the memo inputs): recomputation per keystroke is the same cost class as the existing `mentionQuery` memo — acceptable.
- Goal Mode interaction: a goal-mode draft that mentions a human now defaults the toggle off, and the existing `goalModeBlocked` check blocks submission ("Turn on agent handling to use Goal") until the user re-checks the toggle. This is the same behavior multiplayer threads already exhibit today (server MULTIPLAYER → default off → goal blocked) — a new trigger for an existing, intentional gate, not a new behavior class. V2's manual re-check is the escape hatch; no code change needed.

### Deferred to Follow-Up Work

- Screen-reader announcement for the auto-uncheck: the toggle flips as a side effect of typing, so assistive tech gets no signal (`aria-live`) that "Send to agent" changed. Worth a small accessibility follow-up across all auto-toggle transitions (including the existing force-on path); out of scope for this fix.
- Mobile migration from the legacy `agentRequested` boolean to the `agentDispatch` tri-state (carried from Scope Boundaries).
