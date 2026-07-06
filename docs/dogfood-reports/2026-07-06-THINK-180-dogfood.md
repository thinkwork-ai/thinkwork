---
issue: THINK-180
title: "User mentions are triggering an Agent Profile"
phase: Verification (dogfood QA on deployed dev)
date: 2026-07-06
verdict: PASS (backend green; web display-fallback deferred pending next canary — noted, not blocking)
fix_pr: "#3413"
fix_commit: c8dc8130fa8743948598fe38e1038bcff8b11948
deploy_run: "28761330305 (success)"
tenant: sleek-squirrel-230 (0015953e-aa13-4cab-8398-2e70f73dda63)
---

# THINK-180 Dogfood Verification — `@` no longer delegates to an Agent Profile

## Contract under test

`@Name` (a user/agent mention) must **not** delegate to an Agent Profile.
Only `#Name` triggers Agent Profile delegation. PR #3413 scoped the profile
mention trigger from the `[#@]` character class to `#` at three sites:

1. `packages/api/src/lib/mentions/parse-message-mentions.ts:89` — API mention
   parser (**backend, load-bearing**).
2. `packages/agentcore-pi/agent-container/src/server.ts:275,292` — Pi runtime
   strip + explicit-slug parser (**backend**).
3. `apps/web/src/components/workbench/TaskThreadView.tsx:5427` — web display
   fallback regex (**display-only**).

Backend (1) + (2) ship via continuous-CD (Deploy run 28761330305, success) and
are **live on dev**. Web (3) ships only on the next `desktop-v*` canary; none
has been cut since `desktop-v0.1.0-canary.320` (checked at session start), so
(3) is **not yet deployed** — same gap THINK-178 hit. This pass is scoped to
backend-only proof (per the handoff caveat and THINK-178 precedent).

## Scenario matrix

| # | Scenario | Backend-provable now? | Signal | Result |
|---|----------|----------------------|--------|--------|
| A | Plain `@Profile` (Research is a real profile) → **no** delegation | ✅ Yes | `sendMessage` → `message.mentions` has **0** `AGENT_PROFILE` | **PASS** |
| B | `#Profile` → **does** delegate (as before) | ✅ Yes | `message.mentions` has 1 `AGENT_PROFILE`; AUTO dispatch spins a real profile-lane turn | **PASS** |
| C | `@User` (a real person) still resolves to that person | ✅ Yes | Exact repro text `@SurSum …` → `message.mentions` = 1 `USER` | **PASS** |
| — | Web display-fallback regex (`/[#@].../ → /#.../`) | ⛔ Deferred | Needs a `desktop-v*` canary; none since `.320` | **DEFERRED (non-blocking)** |

