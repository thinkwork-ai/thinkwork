---
name: package
display_name: Package
description: >
  Render a synthesis into a final Markdown deliverable using a named
  template. Deterministic — pure template substitution, no LLM call.
license: Proprietary
metadata:
  author: thinkwork
  version: "0.1.0"
category: workflow
version: "0.1.0"
author: thinkwork
icon: file-text
tags: [composition, primitive, rendering, deliverable]
execution: script
mode: tool
invocable_from: composition
is_default: false
scripts:
  - name: render_package
    path: scripts/render.py
    description: "Render a synthesis dict into a Markdown deliverable using a named template."
inputs:
  synthesis:
    type: string
    required: true
  format:
    type: enum
    required: true
    values: [sales_brief, health_report, renewal_risk]
  metadata:
    type: string
    required: false
output: deliverable
templates:
  sales_brief: templates/sales_brief.md.tmpl
  health_report: templates/health_report.md.tmpl
  renewal_risk: templates/renewal_risk.md.tmpl
---

# Package Skill

## Why this is a script, not a prompt

The deliverable is the artifact the composition is ultimately judged on.
A template-rendered step is cheaper, deterministic, reviewable in diff,
and avoids last-mile LLM drift (reordering sections, renaming headings,
dropping citations). Compositions that need generative polishing should
do it inside `synthesize`, not here.

## Contract

**Inputs**

| Field     | Required | Description |
|-----------|----------|-------------|
| synthesis | Yes      | Output of the `synthesize` step. Must contain the four-section structure (`## Risks`, `## Opportunities`, `## Open questions`, `## Talking points`). |
| format    | Yes      | Template name — one of `sales_brief`, `health_report`, `renewal_risk`. Rejected at the input boundary if unknown. |
| metadata  | No       | Optional JSON-ish string the template may interpolate (e.g., `customer`, `meeting_date`). Templates read keys they care about and ignore the rest. |

**Output**

A single Markdown string. The composition stores it under the step's
declared output key (conventionally `deliverable`).

## Adding a format

1. Add a `.md.tmpl` file under `templates/`.
2. Add its key to the `format` enum and the `templates:` map in
   `skill.yaml`.
3. Extend `tests/test_render.py` with a round-trip snapshot for the new
   format.

Templates use a minimal mustache-style substitution (`{{ synthesis }}`,
`{{ metadata.customer }}`). No loops, no conditionals, no includes. If a
template needs branching, that's a sign the work belongs in `synthesize`.

## What this skill does NOT do

- It does not call an LLM.
- It does not invent missing sections. If `synthesis` is missing one of
  the four headings, the rendered deliverable will have an empty section
  — that's a signal the upstream `synthesize` step needs attention, not
  a bug in `package`.
- It does not deliver the result. Wiring a deliverable to chat / email /
  agent-owner channels is the composition's delivery block, handled by
  later units in the plan.
