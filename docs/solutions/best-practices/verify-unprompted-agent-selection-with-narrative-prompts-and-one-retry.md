---
title: "Verifying unprompted agent selection: use narrative prompts and a one-retry rule"
date: 2026-07-07
category: best-practices
module: dogfood-qa-verification
problem_type: best_practice
component: testing_framework
severity: medium
applies_when:
  - "Writing acceptance criteria or a verification brief for probabilistic/unprompted agent behavior (e.g. 'the agent should choose X without being told the name X')"
  - "An agent-selection scenario produces a miss on the first dogfood/QA attempt"
tags:
  [
    dogfood-qa,
    verification-doctrine,
    probabilistic-behavior,
    prompt-design,
    unprompted-selection,
  ]
---

# Verifying Unprompted Agent Selection: Use Narrative Prompts and a One-Retry Rule

## Context

THINK-207 (U3 of THINK-202) needed to prove R12: agents choose `tw:timeline`
unprompted for sequence-shaped content, without the directive name ever
appearing in the prompt. The first self-contained verification prompt
described a product rollout using a phase/status table shape ("Phase
Overview" with columns), and the agent emitted a GFM table — a genuine miss,
even with the freshly deployed guidance and runtime confirmed loaded. A
second, purely narrative prompt (a plain description of a sequence with dates
and a "this is where we are now" framing, no table scaffolding) then produced
the timeline unprompted. The verification brief had already allowed one
retry (two consecutive genuine misses = FAIL), so the miss-then-pass
sequence still counted as an overall PASS for R12.

The same pass also hit two non-results unrelated to the guidance: one prompt
was sparse enough that the agent asked clarifying questions and emitted no
document; one turn on Kimi K2.5 degenerated into a runaway `"I'll!!!!…"`
model glitch. Neither was counted against the retry budget — both were
re-run with a more self-contained prompt.

## Guidance

1. **A verification prompt's own shape competes with the guidance being
   tested.** For "the agent chooses X unprompted" requirements, a prompt that
   incidentally scaffolds a _different_ output shape (a table with a status
   column, an explicit bulleted structure) can prime that competing shape
   even when the underlying content is otherwise a good fit for X and the
   agent's guidance correctly nudges toward X. Write these prompts as
   narrative, self-contained descriptions of the underlying content —
   avoid embedding structural hints that resemble a competing output.

2. **Decide the retry threshold before running scenarios, not after seeing a
   miss.** A single miss on an inherently probabilistic selection requirement
   is not evidence the guidance path is broken. Fix a rule up front: two
   consecutive _genuine_ misses (with a confirmed-fresh skill/runtime) is the
   FAIL threshold; a single miss followed by a pass is a PASS, not a shrug.

3. **Distinguish a genuine miss from a non-result.** A genuine miss is the
   agent producing a document but not selecting the target output. A
   non-result is the agent asking clarifying questions, timing out, or
   degenerating into unrelated model-runtime noise and producing no document
   at all — these should be re-run with a more self-contained prompt and are
   not counted toward the retry budget; they say nothing about the guidance
   under test.

4. **Record the actual prompts used, not just the verdict**, so a later
   reader can tell whether a miss came from a genuinely ambiguous case or
   from prompt-shape priming (see Examples).

## Why This Matters

Without this doctrine, a first-attempt miss on a probabilistic requirement
gets misread as a guidance defect — triggering unnecessary rework on
guidance that is actually working — or, worse, a first prompt happens to hit
and the verifier never learns the guidance is fragile to prompt framing,
producing false confidence. Naming the retry rule and the narrative-prompt
requirement up front turns an otherwise ambiguous single data point into a
designed, reproducible test, and separates "the guidance doesn't work" from
"this particular prompt happened to prime a different shape" or "the model
had an unrelated bad turn."

## When to Apply

- Any requirement phrased as "the agent selects/chooses/reaches for X
  without being told" — unprompted-selection, default-behavior, or
  house-style-adoption requirements.
- Writing a verification brief for a newly shipped authoring-guidance change
  (skill content, selection-trigger wording) before it's exercised live.
- Triaging a dogfood miss on a probabilistic requirement: check the prompt's
  shape and whether it primed a competing output before concluding the
  guidance failed.

## Examples

**Miss (table-shaped prompt, competing structure):**

> Prompt listed rollout phases with a status column ("Phase Overview").
> Agent emitted a GFM table with a status column — no `tw:timeline`. The
> prompt itself supplied a table shape, which likely primed the table
> choice.

**Pass (narrative prompt, no competing structure):**

> Prompt described a Q4 onboarding sequence in plain prose — "discovery in
> October → configuration in early November → a two-week guided pilot in
> late November, that's the stage we're planning toward right now →
> go-live in December" — no table framing, no directive named. Agent chose
> `tw:timeline` unprompted.

**Non-result (excluded from retry budget):**

> Sparse prompt → agent asked clarifying questions, emitted no document.
> Re-run with a self-contained prompt; not counted as a miss.

## Related

- `docs/dogfood-reports/2026-07-07-THINK-207-dogfood.md` — the verification
  pass this pattern is drawn from (scenario 2, "R12 positive").
- `docs/solutions/architecture-patterns/new-tw-directive-kind-checklist.md`
  — the authoring-guidance seam (item 6) that this verification method
  proves end to end.
