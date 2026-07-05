---
date: 2026-07-05
linear_issue: THINK-170
scope: "PR #3373 (R0 — retire Customer Onboarding chat interception path)"
verdict: PASS
---

# THINK-170 R0 Dogfood Verification — Customer Onboarding chat interceptor retirement

**Verdict: PASS.** All five QA-brief checks plus two ceiling scenarios pass
functionally. Every user message in the target thread now dispatches a real
platform-agent turn; zero canned `customer_onboarding_chat_update` system
inserts after the deploy. Three paper cuts recorded for the R1+ planning pass
(most notable: the agent confirmed a task-status change it never persisted).

**Target:** deployed dev (`app.thinkwork.ai`), Customer Onboarding space,
thread "mcphersonoil.com onboarding"
(`d1d1049d-d230-4a42-a6d4-dfc5e94d1635`), operator session (Eric,
Cognito Google-federated — session established via the OAuth refresh-token
path from the CLI's dev session; the agent-browser profile had no saved
state).

**Change under test:** PR #3373 (merged 2026-07-05 14:14 UTC, live via Deploy
run 28743866143, completed green 14:37:22 UTC). `sendMessage.mutation.ts` no
longer calls `applyCustomerOnboardingChatUpdate`; the
`customerOnboardingHandled` short-circuit and
`shouldApplyCustomerOnboardingChatUpdate` gate are removed; dispatch falls
through to normal Thread Mode (`shouldDispatchDefaultAgentTurn`).

**Old-behavior signature (must NOT recur):** instant (~57 ms)
`sender_type:"system"` insert with
`metadata.kind='customer_onboarding_chat_update'` and canned
"Progress: 0/0 …" text; no agent turn. The thread's history still shows these
(same report question 12 h earlier → canned card), giving a direct in-thread
before/after contrast.

**Accepted trade-off (D1):** prefixed task commands are agent-mediated now —
slower/softer responses are expected, not failures.

## Scenario matrix

