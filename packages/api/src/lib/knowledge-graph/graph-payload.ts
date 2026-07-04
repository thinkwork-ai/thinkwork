/**
 * Neutral graph-extraction payload types (plan 2026-07-03-005 U1, KTD-5).
 *
 * This is the contract between any extraction engine and the normalizer:
 * a flat node/edge payload the normalizer grounds against the approved
 * ontology. The shapes remain structurally identical to the retired graph
 * client payloads on purpose — the normalizer's behavior is frozen
 * (THINK-133 read-contract decision).
 */

export interface GraphExtractionNode {
  id: string;
  label: string;
  type?: string | null;
  properties?: Record<string, unknown> | null;
}

export interface GraphExtractionEdge {
  id?: string | null;
  source: string;
  target: string;
  label: string;
  type?: string | null;
  properties?: Record<string, unknown> | null;
}

export interface GraphExtractionPayload {
  nodes: GraphExtractionNode[];
  edges: GraphExtractionEdge[];
}
