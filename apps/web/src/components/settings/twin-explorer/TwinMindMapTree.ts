/**
 * Mind-map tree model + tidy layout for the Traversal view (Eric
 * 2026-07-23: deterministic mind-map UI as a THIRD view alongside Graph
 * and Table — the force renderer stays on the Graph view).
 *
 * Pure data + math, no React. Consumes the SAME `TraversalState` the
 * force traversal uses; produces a laid-out tree: at each root,
 * out-relations branch right and in-relations branch left (classic mind
 * map); deeper levels keep flowing away from the root. Entities are
 * placed ONCE — a second path to an already-placed entity renders as a
 * dashed cross-link, never a duplicate subtree.
 *
 * Layout is a tidy tree: leaves stack vertically, parents center on
 * their children, columns advance per-branch by the parent pill's
 * width. Zero physics — positions are a pure function of the state.
 */
import type { TwinGraphLink, TwinGraphNode } from "@thinkwork/graph";
import {
  groupKey,
  type TraversalState,
  type TraversalSummaryRow,
} from "./TwinTraversal";

export interface MindMapNode {
  /** Placement id — entity `~id` or `sum:`/`more:`/`none:` synthetic. */
  id: string;
  kind: "entity" | "summary" | "more" | "none";
  /** The canonical entity object (kind "entity" only). */
  entity?: TwinGraphNode;
  label: string;
  typeLabel: string | null;
  /** Group key for summary/more nodes (drives expand/collapse/batch). */
  groupKey?: string;
  /** Display label for the branch from the parent. */
  relationship?: string;
  /** Real relationship edge behind the branch (opens the sheet). */
  edge?: TwinGraphLink;
  direction?: "in" | "out";
  side: "left" | "right";
  pending?: boolean;
  expanded?: boolean;
  count?: number;
  children: MindMapNode[];
}

export interface MindMapRootTree {
  root: TwinGraphNode;
  left: MindMapNode[];
  right: MindMapNode[];
}

export interface MindMapCrossLink {
  fromId: string;
  toId: string;
  relationship: string;
  edge?: TwinGraphLink;
}

export interface MindMapModel {
  roots: MindMapRootTree[];
  crossLinks: MindMapCrossLink[];
}

export interface BuildMindMapOptions {
  relationshipLabel?: (slug: string) => string;
  typeLabel?: (slug: string) => string;
}

function endpointOf(endpoint: string | { id: string }): string {
  return typeof endpoint === "object" ? endpoint.id : endpoint;
}

/**
 * Derive the mind-map tree from the traversal state. Same visibility
 * semantics as the force build: walk from roots, expanded groups show
 * loaded members plus "+N more…", collapse hides subtrees recursively,
 * singleton groups inline their lone member (no hub).
 */
