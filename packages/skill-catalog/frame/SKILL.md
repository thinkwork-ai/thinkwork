---
name: frame
description: >
  Structured problem restatement. First step of every composition — converts a
  free-form problem + prior learnings into an explicit goal, constraints,
  known unknowns, and decision criteria so the gather/synthesize/package
  pipeline has a concrete target.
license: Proprietary
metadata:
  author: thinkwork
  version: "0.1.0"
---

# Frame Skill

## When this is invoked

Only by a composition step. The composition runner passes `problem` and
`context` as resolved inputs and expects a structured restatement back.
Direct chat invocation is not supported.

## Contract

**Inputs**

| Field   | Required | Description |
|---------|----------|-------------|
| problem | Yes      | Free-form statement of what the composition is trying to accomplish, usually assembled from the user's request + composition input placeholders. |
| context | No       | Prior learnings, tenant-wide notes, or any other narrative context the composition wants the frame to account for. |

**Output**

A structured restatement with four sections. Downstream steps read this as
plain text; preserve the headings exactly so `synthesize` can find them.

```
## Goal
One or two sentences: what a successful run of this composition delivers.

## Constraints
- Hard limits (time, audience, tone, format, data access).
- Soft preferences (style, length).

## Known unknowns
- Facts that would meaningfully change the deliverable if resolved.
- Phrase each as a question.

## Decision criteria
- How the eventual deliverable will be judged good enough.
- Include anything measurable where possible.
```

## Prompt

See `prompts/frame.md` for the instruction text the composition runner
passes to the model. Edit the prompt when the structure above changes;
keep the two in sync.

## What this skill does NOT do

- It does not gather data.
- It does not ask the user clarifying questions. Uncertainty goes in
  `Known unknowns` and is resolved by later steps (`gather`) or by the
  composition's `on_missing_input` policy.
- It does not make plans beyond the current run. Plans across runs are
  the `compound` primitive's concern.
