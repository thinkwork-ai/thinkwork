/**
 * Traversal state model for the Digital Twin explorer (twin-traversal
 * plan U4, KTD-4).
 *
 * Pure data + functions — no React, no fetching. The explorer owns one
 * `TraversalState`, feeds fetch results in through the mutators, and
 * renders `buildTraversalGraphData(state)` through TwinGraph's controlled
 * mode.
 *
 * Visibility is DERIVED, never torn down: the build walks from the roots,
 * so collapsing a group hides its members' traversed sub-rings recursively
 * (their fetched state is kept for instant re-expand), and removing a root
 * prunes its subtree while nodes another root still reaches survive —
 * summaries/members are caches, the walk decides what renders.
 *
 * Synthetic nodes (`sum:` / `more:` / `none:` ids) are client-side only
 * (KTD-4) and cached by id so object identity — and therefore simulation
 * positions and the camera — survives rebuilds.
 */
import type {
  TwinGraphData,
  TwinGraphLink,
  TwinGraphNode,
} from "@thinkwork/graph";

export interface TraversalSummaryRow {
  relationship: string;
  direction: "in" | "out";
  targetType: string;
  count: number;
}

export interface TraversalGroup extends TraversalSummaryRow {
  focalId: string;
  expanded: boolean;
  /** How many members have been fetched (offset for the next batch). */
  loadedOffset: number;
}

export interface TraversalState {
  /** Root node ids, in pick order. */
  rootIds: string[];
  /** Every fetched entity node, by `~id` — the canonical objects. */
  nodesById: Map<string, TwinGraphNode>;
  /** focalId → ring rows; presence means the summary fetch completed. */
  summaries: Map<string, TraversalSummaryRow[]>;
  /** groupKey → group state. */
  groups: Map<string, TraversalGroup>;
  /** groupKey → ordered member node ids. */
  members: Map<string, string[]>;
  /** groupKey → focal↔member links from the member batches. */
  memberLinks: Map<string, TwinGraphLink[]>;
  /** In-flight fetch guards: focalId (summary) or groupKey (members). */
  pending: Set<string>;
  /** Synthetic node/link caches — object identity across rebuilds. */
  synthNodes: Map<string, TwinGraphNode>;
  synthLinks: Map<string, TwinGraphLink>;
}

export const TRAVERSAL_BATCH_SIZE = 20;

const SUMMARY_COLOR = "#475569";
const MORE_COLOR = "#334155";
const SUMMARY_RADIUS = 14;
const MORE_RADIUS = 10;

export function groupKey(
  focalId: string,
  row: Pick<TraversalSummaryRow, "relationship" | "direction" | "targetType">,
): string {
  return `${focalId}|${row.relationship}|${row.direction}|${row.targetType}`;
}

export function createTraversal(): TraversalState {
  return {
    rootIds: [],
    nodesById: new Map(),
    summaries: new Map(),
    groups: new Map(),
    members: new Map(),
    memberLinks: new Map(),
    pending: new Set(),
    synthNodes: new Map(),
    synthLinks: new Map(),
  };
}

/** Register an entity node (root or member); existing objects win so
 *  simulation positions survive. Returns the canonical object. */
export function upsertNode(
  state: TraversalState,
  node: TwinGraphNode,
): TwinGraphNode {
  const existing = state.nodesById.get(node.id);
  if (existing) {
    existing.label = node.label;
    existing.typeLabel = node.typeLabel ?? existing.typeLabel;
    existing.properties = node.properties;
    return existing;
  }
  state.nodesById.set(node.id, node);
  return node;
}

/** Add a traversal root (checkbox accumulate / search or overview pick). */
export function addRoot(state: TraversalState, node: TwinGraphNode): void {
  upsertNode(state, node);
  if (!state.rootIds.includes(node.id)) state.rootIds.push(node.id);
}

/** Unchecking a root prunes its subtree (the walk keeps shared nodes). */
export function removeRoot(state: TraversalState, nodeId: string): void {
  state.rootIds = state.rootIds.filter((id) => id !== nodeId);
}

/** Record a fetched summary ring; seeds group state for each row. */
export function setSummary(
  state: TraversalState,
  focalId: string,
  rows: TraversalSummaryRow[],
): void {
  state.summaries.set(focalId, rows);
  for (const row of rows) {
    const key = groupKey(focalId, row);
    const existing = state.groups.get(key);
    if (existing) {
      existing.count = row.count;
    } else {
      state.groups.set(key, {
        ...row,
        focalId,
        expanded: false,
        loadedOffset: 0,
      });
    }
  }
}

export function setGroupExpanded(
  state: TraversalState,
  key: string,
  expanded: boolean,
): void {
  const group = state.groups.get(key);
  if (group) group.expanded = expanded;
}

/** Fold one fetched member batch into the group. */
export function addMembers(
  state: TraversalState,
  key: string,
  memberNodes: TwinGraphNode[],
  links: TwinGraphLink[],
): void {
  const group = state.groups.get(key);
  if (!group) return;
  const ids = state.members.get(key) ?? [];
  for (const node of memberNodes) {
    upsertNode(state, node);
    if (!ids.includes(node.id)) ids.push(node.id);
  }
  state.members.set(key, ids);
  const existing = state.memberLinks.get(key) ?? [];
  const linkIds = new Set(existing.map((link) => link.id));
  for (const link of links) {
    if (!linkIds.has(link.id)) {
      linkIds.add(link.id);
      existing.push(link);
    }
  }
  state.memberLinks.set(key, existing);
  group.loadedOffset = ids.length;
}

