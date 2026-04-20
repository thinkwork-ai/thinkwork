import type { WikiGraphNode } from "../types";
import { SCALE_MAX, SCALE_MIN, getNodeRadius } from "./typeStyle";

export interface CameraFit {
  tx: number;
  ty: number;
  scale: number;
}

/**
 * Computes a camera transform that fits every node's center (plus the
 * node radius) inside the viewport with the given padding. Pure; easy to
 * reason about from the call site without a test runner.
 *
 * - Zero nodes → identity (center on viewport, scale 1).
 * - Single node → center on it, scale 1.
 * - Many nodes → scale to the tighter of the two axis ratios so both
 *   dimensions fit, clamped to [SCALE_MIN, SCALE_MAX].
 *
 * World origin is (0, 0) because `forceCenter(0, 0)` seats the sim there.
 * Screen transform is `tx + scale * worldX` — so to center a world point
 * (wx, wy) on screen point (sx, sy): tx = sx - scale * wx.
 */
export interface ComputeFitOptions {
  paddingPct?: number;
  /** Upper bound on the returned `scale`. Auto-fit during the running sim
   *  passes `1` so the camera only zooms out, never in. Defaults to `SCALE_MAX`. */
  maxScale?: number;
  /** When true, ignore the cluster's bbox midpoint and lock the camera at
   *  the viewport center, sizing the scale by the largest distance from
   *  the world origin. Use during the running sim — `forceCenter(0,0)`
   *  pins the centroid at origin, so this keeps the cloud visually still
   *  at canvas center while it expands. Avoids the per-tick recenter
   *  jitter that asymmetric bboxes produce. */
  centerOnOrigin?: boolean;
}

export function computeFit(
  nodes: WikiGraphNode[],
  viewportWidth: number,
  viewportHeight: number,
  {
    paddingPct = 0.1,
    maxScale = SCALE_MAX,
    centerOnOrigin = false,
  }: ComputeFitOptions = {},
): CameraFit {
  const cx = viewportWidth / 2;
  const cy = viewportHeight / 2;

  if (nodes.length === 0) {
    return { tx: cx, ty: cy, scale: 1 };
  }

  const radius = getNodeRadius();
  const padX = viewportWidth * paddingPct;
  const padY = viewportHeight * paddingPct;
  const availW = Math.max(1, viewportWidth - 2 * padX);
  const availH = Math.max(1, viewportHeight - 2 * padY);
  const clamp = (s: number) =>
    Math.min(
      Math.min(SCALE_MAX, maxScale),
      Math.max(SCALE_MIN, s),
    );

  if (centerOnOrigin) {
    // Lock to the viewport center; size by the largest distance from
    // the world origin in either axis. Skips the bbox midpoint entirely
    // so an asymmetric cluster (still settling) doesn't pull the
    // camera around.
    let maxAbsX = 0;
    let maxAbsY = 0;
    let counted = 0;
    for (const n of nodes) {
      if (typeof n.x !== "number" || typeof n.y !== "number") continue;
      if (Math.abs(n.x) > maxAbsX) maxAbsX = Math.abs(n.x);
      if (Math.abs(n.y) > maxAbsY) maxAbsY = Math.abs(n.y);
      counted += 1;
    }
    if (counted === 0) return { tx: cx, ty: cy, scale: 1 };
    const halfW = Math.max(1, maxAbsX + radius);
    const halfH = Math.max(1, maxAbsY + radius);
    const fitScale = Math.min(availW / (2 * halfW), availH / (2 * halfH));
    return { tx: cx, ty: cy, scale: clamp(fitScale) };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let counted = 0;
  for (const n of nodes) {
    if (typeof n.x !== "number" || typeof n.y !== "number") continue;
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
    counted += 1;
  }

  if (counted === 0) return { tx: cx, ty: cy, scale: 1 };

  minX -= radius;
  maxX += radius;
  minY -= radius;
  maxY += radius;
  const worldWidth = Math.max(1, maxX - minX);
  const worldHeight = Math.max(1, maxY - minY);
  const fitScale = Math.min(availW / worldWidth, availH / worldHeight);
  const scale = clamp(fitScale);
  const worldCenterX = (minX + maxX) / 2;
  const worldCenterY = (minY + maxY) / 2;
  return {
    tx: cx - scale * worldCenterX,
    ty: cy - scale * worldCenterY,
    scale,
  };
}
