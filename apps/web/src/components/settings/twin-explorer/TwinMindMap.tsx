/**
 * Mind-map renderer for the Traversal view (Eric 2026-07-23).
 *
 * HTML pills + one SVG layer of curved branches, positioned by the pure
 * tidy layout in TwinMindMapTree.ts. No canvas, no physics — expanding
 * a group unfolds its subtree in place. Pan by dragging the background,
 * zoom with the wheel (ctrl/cmd or trackpad pinch also works via wheel
 * events); the content auto-centers on first paint and when the tree is
 * replaced (epoch key remount, host-owned).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { twinTypeColor } from "@thinkwork/graph";
import type { TwinGraphLink, TwinGraphNode } from "@thinkwork/graph";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@thinkwork/ui";
import {
  buildMindMap,
  layoutMindMap,
  type BuildMindMapOptions,
  type MindMapNode,
  type PlacedNode,
} from "./TwinMindMapTree";
import type { TraversalState } from "./TwinTraversal";

export interface TwinMindMapProps {
  state: TraversalState;
  /** Bump to rebuild after any state mutation (host-owned, like TwinGraph). */
  revision: number;
  labels?: BuildMindMapOptions;
  onEntityClick?: (entity: TwinGraphNode) => void;
  onEntityDoubleClick?: (entity: TwinGraphNode) => void;
  onSummaryClick?: (key: string) => void;
  onMoreClick?: (key: string) => void;
  onEdgeClick?: (edge: TwinGraphLink) => void;
}

interface Camera {
  x: number;
  y: number;
  k: number;
}

function anchorPoints(from: PlacedNode, to: PlacedNode) {
  // Branch leaves the parent on the side the child sits on.
  const rightward = to.x + to.width / 2 >= from.x + from.width / 2;
  const start = {
    x: rightward ? from.x + from.width : from.x,
    y: from.y + from.height / 2,
  };
  const end = {
    x: rightward ? to.x : to.x + to.width,
    y: to.y + to.height / 2,
  };
  return { start, end };
}

