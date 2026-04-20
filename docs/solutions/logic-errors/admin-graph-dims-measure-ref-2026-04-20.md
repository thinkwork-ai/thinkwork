---
title: "Admin wiki/memory graph view renders blank when loaded with ?view=graph in URL"
date: "2026-04-20"
category: "logic-errors"
module: "apps/admin/src/components"
problem_type: "logic_error"
component: "react_component"
severity: "high"
symptoms:
  - "Admin /wiki?view=graph or /memory?view=graph opens to a blank content area — no graph, no loader, no empty-state message"
  - "Same bug hits when user selects an agent, then toggles to Graph — not only on refresh"
  - "Any Graph toggle in a session where the query cache is cold produces the blank"
root_cause: "logic_error"
resolution_type: "code_fix"
related_components:
  - react
  - urql
tags:
  - react-hooks
  - useeffect-empty-deps
  - useref-vs-callback-ref
  - resizeobserver
  - conditional-branch-ref
  - url-state
  - query-race
  - tanstack-router
---

# Admin wiki/memory graph view renders blank when loaded with ?view=graph in URL

## Problem

After PR #300 added URL persistence for the `view` filter on `/wiki` and `/memory`, opening either page with `view=graph` in the URL (cold load, refresh, or select-agent-then-toggle) rendered a silently blank panel. The component mounted, the toggle looked correct, no console errors appeared. Graph just didn't draw.

## Symptoms

- `/wiki?view=graph&agent=<uuid>` in a fresh tab: blank content area between the toolbar and the bottom chrome.
- `/memory?view=graph`: same blank. Separate second bug (Hindsight auto-reset race) was stripping `view=graph` from the URL first and also masking this one.
- Once the graph rendered in a session (by toggling Graph off and back on with query data already cached), subsequent refreshes worked — the bug only hit the first cold mount.

## Root cause

Two stacked bugs, both triggered by the new URL-driven cold entry into graph view:

### Bug 1 — `/memory` only: Hindsight auto-reset fired during config-query loading window

```tsx
const hindsightEnabled = memorySystemConfigResult.data?.memorySystemConfig?.hindsightEnabled ?? false;

useEffect(() => {
  if (!hindsightEnabled && view === "graph") setView("memories");
}, [hindsightEnabled, view]);
```

On cold load with `?view=graph`, `memorySystemConfigResult.data` is `undefined` for a few hundred ms. The `?? false` coalesced that to `false`, the effect fired, and `setView("memories")` now navigated the URL (per PR #300's updater), stripping `view=graph` before the real config ever arrived. Fix: gate the effect on `memorySystemConfigResult.data !== undefined` so the reset only fires once Hindsight is genuinely known to be disabled.

### Bug 2 — `WikiGraph` + `MemoryGraph`: dims-measure effect read a mount-only ref

```tsx
const containerRef = useRef<HTMLDivElement>(null);
// ...
useEffect(() => {
  const el = containerRef.current;
  if (!el) return;                 // ← early exit if ref not yet attached
  const ro = new ResizeObserver(measure);
  ro.observe(el);
  return () => ro.disconnect();
}, []);                             // ← mount-only

// Render:
if (anyFetching) {
  return <div>Loading graph...</div>;  // ← NO ref attached here
}
if (!dims) {
  return <div ref={containerRef} />;   // ← ref here, but effect already ran once with null
}
return <div ref={containerRef}>...ForceGraph3D...</div>;
```

Cold-mount sequence when the urql query hasn't returned yet:

1. Component mounts during query fetch. `anyFetching=true`. Loading branch renders — no ref attached.
2. `useEffect([])` runs. `containerRef.current === null`. Effect returns early.
3. Query resolves. `anyFetching=false`. Ref-bearing div finally mounts.
4. `useEffect([])` does NOT re-run (empty deps). `containerRef.current` is now set, but nothing measures it.
5. `dims` stays `null` forever. The `if (!dims) return <div ref={containerRef} />` branch holds. Blank panel.

Before URL persistence this was hard to hit: users always toggled to Graph from a page that already had the query cache warm, so `anyFetching=false` on graph mount and the ref-bearing branch was the first render. After URL persistence, cold loads became the norm.

## Solution — PR #302

**Bug 1:** gate the auto-reset on the query having resolved.

```tsx
const hindsightConfigLoaded = memorySystemConfigResult.data !== undefined;
const hindsightEnabled = memorySystemConfigResult.data?.memorySystemConfig?.hindsightEnabled ?? false;

useEffect(() => {
  if (hindsightConfigLoaded && !hindsightEnabled && view === "graph") {
    setView("memories");
  }
}, [hindsightConfigLoaded, hindsightEnabled, view, setView]);
```

**Bug 2:** switch from a `useRef` + empty-deps effect to a state-backed callback ref. When the mounted DOM element changes (initial mount or loading→main branch swap), the state update triggers the effect to re-run with the new element.

```tsx
const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);

useEffect(() => {
  if (!containerEl) return;
  const measure = () => {
    const w = containerEl.offsetWidth;
    const h = containerEl.offsetHeight;
    if (w > 0 && h > 0) setDims({ w, h });
  };
  measure();
  const ro = new ResizeObserver(measure);
  ro.observe(containerEl);
  return () => ro.disconnect();
}, [containerEl]);

// All three render branches now use:
<div ref={setContainerEl} ... />
```

No JSX restructuring. No risk of infinite loop: React's `setState` with a shallowly-equal value (same DOM node) is a no-op, so steady-state renders don't re-trigger.

## Why it stayed hidden

PR #300's Lightweight plan reused the existing analytics.tsx URL-sync pattern exactly and didn't touch the graph components. Both latent bugs predated the change — they only surfaced because URL persistence suddenly made cold-mount-during-fetch the default path instead of a rare edge case. Takeaway: when a change *enables a previously-rare user path*, budget for latent bugs along that path even if the change itself is tight.

## Rules of thumb

- **Empty-deps effects that read a mutable ref are fragile** when the ref'd element can live in a conditionally-rendered branch. If the component has loading/empty/main branches, either attach the ref to a stable outer container or use a state-backed callback ref so the effect re-runs on element swaps.
- **Don't coalesce query-loading values with `?? false` in effect predicates.** `undefined ?? false === false` fires the effect during the loading window with a wrong assumption. Either keep the raw optional and check `=== false` explicitly, or track a separate `loaded` boolean.
- **URL state makes cold entry into any view path the default.** Before shipping URL persistence for a filter, mentally walk the cold-mount path for every rendered branch it can land on.
