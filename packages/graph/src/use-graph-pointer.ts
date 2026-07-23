import { useEffect, useRef, useState } from "react";

export type GraphPointerTooltip = { x: number; y: number; text: string };

/**
 * Screen-space distance (px) a pressed pointer must travel before the
 * press becomes a node drag. Real mice almost always jitter a pixel or
 * two between pointerdown and pointerup, and Chrome delivers those as
 * pointermove events — without a threshold every ordinary click on a
 * node turned into a zero-length "drag" that pinned the node (fx/fy)
 * and suppressed the click, so nodes were effectively unclickable.
 */
export const DRAG_START_THRESHOLD_PX = 4;

/**
 * Double-click detection (twin traversal KTD-3): two clicks on the SAME
 * node within this window and drift fire `onNodeDoubleClick` once. The
 * first click still fires `onNodeClick` — traversal expansion is cheap and
 * idempotent, so the pair reads as "expand, then open detail".
 */
export const DOUBLE_CLICK_WINDOW_MS = 300;
export const DOUBLE_CLICK_DRIFT_PX = 4;

/**
 * Screen-space tolerance for edge (link) hit-testing — a click within this
 * many px of a link's segment counts, checked only after every node disc
 * misses (nodes always win).
 */
export const LINK_HIT_TOLERANCE_PX = 5;

interface UseGraphPointerArgs {
  /** The graph container element (same element the size observer uses). */
  containerEl: HTMLElement | null;
  fgRef: React.MutableRefObject<any>;
  graphDataRef: React.MutableRefObject<{ nodes: any[]; links?: any[] }>;
  nodeRadius: (node: any) => number;
  tooltipText: (node: any) => string;
  onNodeClick: (node: any) => void;
  onBackgroundClick: () => void;
  /** Optional dbl-click primitive — unwired, behavior is identical to before. */
  onNodeDoubleClick?: (node: any) => void;
  /**
   * Optional geometric link clicks (segment distance hit-test) — the 2D
   * library's own link picking is part of the canvas color-picking this
   * hook replaces, so hosts that need edge clicks wire them here.
   */
  onLinkClick?: (link: any) => void;
}

/**
 * Geometric pointer handling for the 2D force graphs.
 *
 * force-graph's built-in interaction uses canvas color-picking (each node
 * painted in an index color on a shadow canvas, hit = pixel readback).
 * Brave's fingerprinting shield adds noise to canvas readback, which makes
 * every pick miss — clicks/hovers/drags die, and node clicks register as
 * background clicks. Firefox's resistFingerprinting farbles the same way.
 *
 * This hook replaces picking with math: pointer position →
 * `screen2GraphCoords` → nearest node within its radius. The library's
 * tracker canvas is disabled entirely (`enablePointerInteraction={false}`
 * on the component); its d3-zoom pan/zoom is untouched. Node dragging is
 * reimplemented here — a capture-phase stopPropagation keeps node-drags
 * from also panning the camera.
 */