Note: the tenant `sleek-squirrel-230` has **no** `SurSum` *profile* (SurSum is
Eric's other tenant). It does have an enabled **Research** agent profile
(slug `research`) — the THNK-51 example alias — and, separately, a real **user**
named "SurSum" (eric@sursumconsulting.com). This yields the ideal split: `Research`
exercises the profile path (A/B) and `SurSum` exercises the user path (C) with
the literal screenshot text from the debug findings.

## Evidence

### Backend live proof — deployed GraphQL `sendMessage` (the exact defect code path)

`sendMessage` re-parses raw message text server-side and persists the parsed
mentions (`sendMessage.mutation.ts:246` parse → `:329` persist), independent of
dispatch. The persisted `message.mentions` is therefore a faithful, end-to-end
readout of the deployed parser — and is exactly what drives both the
delegation decision (`hasAgentProfileMentions`) and the web dispatch card
(branch 1 of `agentProfileMentionForMessage`). Sent into a dedicated thread
`955d0df7-5b67-45eb-8b6f-e1425babd79f` as Eric (Cognito refresh-grant token),
`agentDispatch: FORCE_OFF` for A/B-parse to isolate parsing:

**Scenario A** — `@Research what do you think? Can run the credit check?`
```json
{ "content": "@Research what do you think? Can run the credit check?",
  "mentions": [] }
```
→ Zero `AGENT_PROFILE` mentions. `@Research` no longer delegates. **PASS.**

**Scenario B (parse)** — `#Research please review this`
```json
{ "mentions": [ { "targetType": "AGENT_PROFILE",
                  "targetId": "244b037b-043d-42b7-be6d-ec03233b9ca3",
                  "displayName": "Research", "rawText": "#Research" } ] }
```
→ One `AGENT_PROFILE` mention, correct target + `#Research` rawText. **PASS.**

**Scenario B (positive dispatch)** — `#Research summarize the fix contract …`
with `agentDispatch: AUTO` produced a real profile-lane turn. In the browser
the expanded turn shows an **"Agent Profile: Research"** action row
(`moonshotai.kimi-k2.5 · running`, with tool invocations) — genuine
`#`-triggered delegation, not the "Waiting for profile lane activity" fallback.
**PASS.**

**Scenario C** — `@SurSum what do you think? Can run the credit check?` (the
verbatim debug-findings repro text; SurSum is a real user here)
```json
{ "mentions": [ { "targetType": "USER",
                  "targetId": "c4a834d8-30a1-70c1-9664-fa633790cf03",
                  "displayName": "SurSum", "rawText": "@SurSum" } ] }
```
→ `@` resolves to the person, **not** an Agent Profile. The exact string that
produced "Agent Profile: SurSum — Delegated via @SurSum. Waiting for profile
lane activity." in the original screenshot now yields a plain `USER` mention.
**PASS.**

### Browser dogfood (deployed web, app.thinkwork.ai)

Rendered the verification thread signed in as Eric. Observations:
- `@SurSum …` and `@Research …` render the alias as a mention **chip** with
  **no** "Delegated via @… Waiting for profile lane activity." card and **no**
  dispatched turn.
- `#Research …` (AUTO) is the only message that spun a turn; expanding it shows
  the **"Agent Profile: Research"** delegation row.
- Screenshots: `/tmp/think180-thread.png`, `/tmp/think180-turn.png` (transient
  artifacts; the thread persists on dev as `955d0df7-…`).

Why the deferred web-display-fallback did **not** confound this: the stale-web
fallback (`agentProfileMentionForMessage` branch 2, `/[#@].../`) only runs
inside `actionRowsForTurn` — i.e. only for a message that dispatched a turn. The
backend fix stops `@`-messages from dispatching a profile lane, so no bogus card
appears. The remaining `[#@]` display regex is a latent cosmetic that would only
surface if a *normal* (non-profile) turn ran on an `@`-message; it self-heals on
the next routine canary (THINK-178 precedent).

### Deterministic parser corroboration (deployed code, `parse-message-mentions.ts`)

Ran the live parser (worktree == deployed main) against the exact repro:
```
A  @SurSum (+profile target)   → agent_profile = 0   all = []
B  #SurSum (+profile target)   → agent_profile = 1   rawText = ["#SurSum"]
C  @SurSum (+user target)      → user = 1            rawText = ["@SurSum"]
D  @SurSum (+BOTH targets)     → types = ["user"]    agent_profile = 0
```
Case **D** is the decisive disambiguation: when a name is *both* a user and a
profile, `@` picks the **user** and produces **zero** profile mentions — `@`
can never trigger delegation.

## Verdicts (functional + experiential)

| Scenario | Functional | Experiential |
|---|---|---|
| A `@Profile` no-delegate | PASS — 0 `AGENT_PROFILE` mentions, no dispatch | PASS — reads as an ordinary @mention chip; no surprise delegation |
| B `#Profile` delegate | PASS — 1 `AGENT_PROFILE` mention; real Research lane turn | PASS — delegation is explicit and visible ("Agent Profile: Research") |
| C `@User` still works | PASS — resolves to `USER` target | PASS — the exact bug string now mentions a person, as a user expects |

## Paper cuts (non-blocking)

- **ProseMirror composer input via automation is finicky:** `agent-browser type`
  did not land into the contenteditable composer; per-key `press` worked but the
  editor re-rendered mid-sequence. Not a product bug — an automation ergonomics
  note. Live GraphQL `sendMessage` was the more reliable (and more faithful)
  driver of the exact server-side defect path.
- **Display strips the trigger char:** both `@` and `#` mentions render the bare
  alias as a chip (no leading sigil). Cosmetic; out of scope for THINK-180.

## Decisions for a human

_None._ Backend scenarios A/B/C are green. The web display-fallback (site 3)
is deferred pending the next `desktop-v*` canary — a note, not a decision, and
it does not manifest in any tested user flow because the backend no longer
dispatches a profile lane for `@`-mentions.

## Deferred follow-up

- The `TaskThreadView.tsx` `[#@] → #` display-fallback ships on the next
  `desktop-v*` canary (none since `.320`). No action required — routine canary
  cadence carries it (THINK-178 precedent). Re-confirm opportunistically after
  the next canary if desired; not a blocker for THINK-180.
