# Doc figures

Named SVG figures for the Agent Documentation pages live here — **one file
per doc section**, not one shared module:

```
figures/start-here.tsx
figures/agents.tsx
figures/spaces-threads.tsx
figures/memory.tsx
figures/tools.tsx
figures/automations.tsx
figures/operations.tsx
```

The split is deliberate. Several agents write doc content in parallel; a
single shared figures module would be a permanent merge conflict.
(`../diagrams.tsx`, the old shared Dg* primitive layer, was deleted in the
2026-08-11 report restyle — figures are now self-contained raw SVG.)

## Rules for a new figure

Figures are drawn in the report figure language — model a new one on
`ConsolidationLoopFigure` in `memory.tsx`:

- Raw SVG in a fixed `viewBox`; the SVG scales to the column
  (`className="block h-auto w-full"`), never scrolls.
- Boxes are `fill-card` with `stroke-teal-400/50`; edges are
  `stroke-muted-foreground` lines with a `markerEnd` arrowhead; edge labels
  are italic 11px `fill-muted-foreground` text.
- Amber (`stroke-amber-400/70`, dashed enclosure, `fill-amber-400/10` box)
  is reserved for the places a human is load-bearing — most figures have
  none.
- Loops are drawn as loops, with a real return edge. A straight chain is
  not a figure — use the kit's `Flow` inline in the page instead.
- Every `<marker>` id is unique across the docs (grep before picking one).
- Every figure gets `role="img"`, an `aria-label`, and a `<figcaption>`
  that earns its place.
- Export one named component per figure, e.g. `TenancyDiagram`, imported
  from the page that uses it.