export function useGraphPointer({
  containerEl,
  fgRef,
  graphDataRef,
  nodeRadius,
  tooltipText,
  onNodeClick,
  onBackgroundClick,
  onNodeDoubleClick,
  onLinkClick,
}: UseGraphPointerArgs): { tooltip: GraphPointerTooltip | null } {
  const [tooltip, setTooltip] = useState<GraphPointerTooltip | null>(null);

  // Stable refs so the listener effect never re-binds on render.
  const callbacksRef = useRef({
    nodeRadius,
    tooltipText,
    onNodeClick,
    onBackgroundClick,
    onNodeDoubleClick,
    onLinkClick,
  });
  callbacksRef.current = {
    nodeRadius,
    tooltipText,
    onNodeClick,
    onBackgroundClick,
    onNodeDoubleClick,
    onLinkClick,
  };

  useEffect(() => {
    if (!containerEl) return;

    const hoverIdRef = { current: null as string | null };
    const dragRef = {
      current: null as {
        node: any;
        moved: boolean;
        startX: number;
        startY: number;
      } | null,
    };
    const suppressClickRef = { current: false };

    const localPoint = (event: MouseEvent | PointerEvent) => {
      const rect = containerEl.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    // Only handle events that originate on the canvas itself — overlay
    // UI (selected-node chip, label toggle, legends) lives inside the
    // container and must keep its own click behavior untouched.
    const isCanvasEvent = (event: Event) => {
      const target = event.target as HTMLElement | null;
      return target === containerEl || target?.tagName === "CANVAS";
    };

    const hitNode = (px: number, py: number): any | null => {
      const fg = fgRef.current;
      if (!fg?.screen2GraphCoords) return null;
      const point = fg.screen2GraphCoords(px, py);
      if (!point) return null;
      let best: any = null;
      let bestDist = Infinity;
      for (const node of graphDataRef.current.nodes as any[]) {
        if (typeof node.x !== "number" || typeof node.y !== "number") continue;
        const r = callbacksRef.current.nodeRadius(node) + 4;
        const dx = node.x - point.x;
        const dy = node.y - point.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r * r && d2 < bestDist) {
          best = node;
          bestDist = d2;
        }
      }
      return best;
    };

    const updateHover = (node: any | null) => {
      const id = node?.id ?? null;
      if (id === hoverIdRef.current) return;
      hoverIdRef.current = id;
      containerEl.style.cursor = node ? "pointer" : "";
      if (!node) {
        setTooltip(null);
        return;
      }
      const fg = fgRef.current;
      const pos = fg?.graph2ScreenCoords?.(node.x, node.y);
      if (!pos) {
        setTooltip(null);
        return;
      }
      const k = typeof fg?.zoom === "function" ? (fg.zoom() ?? 1) : 1;
      setTooltip({
        x: pos.x,
        y: pos.y - callbacksRef.current.nodeRadius(node) * k - 10,
        text: callbacksRef.current.tooltipText(node),
      });
    };

    // Capture phase: when the press lands on a node, keep the event away
    // from the library's d3-zoom listeners so dragging a node doesn't pan
    // the camera.
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !isCanvasEvent(event)) return;
      const { x, y } = localPoint(event);
      const node = hitNode(x, y);
      if (!node) return;
      event.stopPropagation();
      dragRef.current = {
        node,
        moved: false,
        startX: event.clientX,
        startY: event.clientY,
      };
      updateHover(null);
    };
    const stopIfDragging = (event: Event) => {
      if (dragRef.current) event.stopPropagation();
    };

    const onWindowPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      // Sub-threshold movement is click jitter, not a drag: leave the node
      // unpinned and keep the upcoming click alive.
      if (!drag.moved) {
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (Math.hypot(dx, dy) < DRAG_START_THRESHOLD_PX) return;
      }
      const fg = fgRef.current;
      const { x, y } = localPoint(event);
      const point = fg?.screen2GraphCoords?.(x, y);
      if (!point) return;
      drag.node.fx = point.x;
      drag.node.fy = point.y;
      drag.node.x = point.x;
      drag.node.y = point.y;
      if (!drag.moved) {
        drag.moved = true;
        fg?.d3ReheatSimulation?.();
      }
    };

    const onWindowPointerUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (drag?.moved) suppressClickRef.current = true;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (dragRef.current) return;
      if (!isCanvasEvent(event)) {
        updateHover(null);
        return;
      }
      const { x, y } = localPoint(event);
      updateHover(hitNode(x, y));
    };

    const onPointerLeave = () => {
      if (!dragRef.current) updateHover(null);
    };

    // Nearest link whose segment passes within the screen-space tolerance
    // of the pointer. Endpoints must be sim-hydrated objects.
    const hitLink = (px: number, py: number): any | null => {
      const fg = fgRef.current;
      const links = graphDataRef.current.links;
      if (!fg?.screen2GraphCoords || !links?.length) return null;
      const point = fg.screen2GraphCoords(px, py);
      if (!point) return null;
      const k = typeof fg.zoom === "function" ? (fg.zoom() ?? 1) : 1;
      const tolerance = LINK_HIT_TOLERANCE_PX / (k || 1);
      let best: any = null;
      let bestDist = Infinity;
      for (const link of links as any[]) {
        const s = link.source;
        const t = link.target;
        if (
          typeof s !== "object" ||
          typeof t !== "object" ||
          typeof s?.x !== "number" ||
          typeof t?.x !== "number"
        ) {
          continue;
        }
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const lenSq = dx * dx + dy * dy;
        const u = lenSq
          ? Math.max(
              0,
              Math.min(
                1,
                ((point.x - s.x) * dx + (point.y - s.y) * dy) / lenSq,
              ),
            )
          : 0;
        const cx = s.x + u * dx;
        const cy = s.y + u * dy;
        const dist = Math.hypot(point.x - cx, point.y - cy);
        if (dist <= tolerance && dist < bestDist) {
          best = link;
          bestDist = dist;
        }
      }
      return best;
    };

    const lastClickRef = {
      current: null as {
        nodeId: string;
        time: number;
        x: number;
        y: number;
      } | null,
    };

    const onClick = (event: MouseEvent) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        lastClickRef.current = null;
        return;
      }
      if (!isCanvasEvent(event)) return;
      const { x, y } = localPoint(event);
      const node = hitNode(x, y);
      if (!node) {
        lastClickRef.current = null;
        const link = callbacksRef.current.onLinkClick ? hitLink(x, y) : null;
        if (link) callbacksRef.current.onLinkClick?.(link);
        else callbacksRef.current.onBackgroundClick();
        return;
      }
      // The single click ALWAYS fires (expansion is idempotent); a paired
      // second click within the window/drift additionally fires the
      // dbl-click and resets, so a triple click can't fire it twice.
      callbacksRef.current.onNodeClick(node);
      const previous = lastClickRef.current;
      const now = Date.now();
      if (
        previous &&
        previous.nodeId === node.id &&
        now - previous.time <= DOUBLE_CLICK_WINDOW_MS &&
        Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <=
          DOUBLE_CLICK_DRIFT_PX
      ) {
        lastClickRef.current = null;
        callbacksRef.current.onNodeDoubleClick?.(node);
      } else {
        lastClickRef.current = {
          nodeId: node.id,
          time: now,
          x: event.clientX,
          y: event.clientY,
        };
      }
    };

    containerEl.addEventListener("pointerdown", onPointerDown, true);
    // d3-zoom also binds mouse/touch fallbacks — starve them during drags.
    containerEl.addEventListener("mousedown", stopIfDragging, true);
    containerEl.addEventListener("touchstart", stopIfDragging, true);
    containerEl.addEventListener("pointermove", onPointerMove);
    containerEl.addEventListener("pointerleave", onPointerLeave);
    containerEl.addEventListener("click", onClick);
    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp);

    return () => {
      containerEl.removeEventListener("pointerdown", onPointerDown, true);
      containerEl.removeEventListener("mousedown", stopIfDragging, true);
      containerEl.removeEventListener("touchstart", stopIfDragging, true);
      containerEl.removeEventListener("pointermove", onPointerMove);
      containerEl.removeEventListener("pointerleave", onPointerLeave);
      containerEl.removeEventListener("click", onClick);
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerUp);
      containerEl.style.cursor = "";
    };
  }, [containerEl, fgRef, graphDataRef]);

  return { tooltip };
}
