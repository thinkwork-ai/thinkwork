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
