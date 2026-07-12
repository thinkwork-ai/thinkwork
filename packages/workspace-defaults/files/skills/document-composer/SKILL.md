---
name: document-composer
description: 'Compose document deliverables — reports, plans, briefs, and any other genre registered for this workspace — as markdown that the platform compiles into a beautiful house-style document, saved as a durable artifact via emit_document. Use whenever the deliverable is document-shaped: the user asks for a plan, report, brief, write-up, analysis, proposal, or ideation summary, or asks to "write this up", "make a document", "put together a report", or when a substantial multi-section answer deserves a durable, shareable form instead of chat text.'
---

# Document Composer

Author documents as **markdown only**. You write the substance — frontmatter,
prose, tables, and `tw:` component blocks — and call `emit_document` with that
single body. The platform compiles the polished house-style HTML render
(layout, typography, dark mode, charts) at emission; you never write HTML.
The thread shows a compact card linking to the full-page reader.

## When to reach for a document

- The user asks for a plan, report, brief, analysis, proposal, or ideation
  summary — or to "write this up" / "make a document".
- Your answer is substantial (multiple sections, comparisons, decisions,
  metrics) and will be revisited or shared. A document outlives the thread.
- NOT for short answers, quick lists, or conversational replies — those stay
  in chat. NOT for interactive dashboards — that is the artifact-builder skill.

## Genres

The available genres and their purposes are listed on the `emit_document`
tool itself — read the tool's `genre` parameter description and pick by
purpose. The set is workspace-specific (operators can register new genres),
so never assume a fixed list.

## Authoring the markdown body

Structure: optional frontmatter, then `##` sections. The platform supplies
the document header (eyebrow, H1 from your `title` parameter, meta line from
frontmatter) — start your body at `## Summary`, never with a `#` heading.

Optional frontmatter (unknown keys are dropped with a warning):

```
---
eyebrow: QUARTERLY REPORT
date: 2026-07-05
context: coverage of the Q3 pipeline
---
```

- `eyebrow` — small-caps category label above the title.
- `date` / `context` — the muted metadata line under the title.

Then plain markdown: `##` sections (lead with a Summary section that answers
the document's question), GFM tables for 5+ uniform items, ordered lists for
steps and recommendations. See `references/authoring-rules.md` for the house
guidance on structure and when to use each component.

## Components (`tw:` fenced blocks)

Rich visuals are declarative fenced blocks — the platform renders the pixels.
The fence info string picks the component; the body is YAML.

**Stat strip** — 3+ headline numbers at the top of a document:

````
```tw:stats
items:
  - { value: 42, label: opportunities }
  - { value: "+18%", label: change vs prior }
  - { value: 3, label: need action }
```
````

**Verdict grid** — discrete questions with bold answers:

````
```tw:verdict-grid
cards:
  - { question: Ship it?, answer: Yes, note: All gates green, tone: acc }
  - { question: Risk, answer: Low, tone: info }
```
````

Tones: `acc` (positive), `info` (neutral), `warn`, `bad`.

**Timeline** — an ordered sequence of named events or phases on a horizontal
track (rollout phases, project milestones, launch plans). Reach for it
whenever the content is "first this, then this, then this" with named stages —
don't wait to be asked for one:

````
```tw:timeline
items:
  - { label: Kickoff, caption: Goals and owners locked, date: Week 1 }
  - { label: Rollout, caption: Phased team onboarding, current: true }
  - { label: Full adoption, date: Q4 }
```
````

- 1–8 `items`, in the order they happen; `label` is required on every item.
- `caption` (one-line detail) and `date` are optional and rendered verbatim —
  write display-ready text (`Week 1`, `Q4`, `Jan 2026`), not machine dates.
- Mark at most one item `current: true` — the phase in progress now; the
  platform emphasizes it. Omit `current` for purely past or future sequences.

**Chart** — data you write, pixels the platform draws. Types: `bar`, `line`,
`donut`, `stat-strip`, `sparkline`, `meter`, `funnel`.

````
```tw:chart
type: funnel
title: Pipeline by stage
qualifier: count of opportunities
series:
  - { label: Leads, value: 120 }
  - { label: Qualified, value: 64 }
  - { label: Won, value: 18 }
caption: Qualification is the biggest drop-off.
```
````

- `title` is required; `qualifier` is the one-line unit note; `caption` is
  the takeaway sentence (an interpretation, not a description).
- `meter` takes `max:` (defaults to 100) and a single-point series.
- Every chart automatically gets a collapsible data table — don't repeat the
  numbers in prose unless interpreting them.
- Never write SVG or chart markup yourself — it is stripped.

An unknown component or malformed YAML rejects the emission with a diagnostic
that names the supported vocabulary and shows a corrected example — fix the
block and re-emit.

## Hard rules

- **No raw HTML.** Any inline HTML in the markdown is stripped; express
  structure with markdown and `tw:` components only.
- **External links become plain text** — documents are fully self-contained.
  Same-document `#anchors` and `mailto:` links survive.
- **Keep the body under ~90KB.** It is the document itself in markdown form —
  substance, not a transcript.
- **Never include secrets, tokens, or credentials.**

## Emitting and revising

- Call `emit_document` with genre, title, abstract (2-3 sentences), the
  markdown body as `digest_markdown`, and `status: "draft"` unless the user
  asked for a final document.
- The result returns a `document_id`. **Always pass that document_id when
  revising** — re-emission with it updates the same document instead of
  creating a duplicate.
- When the user declares the document done, re-emit with `status: "final"` —
  this pins an immutable version. Later edits re-open a draft head; the
  pinned version is preserved.
- **After emitting, keep the thread reply to one or two sentences** — e.g.
  "Done — the report is ready" plus anything the user must decide next. The
  platform attaches the document to your reply automatically and surfaces it
  the right way for wherever the user is reading — a card in the ThinkWork
  app, a link in chat surfaces like Slack. So write surface-neutral prose:
  never tell the user to look at a "card", never say "above" or "below",
  never describe the surface at all — just state that the deliverable is
  ready. Never recap the document's sections, contents, styling, or
  document_id in chat. The document is the deliverable, not the reply.
