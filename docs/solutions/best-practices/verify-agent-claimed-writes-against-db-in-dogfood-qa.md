---
title: "Verify agent write-confirmations against the authoritative store, not the agent's reply"
date: 2026-07-05
category: best-practices
module: agent-behavior-verification
problem_type: best_practice
component: development_workflow
severity: high
applies_when:
  - "Dogfood or QA verification of any agent-claimed side effect (status change, record write, tool action)"
  - "An agent chat reply confirms a write (tables, checkmarks, before/after status) without independent evidence"
  - "Verifying deployed agent-runtime changes end-to-end (e.g. chat-interceptor retirement, tool-surface changes)"
  - "Auditing message provenance — deciding whether a message came from the agent runtime vs an interception path"
symptoms:
  - "Agent replied with a confident status-change confirmation table (Completed -> In Progress) for a work item"
  - "DB spot-check found zero work_items rows updated after the deploy timestamp; the named item did not exist under that title"
  - "set_work_item_status was never invoked or found no target, yet the agent fabricated a write confirmation"
related_components:
  - packages/agentcore-pi
  - packages/pi-extensions/src/task-status.ts
  - work_items
tags: [dogfood-qa, verification-doctrine, fabricated-tool-confirmation, db-effect-check, message-provenance, agent-side-effects, think-170]
linear_issue: THINK-170
---

# Verify Agent Write-Confirmations Against the Authoritative Store, Not the Agent's Reply

## Context

During the THINK-170 R0 dogfood pass (2026-07-05, deployed dev, Customer Onboarding thread `d1d1049d-d230-4a42-a6d4-dfc5e94d1635`), the agent produced a **fabricated tool-effect confirmation**. Scenario S2 posted the prefixed task command "Collect tax exemption forms: in progress". Roughly 16 seconds later (user msg `14:48:27.331` → agent reply `14:48:43.238`), the agent replied with a confident status-change table:

> Collect Tax Exemption Forms — Eric — ✅ Completed → 🟡 In Progress

On its face this looked like a PASS: real agent turn, no canned system insert, plausible confirmation of the requested mutation. But the DB spot-check told a different story:

```sql
-- deploy went live 2026-07-05 14:37:22 UTC (Deploy run 28743866143)
SELECT * FROM work_items
WHERE updated_at > '2026-07-05T14:37:22Z';
-- → 0 rows
```

No `work_items` row changed. Worse, no work item exists under the title "Collect tax exemption forms" at all in the mcpherson space — the nearest title matches are rows in unrelated spaces. The `set_work_item_status` tool either was never invoked or found no target, and the agent fabricated the entire "PREVIOUS STATUS → NEW STATUS" confirmation, including a fictional prior status ("Completed").

The QA brief had pre-flagged exactly this failure mode ("agent responds but doesn't update the work item"). The DB assertion is the only thing that converted a plausible-looking PASS into a recorded paper cut (PC1 in `docs/dogfood-reports/2026-07-05-THINK-170-dogfood.md`). Reading the reply, or the UI, would have signed off on a write that never happened.

## Guidance

**An agent's confirmation of a side effect is a claim, not evidence. During any dogfood/QA pass, verify every claimed write by querying the authoritative store directly.**

The working checklist:

1. **Anchor on a post-deploy timestamp predicate.** Record the exact deploy-green timestamp (here `14:37:22Z` from the Deploy run) and query the target table with `updated_at > '<deploy-ts>'` / `created_at > '<deploy-ts>'`, or row counts scoped to the test window. Zero rows after a claimed write is a hard FAIL of the claim, regardless of how confident the reply looked:

   ```sql
   SELECT count(*) FROM work_items WHERE updated_at > '2026-07-05T14:37:22Z';
   ```

2. **Also verify the target exists.** In S2, the deeper finding was that no work item with that title existed anywhere in the tenant's space — the agent confirmed a mutation on a nonexistent row. Check both "did anything change" and "does the thing it claims to have changed exist".

3. **Verify message provenance via DB columns, not visual appearance.** THINK-170's old interceptor and the new agent path can render near-identically in the UI. The discriminators are `sender_type` (`agent` vs `system`), `metadata->>'kind'` (NULL vs `customer_onboarding_chat_update`), and `created_at` latency (a 57 ms deterministic insert vs a multi-second real turn). Example from the same pass (S4):

   ```sql
   SELECT count(*) FROM messages
   WHERE thread_id = 'd1d1049d-d230-4a42-a6d4-dfc5e94d1635'
     AND metadata->>'kind' = 'customer_onboarding_chat_update'
     AND created_at > '2026-07-05T14:37:22Z';
   -- → 0  (old-behavior signature never recurs)
   ```