| # | Scenario | Source | Expected | Functional | Experiential |
|---|----------|--------|----------|------------|--------------|
| S1 | "can you generate a report of the current status of this company onboard?" | QA checklist 2 / R0 acceptance | Real agent turn streams over seconds; no instant canned card | **PASS** | PASS w/ paper cuts (PC2, PC3) |
| S2 | "Collect tax exemption forms: in progress" (prefixed task command) | QA checklist 3 / D1 | Agent-mediated response; no canned checklist summary; no system insert | **PASS** | PASS w/ paper cut (PC1 — confirmation not persisted) |
| S3 | Neutral "thanks, looking good" | QA checklist 4 | Normal Thread Mode, no interception | **PASS** | **PASS** (clean, natural reply) |
| S4 | DB spot-check post-deploy | QA checklist 5 / R0 | Zero `customer_onboarding_chat_update` rows after 14:37:22Z; replies are agent, not system | **PASS** | n/a |
| S5 | @agent mention: "please summarize the current onboarding checklist status" | Ceiling — mention path touched by diff | Real agent turn | **PASS** | PASS w/ paper cut (PC2 — can't see checklist) |
| S6 | Console/network health across S1–S5 | Ceiling — regression sweep | No console errors / failed requests | **PASS** | PASS |

(QA checklist 1 — deploy gate — was a satisfied precondition: run
28743866143 green, includes R0 commit 7d86901e6. Not re-gated.)

## Evidence

All timings below are from dev Aurora `messages.created_at` (UTC), not UI
guesses. Every post-deploy reply is `role=assistant, sender_type=agent,
metadata.kind=NULL` — the interceptor's `sender_type=system` +
`kind='customer_onboarding_chat_update'` signature never appears.

| Scenario | User msg | Agent reply | Latency | UI turn meter |
|---|---|---|---|---|
| S1 | 14:45:21.505 | 14:46:10.735 | **49.2 s** | "Worked for 49s · 76.2K in / 1.9K out · $0.0700" |
| S2 | 14:48:27.331 | 14:48:43.238 | **15.9 s** | "Worked for 16s · 76.9K in / 313 out · $0.0482" |
| S3 | 14:49:13.029 | 14:49:21.918 | **8.9 s** | "Worked for 9s · 77.2K in / 62 out · $0.0469" |
| S5 | 14:50:23.602 | 14:51:53.410 | **89.8 s** | "Worked for 1m 30s · 85.2K in / 505 out · $0.0606" |

- **S1:** a "Working…" streaming indicator appeared within ~3 s of the POST
  and the turn ran 49 s — versus the 57 ms deterministic insert this exact
  question produced pre-fix (visible 12 h earlier in the same thread as an
  agent-labeled canned "Progress: 0/0" card, directly above the new turn).
  Reply is a substantive company report (McPherson Oil, deal $7,500, CRM
  opportunity/customer/owner IDs).
- **S2:** agent replied with a status-change table "Collect Tax Exemption
  Forms — Eric — ✅ Completed → 🟡 In Progress". No canned checklist summary,
  no system insert. (Persistence gap: see PC1.)
- **S3:** natural conversational reply ("You're welcome! The McPherson Oil
  onboarding is tracking well…"), no interception.
- **S4 (DB):**
  `SELECT count(*) FROM messages WHERE thread_id='d1d1049d-…' AND
  metadata->>'kind'='customer_onboarding_chat_update' AND created_at >
  '2026-07-05T14:37:22Z'` → **0**. The 8 post-deploy rows are exactly the 4
  user messages + 4 agent replies above.
- **S5:** mention suggestion list offered "agent (DEFAULT THREAD AGENT)";
  mentioned turn ran 1 m 30 s and produced a checklist-status summary, though
  the agent noted it "cannot locate an internal onboarding checklist in the
  connected systems" (PC2).
- **S6:** browser console empty of errors across all scenarios; no failed
  (4xx/5xx) network requests attributable to the change.
- Screenshots captured locally under `/tmp/think170-evidence/` (thread
  before/after, each reply, mention menu); key contrast shot:
  canned 12h-old card and the new 49 s turn in one frame.

## Paper cuts (for R1+ planning pass — none fail R0)

1. **PC1 — Agent confirms task updates it never persists.** S2's reply
   rendered a confident "PREVIOUS STATUS → NEW STATUS" confirmation table,
   but no `work_items` row changed (`work_items.updated_at >
   14:37:22Z` → 0 rows; the mcpherson "Collect tax exemption forms" item
   doesn't exist under that title — nearest rows are unrelated spaces). The
   `set_work_item_status` path either wasn't invoked or found no target, and
   the agent fabricated the confirmation. This is the exact risk flagged in
   the QA brief ("agent responds but doesn't update the work item") —
   recorded as R1+ follow-up, but it deserves top billing in that pass:
   a false write-confirmation is worse UX than a soft answer.
2. **PC2 — Onboarding checklist state is invisible to the agent.** S5's
   honest answer: it "cannot locate an internal onboarding checklist". The 7
   seeded checklist rows live in `linked_tasks provider='lastmile'` /
   work-item `checklistItemKey` plumbing the agent has no tool surface for.
   This is R1's core scope (work-item tools + workflow-as-data); confirming
   it live validates the R1 problem statement.
3. **PC3 — Markdown table rendering.** Literal `**bold**` asterisks render
   unprocessed inside table cells (S1 company table, S2 status table), and
   replies open with a bare table, no prose framing. Cosmetic GenUI/streamdown
   issue, unrelated to R0's server-side change.

## Decisions for a human

- None blocking. D1's trade-off behaves as accepted: prefixed commands get
  agent-mediated replies in ~16 s. PC1 (fabricated write confirmation) is the
  one item worth explicit prioritization when R1+ returns to Planning.
- Observation (out of scope): the dev sign-in surface now routes "Continue
  with SSO" through a WorkOS AuthKit **staging** domain
  (`welcoming-nutmeg-53-staging.authkit.app`); fine for dev, worth a check
  before any customer-facing cutover.
