# Homepage screenshot inventory

The homepage pulls product shots from this folder (`apps/www/public/images/admin/`) and `apps/www/public/images/mobile/`. Each image is used via `ScreenshotFrame.astro`, which renders a window-chrome bezel around the PNG.

## Shipped (in `public/images/`)

### Admin

| File | Used by |
|------|---------|
| `dashboard.png` | `SystemModel.astro` |
| `agent-templates.png` (capabilities list) | `AgentTemplates.astro` |
| `cost-analytics.png` | `CostControl.astro` |
| `thread-detail.png` | `Audit.astro` |
| `memories-graph.png` (all-agents graph) | `MemoryWedge.astro` |

### Mobile

| File | Used by |
|------|---------|
| `threads-list.png` | `MobileApp.astro` (left phone) |
| `wiki-graph.png` | `MobileApp.astro` (right phone) |

## Reserve (in `apps/www/assets/reserve/` — NOT shipped)

Kept versioned in the repo for future pages or decks but excluded from the static build so they don't inflate payload.

- `admin/memories-graph-filtered.png` — single-agent view of the memory graph
- `mobile/wiki-list.png` — wiki list view from mobile
- `mobile/tasks-list.png` — legacy tasks tab capture (pre-wiki-first narrative)

## Not yet captured

- `evals-run.png` — would be `/evaluations/$runId`. Until it lands, the Evals narrative lives as:
  - Pillar #5 in `FiveControls` (`copy.ts → controls.items[4]`)
  - Proof point #5 in `ProofStrip` (`copy.ts → proofStrip[4]`)
  - Sub-feature "Evals run on the same trace" inside Audit (`copy.ts → audit.features[3]`)
  - The `evals` object in `copy.ts` still holds a full section's worth of copy so the dedicated showcase is easy to re-add once a real capture exists.

## How to swap in a new capture

1. Save the PNG to the matching path above. Aspect targets: roughly 16:10 for admin, vertical phone frame for mobile.
2. Strip any real tenant names or PII before committing.
3. Keep each file under ~600 KB.

## Adding the Evals showcase back

1. Capture `/evaluations/$runId` and save to `public/images/admin/evals-run.png`.
2. Create `src/components/Evals.astro` that wraps `CapabilityShowcase` with the `evals` object from `copy.ts` (convert `evals.bullets` to `features: [{ title, desc }]` objects — see `agentTemplates.features` for shape).
3. Compose `<Evals />` in `src/pages/index.astro` between `<CostControl />` and `<SystemModel />`.
