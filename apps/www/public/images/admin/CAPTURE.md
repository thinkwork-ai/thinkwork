# Homepage screenshot inventory

The homepage pulls product shots from this folder (`apps/www/public/images/admin/`) and `apps/www/public/images/mobile/`. Each image is used via `ScreenshotFrame.astro`; set `pending={true}` to fall back to a styled SVG mock if the PNG isn't ready.

## Admin captures

| File | Used by | Status |
|------|---------|--------|
| `dashboard.png` | `SystemModel.astro` | shipped |
| `agent-templates.png` (capabilities list) | `AgentTemplates.astro` | shipped |
| `cost-analytics.png` | `CostControl.astro` | shipped |
| `memories-graph.png` (all-agents graph) | `MemoryWedge.astro` | shipped |
| `memories-graph-filtered.png` | — | reserve asset (single-agent graph view) |
| `thread-detail.png` | — | reserve asset (thread execution trace, useful for a future "Audit trail" section) |
| `evals-run.png` | — | **not yet captured**. The dedicated Evals showcase section is currently removed to avoid a placeholder. Evals still appears as pillar #5 in `FiveControls.astro` and as a proof point in `ProofStrip.astro`. When a real `/evaluations/$runId` capture lands, re-add an `Evals.astro` component (see `git log` — it was deleted in the `feat(www): unify design system` follow-up; a prior version using `CapabilityShowcase` is recoverable from the history) and compose it in `src/pages/index.astro` between `CostControl` and `SystemModel`. |

## Mobile captures

| File | Used by | Status |
|------|---------|--------|
| `threads-list.png` | `MobileApp.astro` (left phone) | shipped |
| `wiki-graph.png` | `MobileApp.astro` (right phone) | shipped |
| `wiki-list.png` | — | reserve asset |
| `tasks-list.png` | — | legacy (pre-wiki-first narrative); can be deleted when you're sure nothing else references it |

## How to swap in a new capture

1. Save the PNG to the path above, overwriting the existing file. Aspect targets: roughly 16:10 for admin, vertical phone frame for mobile.
2. Strip any real tenant names or PII before committing.
3. Keep each file under ~600 KB.
4. If you're replacing an image that was marked pending, set `pending={false}` (or remove the attribute) on the component that uses it.

## Where to find these images for decks, pitches, or other projects

This folder IS the canonical asset store — anything here ships with the www site and is durably versioned. For reuse outside the www build, copy from this directory.
