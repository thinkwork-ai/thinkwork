---
title: "Wakeup-processor invoke payload must mirror chat-agent-invoke — third dispatch-parity bug on the same seam"
date: 2026-06-12
category: docs/solutions/architecture-patterns/
module: packages/api
problem_type: architecture_pattern
component: wakeup_processor
severity: high
applies_when:
  - Adding any payload-gated runtime capability (extension, tool config, context field) to chat-agent-invoke
  - A feature works on direct chat turns but silently degrades on resumes/automations
  - Reviewing a PR that touches the chat-agent-invoke payload but not wakeup-processor
tags: [wakeup-processor, chat-agent-invoke, dispatch-parity, ask-user-question, pi-extensions]
---

# Wakeup-processor payload must mirror chat-agent-invoke

## The pattern

There are TWO independent builders of the Pi runtime invoke payload:

- `packages/api/src/handlers/chat-agent-invoke.ts` (direct chat turns)
- `packages/api/src/handlers/wakeup-processor.ts` `agentCorePayload`
  (question_answer resumes, automations, email, webhooks, workspace events)

Anything the runtime gates on payload fields must be added to **both**, or
the capability silently exists only on direct chat turns. This has now
bitten three times:

1. **Message attachments** (#2013) — wakeup path didn't resolve attachments;
   agent was blind to files on resumed turns.
2. **Pinned skills** (plan 2026-06-04-004 U3) — `pinned_skills` had to be
   re-derived in the wakeup fallback.
3. **Extension gate fields** (#2395, 2026-06-12) — `thinkwork_api_url` /
   `thinkwork_api_secret` / `thread_turn_id` were never in the wakeup
   payload, so the runtime's extension gate (`server.ts`) never registered
   `ask_user_question` (or task-status) on ANY wakeup-dispatched turn. The
   model asked follow-up questions in prose instead of a card — on the
   question_answer resume path, i.e. the one path a question flow is
   guaranteed to hit.

## Why it keeps happening

The first card in a thread always renders (chat path), so E2E validation
passes; the regression only shows on the *second* ask, after an answer
round-trip through the wakeup queue. Test the resume turn, not just the
first ask.

## Diagnostic: which prose-question failure is it?

`select position('ask_user_question' in system_prompt) > 0` for the turn:

- **Policy ABSENT + wakeup-dispatched turn** → structural: payload gate
  fields missing on that dispatch path (this doc). All turns of that
  source fail, forever, until the payload is fixed.
- **Policy PRESENT + empty tools_called + Lambda LastModified ≈ turn
  start** → transient deploy race (see
  `docs/solutions/runtime-errors/ask-user-question-tool-missing-during-deploy-roll-2026-06-11.md`).

Dispatch-path split query (clean separation = structural):

```sql
select coalesce(w.source,'(direct chat)') as dispatch,
       count(*) filter (where position('ask_user_question' in coalesce(t.system_prompt,'')) > 0) as has_policy,
       count(*) as total
from thread_turns t
left join agent_wakeup_requests w on w.id = t.wakeup_request_id
where t.started_at > now() - interval '36 hours' and t.status='succeeded'
group by 1;
```

## Guardrails

- `wakeup-processor.system-prompt.test.ts` carries source-inspection parity
  assertions (gate fields, space slugs, user identity). Extend it when
  adding payload fields to chat-agent-invoke.
- Verified safe-by-construction parts of the fix: intake parks the thread
  itself in one transaction (dispatch-independent), the wakeup post-turn
  thread update only stamps `last_turn_completed_at`/preview (AWAITING_USER
  survives), and the sentinel turn-end returns the pre-tool preamble as
  response text on both paths.
- A real refactor would extract a shared payload-builder; until then this
  doc + the parity test are the seam's guardrail.
