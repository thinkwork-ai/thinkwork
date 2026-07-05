# Document authoring rules — the house style

You author markdown; the platform compiles the visual document. These rules
are about the _substance_: what to include, how to structure it, and which
component fits which content. Layout, typography, color, and dark mode are
the compiler's job — you cannot and need not control them.

## Document anatomy (in order)

1. **Frontmatter** (optional) — `eyebrow`, `date`, `context`. The eyebrow is
   a small-caps category label (`QUARTERLY REPORT`, `DECISION BRIEF`); the
   date/context become the muted metadata line.
2. **Stat strip** — when the document has 3+ quantifiable signals, open with
   a `tw:stats` block (big number + small label). Omit when there aren't
   real numbers; never pad with filler stats.
3. **`## Summary`** — the document's answer in 2-3 sentences: what is true,
   what changed, what needs attention. Lead with the conclusion; a reader who
   stops here knows the answer.
4. **Verdict grid** — when the document answers discrete questions, a
   `tw:verdict-grid` block right after the summary.
5. **Body sections** — `##` headings per section; `###` for repeating items
   (findings, ideas, units). Give repeating items stable visible IDs
   (`F1.`, `U2.`) in their headings.
6. **Recommendations / next steps** — numbered, concrete, tied to findings.

Never start the body with a `#` heading — the platform renders the H1 from
the tool's `title` parameter.

## Structure choices

- Prose held to short paragraphs; every claim a chart shows must also be
  stated in text — a visual complements prose, never replaces it.
- GFM tables for 5+ uniform items; keep header rows short.
- Ordered lists for sequences and recommendations; definition-style bullet
  pairs (`**Evidence:** …`) for labeled fields inside repeated items.

## Choosing chart types (form first)

Pick the form by the data's job — one chart, one job:

| Data's job                         | Type         |
| ---------------------------------- | ------------ |
| Magnitude comparison across items  | `bar`        |
| Change over time                   | `line`       |
| Parts of a whole (2–4 parts)       | `donut`      |
| A row of headline numbers          | `stat-strip` |
| A compact inline trend             | `sparkline`  |
| One value against a maximum/target | `meter`      |
| Stage-to-stage conversion (CRM)    | `funnel`     |

- If the "chart" would have one value, use a `meter` or a `tw:stats` tile,
  not a bar chart.
- Never more than ~12 points in a bar chart or ~4 slices in a donut —
  aggregate the tail into "other" or split the data.
- `title` names the series (there is no legend for single-series charts);
  `qualifier` states the unit ("count of opportunities", "USD thousands").
- The `caption` states the _takeaway_ ("Qualification is the biggest
  drop-off"), never a description of the chart type.
- The platform pairs every chart with a collapsible data table
  automatically — don't duplicate the numbers in a markdown table.

## Machine navigability

- Stable IDs on repeating items (R1, U1, F1…) as visible text in headings.
- Section headings get stable anchors automatically from their text — link
  to them with `[see Summary](#summary)`.

## What NOT to do

- No raw HTML or SVG — stripped at compile time.
- No external links as load-bearing content — they degrade to plain text
  (documents are fully self-contained).
- No secrets, tokens, or credentials in the body.
- Don't reproduce a chart's data table in prose; interpret it instead.
