# Document authoring rules — the house style

These rules are what make a document read as designed rather than generated.
The genre plates apply all of them; imitate the plates structurally and use
this file to understand why each choice exists.

## Header anatomy (every document opens with this, in order)

1. **Eyebrow** — a small-caps category label above the title
   (`IDEATION · REPO-GROUNDED`, `QUARTERLY REPORT`, `DECISION BRIEF`).
2. **Title** — one `<h1>`, matching the `<title>`.
3. **Metadata line** — date, topic, author/agent context as muted inline text.
4. **Stats strip** — when the document has 3+ quantifiable signals, a row of
   stat tiles (big number + small label). Omit when there aren't real numbers.
5. **Summary / verdict cards** — when the document answers discrete questions,
   a card grid with an eyebrow question, a bold answer, and supporting prose.

## Layout

- Centered content column, `max-width` ~920px; prose held to ~72ch.
- Section headings (`<h2 id="...">`) with a top border as section separators.
- Repeating items (ideas, findings, units) are `<article>` cards with a chip
  row (category, confidence, status) and a `<dl>` of labeled fields.
- Tables for 5+ uniform items; keep header cells tinted with the accent-soft
  color.

## Color system (copy the plate's variable block)

- All colors are CSS custom properties on `:root`: `--bg`, `--ink`, `--muted`,
  `--line`, `--card`, plus accent/warn/info/bad each with a `-soft` and
  `-text` variant.
- Dark theme redefines the SAME variables twice: once under
  `@media (prefers-color-scheme: dark)` and once under
  `:root[data-theme="dark"]` (also mirror light under
  `:root[data-theme="light"]`). The reader injects `data-theme` from the app
  theme; the media query covers the downloaded/standalone file.
- Text on tinted fills uses the matching `-text` variant, never `--muted`.
- Chips/pills are uniform: full soft-tint fill + matching text color. Never a
  colored stripe on one edge.

## Typography

- System stack only:
  `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`
  and `ui-monospace, "SF Mono", Menlo, Consolas, monospace` for code.
  Never load a webfont — external requests are rejected and would render
  broken anyway.
- Body ~15px/1.6; `h1` ~1.7em; `h2` ~1.25em; eyebrows ~0.72em with letter
  spacing.

## Visuals: diagrams, tables, charts

Documents carry rich visuals wherever content has shape — this is a core
quality bar, not decoration.

- **Diagrams are hand-authored inline SVG**: flow/architecture boxes with
  arrow markers, comparison layouts, state charts. Rules that keep them
  legible: no stroke passes through a text label; arrow labels sit at the
  arrow's midpoint; differentiate shapes by geometry first, fill second; use
  `var(--...)` colors so diagrams follow the theme.
- **Charts are inline SVG too** — simple bars/lines with value labels. No
  charting libraries (scriptless).
- **A visual complements prose, never replaces it** — every relationship a
  diagram shows must also be stated in text.
- SVG paint-server references like `fill="url(#gradient)"` are fine —
  same-document `#refs` pass validation.

## Machine navigability

- Every section heading carries a stable ASCII `id`.
- Stable IDs on repeating items (R1, U1, F1…) appear as visible text AND as
  element ids.
- Semantic HTML throughout: `<article>` per card, `<dl>` for field pairs,
  `<table>` for tabular data, `<details>` (default-closed) for secondary
  content on 3+ repeated cards.

## Print (the export path)

Include an `@media print` block: white background, dark ink, no borders
around the page container, `break-inside: avoid` on cards and tables. The
downloaded file opened in a browser and printed to PDF is the document's
export story.

## Footer

End with a small muted composition footer: what composed the document, the
date, and the source context (one line).
