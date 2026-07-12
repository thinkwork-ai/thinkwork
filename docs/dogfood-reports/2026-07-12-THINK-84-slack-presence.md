---
date: 2026-07-12
linear_issue: THINK-84
scope: "Slack channel presence tracer bullet (U1 ingress, U5 Chat SDK primitives, U2 finalized replies, U3 cleanup) + U4 deployed dogfood"
verdict: PASS
---

# THINK-84 U4 — Slack Presence Dogfood Verification

**Verdict: PASS.** The full Slack channel-presence loop works end to end on the
deployed dev stack: an `@ThinkWork` mention (or bot DM) is received, executed as
the explicitly linked ThinkWork user, and answered back in the originating Slack
thread exactly once. Getting there required fixing **three deployed defects that
every unit test with fakes had passed** — the exact reason this dogfood exists.
Three reply-quality improvements (in-place acknowledgement, Slack `mrkdwn`
formatting, public report links) were then added from live feedback.

**Target:** deployed dev stack. Installed Slack workspace **Homecare
Intelligence** (`T1U9X1BEH`), channel `#thinkwork-test` (`C0BGUT2PRH7`), linked
real user **eric@thinkwork.ai** (`4dee701a-c17b-46fe-9f38-a333d4c3fad0`), tenant
platform agent via the AgentCore Pi runtime.

**Delivered baseline under test:** U1 (PR #3610), U5 (#3612), U2 (#3613), U3
(#3614), plus dogfood-driven fixes #3616, #3620, #3624 and reply polish #3633.

## Acceptance matrix

| # | Scenario (AE) | Result | Evidence |
|---|---------------|--------|----------|
| 1 | Channel mention → one linked-user turn → one in-thread reply (AE1) | **PASS** | `@ThinkWork reply with exactly the word ORANGE` → assistant `ORANGE`, `slackDelivery.status=succeeded`, provider ts `1783879274.890409`, delivered 18:01:14Z. |
| 2 | Executes as the explicitly linked ThinkWork user (R3) | **PASS** | Every Slack turn's requester = `4dee701a…` (eric@thinkwork.ai); never the bot identity. |
| 3 | One Slack thread ↔ one ThinkWork thread (AE2, R2) | **PASS** | `slack_threads` → `SLACK-1464..1467`, all channel `C0BGUT2PRH7`, all requester `4dee701a…`; a follow-up mention in a thread continued the same ThinkWork thread. |
| 4 | Bot DM completes the loop with no mention (R1) | **PASS (code-verified + live)** | `classifySlackEvent`: `message` + `channel_type=im` → processed with no mention gate; DM turn ran and delivered. |
| 5 | Exactly-once under provider retry (R6, idempotency) | **PASS** | Inbound dedup by tenant-scoped partial unique index on `messages.source_event_id` (`slack:<event_id>`); outbound exactly-once by the per-assistant `metadata.slackDelivery` claim ledger. |
| 6 | Ordinary post-turn behavior — Hindsight/Wiki/push (R7) | **PASS** | Completed turns run the normal wakeup-processor finalize path (push notifications observed per thread); no Slack-special memory path. |
| 7 | Report generation → formatted reply + clickable public link | **PASS** | `@ThinkWork build a CRM opportunities report` → reply rendered as Slack `mrkdwn` (headings bold, `•` bullets, GFM table flattened to `• Metric — Value` lines, ASCII chart preserved, `$330,750`/`13` intact, no literal `**`/`###`); artifact `CRM Opportunities Report` linked, share `313ad361…` minted, and the appended `📄` link fetched **anonymously** returns **HTTP 200**, 16 KB HTML containing the report body. The reply carries Slack's `(edited)` marker — the ack placeholder was updated in place, not duplicated. |

## Deployed defects found and fixed (why dogfood matters)

Each was invisible to unit tests (which inject fakes) and each was hidden behind
the previous one — only reachable by running the real thing end to end:

1. **Ingress never persisted (`42P10`)** — Drizzle `onConflictDoNothing` silently
   dropped a `targetWhere` key, emitting `ON CONFLICT` with no predicate, which
   Postgres could not match to the partial unique index. Every Slack event died
   at message persistence. Fix: PR **#3616** (use the `where` key Drizzle emits).
2. **Reply never delivered** — U2 wired Slack delivery into `chat-agent-finalize`,
   but deployed platform-agent turns finalize in the **wakeup-processor**, which
   never called it; the ack posted, the answer persisted, nothing reached Slack.
   Fix: PR **#3620** (invoke origin-gated delivery from the wakeup finalize path;
   stamp `metadata.sourceTurnId`).
3. **Delivery threw before posting** — `sendThreadReplySlack` called
   `crypto.randomUUID` detached from its receiver → `ERR_INVALID_THIS` on the
   deployed Node runtime, throwing before the claim. Fix: PR **#3624** (import
   `randomUUID` from `node:crypto`; regression test exercising the real default).
4. **Report link never appended** — the reply was dispatched from inside
   `insertAssistantMessage`, which runs *before* the wakeup-processor links
   orphan artifacts to the assistant message (`source_message_id`). The link
   lookup therefore found no artifacts. Fix: PR **#3638** (dispatch after the
   artifact-linking step).

## Reply quality (PR #3633)

From live feedback on the first successful report:

- **In-place acknowledgement** — the `ThinkWork is working on it…` placeholder is
  now `chat.update`-d into the final answer (falling back to a fresh post if the
  ack was deleted/uneditable), so no placeholder lingers.
- **Slack `mrkdwn` formatting** — agent replies were posted as raw GitHub-flavored
  markdown (literal `**`, `###`, `-`, tables). `toSlackMrkdwn` converts to Slack's
  dialect (`*bold*`, headings→bold, `•` bullets, `<url|label>`, tables flattened),
  protecting code/link spans behind NUL-byte sentinels so bare numbers in a report
  are never corrupted.
- **Public report link** — turns producing an artifact append a clickable
  `📄 <…/share/<token>|Title>` public share (`getOrCreateArtifactShare` +
  `signShareToken`), served by the existing `artifact-share` handler as an
  unauthenticated read-only page: click → rendered report in the browser, no
  login. Public now; revocable, auth later.

## Latency

Acknowledgement posts within the events-handler ingress (well inside Slack's
3-second deadline); the answer follows when the durable platform-agent turn
finalizes (seconds for chat turns; longer for tool-using turns such as CRM
lookups). No asynchronous queue boundary was required — the synchronous
durable-ingress path acknowledges reliably.

## Carry-forward (not blocking Slack completion)

- **Agent references a "document card" that does not exist in Slack** — the
  report reply ends with "the full report is available in the document card
  above". That card is a ThinkWork-app affordance; in Slack the artifact is a
  `📄` link. The agent prompt should describe the artifact surface-neutrally (or
  the delivery layer should rewrite it), so the reply never points at UI the
  reader cannot see.

- **CRM connector authorization** — the linked user initially had no active MCP
  token for `twenty--crm` / `lastmile--crm`, so early CRM questions fell back to
  memory; connector auth resolved during dogfood.
- **DM native typing status** — the in-place ack covers channels; a true
  ephemeral "typing…" indicator needs the Slack assistant-app surface
  (`assistant.threads.setStatus`), scoped as a follow-up.
- **Teams (U6–U8)** — U6 install path merged behind `enable_msteams_app=false`;
  U7/U8 await Microsoft tenant-admin access.
