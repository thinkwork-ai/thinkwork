import { useEffect, useRef, useState } from "react";

export type GraphPointerTooltip = { x: number; y: number; text: string };

interface UseGraphPointerArgs {
  /** The graph container element (same element the size observer uses). */
  containerEl: HTMLElement | null;
  fgRef: React.MutableRefObject<any>;
  graphDataRef: React.MutableRefObject<{ nodes: any[] }>;
  nodeRadius: (node: any) => number;
  tooltipText: (node: any) => string;
  onNodeClick: (node: any) => void;
  onBackgroundClick: () => void;
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
}: UseGraphPointerArgs): { tooltip: GraphPointerTooltip | null } {
  const [tooltip, setTooltip] = useState<GraphPointerTooltip | null>(null);

  // Stable refs so the listener effect never re-binds on render.
  const callbacksRef = useRef({
    nodeRadius,
    tooltipText,
    onNodeClick,
    onBackgroundClick,
  });
  callbacksRef.current = {
    nodeRadius,
    tooltipText,
    onNodeClick,
    onBackgroundClick,
  };

  useEffect(() => {
    if (!containerEl) return;

    const hoverIdRef = { current: null as string | null };
    const dragRef = {
      current: null as { node: any; moved: boolean } | null,
    };
    const suppressClickRef = { current: false };

    const localPoint = (event: MouseEvent | PointerEvent) => {
      const rect = containerEl.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
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
      if (event.button !== 0) return;
      const { x, y } = localPoint(event);
      const node = hitNode(x, y);
      if (!node) return;
      event.stopPropagation();
      dragRef.current = { node, moved: false };
      updateHover(null);
    };
    const stopIfDragging = (event: Event) => {
      if (dragRef.current) event.stopPropagation();
    };

    const onWindowPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
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
      const { x, y } = localPoint(event);
      updateHover(hitNode(x, y));
    };

    const onPointerLeave = () => {
      if (!dragRef.current) updateHover(null);
    };

    const onClick = (event: MouseEvent) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      const { x, y } = localPoint(event);
      const node = hitNode(x, y);
      if (node) callbacksRef.current.onNodeClick(node);
      else callbacksRef.current.onBackgroundClick();
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
