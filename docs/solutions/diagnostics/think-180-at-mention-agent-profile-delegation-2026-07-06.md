---
module: api
date: 2026-07-06
last_updated: 2026-07-06
problem_type: debug_findings
component: agent_profile_routing
severity: high
linear: THINK-180
status: diagnosed
supersedes_decision: THNK-51 (#2701) backward-compatible `@Profile` alias
tags:
  - agent-profiles
  - delegation
  - mentions
  - multiplayer
  - debug-artifact
  - fix-plan
---

# THINK-180: Any `@` Mention Delegates To An Agent Profile

## Problem

Eric reports (THINK-180, High, labels Bug/LFG/Claude): "Anytime there is an
`@` in the prompt, it looks like it's trying to delegate to that user or email.
This is wrong. Only `#agent` should trigger delegate to agent profile."

Screenshot evidence on the issue: a follow-up chat message
`SurSum what do you think? Can run the credit check?` (the `SurSum` token
rendered as a mention chip) produced a profile-lane dispatch card reading:

```
Agent Profile: SurSum
Delegated via @SurSum. Waiting for profile lane activity.
```

`SurSum` is an Agent Profile in the tenant. The user typed `@SurSum` (an
`@`-mention, which the composer scopes to _people/agents_, not profiles), yet
the message was delegated to the **SurSum Agent Profile lane**.

## Debug Summary

**Problem**: A plain `@Name` in message text is parsed as an Agent Profile
delegation whenever `Name` matches an Agent Profile display name or slug —
identical to `#Name`. Only `#Name` should delegate to a profile; `@` is for
user/agent mentions.

**Root Cause**: The server-side text mention scanner matches Agent Profile
aliases with the character class `[#@]` (either trigger), instead of `#` only.
So `@SurSum` matches the agent-profile pattern, is emitted as a
`targetType: "agent_profile"` mention, and drives the profile-lane dispatch.

**Confidence**: High. Root cause is empirically reproduced (below) and the
"Delegated via @SurSum" string is reproduced exactly, including the `@` prefix.

## Root Cause — full causal chain

Primary path (the screenshot: THINK-136 multiplayer profile-lane dispatch):

1. Composer send. Both web composers already scope trigger characters
   correctly — `@` offers only USER/AGENT targets, `#` offers AGENT_PROFILE —
   and insert `#` for a selected profile
   (`apps/web/src/components/workbench/SpacesComposer.tsx:155-158,328`;
   `apps/web/src/components/workbench/TaskThreadView.tsx:3441-3443,3652`). A
   plain typed `@SurSum` therefore carries **no** structured agent_profile
   mention; it is sent as raw text.
2. `sendMessage` re-parses the raw text server-side:
   `packages/api/src/graphql/resolvers/messages/sendMessage.mutation.ts:246`
   calls `parseMessageMentions({ content, targets, explicitMentions })`.
3. `parseMessageMentions` runs `findTextMentions` whenever the content contains
   `@` or `#` (`packages/api/src/lib/mentions/parse-message-mentions.ts:56`).
4. **The defect** — `packages/api/src/lib/mentions/parse-message-mentions.ts:89`:

   ```ts
   const trigger = target.targetType === "agent_profile" ? "[#@]" : "@";
   const pattern = new RegExp(
     `(^|\\s)${trigger}${escapeRegExp(alias)}(?=$|\\s|[.,!?;:])`,
     "iu",
   );
   ```

   For an agent_profile target whose alias is `SurSum`, the pattern
   `(^|\s)[#@]SurSum(?=…)` matches `@SurSum`, emitting a mention with
   `targetType: "agent_profile"` and `rawText: "@SurSum"` (lines 99-108;
   `rawText = content.slice(startOffset, startOffset + alias.length + 1)`
   includes the `@` trigger).

5. `sendMessage.mutation.ts:254` sets `hasAgentProfileMentions = true`;
   `:393` derives `requestedProfileSlug = profileSlugFromMentions(...)`.
6. `shouldDispatchDefaultAgentTurn({ hasAgentProfileMentions: true, ... })`
   returns `true` regardless of Thread Mode
   (`packages/api/src/graphql/resolvers/messages/sendMessage.agent-handling.ts:96`),
   and the turn is dispatched to the profile lane via
   `dispatchDefaultAgentChatTurn(..., requestedProfileSlug)`.
7. The UI renders the stored `agent_profile` mention's `rawText` ("@SurSum")
   into `Delegated via @SurSum. Waiting for profile lane activity.`
   (`apps/web/src/components/workbench/TaskThreadView.tsx` dispatch-card row +
   `agentProfileMentionForMessage`, `:5409-5433`).

Two additional surfaces carry the same `@`-as-profile assumption and must be
fixed for the behavior to be fully scoped to `#`:

- **Pi runtime explicit profile parser** —
  `packages/agentcore-pi/agent-container/src/server.ts:275` (match) and `:292`
  (strip), both `(^|\s)[#@]${alias}(?=…)`. This is the direct-to-runtime
  explicit-shortcut path (distinct from the automatic Research inference that
  THNK-51/#2701 addressed).
- **Web display fallback** —
  `apps/web/src/components/workbench/TaskThreadView.tsx:5427`,
  `message?.content?.match(/[#@]([a-z][a-z0-9_-]*)/i)`. Display-only, but it
  independently mis-labels `@name` as a profile when no structured mention
  exists.

## Evidence (smallest local signal)

Isolated reproduction of the `parse-message-mentions.ts` regex against the exact
screenshot text:

```
CURRENT [#@] on '@SurSum what do you think? ...': MATCH  rawText='@SurSum'
FIXED   '#'  on '@SurSum what do you think? ...': no match  (correct — @ no longer delegates)
FIXED   '#'  on '#SurSum please review':          MATCH     (correct — # still delegates)
```

The current `[#@]` reproduces both the delegation and the literal `@SurSum`
`rawText` seen in the screenshot. Switching the profile trigger to `#`
suppresses the `@` misfire while preserving `#` delegation.

## Relationship to THNK-51 (`#2701`)

THNK-51 (2026-06-19) is the same theme: Agent Profile delegation firing on an
`@`/email signal. Eric noted then that "Agent Profile shortcuts may be intended
to use `#` rather than `@`." That fix redacted email tokens and tightened the
**automatic Research inference** in the Pi runtime, but **deliberately preserved
the `@Profile` explicit alias** ("guarded `@Research` shortcuts still delegate
because the explicit profile parser remains start/whitespace guarded"). THINK-180
is Eric now decisively rejecting that preserved `@Profile` alias. This is
negative evidence: the `@`-alias support is intentional, tested legacy behavior —
not an accident — so the fix is a behavior change plus test inversions, not a
one-character typo patch.

## Fix Plan

Scope the Agent Profile mention trigger to `#` only, everywhere. `@` remains the
user/agent mention trigger (unchanged), so legitimate `@person`/`@agent`
behavior is preserved.

1. `packages/api/src/lib/mentions/parse-message-mentions.ts:89` —
   `"[#@]"` → `"#"` for `agent_profile`. (Keep the `content.includes("@")`
   guard at `:56`; `@` is still needed to match user/agent aliases.)
2. `packages/agentcore-pi/agent-container/src/server.ts:275` and `:292` —
   `[#@]` → `#` in both the strip and the explicit-slug parser.
3. `apps/web/src/components/workbench/TaskThreadView.tsx:5427` — display
   fallback regex `/[#@]([a-z][a-z0-9_-]*)/i` → `/#([a-z][a-z0-9_-]*)/i`.

### Tests to update / add

- `packages/api/src/lib/mentions/parse-message-mentions.test.ts:164` — the
  existing test "keeps @ Agent Profile mentions as a backwards-compatible text
  alias" (`@research` → agent_profile) now encodes the wrong contract. **Invert
  it**: assert `@research`/`@SurSum` does **not** produce an `agent_profile`
  mention, and keep/extend the `#Research` positive case (`:135`). Add the exact
  regression: content `@SurSum what do you think? Can run the credit check?`
  with a `SurSum` agent_profile target yields zero agent_profile mentions.
- `packages/agentcore-pi/agent-container/tests/server.test.ts` — invert the
  "guarded `@Research` shortcut" contract to assert `@Research` no longer
  produces an explicit profile slug; keep `#Research` positive. Preserve the
  THNK-51 email/automatic-Research tests.
- Consider a `sendMessage` integration assertion that a plain `@Profile` message
  does not set `requestedProfileSlug` / does not dispatch a profile-lane turn.

### Why existing tests did not catch this

They asserted the opposite: `@Profile` delegation was an intentional,
test-locked "backwards-compatible alias" (parse-message-mentions.test.ts:164;
server.test.ts guarded-`@Research`). The tests defended the now-unwanted
behavior.

## Open question (resolved by this issue)

THNK-51 left open whether `@Profile` should remain a valid delegation trigger
for backward compatibility. THINK-180 answers it: **no** — only `#` triggers
agent-profile delegation. `@` is reserved for people/agents. No known product
surface relies on `@Profile` delegation (composers already emit `#` for
profiles), so removing the `@` alias has no legitimate-behavior regression.

## Next phase

Diagnosis only (per the Debug baton). Hand to Ready to Work for the LFG
implementation lane to apply the three-site fix + test inversions above.