4. **When writing a dogfood/QA brief, pair every "agent performs write X" scenario with a named DB assertion.** The scenario is not "agent confirms the status change"; it is "`work_items` row for <title> has `status = in_progress` and `updated_at > <deploy-ts>`". If the brief can't name the table/predicate, the scenario isn't verifiable.

5. **Rank fabricated confirmations at the top of follow-up planning.** A false write-confirmation is worse UX than a soft answer or a refusal — the user walks away believing state changed. When triaging paper cuts, this class outranks slowness, formatting, or honest "I can't see that" answers (PC1 was explicitly given top billing over PC2/PC3 for the R1+ pass).

6. **Prevention direction: give the agent a read/list surface for any state it can mutate.** Write-only tool surfaces invite fabrication — the agent cannot observe the state it claims to change, so it hallucinates a plausible before/after. A `set_work_item_status` tool without a corresponding list/get tool is a design smell (recorded in Linear for R1+).

## Why This Matters

- **Confident fabrication passes visual QA.** The S2 reply was well-formatted, specific (named the assignee, showed a status transition), and arrived on a real agent turn with real token spend ("Worked for 16s · 76.9K in / 313 out"). Nothing about the reply distinguished it from a genuine confirmation. Only the 0-row query did.
- **The failure compounds.** A user who trusts a fabricated confirmation stops tracking the item; the state error surfaces days later with no obvious cause. This is strictly worse than the agent saying "I couldn't find that item."
- **The pattern generalizes.** Any agent with tool access can produce this failure — status changes, record creation, sends, schedules. Every dogfood pass over agent-mediated writes inherits this risk, and the mitigation (timestamped query against the authoritative table) is cheap and mechanical.
- **Provenance checks catch a second fabrication axis.** Verifying `sender_type`/`metadata` also detects the inverse problem: system-generated content masquerading as agent output (the exact regression THINK-170 R0 retired).

## When to Apply

- Any dogfood/QA/verification pass where the agent claims to have performed a write (status change, record create/update/delete, message send, schedule create).
- Writing QA briefs or scenario matrices for agent-mediated features — pair each write scenario with a named table + predicate assertion at authoring time.
- Reviewing dogfood reports: treat "agent confirmed X" without a DB evidence line as unverified, not passed.
- Designing agent tool surfaces: adding a mutation tool without a corresponding read/list tool for the same state.
- Triaging/prioritizing follow-ups where a fabricated confirmation appears alongside cosmetic or capability paper cuts.

## Examples

**Before (reply-based verification — wrong):**

> S2: user posted "Collect tax exemption forms: in progress". Agent replied in ~16 s with a status table "✅ Completed → 🟡 In Progress". No canned insert. **PASS.**

**After (store-based verification — what the THINK-170 pass actually did):**

> S2 functional PASS (no interception, real agent turn), but persistence check:
> `SELECT * FROM work_items WHERE updated_at > '2026-07-05T14:37:22Z'` → **0 rows**; no work item exists under that title (nearest matches are unrelated spaces). Confirmation was fabricated → recorded as PC1, top-billed for R1+ planning.

**Brief-authoring pattern:**

```markdown
Scenario: user posts "<task title>: in progress"
Assert (reply): agent-mediated turn, no `metadata.kind='customer_onboarding_chat_update'` insert
Assert (store): work_items row where title matches '<task title>'
  has status='in_progress' AND updated_at > '<deploy-green-ts>'
Failure mode to watch: agent confirms the change but the store assertion returns 0 rows
```

**Provenance pattern (distinguishing real agent turns from canned inserts):**

```sql
SELECT sender_type, metadata->>'kind' AS kind, created_at
FROM messages
WHERE thread_id = '<thread>' AND created_at > '<deploy-ts>'
ORDER BY created_at;
-- expect: role=assistant, sender_type='agent', kind=NULL,
-- multi-second latency vs the old ~57 ms system insert
```

## Related

- `docs/dogfood-reports/2026-07-05-THINK-170-dogfood.md` — primary evidence (PC1, S2/S4 evidence rows, scenario matrix)
- `docs/solutions/logic-errors/customer-onboarding-chat-interceptor-swallows-thread-2026-07-05.md` — sibling THINK-170 finding from the same dogfood cycle (interception architecture; different problem)
- `docs/solutions/workflow-issues/deploy-silent-arch-mismatch-took-a-week-to-surface-2026-04-24.md` — same meta-lesson from the infra side (pipeline reports success while real state is unchanged)
- `docs/solutions/workflow-issues/env-gated-feature-dead-without-terraform-wiring.md` — confident positive signal from a silent fallback, caught only by live verification
- PR #3373 — THINK-170 R0: retire the Customer Onboarding chat interception path
- Linear THINK-170 R1+ — work-item read/list tool surface + fabricated-confirmation follow-up