export function TwinMindMap({
  state,
  revision,
  labels,
  onEntityClick,
  onEntityDoubleClick,
  onSummaryClick,
  onMoreClick,
  onEdgeClick,
}: TwinMindMapProps) {
  const layout = useMemo(
    () => layoutMindMap(buildMindMap(state, labels)),
    // Rebuild only on revision bumps — the state object mutates in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revision],
  );
  const byId = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout],
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [camera, setCamera] = useState<Camera | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  cameraRef.current = camera;
  // Once the user pans/zooms, stop auto-fitting so their framing sticks.
  const interactedRef = useRef(false);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const fitToContainer = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { offsetWidth: w, offsetHeight: h } = el;
    if (w === 0 || h === 0) return;
    const box = layoutRef.current;
    const k = Math.max(
      0.3,
      Math.min(
        1,
        (w - 48) / Math.max(1, box.width),
        (h - 48) / Math.max(1, box.height),
      ),
    );
    setCamera({
      x: (w - box.width * k) / 2,
      y: (h - box.height * k) / 2,
      k,
    });
  }, []);

  // Auto-fit on first paint and while the container is still settling to
  // its real size — but never after the user has taken control. A
  // ResizeObserver catches the case where the flex/scroll container hadn't
  // laid out yet on the first measurement (content would land off-center).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!interactedRef.current) fitToContainer();
    const ro = new ResizeObserver(() => {
      if (!interactedRef.current) fitToContainer();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitToContainer, layout]);

  // Wheel zoom around the cursor; passive:false so we can preventDefault.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const cam = cameraRef.current;
      if (!cam) return;
      const rect = el.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      interactedRef.current = true;
      const factor = Math.exp(-event.deltaY * 0.0015);
      const k = Math.min(2.5, Math.max(0.2, cam.k * factor));
      const scale = k / cam.k;
      setCamera({
        k,
        x: px - (px - cam.x) * scale,
        y: py - (py - cam.y) * scale,
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const dragRef = useRef<{ px: number; py: number } | null>(null);

  const nodeAccent = (node: MindMapNode) =>
    node.kind === "entity" ? twinTypeColor(node.typeLabel) : "#64748b";

  const renderPill = (placedNode: PlacedNode) => {
    const node = placedNode.node;
    const isRoot = node === null;
    const entity = isRoot ? placedNode.root! : node.entity;
    const accent = isRoot
      ? "#0ea5e9"
      : node.kind === "entity"
        ? nodeAccent(node)
        : "#64748b";
    const clickable = isRoot || node.kind !== "none";
    const label = isRoot ? placedNode.root!.label : node.label;
    return (
      <div
        key={placedNode.id}
        data-testid={
          isRoot
            ? "mindmap-root"
            : node.kind === "entity"
              ? "mindmap-entity"
              : `mindmap-${node.kind}`
        }
        data-node-id={placedNode.id}
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        className={cn(
          "absolute flex items-center gap-1.5 rounded-full border bg-card px-3 text-xs shadow-sm select-none",
          clickable && "cursor-pointer hover:bg-accent/60",
          !isRoot && node.kind === "summary" && "bg-muted/60",
          !isRoot &&
            node.kind === "more" &&
            "border-dashed text-muted-foreground",
          !isRoot &&
            node.kind === "none" &&
            "border-dashed text-muted-foreground italic",
          !isRoot && node.pending && "opacity-60",
          isRoot && "border-2 font-semibold",
        )}
        style={{
          left: placedNode.x,
          top: placedNode.y,
          width: placedNode.width,
          height: placedNode.height,
          borderColor: accent,
        }}
        title={entity?.typeLabel ? `${label} — ${entity.typeLabel}` : label}
        onClick={(event) => {
          event.stopPropagation();
          if (isRoot) {
            onEntityClick?.(placedNode.root!);
            return;
          }
          if (node.kind === "entity" && node.entity) {
            onEntityClick?.(node.entity);
          } else if (node.kind === "summary" && node.groupKey) {
            onSummaryClick?.(node.groupKey);
          } else if (node.kind === "more" && node.groupKey) {
            onMoreClick?.(node.groupKey);
          }
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          const target = isRoot ? placedNode.root : node?.entity;
          if (target) onEntityDoubleClick?.(target);
        }}
      >
        {!isRoot && node.kind === "summary" ? (
          node.expanded ? (
            <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3 shrink-0" aria-hidden="true" />
          )
        ) : null}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {!isRoot && node.kind === "summary" ? (
          <span className="shrink-0 rounded-full bg-background/80 px-1.5 font-medium tabular-nums">
            {node.count}
          </span>
        ) : null}
        {!isRoot && node.pending ? (
          <Loader2
            className="size-3 shrink-0 animate-spin"
            aria-hidden="true"
          />
        ) : null}
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      data-testid="twin-mindmap"
      className="absolute inset-0 cursor-grab overflow-hidden active:cursor-grabbing"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // Only pan when the press starts on empty canvas — capturing the
        // pointer on a press that began on a pill (or an edge hit target)
        // would swallow that element's click, breaking expand/collapse.
        const target = event.target as HTMLElement;
        if (target.closest("[data-node-id],[data-testid='mindmap-edge-hit']"))
          return;
        dragRef.current = { px: event.clientX, py: event.clientY };
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        const cam = cameraRef.current;
        if (!drag || !cam) return;
        const dx = event.clientX - drag.px;
        const dy = event.clientY - drag.py;
        if (dx === 0 && dy === 0) return;
        interactedRef.current = true;
        dragRef.current = { px: event.clientX, py: event.clientY };
        setCamera({ ...cam, x: cam.x + dx, y: cam.y + dy });
      }}
      onPointerUp={() => {
        dragRef.current = null;
      }}
    >
      <div
        className="absolute origin-top-left"
        style={{
          width: layout.width,
          height: layout.height,
          transform: camera
            ? `translate(${camera.x}px, ${camera.y}px) scale(${camera.k})`
            : undefined,
          visibility: camera ? "visible" : "hidden",
        }}
      >
        <svg
          className="absolute overflow-visible"
          width={Math.max(1, layout.width)}
          height={Math.max(1, layout.height)}
          aria-hidden="true"
        >
          {layout.edges.map((edge) => {
            const from = byId.get(edge.fromId);
            const to = byId.get(edge.toId);
            if (!from || !to) return null;
            const { start, end } = anchorPoints(from, to);
            const midX = (start.x + end.x) / 2;
            const path = `M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`;
            return (
              <g key={edge.id}>
                <path
                  d={path}
                  fill="none"
                  stroke="hsl(215 16% 47% / 0.55)"
                  strokeWidth={1.5}
                  strokeDasharray={edge.dashed ? "4 4" : undefined}
                />
                {edge.edge && onEdgeClick ? (
                  <path
                    d={path}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={12}
                    className="cursor-pointer"
                    data-testid="mindmap-edge-hit"
                    onClick={(event) => {
                      event.stopPropagation();
                      onEdgeClick(edge.edge!);
                    }}
                  />
                ) : null}
                {edge.label ? (
                  <text
                    x={midX}
                    y={(start.y + end.y) / 2 - 5}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[9px]"
                  >
                    {edge.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
        {layout.nodes.map(renderPill)}
      </div>
    </div>
  );
}
