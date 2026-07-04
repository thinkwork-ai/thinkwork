---
name: document-composer
description: Compose beautiful, self-contained HTML document deliverables — ideation docs, plans, reports, and briefs — saved as durable artifacts via emit_document. Use whenever the deliverable is document-shaped: the user asks for a plan, report, brief, write-up, analysis, proposal, or ideation summary, or asks to "write this up", "make a document", "put together a report", or when a substantial multi-section answer deserves a durable, shareable form instead of chat text.
---

# Document Composer

Produce document deliverables as **dual-body artifacts**: a canonical markdown
digest (the machine- and mobile-readable record) plus a single-file HTML render
(the beautiful human-facing document), saved together with one `emit_document`
call. The thread shows a compact card linking to the full-page reader.

## When to reach for a document

- The user asks for a plan, report, brief, analysis, proposal, or ideation
  summary — or to "write this up" / "make a document".
- Your answer is substantial (multiple sections, comparisons, decisions,
  metrics) and will be revisited or shared. A document outlives the thread.
- NOT for short answers, quick lists, or conversational replies — those stay
  in chat. NOT for interactive dashboards — that is the artifact-builder skill.

## Genres

Pick one; open its plate in `references/` and imitate its structure:

| Genre | Use for | Plate |
|---|---|---|
| `ideation` | Ranked options/ideas with evidence and a rejection record | `references/plate-ideation.html` |
| `plan` | How something will be done: decisions, requirements, steps | `references/plate-plan.html` |
| `report` | What happened / what is true: findings, metrics, analysis | `references/plate-report.html` |
| `brief` | A compact one-page summary for a decision-maker | `references/plate-brief.html` |

## Composing the two bodies

1. **Write the markdown digest first** — the document's full substance as
   clean markdown (sections, tables, decisions). It is the canonical record:
   agents, mobile, and memory pipelines read it. It is not a transcript; it is
   the document itself in markdown form. Keep it under ~90KB.
2. **Then hand-write the HTML render** following the genre plate and
   `references/authoring-rules.md`. The render presents the same substance —
   never content that isn't in the digest. Keep it under ~250KB.

## Hard rules for the HTML render (violations are rejected, nothing saves)

- **Fully self-contained.** No external URLs anywhere — no CDN fonts or
  styles, no remote images, no relative paths. Every URL in every attribute
  and CSS value must be `data:`, a same-document `#anchor`, or `mailto:`.
  Use system font stacks; inline images as data: URIs; draw diagrams as
  inline SVG.
- **Scriptless.** No `<script>` of any kind, no inline event handlers, no
  `javascript:` URLs. Interactivity is CSS-only: `<details>`, anchors.
- **Both themes.** Style light AND dark: define CSS custom properties in
  `:root`, override them in `@media (prefers-color-scheme: dark)` AND in
  `:root[data-theme="dark"]` (the reader injects `data-theme`; it must win in
  both directions). Include `@media print` rules — the downloaded file is the
  export, and print-to-PDF must look right.
- **Skeleton.** A non-empty `<title>` and id-anchored section headings
  (`<h2 id="summary">`).
- **Never include secrets, tokens, or credentials in either body.**

If `emit_document` returns preflight diagnostics, fix EVERY listed issue and
re-emit — nothing was saved.

## Emitting and revising

- First emission: call `emit_document` with genre, title, abstract (2-3
  sentences), both bodies, and `status: "draft"` unless the user asked for a
  final document.
- The result returns a `document_id`. **Always pass that document_id when
  revising** — re-emission with it updates the same document instead of
  creating a duplicate.
- When the user declares the document done, re-emit with `status: "final"` —
  this pins an immutable version. Later edits re-open a draft head; the
  pinned version is preserved.
- Tell the user where the document lives: the card in this thread opens it,
  and it appears under Artifacts.
