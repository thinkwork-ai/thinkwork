/**
 * ExecutionGraphMobile — vertical step-list visualization of a routine
 * execution (Plan 2026-05-01-007 §U13 mobile parity).
 *
 * Mobile counterpart to admin's apps/admin/src/components/routines/
 * ExecutionGraph.tsx. Same data shapes (StepEventLite + the
 * latest-event-per-node collapse) so a future shared package is easy.
 *
 * Rendering: native View column + status icon dots. Tappable rows
 * delegate to the parent for selecting which node to display in the
 * step-detail card.
 */

import { useMemo } from "react";
import { View, Pressable } from "react-native";
import {
  CheckCircle2,
  Circle,
  Clock,
  XCircle,
  PauseCircle,
  AlertCircle,
} from "lucide-react-native";
import { IconLoader2 } from "@tabler/icons-react-native";
import { Text, Muted } from "@/components/ui/typography";

export interface StepEventLite {
  id: string;
  nodeId: string;
  recipeType: string;
  status: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  retryCount: number;
}

export interface StepNode {
  nodeId: string;
  recipeType?: string;
  latestEvent?: StepEventLite;
}

export interface ExecutionGraphMobileProps {
  /** Step manifest from `routine_asl_versions.step_manifest_json`.
   * v0 mobile: typically null because routineExecution.routine doesn't
   * surface the manifest yet (admin has the same gap, tracked as a
   * Phase E schema follow-up). The events-only fallback covers it. */
  stepManifest: Record<string, { recipeType?: string }> | null | undefined;
  stepEvents: StepEventLite[];
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string) => void;
}

/** Collapse multi-event-per-node to the latest event by `started_at`.
 * Mirrors admin's ExecutionGraph#latestEventByNode. Exported for tests. */
export function latestEventByNode(
  events: StepEventLite[],
): Record<string, StepEventLite> {
  const byNode: Record<string, StepEventLite> = {};
  for (const ev of events) {
    const existing = byNode[ev.nodeId];
    if (!existing) {
      byNode[ev.nodeId] = ev;
      continue;
    }
    const existingFinished = !!existing.finishedAt;
    const candidateFinished = !!ev.finishedAt;
    if (candidateFinished && !existingFinished) {
      byNode[ev.nodeId] = ev;
      continue;
    }
    if (!candidateFinished && existingFinished) {
      continue;
    }
    const existingStart = existing.startedAt ?? "";
    const candidateStart = ev.startedAt ?? "";
    if (candidateStart > existingStart) {
      byNode[ev.nodeId] = ev;
    }
  }
  return byNode;
}

/** Order step manifest keys deterministically (insertion order =
 * publish-emit order). Falls back to event-derived nodes when the
 * manifest is empty. Mirrors admin's deriveNodes. */
export function deriveNodes(
  stepManifest: Record<string, { recipeType?: string }> | null | undefined,
  events: StepEventLite[],
): StepNode[] {
  const latest = latestEventByNode(events);
  if (stepManifest && Object.keys(stepManifest).length > 0) {
    return Object.entries(stepManifest).map(([nodeId, meta]) => ({
      nodeId,
      recipeType: meta?.recipeType ?? latest[nodeId]?.recipeType,
      latestEvent: latest[nodeId],
    }));
  }
  const seen = new Set<string>();
  const sorted = [...events].sort((a, b) => {
    const aStart = a.startedAt ?? "";
    const bStart = b.startedAt ?? "";
    return aStart.localeCompare(bStart);
  });
  const nodes: StepNode[] = [];
  for (const ev of sorted) {
    if (seen.has(ev.nodeId)) continue;
    seen.add(ev.nodeId);
    nodes.push({
      nodeId: ev.nodeId,
      recipeType: ev.recipeType,
      latestEvent: latest[ev.nodeId],
    });
  }
  return nodes;
}

interface StatusPresentation {
  Icon: React.ComponentType<{ size?: number; color?: string }>;
  color: string;
  label: string;
  spin?: boolean;
}

function statusPresentation(status: string | undefined): StatusPresentation {
  switch (status) {
    case "running":
      return {
        Icon: IconLoader2,
        color: "#3b82f6",
        label: "Running",
        spin: true,
      };
    case "succeeded":
      return { Icon: CheckCircle2, color: "#22c55e", label: "Succeeded" };
    case "failed":
      return { Icon: XCircle, color: "#ef4444", label: "Failed" };
    case "cancelled":
      return { Icon: AlertCircle, color: "#737373", label: "Cancelled" };
    case "timed_out":
      return { Icon: Clock, color: "#f59e0b", label: "Timed out" };
    case "awaiting_approval":
      return {
        Icon: PauseCircle,
        color: "#a855f7",
        label: "Awaiting approval",
      };
    default:
      return { Icon: Circle, color: "#a3a3a3", label: "Pending" };
  }
}

export function ExecutionGraphMobile({
  stepManifest,
  stepEvents,
  selectedNodeId,
  onSelectNode,
}: ExecutionGraphMobileProps) {
  const nodes = useMemo(
    () => deriveNodes(stepManifest, stepEvents),
    [stepManifest, stepEvents],
  );

  if (nodes.length === 0) {
    return (
      <View className="rounded-xl border border-dashed border-neutral-200 dark:border-neutral-800 px-4 py-6">
        <Muted className="text-center text-sm">
          No steps yet — the execution may still be starting.
        </Muted>
      </View>
    );
  }

  return (
    <View className="bg-white dark:bg-neutral-900 rounded-xl overflow-hidden">
      {nodes.map((node, idx) => {
        const presentation = statusPresentation(node.latestEvent?.status);
        const Icon = presentation.Icon;
        const isLast = idx === nodes.length - 1;
        const isSelected = selectedNodeId === node.nodeId;
        const retries = node.latestEvent?.retryCount ?? 0;
        return (
          <Pressable
            key={node.nodeId}
            onPress={() => onSelectNode?.(node.nodeId)}
            className={`flex-row items-start px-4 py-3 ${
              isLast ? "" : "border-b border-neutral-100 dark:border-neutral-800"
            } ${isSelected ? "bg-neutral-50 dark:bg-neutral-800" : "active:bg-neutral-50 dark:active:bg-neutral-800"}`}
          >
            <View style={{ marginTop: 2 }}>
              <Icon size={18} color={presentation.color} />
            </View>
            <View className="flex-1 ml-3 min-w-0">
              <View className="flex-row items-center gap-2">
                <Text className="text-xs text-neutral-400 tabular-nums">
                  {String(idx + 1).padStart(2, "0")}
                </Text>
                <Text
                  className="text-base font-medium text-neutral-900 dark:text-neutral-100 flex-1"
                  numberOfLines={1}
                >
                  {node.nodeId}
                </Text>
              </View>
              <View className="flex-row items-center gap-2 mt-0.5">
                {node.recipeType ? (
                  <Muted className="text-xs">{node.recipeType}</Muted>
                ) : null}
                <Muted className="text-xs">·</Muted>
                <Muted className="text-xs">{presentation.label}</Muted>
                {retries > 0 ? (
                  <Muted className="text-xs">
                    · {retries} retr{retries === 1 ? "y" : "ies"}
                  </Muted>
                ) : null}
              </View>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
