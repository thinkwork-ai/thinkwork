// @thinkwork/graph — shared force-graph rendering primitives for web surfaces.
//
// The concrete graph views were removed with their backing queries; what
// remains is the reusable classification, painting, and pointer layer that
// any future graph surface can build on.
//
// Performance invariants (in-place opacity mute on filter, one-shot camera
// init, stable nodeThreeObject) are load-bearing.

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
  paintNodeDisc,
  paintLinkLine,
  applySettleFit,
  makeEarlyTickFramer,
} from "./renderer-core.js";
export type { NodePaintSpec, LinkPaintSpec } from "./renderer-core.js";

export { useGraphPointer } from "./use-graph-pointer.js";
