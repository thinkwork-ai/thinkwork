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

export interface MemoryGraphEdge {
  label: string;
  targetLabel: string;
  targetType: string;
  targetId: string;
}

interface MemoryGraphNodeSheetProps {
  node: MemoryGraphNode;
  edges: MemoryGraphEdge[];
  historyDepth: number;
  onBack: () => void;
  onEdgeClick: (edge: MemoryGraphEdge) => void;
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
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{s.content}</p>
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
}: MemoryGraphNodeSheetProps) {
  const isMemory = node.nodeType === "memory";
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
              isMemory ? "bg-pink-500/20 text-pink-400" : "bg-sky-500/20 text-sky-400"
            }`}
          >
            {isMemory ? node.strategy ?? "memory" : node.entityType ?? "entity"}
          </Badge>
        </SheetTitle>
        <SheetDescription>
          {isMemory
            ? `Memory node — ${edges.length} connection${edges.length !== 1 ? "s" : ""}`
            : `Entity — ${edges.length} mention${edges.length !== 1 ? "s" : ""}`}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-6 pt-4 space-y-4">
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

        {edges.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              {isMemory ? "Mentions" : "Mentioned by"}
            </h4>
            <div className="space-y-2">
              {edges.map((edge, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-sm rounded-md bg-muted/30 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => onEdgeClick(edge)}
                >
                  <Badge
                    variant="outline"
                    className={`shrink-0 text-[10px] mt-0.5 ${
                      edge.targetType === "memory"
                        ? "border-pink-500/30 text-pink-400"
                        : "border-sky-500/30 text-sky-400"
                    }`}
                  >
                    {edge.targetType === "memory" ? "Memory" : "Entity"}
                  </Badge>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">
                      {stripTopicTags(edge.targetLabel)}
                    </p>
                    {edge.label && <p className="text-xs text-muted-foreground">{edge.label}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {edges.length === 0 && (
          <p className="text-sm text-muted-foreground">No connections found for this node.</p>
        )}
      </div>
    </SheetContent>
  );
}
