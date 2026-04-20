export type WikiPageType = "ENTITY" | "TOPIC" | "DECISION";

export type EntitySubtype =
  | "person"
  | "company"
  | "project"
  | "repo"
  | "product"
  | (string & {});

export interface WikiGraphNode {
  id: string;
  slug: string;
  label: string;
  pageType: WikiPageType;
  subtype?: EntitySubtype;
  ownerId?: string | null;
  summaryPreview?: string;

  firstCompiledAt?: string;
  lastCompiledAt: string;
  status: "ACTIVE" | "STALE" | "ARCHIVED";

  primaryAgentIds: string[];
  lastTouchedAgentId?: string | null;

  initialX?: number;
  initialY?: number;
  pinned?: boolean;

  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface WikiGraphEdge {
  id: string;
  source: string | WikiGraphNode;
  target: string | WikiGraphNode;

  sectionSlug?: string;
  contextExcerpt?: string;

  firstSeenAt: string;
  lastSeenAt: string;
  isCurrent: boolean;

  weight?: number;
}

export interface WikiSubgraph {
  focalPageId: string;
  depth: number;
  atTime: string;
  nodes: WikiGraphNode[];
  edges: WikiGraphEdge[];
  hasMore: Record<string, boolean>;
}

export interface CameraState {
  tx: number;
  ty: number;
  scale: number;
}

/**
 * Filter state for the wiki graph. `null` → no filter active, render
 * everything full color. Non-null → 3-state rendering:
 *   • `matchedIds`      — matched nodes, full color.
 *   • `neighborIds`     — 1-hop neighbors of a match, muted fill + a
 *                          colored outline ring in the node's type color.
 *   • everything else   — muted fill only, no outline ring.
 * Edges stay visible: full opacity when at least one endpoint is
 * matched, muted when both are unmatched. Nothing is ever hidden.
 */
export interface GraphFilter {
  matchedIds: Set<string>;
  neighborIds: Set<string>;
}
