// @thinkwork/graph — shared 3D force-graph rendering for web surfaces.
//
// Hosts:
//   - MemoryGraph — Hindsight memory + entity graph (used by Brain).
//   - KnowledgeGraph — Bedrock thread graph with trust/provenance styling.
//
// The components were ported out of the app layer to keep graph
// rendering behavior reusable and versioned in one package.
//
// Performance invariants (in-place opacity mute on filter, one-shot camera
// init, stable nodeThreeObject) are load-bearing — see each component's
// header comment before changing them.

export { MemoryGraph } from "./MemoryGraph.js";
export type { MemoryGraphHandle, MemoryGraphNode } from "./MemoryGraph.js";

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
  communityColor,
  connectedGraphEdges,
  deriveGraphClassification,
  endpointId,
  normalizeGraphSearch,
  COMMUNITY_COLORS,
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

export { KnowledgeGraphQuery, MemoryGraphQuery } from "./queries.js";

export {
  paintNodeDisc,
  paintLinkLine,
  applySettleFit,
  makeEarlyTickFramer,
} from "./renderer-core.js";
export type { NodePaintSpec, LinkPaintSpec } from "./renderer-core.js";

export { useGraphPointer } from "./use-graph-pointer.js";
