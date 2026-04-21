---
name: synthesize
description: >
  Structured analysis of a framed problem plus gathered facts. Produces
  risks, opportunities, open questions, and talking points that the
  package step renders into a deliverable.
license: Proprietary
metadata:
  author: thinkwork
  version: "0.1.0"
---

# Synthesize Skill

## When this is invoked

Only by a composition step, after `frame` and `gather` have run. The
composition runner passes the named outputs from those prior steps
(as strings / aggregated dicts rendered to strings) and expects a
structured analysis back.

## Contract

**Inputs**

| Field           | Required | Description |
|-----------------|----------|-------------|
| framed          | Yes      | Output of the `frame` step — goal, constraints, known unknowns, decision criteria. |
| gathered        | Yes      | Aggregated output of the `gather` step — one section per branch id, with footer notes for unavailable branches. |
| focus           | No       | Optional steering hint from the composition's inputs (e.g., `financial`, `expansion`, `risks`, `general`). |
| prior_learnings | No       | Output of `compound.recall`, if the composition declared one. Treat as background, not ground truth. |

**Output**

A structured analysis with four sections. Keep the headings exactly so
`package` templates can find them.

```
## Risks
- Specific, attributed to a source in the gathered data where possible.

## Opportunities
- Specific, actionable, grounded in the gathered data.

## Open questions
- Anything that `frame` flagged as a known unknown AND gather didn't
  resolve, plus anything new that surfaced during analysis.

## Talking points
- Ordered most-to-least important for the current focus.
```

## Prompt

See `prompts/synthesize.md`. Update the prompt together with this
contract if the structure above changes.

## What this skill does NOT do

- It does not gather new data — everything in the output must be
  traceable to the `framed`, `gathered`, or `prior_learnings` inputs.
- It does not render a final deliverable — that's `package`'s job.
- It does not decide the focus on its own. If `focus` is missing or
  `general`, treat all four sections with equal weight.