function synthNode(
  state: TraversalState,
  id: string,
  make: () => TwinGraphNode,
): TwinGraphNode {
  const existing = state.synthNodes.get(id);
  if (existing) return existing;
  const created = make();
  state.synthNodes.set(id, created);
  return created;
}

function synthLink(
  state: TraversalState,
  id: string,
  make: () => TwinGraphLink,
): TwinGraphLink {
  const existing = state.synthLinks.get(id);
  if (existing) return existing;
  const created = make();
  state.synthLinks.set(id, created);
  return created;
}

export interface BuildOptions {
  /** Slug → display name for relationship edge labels. */
  relationshipLabel?: (slug: string) => string;
  /** Slug → display name for entity types on summary labels. */
  typeLabel?: (slug: string) => string;
}

/**
 * Derive the rendered graph by walking from the roots (R5–R11):
 * per visible entity with a fetched ring, one summary node per group
 * ("Customers (20)"), expanded groups additionally render their loaded
 * members attached to the focal plus a "+N more…" node while members
 * remain; members recurse. Node/link objects come from the state caches so
 * identity — and camera — is stable.
 */
export function buildTraversalGraphData(
  state: TraversalState,
  options?: BuildOptions,
): TwinGraphData {
  const nodes: TwinGraphNode[] = [];
  const links: TwinGraphLink[] = [];
  const nodeIds = new Set<string>();
  const linkIds = new Set<string>();
  const visitedFocals = new Set<string>();

  const pushNode = (node: TwinGraphNode) => {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push(node);
  };
  const pushLink = (link: TwinGraphLink) => {
    if (linkIds.has(link.id)) return;
    linkIds.add(link.id);
    links.push(link);
  };

  const relLabel = (slug: string) => options?.relationshipLabel?.(slug) ?? slug;
  const typeName = (slug: string) => options?.typeLabel?.(slug) ?? slug;

  const visit = (focalId: string) => {
    const focal = state.nodesById.get(focalId);
    if (!focal) return;
    pushNode(focal);
    if (visitedFocals.has(focalId)) return;
    visitedFocals.add(focalId);

    const rows = state.summaries.get(focalId);
    if (rows === undefined) return; // ring not fetched yet
    if (rows.length === 0) {
      // "(no relations)" affordance — the focal renders alone, no crash.
      const noneId = `none:${focalId}`;
      pushNode(
        synthNode(state, noneId, () => ({
          id: noneId,
          canonicalId: null,
          label: "(no relations)",
          typeLabel: null,
          isSystem: false,
          isCenter: false,
          properties: {},
          kind: "none",
          color: MORE_COLOR,
          radius: MORE_RADIUS,
          labelAlways: true,
        })),
      );
      pushLink(
        synthLink(state, `link:${noneId}`, () => ({
          id: `link:${noneId}`,
          source: focalId,
          target: noneId,
          label: "",
          properties: {},
        })),
      );
      return;
    }

    for (const row of rows) {
      const key = groupKey(focalId, row);
      const group = state.groups.get(key);
      if (!group) continue;
      const summaryId = `sum:${key}`;
      const summaryNode = synthNode(state, summaryId, () => ({
        id: summaryId,
        canonicalId: null,
        label: "",
        typeLabel: row.targetType,
        isSystem: false,
        isCenter: false,
        properties: {},
        kind: "summary",
        color: SUMMARY_COLOR,
        radius: SUMMARY_RADIUS,
        labelAlways: true,
      }));
      // Label reflects live expand state: collapsed shows the count,
      // expanded becomes the collapse handle.
      summaryNode.label = group.expanded
        ? `${typeName(row.targetType)} —`
        : `${typeName(row.targetType)} (${group.count})`;
      summaryNode.pending = state.pending.has(key);
      pushNode(summaryNode);
      const summaryLinkId = `link:${summaryId}`;
      const summaryLink = synthLink(state, summaryLinkId, () => ({
        id: summaryLinkId,
        source: row.direction === "in" ? summaryId : focalId,
        target: row.direction === "in" ? focalId : summaryId,
        label: relLabel(row.relationship),
        properties: {},
      }));
      pushLink(summaryLink);

      if (!group.expanded) continue;
      const memberIds = state.members.get(key) ?? [];
      for (const memberId of memberIds) {
        visit(memberId);
      }
      for (const link of state.memberLinks.get(key) ?? []) {
        pushLink(link);
      }
      const remaining = group.count - memberIds.length;
      if (remaining > 0) {
        const moreId = `more:${key}`;
        const moreNode = synthNode(state, moreId, () => ({
          id: moreId,
          canonicalId: null,
          label: "",
          typeLabel: row.targetType,
          isSystem: false,
          isCenter: false,
          properties: {},
          kind: "more",
          color: MORE_COLOR,
          radius: MORE_RADIUS,
          labelAlways: true,
        }));
        moreNode.label = `+${remaining} more…`;
        moreNode.pending = state.pending.has(key);
        pushNode(moreNode);
        pushLink(
          synthLink(state, `link:${moreId}`, () => ({
            id: `link:${moreId}`,
            source: summaryId,
            target: moreId,
            label: "",
            properties: {},
          })),
        );
      }
    }
  };

  for (const rootId of state.rootIds) {
    const root = state.nodesById.get(rootId);
    if (root) root.isCenter = true;
    visit(rootId);
  }

  return { nodes, links };
}

/** groupKey embedded in a synthetic `sum:`/`more:` node id, or null. */
export function groupKeyFromSyntheticId(nodeId: string): string | null {
  const match = /^(?:sum|more):(.+)$/.exec(nodeId);
  return match ? match[1]! : null;
}
