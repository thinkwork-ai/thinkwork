// @thinkwork/graph — shared 3D force-graph rendering for web surfaces.
//
// Hosts:
//   - MemoryGraph — Hindsight memory + entity graph (used by Brain).
//   - WikiGraph — compiled wiki-page graph (used by Pages).
//   - KnowledgeGraph — Cognee thread graph with trust/provenance styling.
//
// The Memory/Wiki components were ported out of the app layer to keep graph
// rendering behavior reusable and versioned in one package.
//
// Performance invariants (in-place opacity mute on filter, one-shot camera
// init, stable nodeThreeObject) are load-bearing — see each component's
// header comment before changing them.

export { MemoryGraph } from "./MemoryGraph.js";
export type { MemoryGraphHandle, MemoryGraphNode } from "./MemoryGraph.js";

export { WikiGraph, buildConnectedWikiGraphData } from "./WikiGraph.js";
export type { WikiGraphHandle, WikiGraphNode } from "./WikiGraph.js";

export {
  KnowledgeGraph,
  buildKnowledgeGraphData,
  knowledgeGraphTrustColor,
  knowledgeGraphTrustState,
} from "./KnowledgeGraph.js";
export type {
  KnowledgeGraphConnectedEdge,
  KnowledgeGraphEdge,
  KnowledgeGraphGroundingStatus,
  KnowledgeGraphHandle,
  KnowledgeGraphNode,
  KnowledgeGraphProvenanceStatus,
  KnowledgeGraphTrustState,
} from "./KnowledgeGraph.js";

export {
  classifyNode,
  connectedGraphEdges,
  deriveGraphClassification,
  endpointId,
  normalizeGraphSearch,
} from "./graph-utils.js";
export type {
  GraphClassification,
  GraphEndpoint,
  NodeVisualState,
} from "./graph-utils.js";

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

export {
  KnowledgeGraphQuery,
  MemoryGraphQuery,
  WikiGraphQuery,
} from "./queries.js";
