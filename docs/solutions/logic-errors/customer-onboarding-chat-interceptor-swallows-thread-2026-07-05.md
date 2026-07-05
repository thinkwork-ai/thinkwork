---
title: "Customer Onboarding chat interceptor swallows every thread message and suppresses the agent"
date: 2026-07-05
category: logic-errors
module: "api/sendMessage + spaces/customer-onboarding"
problem_type: logic_error
component: message_dispatch
severity: high
linear_issue: THINK-170
applies_when:
  - "A user posts a plain (un-@mentioned) message in a Customer Onboarding space thread"
  - "Debugging why the platform agent never responds in a workflow-tagged thread"
  - "Evaluating deterministic pre-agent interception of chat messages"
related_components:
  - packages/api/src/graphql/resolvers/messages/sendMessage.mutation.ts
  - packages/api/src/graphql/resolvers/messages/sendMessage.agent-handling.ts
  - packages/api/src/lib/spaces/customer-onboarding-chat-updates.ts
  - packages/api/src/lib/work-items/customer-onboarding.ts
tags: [customer-onboarding, agent-dispatch, interception, worktasks, regex-nlu]
---

# Customer Onboarding chat interceptor swallows every thread message (THINK-170)

## Symptom

In the `mcphersonoil.com onboarding` thread (Customer Onboarding space, dev),
every user message — including a genuine request like *"can you generate a
report of the current status of this company onboard?"* — gets an instant
canned reply:

> Progress: 0/0 required onboarding tasks complete. Missing intake: salesRep,
> contacts, dealValue, productPlan, documents, primaryContact,
> accountsPayableContact, billingAddress, shippingAddress, taxExempt,
> creditTermsRequested, docusignRecipient.

The platform agent never engages. The thread is effectively dead.

## Root cause

There are two stacked defects: an **interception defect** (why the agent never
runs) and a **state-source defect** (why the canned status is also wrong).

### 1. A regex NLU interceptor in `sendMessage` pre-empts agent dispatch

`sendMessage.mutation.ts:414` calls
`applyCustomerOnboardingChatUpdate(...)` for **every un-@mentioned user
message** in a thread whose metadata carries
`customerOnboarding.workflow === "customer_onboarding"`
(`customer-onboarding-chat-updates.ts:158`).

That function runs a bespoke keyword/regex extraction over the message. If it
detects *any* "signal" — a status request, an assignment request, a fact
label, or task words — it marks the message `handled`, inserts a canned
`sender_type: "system"` assistant message itself, and returns.
`sendMessage.mutation.ts:420-422` then sets `customerOnboardingHandled`, and
`shouldDispatchDefaultAgentTurn` (`sendMessage.agent-handling.ts:96-105`)
returns `false` — **the Pi agent turn is never dispatched**.

The status-request regex is the widest trap
(`customer-onboarding-chat-updates.ts:116-117`):

```ts
const STATUS_REQUEST =
  /\b(?:what(?:'s| is)?|show|give me|current|latest)?\s*(?:the\s+)?(?:onboarding\s+)?(?:status|progress|checklist)\b/i;
```

Every group before `(?:status|progress|checklist)` is optional, so the regex
matches **any message containing the bare word "status", "progress", or
"checklist" anywhere** — which is nearly every message a human would type in
an onboarding thread. Verified against the screenshot messages:

| Message | `STATUS_REQUEST` | Outcome |
| --- | --- | --- |
| "can you generate a report of the current status of this company onboard?" | ✅ matches | canned Progress summary, agent suppressed |
| "Collect tax exemption forms: in progress" | (prefixed-command path) | task update + canned summary, agent suppressed |
| "Collect tax exemption forms: done" | (prefixed-command path) | task update + canned summary, agent suppressed |
| "any progress on your side?" | ✅ matches | would be intercepted too |

The only escape hatch is `shouldDispatchAgentForCustomerOnboardingMessage`
(`customer-onboarding-chat-updates.ts:976-984`): the agent is dispatched only
if the message **mentions email/mail** *and* is a status/assignment request —
added by #1742 to let "email me the status" reach the agent. Everything else
that pattern-matches is consumed by the interceptor.

### 2. The canned status reads the wrong state source, so it is also wrong

