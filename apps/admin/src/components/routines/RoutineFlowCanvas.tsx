import { useMemo } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import { AlertCircle, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  buildRoutineAslGraph,
  type BuildRoutineAslGraphInput,
  type RoutineAslGraph,
  type RoutineGraphNode,
  type RoutineGraphMode,
} from "./routineAslGraph";
import { RoutineFlowNode } from "./RoutineFlowNode";

interface RoutineFlowCanvasProps extends BuildRoutineAslGraphInput {
  mode: RoutineGraphMode;
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string | null) => void;
  onAddStepAfter?: (nodeId: string | null) => void;
  className?: string;
  emptyLabel?: string;
}

const nodeTypes = {
  routine: RoutineFlowNode,
};

export function RoutineFlowCanvas({
  mode,
  selectedNodeId,
  onSelectNode,
  onAddStepAfter,
  className,
  emptyLabel = "No workflow graph available.",
  ...graphInput
}: RoutineFlowCanvasProps) {
  const graph = useMemo(() => buildRoutineAslGraph(graphInput), [graphInput]);
  const nodes = useMemo(
    () => toFlowNodes(graph, selectedNodeId),
    [graph, selectedNodeId],
  );
  const edges = useMemo(() => toFlowEdges(graph), [graph]);

  if (graph.error || nodes.length === 0) {
    return (
      <div
        className={cn(
          "flex min-h-[360px] flex-col items-center justify-center rounded-md border border-dashed border-border/80 bg-muted/20 p-6 text-center",
          className,
        )}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-background text-muted-foreground">
          {graph.error ? (
            <AlertCircle className="h-5 w-5" />
          ) : (
            <Workflow className="h-5 w-5" />
          )}
        </div>
        <p className="mt-3 text-sm font-medium">{graph.error ?? emptyLabel}</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {mode === "authoring"
            ? "Add a recipe step to start building the routine."
            : "The execution may predate graph artifacts or still be starting."}
        </p>
        {mode === "authoring" && onAddStepAfter && (
          <Button
            type="button"
            size="sm"
            className="mt-4"
            onClick={() => onAddStepAfter(null)}
          >
            Add step
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative h-[min(70vh,680px)] min-h-[420px] overflow-hidden rounded-md border border-border/80 bg-background",
        className,
      )}
    >
      <div className="absolute left-3 top-3 z-10 flex gap-2">
        <Badge variant="secondary">
          {graph.nodes.filter((node) => node.kind !== "group").length} nodes
        </Badge>
        <Badge variant="outline">{graph.edges.length} edges</Badge>
      </div>
      {mode === "authoring" && onAddStepAfter && (
        <div className="absolute right-3 top-3 z-10">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              onAddStepAfter(selectedNodeId ?? graph.startNodeId ?? null)
            }
          >
            Add step
          </Button>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.35}
        maxZoom={1.4}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={(_, node) => {
          const data = node.data as unknown as RoutineGraphNode;
          if (node.id.startsWith("__") || data.kind === "group") return;
          onSelectNode?.(node.id);
        }}
        onPaneClick={() => onSelectNode?.(null)}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function toFlowNodes(
  graph: RoutineAslGraph,
  selectedNodeId?: string | null,
): Node<Record<string, unknown>>[] {
  return graph.nodes.map((node) => ({
    id: node.id,
    type: "routine",
    position: node.position,
    data: node as unknown as Record<string, unknown>,
    selected: selectedNodeId === node.id,
    draggable: false,
    selectable: node.kind !== "group",
    style: {
      width: node.width,
      height: node.height,
      zIndex: node.kind === "group" ? -1 : 0,
    },
  }));
}

function toFlowEdges(graph: RoutineAslGraph): Edge[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    label: edge.label,
    animated: edge.kind === "start",
    style: {
      strokeWidth: edge.kind === "choice" || edge.kind === "default" ? 2 : 1.5,
      stroke: edge.kind === "catch" ? "hsl(var(--destructive))" : undefined,
    },
    labelStyle: {
      fontSize: 11,
      fontWeight: 600,
    },
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 4,
  }));
}
