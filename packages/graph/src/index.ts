// @thinkwork/graph — shared 3D force-graph rendering for admin and computer.
//
// Hosts:
//   - MemoryGraph — Hindsight memory + entity graph (used by Brain).
//   - WikiGraph — compiled wiki-page graph (used by Pages).
//
// The two components were ported from apps/admin/src/components/{Memory,Wiki}Graph.tsx
// in U2 of plan docs/plans/2026-05-09-003-feat-computer-memory-ui-port-plan.md
// to give apps/admin and apps/computer one source of truth.
//
// Performance invariants (in-place opacity mute on filter, one-shot camera
// init, stable nodeThreeObject) are load-bearing — see each component's
// header comment before changing them.

export { MemoryGraph } from "./MemoryGraph.js";
export type { MemoryGraphHandle, MemoryGraphNode } from "./MemoryGraph.js";

export { WikiGraph } from "./WikiGraph.js";
export type { WikiGraphHandle, WikiGraphNode } from "./WikiGraph.js";

export {
  MEMORY_COLOR,
  ENTITY_COLOR,
  AGENT_COLOR,
  MEMORY_TYPE_COLORS,
} from "./palettes/memory-palette.js";

export {
  PAGE_TYPES,
  PAGE_TYPE_LABELS,
  PAGE_TYPE_BADGE_CLASSES,
  PAGE_TYPE_BORDER_CLASSES,
  PAGE_TYPE_FORCE_COLORS,
  PAGE_TYPE_DEFAULT_FORCE_COLOR,
  pageTypeLabel,
} from "./palettes/wiki-palette.js";
export type { WikiPageType } from "./palettes/wiki-palette.js";

export { MemoryGraphQuery, WikiGraphQuery } from "./queries.js";
