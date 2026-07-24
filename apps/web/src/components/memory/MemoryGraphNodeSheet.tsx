import { ArrowLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { MemoryGraphNode } from "@thinkwork/graph";
import {
  Badge,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@thinkwork/ui";
import { parseMemoryTopics, stripTopicTags } from "@/lib/memory-strategy";
import { RelatedMemories } from "@/components/memory/RelatedMemories";
import {
  NodeBadge,
  RelationshipConnector,
  hashColor,
} from "@/components/memory/relationship-badges";

export interface MemoryGraphEdge {
  label: string;
  targetLabel: string;
  targetType: string;
  targetId: string;
  /** Whether the anchoring node is the edge's source or target. */
  direction?: "in" | "out";
}

interface MemoryGraphNodeSheetProps {
  node: MemoryGraphNode;
  edges: MemoryGraphEdge[];
  historyDepth: number;
  onBack: () => void;
  onEdgeClick: (edge: MemoryGraphEdge) => void;
  /** Community hue for a node label — supplied by the graph host so
   *  badges match the canvas colors; falls back to a stable hash hue. */
  resolveNodeColor?: (label: string) => string | undefined;
  /** Scope for the related-memories lookup on entity nodes. */
  tenantId?: string | null;
  userId?: string | null;
}

function MemoryContent({ text }: { text: string }) {
  const sections = parseMemoryTopics(text);
  return (
    <div className="space-y-3">
      {sections.map((s, i) => (
        <div key={i}>
          {s.topic && (
            <p className="font-medium text-xs text-muted-foreground uppercase tracking-wider mb-1">
              {s.topic}
            </p>
          )}
          <p className="text-sm whitespace-pre-wrap leading-relaxed">
            {s.content}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * Detail drawer for a memory graph node. Mirrors admin's behavior: shows
 * the node's content, links to the source thread, and lists connected
 * edges; clicking an edge re-anchors the sheet to that node (history
 * stack lets the user navigate back).
 */
export function MemoryGraphNodeSheet({
  node,
  edges,
  historyDepth,
  onBack,
  onEdgeClick,
  resolveNodeColor,
  tenantId,
  userId,
}: MemoryGraphNodeSheetProps) {
  const isMemory = node.nodeType === "memory";
  const currentLabel = isMemory ? "Memory" : node.label;
  const colorFor = (label: string) =>
    resolveNodeColor?.(label) ?? hashColor(label);

  return (
    <SheetContent className="sm:max-w-lg flex flex-col">
      <SheetHeader className="p-6 pb-0">
        <SheetTitle className="flex items-center gap-2">
          {historyDepth > 0 && (
            <button
              onClick={onBack}
              className="text-muted-foreground hover:text-foreground -ml-1 mr-1"
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          {isMemory ? "Memory" : node.label}
          <Badge
            className={`font-normal text-xs ${
              isMemory
                ? "bg-pink-500/20 text-pink-400"
                : "bg-sky-500/20 text-sky-400"
            }`}
          >
            {isMemory
              ? (node.strategy ?? "memory")
              : (node.entityType ?? "entity")}
          </Badge>
        </SheetTitle>
        <SheetDescription>
          {isMemory
            ? `Memory node — ${edges.length} connection${edges.length !== 1 ? "s" : ""}`
            : `Entity — ${edges.length} mention${edges.length !== 1 ? "s" : ""}`}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-6 pt-4 pb-8 space-y-4">
        {isMemory && <MemoryContent text={node.label} />}

        {node.latestThreadId && (
          <Link
            to="/threads/$id"
            params={{ id: node.latestThreadId }}
            className="inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 hover:underline"
          >
            View source thread →
          </Link>
        )}

        {/* Relationships lead, memories follow (Eric 2026-07-23). */}
        {edges.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Relationships
            </h4>
            <div className="space-y-1.5">
              {edges.map((edge, i) => {
                const other = stripTopicTags(edge.targetLabel);
                const currentBadge = (
                  <NodeBadge
                    label={currentLabel}
                    color={colorFor(node.label)}
                  />
                );
                const otherBadge = (
                  <NodeBadge
                    label={other}
                    color={colorFor(edge.targetLabel)}
                    onClick={() => onEdgeClick(edge)}
                  />
                );
                const connector = (
                  <RelationshipConnector label={edge.label || "mentions"} />
                );
                return (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 overflow-hidden"
                  >
                    {edge.direction === "out" ? (
                      <>
                        {currentBadge}
                        {connector}
                        {otherBadge}
                      </>
                    ) : (
                      <>
                        {otherBadge}
                        {connector}
                        {currentBadge}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {edges.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No connections found for this node.
          </p>
        )}

        {!isMemory && (
          <RelatedMemories
            tenantId={tenantId}
            userId={userId}
            query={node.label}
          />
        )}
      </div>
    </SheetContent>
  );
}
