---
name: compound
description: >
  Learnings loop for compositions. Retrieve prior observations scoped to
  (tenant, user, skill, optional subject) at run start, and write up to
  three new observations at run end. Paired — edit recall's and
  reflect's docstrings together.
license: Proprietary
metadata:
  author: thinkwork
  version: "0.1.0"
---

# Compound Learnings

## Why this exists

Without a learnings loop, "running a composition" is just running a
composition. With one, the week-12 run of `sales-prep` for ABC Fuels
is meaningfully better than the week-1 run because the intervening
runs captured customer-specific, rep-specific, and tenant-wide
observations that now flow back as context.

This is the whole reason we ported the compound-engineering pattern —
the feedback cycle is the feature.

## Two scripts, one contract

- **`compound_recall`** runs at the top of every composition. It queries
  AgentCore Memory for learnings under this run's scope and returns the
  top-K as a plain string that downstream steps (frame, synthesize,
  custom prompts) can read as background context.
- **`compound_reflect`** runs at the bottom of every composition. It
  asks an LLM to extract up to three non-obvious, concrete, 1–2
  sentence observations from the run's inputs + deliverable and stores
  them under the same scope.

Edit the two docstrings together. Recall names reflect as the
required follow-up; reflect names recall as its read counterpart.
(Auto-memory `feedback_hindsight_recall_reflect_pair`.)

## Scope

The scope tuple is `(tenant_id, user_id?, skill_id, subject_entity_id?)`.
Writes land at the most specific namespace the scope describes. Recall
walks the namespace chain in priority order (user → tenant):

| Scope shape | Recall walks |
|---|---|
| tenant + user + skill + subject | user+subject → user → tenant |
| tenant + user + skill           | user → tenant |
| tenant + skill + subject        | tenant+subject → tenant |
| tenant + skill                  | tenant |

Per auto-memory `project_memory_scope_refactor`, the per-user memory
substrate is in flight. When it lands, this helper keeps the same
public signature and swaps the underlying namespace scheme without
composition-level changes.

## Failure semantics

Both scripts swallow errors by design. A composition must not fail
because AgentCore Memory was transiently unavailable, or because the
LLM reflection returned garbage. Operators see the failure in
CloudWatch; composition authors see empty prior_learnings (for recall)
or a "skipped" summary (for reflect).

## Validation the reflect step applies

Before storing an extracted observation, reflect checks:

1. Output is valid JSON with a `learnings: [str, ...]` field.
2. Each entry is a non-empty string.
3. Each entry is shorter than ~2000 characters (longer almost always
   means the LLM dumped the deliverable back at us).
4. Cap at 3 per run.

Anything failing validation is dropped silently with a metric-friendly
log line.