`buildProgressStatusSummary` counts checklist rows from
`linked_tasks WHERE provider = 'thinkwork'`
(`customer-onboarding-chat-updates.ts:186-195`). On the affected thread the 7
seeded checklist rows have **`provider = 'lastmile'`** (the LastMile
application plugin is the system of record for this tenant's onboarding), so
`activeTaskRows` is empty → **"Progress: 0/0"**. Meanwhile live checklist
state actually flows through `work_items` (keyed by
`metadata.checklistItemKey`; #2929 / #2964) — which is why earlier replies
could still report "Collect tax exemption forms: Todo → In Progress" via the
direct work-item path while the same reply said 0/0.

The "Missing intake: everything" line is real data: the thread's
`customerOnboarding.facts.raw` (seeded from the Twenty CRM
`opportunity.stage.customer` webhook) has `salesRep: null`, `contacts: []`,
`dealValue: null`, etc. The regex extractor can only fill those fields from
exactly-labeled phrases ("sales rep: ...", "billing address: ..."), so in
practice they never fill from natural conversation.

## Reproduction evidence (dev, 2026-07-05)

Thread `d1d1049d-d230-4a42-a6d4-dfc5e94d1635` ("mcphersonoil.com onboarding"),
dev Aurora:

- The reply to the report request is `role=assistant`, `sender_type=system`,
  `metadata.kind = 'customer_onboarding_chat_update'`, created **57 ms** after
  the user message (`01:47:32.514` → `01:47:32.571`) — deterministic API-layer
  insert; no agent turn exists for any user message in this thread.
- `linked_tasks` for the thread: 7 rows, all `provider='lastmile'`,
  `status='unknown'` → interceptor's `provider='thinkwork'` filter selects 0.
- `threads.metadata.customerOnboarding.facts.raw`: all intake fields null from
  the CRM webhook → the full missing-intake list.
- Regex behavior verified directly (node): the report question and
  "any progress on your side?" both match `STATUS_REQUEST`.

## Why the thread is "basically dead"

Un-@mentioned messages in the thread fall into two buckets:

1. Contains "status/progress/checklist", a task alias, a done/progress word,
   or a fact label → intercepted, canned system reply, agent suppressed.
2. No signal at all → `handled: false`, dispatch falls through to Thread Mode.

Bucket 1 covers essentially all real onboarding conversation, and the canned
reply is itself wrong (0/0 + missing-everything), so the space reads as a
broken bot that answers everything with the same status card.

## Recommended fix direction

Do **not** patch the regex. The failure is architectural: a deterministic
pseudo-agent in the GraphQL layer competes with the real agent for the turn.

- Retire the interception path: `sendMessage` should dispatch the platform
  agent for user messages in onboarding threads like any other space thread
  (Thread Mode still governs AUTO).
- Expose onboarding checklist/intake state to the agent as **worktask/work-item
  tools** (read + update), so "collect tax exemption forms: done" becomes a
  tool call the agent makes, and "generate a report" becomes the agent reading
  work-item state — one state source (`work_items`), no `linked_tasks
  provider` split-brain.
- Keep deterministic side-effects (CRM webhook seeding, checklist
  materialization) as data plumbing, not as turn-owners.

The ~7.5k lines of bespoke `customer-onboarding-*.ts` under
`packages/api/src/lib/spaces/` (regex NLU, canned summary builders, seeded
space files, goal-folder refreshers) are what the agent + worktasks should
replace.

## How this motivates the larger design question (THINK-170 → Brainstorming)

Eric's broader question: *what is the right way to configure a workflow / set
of tasks for a space — can we simplify the bespoke skill and space-based files
and handle it through worktasks?* This bug is the existence proof for that
direction:

- **Bespoke workflow code rots independently of the platform.** The
  interceptor's state model (`linked_tasks`, `provider='thinkwork'`) drifted
  from the platform's (work items, LastMile provider) and nobody noticed,
  because the workflow logic lives in a hand-rolled corner of the API rather
  than on the shared worktask surface.
- **Interception is the wrong ownership model.** Any pre-agent turn-grabber
  must reimplement language understanding (here: regexes) and will both
  over-trigger (this bug) and under-deliver (canned replies). The agent should
  own the turn; workflows should be *context + tools* (worktask definitions,
  checklist state, completion criteria), not competing responders.
- **Space workflow configuration should be data, not code.** "Customer
  Onboarding" should be expressible as a worktask template set (tasks,
  required intake, roles, completion gates) that the platform agent reads and
  operates on — the same shape every other space workflow would use — instead
  of a per-workflow TypeScript module plus seeded space files.

The Brainstorming phase should fold this fix direction into that product
framing: define space workflows via worktasks (templates + state + agent
tools), delete the bespoke interception layer, and let the platform agent be
the only thing that answers a human in a thread.
