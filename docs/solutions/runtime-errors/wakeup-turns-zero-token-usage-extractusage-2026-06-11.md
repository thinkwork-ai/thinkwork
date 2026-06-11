---
title: "Wakeup turns recorded 0/0 tokens: extractUsage missed pi-ai usage keys (and the test tested a copy)"
date: 2026-06-11
category: docs/solutions/runtime-errors/
module: packages/api
problem_type: runtime_error
component: cost_recording
severity: high
applies_when:
  - Turn headers show duration + cost but no "X in / Y out" token label
  - usage_json has input_tokens 0 / output_tokens 0 on succeeded turns
  - Adding a new consumer of the Pi runtime's invoke response usage
  - Writing tests for pure helpers exported from a module with DB imports
tags: [usage, tokens, pi-ai, wakeup-processor, cost-recording, finalize, test-antipattern]
---

# Wakeup turns recorded 0/0 tokens: extractUsage missed pi-ai usage keys

## Symptom

Every wakeup-dispatched turn (`question_answer` resumes, `automation`) had
`input_tokens: 0, output_tokens: 0` in `thread_turns.usage_json` while manual
chat turns were fully populated. The web turn header hides the token label
when both are zero, so it looked like a UI regression of PR #2337. Cost still
displayed (tool-cost events flow through a separate pipeline).

## Root cause

The Pi runtime returns usage with **pi-ai style keys** —
`{input, output, cacheRead}` — under `response.usage`. There are two
normalizers:

- `packages/pi-runtime-core/src/finalize-client.ts` checks
  `"inputTokens", "input", "prompt_tokens"` → the chat finalize path was
  correct.
- `packages/api/src/lib/cost-recording.ts` `extractUsage()` only checked
  `inputTokens || input_tokens || prompt_tokens` → the wakeup-processor path
  (which builds `usage_json` itself from the invoke response) got zeros.

Fixed in PR #2365 by adding the pi-ai aliases to `extractUsage`, matching
finalize-client's set. Keep BOTH alias lists in sync when usage key shapes
change.

## Why tests missed it

`packages/api/src/__tests__/cost-recording.test.ts` contained a **pasted
copy** of `extractUsage` ("These mirror the logic in the module — keep in
sync"). The copy passed forever while the real export drifted. The fix added
`src/lib/cost-recording.extract-usage.test.ts` which imports the real export
(partial-mock `@thinkwork/database-pg` with `importOriginal` to dodge the DB
side effects).

**Anti-pattern: never test a copied implementation.** If module side effects
make importing hard, partial-mock the dependency — don't fork the function
into the test file.

## Diagnostic recipe

```sql
-- which dispatch path loses tokens?
select w.source,
       count(*) filter (where coalesce((t.usage_json->>'input_tokens')::int,0)=0
                          and coalesce((t.usage_json->>'output_tokens')::int,0)=0) as zero_tok,
       count(*) as total
from thread_turns t join agent_wakeup_requests w on w.id = t.wakeup_request_id
where t.status='succeeded' group by 1;
```

A clean split by `source` (wakeup paths 100% zero, chat fine) means a
payload-shape mismatch in one path's normalizer, not a runtime accounting
bug.

## Related

- Historical zeros stay zero — values were never captured; no backfill.
- The turn header cost comes from `cost_events` (threadTurns.query.ts), not
  `usage_json.cost_usd`; the two can disagree.
