# Doc figures

Named SVG figures for the Agent Documentation pages live here — **one file
per doc section**, not one shared module:

```
figures/start-here.tsx
figures/agents.tsx
figures/spaces.tsx
figures/memory.tsx
figures/tools.tsx
figures/automations.tsx
figures/operations.tsx
```

The split is deliberate. Several agents write doc content in parallel; a
single `diagrams.tsx` holding every figure would be a permanent merge
conflict. `../diagrams.tsx` therefore holds **only** the shared primitives
(`Diagram`, `DgBox`, `DgChip`, `DgLabel`, `DgArrow`, `DgGroup`, `DgNode`)
and the tone/token maps.

## Rules for a new figure

- Build it from the primitives in `../diagrams.tsx`. Don't hardcode colors:
  hue comes from the five `DiagramTone` accents, and every neutral
  (surface, border, text) is a CSS token, so figures follow the theme.
- Author coordinates in a fixed `viewBox`; the SVG scales to the column.
- Type sizes: 13px titles, 11px subtitles, 10px mono edge labels — same as
  the kit, so an SVG figure and a `FlowChain` sit together cleanly.
- Every figure gets a `title` (its accessible name) and usually a caption.
- Export one named component per figure, e.g. `AgentFolderDiagram`. Import
  it from the page that uses it.
