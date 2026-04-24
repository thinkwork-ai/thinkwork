---
name: gather
description: >
  Authoring guidance for parallel sub-skill invocation inside
  agent-driven skills. Documents the pattern other SKILL.md bodies
  reference when they say "gather in parallel" — post-U8, the model
  fan-outs sub-skill calls itself rather than relying on a runtime
  primitive.
license: Proprietary
metadata:
  author: thinkwork
  version: "1.0.0"
---

# Gather — parallel fan-out guidance

## This is not a runnable skill

`gather` has no script, no prompt, and no MCP. It exists in the
catalog so skill authors + the model share a vocabulary for "fan out
these sub-skill calls in parallel" when a SKILL.md body describes a
gather step. Post-U8 there is no runtime primitive called `gather` —
the model invokes each sub-skill via its own `Skill(slug, inputs)`
call and the runtime handles concurrency automatically.

Other SKILL.md bodies reference the pattern from this skill's name so
both the author and the model have a consistent anchor.

## The pattern

When a SKILL.md body describes a gather step like:

> Gather in parallel: `crm_account_summary`, `ar_summary`,
> `support_incidents_summary`, `web-search`, `wiki_search` —
> `crm_account_summary` is critical; others degrade with a footer note.

the model should:

1. Invoke each named sub-skill via `Skill(slug, inputs)` with the
   inputs the enclosing skill supplied (typically `{customer}`, plus
   `{period}` or `{meeting_date}` where noted).
2. Treat the calls as independent — invoke them in whatever order is
   convenient; don't serialize waits on one before starting another.
3. For **critical** sub-skills (the enclosing SKILL.md body names
   which), if the call errors or returns empty, ABORT the enclosing
   skill with a clear user message. A brief anchored on missing
   critical context is worse than no brief.
4. For **optional** sub-skills, catch the error, record
   `<sub-skill> unavailable: <reason>` as a footer note in the
   enclosing skill's deliverable, and continue with the remaining
   context.
5. Collect successful returns into a single object keyed by sub-skill
   name. Pass that object to the next step (typically `synthesize`).

## What this skill does NOT do

- It does not decide what to fetch — the enclosing skill's SKILL.md
  author picks the sub-skills.
- It does not block the enclosing skill on any external signal.
  Sub-skills should be short-running fetches or computations; anything
  that waits on humans or downstream systems belongs in the reconciler
  pattern (see `customer-onboarding-reconciler`), not in a gather
  step.
- It does not guarantee ordering inside the aggregated output. Treat
  the gathered object as a dict keyed by sub-skill name.

## Example

From `sales-prep` (v2.0.0):

> 2. **Gather in parallel.** Call these sub-skills with `{customer}`
>    (and `{meeting_date}` where noted). Collect successful returns
>    into a single `gathered` object keyed by sub-skill name.
>    - `crm_account_summary(customer)` — required.
>    - `ar_summary(customer)` — optional; footer on miss.
>    - `support_incidents_summary(customer)` — optional.
>    - `web-search({query: customer, date: meeting_date})` —
>      optional.
>    - `wiki_search({query: customer})` — optional.

Each of those sub-skills is its own `Skill("<slug>", inputs)` call.
The model makes five calls; the runtime runs them concurrently.

## Migration note

v1.0.0 landed the current `execution: context` shape — the entry ships
as authoring guidance for the parallel fan-out pattern expressed via
model-driven `Skill()` calls. The pre-V1 declarative runtime hook was
retired with plan §U6.
