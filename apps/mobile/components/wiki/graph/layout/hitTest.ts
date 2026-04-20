import { quadtree } from "d3-quadtree";
import type { CameraState, WikiGraphNode } from "../types";

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface WorldPoint {
  x: number;
  y: number;
}

export interface NodeHit {
  node: WikiGraphNode;
  distance: number;
}

const QUADTREE_THRESHOLD = 500;
const TAP_RADIUS_SCREEN_PX = 28;

export function screenToWorld(
  camera: CameraState,
  screen: ScreenPoint,
): WorldPoint {
  return {
    x: (screen.x - camera.tx) / camera.scale,
    y: (screen.y - camera.ty) / camera.scale,
  };
}

export function worldToScreen(
  camera: CameraState,
  world: WorldPoint,
): ScreenPoint {
  return {
    x: world.x * camera.scale + camera.tx,
    y: world.y * camera.scale + camera.ty,
  };
}

/**
 * Find the nearest node to a screen-space tap, within the scale-adjusted
 * tolerance (28 / camera.scale world units per PRD §F3).
 *
 * Uses a linear scan when `nodes.length ≤ 500`; promotes to a d3-quadtree
 * indexed lookup above that. Both paths return the same shape.
 */
export function nearestNode(
  camera: CameraState,
  screen: ScreenPoint,
  nodes: WikiGraphNode[],
): NodeHit | null {
  if (nodes.length === 0) return null;
  const world = screenToWorld(camera, screen);
  const tolerance = TAP_RADIUS_SCREEN_PX / camera.scale;

  if (nodes.length > QUADTREE_THRESHOLD) {
    const tree = quadtree<WikiGraphNode>()
      .x((d) => d.x ?? 0)
      .y((d) => d.y ?? 0)
      .addAll(nodes);
    const found = tree.find(world.x, world.y, tolerance);
    if (!found || found.x == null || found.y == null) return null;
    const dx = found.x - world.x;
    const dy = found.y - world.y;
    return { node: found, distance: Math.hypot(dx, dy) };
  }

  let bestNode: WikiGraphNode | null = null;
  let bestDistance = Infinity;
  for (const n of nodes) {
    if (n.x == null || n.y == null) continue;
    const dx = n.x - world.x;
    const dy = n.y - world.y;
    const d = Math.hypot(dx, dy);
    if (d < bestDistance) {
      bestDistance = d;
      bestNode = n;
    }
  }
  if (!bestNode || bestDistance > tolerance) return null;
  return { node: bestNode, distance: bestDistance };
}
