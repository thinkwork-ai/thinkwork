/**
 * Shared 2D renderer core (twin traversal KTD-1).
 *
 * The neo4j-style canvas painting the force-graph views established — flat disc +
 * rim + wrapped in-disc label, and links trimmed to disc rims with inline
 * rotated relationship labels and an arrowhead on the target rim — lives
 * here as parameterized paint functions so every 2D force-graph surface
 * (Memory tab, twin traversal) is identical BY CONSTRUCTION. Color, alpha,
 * radius, and label accessors stay caller-supplied; the geometry does not.
 *
 * Camera discipline is parameterized too: `applySettleFit` is the
 * one-shot onEngineStop framing (Memory tab), `makeEarlyTickFramer` the
 * frame-once-early-in-the-settle variant with zoom clamps (twin — no
 * end-of-settle zoom snap, Eric 2026-07-22).
 */
import { wrapLabelLines, darkenColor } from "./graph-utils.js";

export interface NodePaintSpec {
  /** Disc radius in graph units. */
  radius: number;
  color: string;
  /** Whole-node opacity (filter dimming). Default 1. */
  alpha?: number;
  /** Darkened-rim stroke around the disc. Default true. */
  rim?: boolean;
  /** Wrapped in-disc label; null/undefined paints no label. */
  label?: string | null;
  /** Default white — the neo4j-style in-disc text. */
  labelColor?: string;
  /** Max wrapped label lines. Default 3. */
  maxLabelLines?: number;
}

/** Flat disc + rim + centered wrapped label (in-disc, neo4j style). */
export function paintNodeDisc(
  node: { x: number; y: number },
  ctx: CanvasRenderingContext2D,
  spec: NodePaintSpec,
): void {
  const { radius: r, color } = spec;
  ctx.globalAlpha = spec.alpha ?? 1;
  ctx.beginPath();
  ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
  if (spec.rim !== false) {
    ctx.lineWidth = Math.max(0.75, r * 0.05);
    ctx.strokeStyle = darkenColor(color);
    ctx.stroke();
  }

  if (spec.label != null) {
    // Wrapped text that stays inside the disc.
    const fontSize = Math.max(3.5, r * 0.32);
    ctx.font = `600 ${fontSize}px sans-serif`;
    const lines = wrapLabelLines(
      (s) => ctx.measureText?.(s)?.width ?? s.length * fontSize * 0.6,
      spec.label,
      r * 1.7,
      spec.maxLabelLines ?? 3,
    );
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = spec.labelColor ?? "#ffffff";
    const lineHeight = fontSize * 1.15;
    const y0 = node.y - ((lines.length - 1) / 2) * lineHeight;
    lines.forEach((line, index) => {
      ctx.fillText(line, node.x, y0 + index * lineHeight);
    });
  }
  ctx.globalAlpha = 1;
}

export interface LinkPaintSpec {
  /** Rim-trim radii for the two endpoint discs. */
  sourceRadius: number;
  targetRadius: number;
  /** Stroke/fill color (label text uses the same color, neo4j style). */
  color: string;
  /** Inline rotated midpoint label; null/undefined draws a plain line. */
  label?: string | null;
  /**
   * Container dims for the offscreen-label cull (10k offscreen labels must
   * not cost a frame). Omit to skip the cull.
   */
  viewport?: { w: number; h: number } | null;
}

/**
 * Full link painter (replace mode): line trimmed to the disc rims, inline
 * rotated relationship label opening a gap at the midpoint when it fits,
 * arrowhead terminating exactly on the target rim.
 */
