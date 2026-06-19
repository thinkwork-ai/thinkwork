---
module: agentcore-pi
date: 2026-06-19
last_updated: 2026-06-19
problem_type: debug_findings
component: agent_profile_routing
severity: medium
linear: THNK-51
status: resolved
tags:
  - agent-profiles
  - delegation
  - email-addresses
  - pi-runtime
  - debug-artifact
---

# THNK-51: Agent Profile Routing Treats Email Text As Delegation Signal

## Problem

Linear THNK-51 reports that the agent tries to delegate to an Agent Profile
when an email address appears in the user's input. Eric also noted that Agent
Profile shortcuts may be intended to use `#` rather than `@`, and requested the
route order be:

1. determine whether `@` is part of an email address with no space before it;
2. ensure an Agent Profile is matched before trying to delegate.

Issue context checked on 2026-06-19:

- Linear issue: THNK-51, "Incorrect Agent Profile"
- Status before this artifact: Debug
- Labels: Bug, Codex
- Project: Enterprise Agent OS
- Priority: Medium
- Comments: none returned by the Linear connector
- Child, parent, blocker, dependency, duplicate, and related issues: none
- Existing Linear documents: none
- Attachments: no separate Linear attachments; one screenshot embedded in the
  issue description
- Recent PR context: the latest merged PRs on 2026-06-19 were Space webhook,
  WorkOS, and n8n changes; no recent merged PR touched the profile routing
  code. Relevant profile routing history is older: `feat: route agent profiles
  through pi subagents` (#2219), `fix: route research prompts through agent
  profiles`, and `feat: orchestrate agent profile closed loops`.

## Debug Summary

**Problem**: Email-containing user input can trigger an Agent Profile handoff
even when the user did not explicitly mention a profile.

**Root Cause**: Explicit profile shortcut parsing is already guarded against
email-address `@` characters, but the automatic Research Profile shortcut scans
the whole raw message for research-intent words. That scan treats words inside
email addresses, and ordinary words near email addresses such as `current` or
`source`, as enough evidence to delegate.

**Recommended Tests**: Add negative profile-routing tests for
`eric@Research.com` and for email-address tasks containing `current`,
`source`, `latest`, or `today`; keep positive tests for `#Research` and any
supported explicit `@Research` shortcut.

**Fix**: PR #2701 implemented the routing fix in
`packages/agentcore-pi/agent-container/src/server.ts` and regression tests in
`packages/agentcore-pi/agent-container/tests/server.test.ts`. Automatic
Research routing now redacts email-address tokens before intent matching and
suppresses generic `current`/`source` style routing for email-delivery command
shapes.

**Prevention**: Make profile routing token-aware and require explicit profile
matches before mention-based delegation. If automatic Research routing remains,
run it on email-redacted text or behind a stricter user-intent gate.

**Confidence**: High for the routing code path; Medium for the exact production
message because the issue did not include the raw text outside the screenshot.

## Root Cause

The observed behavior is caused by automatic Research delegation, not by the
explicit `@Profile` parser alone.

Causal chain:

1. The explicit profile matcher accepts both `#Profile` and `@Profile`, but it
   requires the marker to appear at the start of the message or immediately
   after whitespace:
   `packages/agentcore-pi/agent-container/src/server.ts:237`. The actual regex
   is anchored with `(^|\\s)[#@]...`:
   `packages/agentcore-pi/agent-container/src/server.ts:244`.
2. The same guard is used when stripping matched profile shortcuts from the
   task before delegation:
   `packages/agentcore-pi/agent-container/src/server.ts:220`.
3. Therefore an email token such as `eric@Research.com` does not match the
   explicit shortcut regex, because there is no whitespace before `@`.
4. If no explicit profile was requested, `handleInvocation` calls
   `inferAutomaticAgentProfileSlug(userMessage, agentProfiles)`:
   `packages/agentcore-pi/agent-container/src/server.ts:2540`.
5. `inferAutomaticAgentProfileSlug` lowercases the raw message and tests the
   full string against a broad Research intent regex containing terms such as
   `research`, `source`, `sources`, `latest`, `current`, and `today`:
   `packages/agentcore-pi/agent-container/src/server.ts:587`.
6. JavaScript `\\b` word boundaries treat punctuation such as `@` and `.` as
   non-word characters, so `research` inside `eric@Research.com` satisfies
   `\\bresearch\\b`. Separately, an ordinary email-address task such as
   "send eric@thinkwork.ai the current source list" satisfies the same regex
   through `current` and `source`.
7. If a Research profile exists, the automatic slug becomes `research`, and the
   runtime builds `orchestrationProfileSlugs = [automaticProfileSlug]`:
   `packages/agentcore-pi/agent-container/src/server.ts:2544`.
8. The parent-owned profile orchestration then emits a synthetic
   `delegate_to_agent_profile` invocation and runs the child profile.

This explains why the behavior can look like `@` email parsing caused the
delegation, while the actual delegation decision can happen after the explicit
profile parser correctly rejected the email token.

## Evidence

Focused test evidence in the debug worktree:

```bash
pnpm --filter @thinkwork/agentcore-pi exec vitest run agent-container/tests/server.test.ts -t "automatically delegates source-backed research prompts"
```

Result:

- 1 test passed, 76 skipped
- The existing test proves that a non-explicit request with Research intent
  delegates to the Research profile and records `agent_profile_runs`.

Smallest local signal:

```text
Email eric@Research.com the notes
  explicitProfileMatch = false
  automaticResearchIntent = true

Email eric@thinkwork.ai the current source list
  explicitProfileMatch = false
  automaticResearchIntent = true

@Research find current sources
  explicitProfileMatch = true
  automaticResearchIntent = true

#Research find current sources
  explicitProfileMatch = true
  automaticResearchIntent = true
```

Relevant existing tests and docs:

- `packages/agentcore-pi/agent-container/tests/server.test.ts:522` documents
  the automatic Research delegation contract.
- `docs/verification/agent-profiles-e2e.md:61` documents the explicit
  `#Research` demo path and does not document email-address handling.
- `docs/solutions/agent-profile-closed-loops-2026-06-08.md` describes explicit
  shortcuts such as `#Research` and `#Reviewer` as parent-orchestration
  selectors.

Implementation evidence from PR #2701:

- `redactEmailAddresses()` replaces RFC-like email tokens with
  `[redacted-address]` before automatic Research intent detection.
- Automatic Research inference now separates strong research intent
  (`research`, `cite`, `citation`, `web search`, `search the web`,
  `find current`) from generic research words (`source`, `sources`, `latest`,
  `current`, `today`).
- Generic research words do not route to Research when the original message
  contains an email address and the redacted message has an email-delivery
  command such as `send`, `email`, `mail`, `forward`, `share`, `draft`, or
  `reply`.
- Explicit `#Research` and guarded `@Research` shortcuts still delegate because
  the explicit profile parser remains start/whitespace guarded.
- Genuine source-backed research about an email address still delegates, so the
  fix does not remove automatic Research entirely.

Final verification:

```bash
pnpm --filter @thinkwork/agentcore-pi exec vitest run agent-container/tests/server.test.ts -t "email-address tasks|research about an email address|guarded @Research|automatically delegates source-backed"
pnpm --filter @thinkwork/agentcore-pi typecheck
pnpm --filter @thinkwork/agentcore-pi test
git diff --check
```

Results:

- Focused routing test: 5 passed, 76 skipped.
- Package typecheck: passed.
- Package test suite: 31 files, 587 passed, 5 todo.
- Diff whitespace check: passed.
- PR #2701 CI: `cla`, `lint`, `test`, `typecheck`, and `verify` passed before
  merge.

Environment notes:

- Fresh isolated worktree:
  `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/thnk-51-debug`
- Branch: `codex/thnk-51-debug`
- Base: `origin/main` at `9a6aca0cf`
- `pnpm install` was required before Vitest binaries were available. The
  install completed, but `canvas` logged a Node 25 source-build failure because
  `pkg-config` was missing after no prebuilt binary existed for the Node 25 ABI.
  This did not block the targeted AgentCore Pi test.

## Assumption Audit

- Verified: Explicit profile matching requires message start or whitespace
  before `#` or `@`.
- Verified: Explicit matching accepts both `#Research` and `@Research` today.
- Verified: `eric@Research.com` does not match the explicit profile shortcut
  regex.
- Verified: The automatic Research route runs only when no explicit/requested
  profile slug was found.
- Verified: The automatic Research route scans the raw message and can match
  words inside email-address tokens or ordinary research-intent words near an
  email address.
- Verified: An existing server test asserts automatic Research delegation for
  source-backed prompts.
- Assumed: The production message either contained a research-like email token
  such as `@Research`, or contained words like `current`, `source`, `latest`,
  or `today` in the same message as an email address. The screenshot could not
  be saved from the signed Linear image URL without Linear upload
  authorization, but the issue summary is consistent with this route.

## Fix Plan

The product fix used the smallest routing change that preserves deliberate
profile handoffs:

1. Keep the explicit profile shortcut parser whitespace/start guarded. That is
   already the right first check for `@` inside email addresses.
2. Decide the public shortcut contract:
   - strict option: support only `#Profile` for explicit user shortcuts and
     remove `@Profile` from `stripProfileMentions` and
     `explicitAgentProfileSlugsFromMessage`;
   - compatibility option: keep `@Profile`, but continue requiring whitespace
     or start-of-message before the marker.
3. Add an email-aware redaction step before automatic Research intent
   inference. Replace RFC-like email tokens with a neutral placeholder before
   running the intent regex, so `eric@Research.com` cannot produce a Research
   hit.
4. Narrow automatic Research delegation so it does not fire just because a user
   mentions an email address and a generic word like `current` or `source`.
   Strong research requests still route; email-delivery command shapes with
   only generic research words stay on the parent Agent.
5. Keep requested profile payload fields (`requested_agent_profile_slug` and
   `requested_agent_profile_slugs`) as explicit host-level overrides; those are
   not user text parsing.

Regression tests added in the fix PR:

- Negative: `Email eric@Research.com the notes` stays on the parent Agent.
- Negative: `Send eric@thinkwork.ai the current source list` stays on the
  parent Agent.
- Positive: `What current sources mention eric@thinkwork.ai?` still delegates
  to Research.
- Positive: guarded `@Research` still delegates and strips `@Research` from the
  child task.
- Existing positive: source-backed automatic Research prompts still delegate.

Session-history note: the implementation self-review caught that the first
redaction placeholder contained the word `email`, which would have made every
redacted address look like an email-delivery command. The final placeholder is
`[redacted-address]`, a neutral token that avoids feeding routing keywords back
into the classifier (session history).

## Risks

- Removing `@Profile` could break any users who already learned the `@Research`
  shortcut. Search telemetry or release notes may be needed before choosing the
  strict option.
- Disabling automatic Research entirely would remove a convenience path covered
  by existing tests. A narrower tokenizer/redaction fix is lower blast radius.
- Generic words like `current` and `source` are useful for research inference
  but common in email/document tasks. The fix should test command-shaped email
  workflows, not only email tokens with the word `research`.
- The product should preserve parent ownership of the final response and
  Activity/Traces evidence for deliberate profile runs; the fix only changes
  routing selection.

## Durable Guardrail

Profile routing has two separate contracts:

- explicit profile selection, where `#Profile` and the compatibility
  `@Profile` form must be start/whitespace guarded and stripped from child task
  text; and
- automatic Research inference, where broad intent words must be evaluated on
  token-aware/redacted text and must respect command shape.

Future changes should test both contracts together. A fix that only guards the
explicit parser can still miss automatic routing, and a fix that disables broad
automatic Research routing can break legitimate source-backed research
handoffs.

## Status

Resolved by PR #2701, merge commit
`4026fdd9851eb363ceac31980e7c8da0fd7be6ff`.