export function buildMindMap(
  state: TraversalState,
  options?: BuildMindMapOptions,
): MindMapModel {
  const relLabel = (slug: string) => options?.relationshipLabel?.(slug) ?? slug;
  const typeName = (slug: string) => options?.typeLabel?.(slug) ?? slug;
  const placed = new Set<string>();
  const crossLinks: MindMapCrossLink[] = [];

  const buildEntityChildren = (
    focal: TwinGraphNode,
    side: "left" | "right",
    atRoot: boolean,
  ): { left: MindMapNode[]; right: MindMapNode[] } => {
    const left: MindMapNode[] = [];
    const right: MindMapNode[] = [];
    const rows = state.summaries.get(focal.id);
    if (rows === undefined) return { left, right };
    if (rows.length === 0) {
      const none: MindMapNode = {
        id: `none:${focal.id}`,
        kind: "none",
        label: "no relations",
        typeLabel: null,
        side,
        children: [],
      };
      (side === "left" ? left : right).push(none);
      return { left, right };
    }
    for (const row of rows) {
      // Only the root splits sides; deeper levels keep flowing outward.
      const childSide: "left" | "right" = atRoot
        ? row.direction === "in"
          ? "left"
          : "right"
        : side;
      const child = buildRowNode(focal, row, childSide);
      if (child) (childSide === "left" ? left : right).push(child);
    }
    return { left, right };
  };

  const buildEntityNode = (
    entity: TwinGraphNode,
    side: "left" | "right",
    relationship: string | undefined,
    edge: TwinGraphLink | undefined,
    direction: "in" | "out" | undefined,
  ): MindMapNode => {
    const sub = buildEntityChildren(entity, side, false);
    return {
      id: entity.id,
      kind: "entity",
      entity,
      label: entity.label,
      typeLabel: entity.typeLabel,
      relationship,
      edge,
      direction,
      side,
      pending: state.pending.has(entity.id),
      children: side === "left" ? sub.left : sub.right,
    };
  };

  const buildRowNode = (
    focal: TwinGraphNode,
    row: TraversalSummaryRow,
    side: "left" | "right",
  ): MindMapNode | null => {
    const key = groupKey(focal.id, row);
    const group = state.groups.get(key);
    if (!group) return null;
    const memberIds = state.members.get(key) ?? [];
    const links = state.memberLinks.get(key) ?? [];
    const edgeForMember = (memberId: string) =>
      links.find(
        (link) =>
          endpointOf(link.source) === memberId ||
          endpointOf(link.target) === memberId,
      );

    // Singleton: inline the lone member, no hub.
    if (group.count === 1 && memberIds.length === 1) {
      const memberId = memberIds[0]!;
      const member = state.nodesById.get(memberId);
      if (!member) return null;
      const relationship = relLabel(row.relationship);
      if (placed.has(memberId)) {
        crossLinks.push({
          fromId: focal.id,
          toId: memberId,
          relationship,
          edge: edgeForMember(memberId),
        });
        return null;
      }
      placed.add(memberId);
      return buildEntityNode(
        member,
        side,
        relationship,
        edgeForMember(memberId),
        row.direction,
      );
    }

    const summaryId = `sum:${key}`;
    const children: MindMapNode[] = [];
    if (group.expanded) {
      for (const memberId of memberIds) {
        const member = state.nodesById.get(memberId);
        if (!member) continue;
        if (placed.has(memberId)) {
          crossLinks.push({
            fromId: summaryId,
            toId: memberId,
            relationship: relLabel(row.relationship),
            edge: edgeForMember(memberId),
          });
          continue;
        }
        placed.add(memberId);
        children.push(
          buildEntityNode(
            member,
            side,
            undefined,
            edgeForMember(memberId),
            row.direction,
          ),
        );
      }
      const remaining = group.count - memberIds.length;
      if (remaining > 0) {
        children.push({
          id: `more:${key}`,
          kind: "more",
          label: `+${remaining} more…`,
          typeLabel: row.targetType,
          groupKey: key,
          side,
          pending: state.pending.has(key),
          children: [],
        });
      }
    }
    return {
      id: summaryId,
      kind: "summary",
      label: typeName(row.targetType),
      typeLabel: row.targetType,
      groupKey: key,
      relationship: relLabel(row.relationship),
      direction: row.direction,
      side,
      pending: state.pending.has(key),
      expanded: group.expanded,
      count: group.count,
      children,
    };
  };

  const roots: MindMapRootTree[] = [];
  for (const rootId of state.rootIds) {
    const root = state.nodesById.get(rootId);
    if (!root) continue;
    if (placed.has(rootId)) continue; // a root already reachable elsewhere
    placed.add(rootId);
    const sides = buildEntityChildren(root, "right", true);
    roots.push({ root, left: sides.left, right: sides.right });
  }
  return { roots, crossLinks };
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export const PILL_H = 36;
export const PILL_MAX_W = 220;
export const PILL_MIN_W = 64;
const CHAR_W = 7.2;
const PILL_PAD = 24;
const H_GAP = 56;
const V_GAP = 10;
const ROOT_GAP = 48;

export interface PlacedNode {
  node: MindMapNode | null; // null for the root pill placeholder
  /** Root entity when this placement IS a root pill. */
  root?: TwinGraphNode;
  id: string;
  x: number; // left edge
  y: number; // top edge
  width: number;
  height: number;
  depth: number;
  side: "left" | "right";
  parentId: string | null;
}

export interface PlacedEdge {
  id: string;
  fromId: string;
  toId: string;
  label?: string;
  edge?: TwinGraphLink;
  dashed?: boolean;
}

export interface MindMapLayout {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  width: number;
  height: number;
}

export function pillWidth(label: string): number {
  return Math.max(
    PILL_MIN_W,
    Math.min(PILL_MAX_W, Math.round(PILL_PAD + label.length * CHAR_W)),
  );
}

/**
 * A pill's rendered width including its chrome: summary pills carry a
 * chevron (left) and a count badge (right), so their box is wider than
 * the bare type label — otherwise "Ship-To" + chevron + "(2)" truncates.
 */
export function nodePillWidth(node: MindMapNode): number {
  const base = pillWidth(node.label);
  if (node.kind === "summary") {
    const chevron = 16;
    const badge = 14 + String(node.count ?? "").length * 8;
    return Math.min(PILL_MAX_W + chevron + badge, base + chevron + badge);
  }
  return base;
}

function subtreeHeight(node: MindMapNode): number {
  if (node.children.length === 0) return PILL_H;
  const kids = node.children.reduce(
    (sum, child) => sum + subtreeHeight(child),
    0,
  );
  return Math.max(PILL_H, kids + V_GAP * (node.children.length - 1));
}

/**
 * Lay the model out. Coordinates are unbounded (can be negative on the
 * left side); the returned width/height describe the bounding box after
 * normalization to a (0,0) origin.
 */
export function layoutMindMap(model: MindMapModel): MindMapLayout {
  const nodes: PlacedNode[] = [];
  const edges: PlacedEdge[] = [];

  const place = (
    node: MindMapNode,
    parentId: string,
    parentX: number,
    parentWidth: number,
    top: number,
    depth: number,
  ): void => {
    const width = nodePillWidth(node);
    const height = subtreeHeight(node);
    const y = top + height / 2 - PILL_H / 2;
    const x =
      node.side === "right"
        ? parentX + parentWidth + H_GAP
        : parentX - H_GAP - width;
    nodes.push({
      node,
      id: node.id,
      x,
      y,
      width,
      height: PILL_H,
      depth,
      side: node.side,
      parentId,
    });
    edges.push({
      id: `edge:${parentId}->${node.id}`,
      fromId: parentId,
      toId: node.id,
      label: node.relationship,
      edge: node.edge,
    });
    let childTop = top;
    for (const child of node.children) {
      place(child, node.id, x, width, childTop, depth + 1);
      childTop += subtreeHeight(child) + V_GAP;
    }
  };

  let rootTop = 0;
  for (const tree of model.roots) {
    const leftHeight =
      tree.left.reduce((sum, n) => sum + subtreeHeight(n), 0) +
      V_GAP * Math.max(0, tree.left.length - 1);
    const rightHeight =
      tree.right.reduce((sum, n) => sum + subtreeHeight(n), 0) +
      V_GAP * Math.max(0, tree.right.length - 1);
    const treeHeight = Math.max(PILL_H, leftHeight, rightHeight);
    const rootWidth = pillWidth(tree.root.label);
    const rootY = rootTop + treeHeight / 2 - PILL_H / 2;
    nodes.push({
      node: null,
      root: tree.root,
      id: tree.root.id,
      x: 0,
      y: rootY,
      width: rootWidth,
      height: PILL_H,
      depth: 0,
      side: "right",
      parentId: null,
    });
    let top = rootTop + (treeHeight - rightHeight) / 2;
    for (const child of tree.right) {
      place(child, tree.root.id, 0, rootWidth, top, 1);
      top += subtreeHeight(child) + V_GAP;
    }
    top = rootTop + (treeHeight - leftHeight) / 2;
    for (const child of tree.left) {
      place(child, tree.root.id, 0, rootWidth, top, 1);
      top += subtreeHeight(child) + V_GAP;
    }
    rootTop += treeHeight + ROOT_GAP;
  }

  for (const cross of model.crossLinks) {
    edges.push({
      id: `cross:${cross.fromId}->${cross.toId}`,
      fromId: cross.fromId,
      toId: cross.toId,
      label: cross.relationship,
      edge: cross.edge,
      dashed: true,
    });
  }

  // Normalize to a (0,0) origin.
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  for (const placedNode of nodes) {
    minX = Math.min(minX, placedNode.x);
    minY = Math.min(minY, placedNode.y);
    maxX = Math.max(maxX, placedNode.x + placedNode.width);
    maxY = Math.max(maxY, placedNode.y + placedNode.height);
  }
  for (const placedNode of nodes) {
    placedNode.x -= minX;
    placedNode.y -= minY;
  }
  // Drop cross-link edges whose endpoints aren't placed (collapsed away).
  const placedIds = new Set(nodes.map((n) => n.id));
  const visibleEdges = edges.filter(
    (edge) => placedIds.has(edge.fromId) && placedIds.has(edge.toId),
  );

  return {
    nodes,
    edges: visibleEdges,
    width: maxX - minX,
    height: maxY - minY,
  };
}