export function paintLinkLine(
  link: { source: unknown; target: unknown },
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  spec: LinkPaintSpec,
): void {
  const start = link.source as { x: number; y: number };
  const end = link.target as { x: number; y: number };
  if (typeof start !== "object" || typeof end !== "object") return;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.hypot(dx, dy);
  if (!dist) return;
  const ux = dx / dist;
  const uy = dy / dist;
  const sourceTrim = spec.sourceRadius + 1.5;
  const targetTrim = spec.targetRadius + 1.5;
  if (dist <= sourceTrim + targetTrim) return;
  const sx = start.x + ux * sourceTrim;
  const sy = start.y + uy * sourceTrim;
  const tx = end.x - ux * targetTrim;
  const ty = end.y - uy * targetTrim;
  const lineLen = dist - sourceTrim - targetTrim;

  ctx.strokeStyle = spec.color;
  ctx.fillStyle = spec.color;
  // Constant 1px screen width regardless of zoom.
  ctx.lineWidth = 1 / globalScale;

  let labeled = false;
  if (spec.label != null) {
    const label = spec.label;
    const fontSize = 10 / globalScale;
    ctx.font = `${fontSize}px sans-serif`;
    const textWidth =
      ctx.measureText?.(label)?.width ?? label.length * fontSize * 0.6;
    const gap = textWidth + 10 / globalScale;
    // Only inline the label when the line has room for it, and only when
    // the midpoint is anywhere near the viewport (cheap cull).
    const mx = (sx + tx) / 2;
    const my = (sy + ty) / 2;
    let onScreen = true;
    const t = (
      ctx as unknown as { getTransform?: () => DOMMatrix }
    ).getTransform?.();
    const viewport = spec.viewport;
    if (t && viewport) {
      const px = t.a * mx + t.c * my + t.e;
      const py = t.b * mx + t.d * my + t.f;
      const bound = Math.max(viewport.w, viewport.h) * 2.5;
      onScreen = px > -bound && px < bound && py > -bound && py < bound;
    }
    if (onScreen && lineLen > gap + 14 / globalScale) {
      const half = gap / 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(mx - ux * half, my - uy * half);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(mx + ux * half, my + uy * half);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      let angle = Math.atan2(dy, dx);
      if (angle > Math.PI / 2) angle -= Math.PI;
      else if (angle < -Math.PI / 2) angle += Math.PI;
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(angle);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, 0, 0);
      ctx.restore();
      labeled = true;
    }
  }
  if (!labeled) {
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  }

  // Arrowhead sitting exactly on the target disc's rim.
  const ah = 4;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx - ux * ah - uy * (ah * 0.5), ty - uy * ah + ux * (ah * 0.5));
  ctx.lineTo(tx - ux * ah + uy * (ah * 0.5), ty - uy * ah - ux * (ah * 0.5));
  ctx.closePath();
  ctx.fill();
}

/**
 * One-shot end-of-settle framing (Memory tab strategy): zoom to fit after
 * the first simulation settle, but never fit-to-tiny — sparse layouts
 * would otherwise open unreadably zoomed out. Returns whether the fit ran
 * (callers flip their `framed` state on true).
 */
export function applySettleFit(
  fg: {
    zoomToFit?: (ms: number, padding: number) => void;
    zoom?: (k?: number, ms?: number) => number | void;
  } | null,
  options?: { padding?: number; minZoom?: number },
): boolean {
  if (!fg) return false;
  fg.zoomToFit?.(0, options?.padding ?? 40);
  const k = fg.zoom?.();
  const minZoom = options?.minZoom ?? 0.55;
  if (typeof k === "number" && k < minZoom) {
    fg.zoom?.(minZoom, 0);
  }
  return true;
}

/**
 * Frame ONCE, early in the settle (twin strategy): when the layout has
 * rough shape (~tick 15) fit the camera, clamp the zoom, and never touch
 * it again — no end-of-settle zoom snap. Returns an onEngineTick handler;
 * create a fresh framer whenever the dataset identity changes.
 */
export function makeEarlyTickFramer(
  fgRef: { current: Parameters<typeof applySettleFit>[0] },
  options?: {
    tick?: number;
    padding?: number;
    minZoom?: number;
    maxZoom?: number;
  },
): () => void {
  let ticks = 0;
  let framed = false;
  const atTick = options?.tick ?? 15;
  return () => {
    ticks += 1;
    if (framed || ticks < atTick) return;
    framed = true;
    const fg = fgRef.current;
    fg?.zoomToFit?.(0, options?.padding ?? 20);
    const k = fg?.zoom?.();
    if (typeof k === "number") {
      const max = options?.maxZoom ?? 2.5;
      const min = options?.minZoom ?? 0.7;
      if (k > max) fg?.zoom?.(max, 0);
      else if (k < min) fg?.zoom?.(min, 0);
    }
  };
}
