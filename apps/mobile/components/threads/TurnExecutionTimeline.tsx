import React, { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { Bot, ChevronRight, Cpu, MessageSquare, X, Zap } from "lucide-react-native";
import { useQuery } from "urql";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { TurnInvocationLogsQuery } from "@/lib/graphql-queries";

type TimelineEvent = {
  type: "llm" | "tool_call" | "response";
  timestamp: string;
  branch: string;
  modelId?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  costUsd?: number;
  requestId?: string;
  inputPreview?: string;
  outputPreview?: string;
  toolUses?: string[];
  hasToolResult?: boolean;
  toolName?: string;
  toolType?: string;
  toolInput?: string;
  toolOutput?: string;
  responseText?: string;
};

type BranchSpan = {
  name: string;
  laneIndex: number;
  color: string;
  forkIdx: number;
  mergeIdx: number;
  eventIndices: number[];
};

const MAIN_COLOR = "#eab308";
const RESPONSE_COLOR = "#06b6d4";
const BRANCH_COLORS = ["#a855f7", "#3b82f6", "#ec4899", "#14b8a6", "#f97316"];
const ROW_H = 34;
const NODE_R = 4;
const MAIN_X = 8;
const BRANCH_X = 22;
const LANE_GAP = 12;

function parseJsonField(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return null;
}

function formatTokens(n: unknown): string {
  const num = Number(n);
  if (!num) return "0";
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}

function formatCost(n: unknown): string {
  const num = Number(n);
  if (!num) return "$0.00";
  if (num < 0.01) return `$${num.toFixed(4)}`;
  return `$${num.toFixed(2)}`;
}

function parseResponseText(resultJson: unknown): string {
  const parsed = parseJsonField(resultJson);
  const value = parsed?.responseText || parsed?.response || parsed?.content;
  return typeof value === "string" ? value : "";
}

function normalizeName(name: string): string {
  return name.replace(/[-\s]/g, "_");
}

function getSubAgentName(branch: string): string | null {
  if (branch.startsWith("sub-agent:")) return branch.slice("sub-agent:".length);
  if (branch === "sub-agent") return "unknown";
  return null;
}

function isSubAgentBranch(branch: string): boolean {
  return branch.startsWith("sub-agent");
}

function laneX(laneIndex: number): number {
  return BRANCH_X + laneIndex * LANE_GAP;
}

function buildTimelineFromUsage(
  toolInvocations: any[],
  responseText: string,
  model?: string,
  inputTokens?: number,
  outputTokens?: number,
  totalCost?: number | null,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  if (model || inputTokens || outputTokens) {
    events.push({
      type: "llm",
      timestamp: "",
      branch: "parent",
      modelId: model ? String(model).replace(/^us\.anthropic\./, "").replace(/-v\d+:\d+$/, "") : "LLM",
      inputTokens: inputTokens || 0,
      outputTokens: outputTokens || 0,
      costUsd: totalCost || 0,
      toolUses: toolInvocations.map((ti: any) => ti.tool_name).filter(Boolean),
    });
  }

  for (const ti of toolInvocations) {
    const toolName = ti.tool_name || ti.name || "unknown";
    events.push({
      type: "tool_call",
      timestamp: "",
      branch: ti.type === "sub_agent" ? `sub-agent:${String(toolName).toLowerCase()}` : "parent",
      toolName,
      toolType: ti.type || "tool",
      toolInput: ti.input_preview || "",
      toolOutput: ti.output_preview || "",
    });
  }

  if (responseText) {
    events.push({
      type: "response",
      timestamp: "",
      branch: "parent",
      responseText,
    });
  }

  return events;
}

function buildTimeline(invocations: any[], toolInvocations: any[], responseText: string): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const inv of invocations) {
    const branch: string = inv.branch || "parent";
    events.push({
      type: "llm",
      timestamp: inv.timestamp,
      branch,
      modelId: inv.modelId,
      inputTokens: inv.inputTokenCount,
      outputTokens: inv.outputTokenCount,
      cacheReadTokens: inv.cacheReadTokenCount,
      costUsd: inv.costUsd,
      requestId: inv.requestId,
      inputPreview: inv.inputPreview,
      outputPreview: inv.outputPreview,
      toolUses: inv.toolUses,
      hasToolResult: inv.hasToolResult,
    });

    if (inv.toolUses?.length > 0) {
      for (const toolName of inv.toolUses) {
        const matchingTool = toolInvocations.find((ti: any) => ti.tool_name === toolName);
        const toolBranch = matchingTool?.type === "sub_agent"
          ? `sub-agent:${toolName.toLowerCase()}`
          : branch;
        events.push({
          type: "tool_call",
          timestamp: inv.timestamp,
          branch: toolBranch,
          toolName,
          toolType: matchingTool?.type || "mcp_tool",
          toolInput: matchingTool?.input_preview || "",
          toolOutput: matchingTool?.output_preview || "",
        });
      }
    }
  }

  if (responseText) {
    events.push({ type: "response", timestamp: "", branch: "parent", responseText });
  }

  reparentSubAgentEvents(events);
  return events;
}

function reparentSubAgentEvents(events: TimelineEvent[]): void {
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.type !== "tool_call" || ev.toolType !== "sub_agent") continue;

    const subBranch = ev.branch;
    let pendingTools = 0;

    for (let j = i + 1; j < events.length; j++) {
      const inner = events[j];
      if (inner.type === "tool_call" && inner.toolType === "sub_agent") break;
      if (isSubAgentBranch(inner.branch)) break;

      if (inner.type === "llm") {
        if (inner.hasToolResult) {
          pendingTools--;
          if (pendingTools < 0) break;
        }
        if (inner.toolUses?.length) pendingTools += inner.toolUses.length;
        inner.branch = subBranch;
      } else if (inner.type === "tool_call") {
        inner.branch = subBranch;
      } else {
        break;
      }
    }
  }
}

function buildBranches(events: TimelineEvent[]): BranchSpan[] {
  const branches: BranchSpan[] = [];
  const activeLanes = new Set<number>();

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.type !== "tool_call" || ev.toolType !== "sub_agent") continue;

    const name = ev.toolName?.toLowerCase() || "unknown";
    const eventIndices = [i];
    for (let j = i + 1; j < events.length; j++) {
      const subName = getSubAgentName(events[j].branch);
      if (subName && normalizeName(subName) === normalizeName(name)) {
        eventIndices.push(j);
      }
    }

    const lastBranchIdx = eventIndices[eventIndices.length - 1];
    let mergeIdx = events.length - 1;
    for (let j = lastBranchIdx + 1; j < events.length; j++) {
      if (!isSubAgentBranch(events[j].branch)) {
        mergeIdx = j;
        break;
      }
    }

    let lane = 0;
    while (activeLanes.has(lane)) lane++;
    activeLanes.add(lane);

    branches.push({
      name,
      laneIndex: lane,
      color: BRANCH_COLORS[branches.length % BRANCH_COLORS.length],
      forkIdx: i,
      mergeIdx,
      eventIndices,
    });
  }

  return branches;
}

function getBranchForEvent(eventIdx: number, branches: BranchSpan[]): BranchSpan | null {
  return branches.find((b) => b.eventIndices.includes(eventIdx)) ?? null;
}

function EventIcon({ event, color }: { event: TimelineEvent; color: string }) {
  if (event.type === "llm") return <Cpu size={15} color={color} />;
  if (event.type === "response") return <MessageSquare size={15} color={RESPONSE_COLOR} />;
  if (event.toolType === "sub_agent") return <Bot size={15} color={color} />;
  return <Zap size={15} color="#facc15" />;
}

export function TurnExecutionTimeline({
  tenantId,
  turn,
  expanded,
  isDark,
  colors,
}: {
  tenantId?: string | null;
  turn: {
    id: string;
    usageJson?: unknown;
    resultJson?: unknown;
    totalCost?: number | null;
  };
  expanded: boolean;
  isDark: boolean;
  colors: (typeof COLORS)["dark"];
}) {
  const [detail, setDetail] = useState<{ title: string; content: string } | null>(null);
  const usage = useMemo(() => parseJsonField(turn.usageJson), [turn.usageJson]);
  const responseText = useMemo(() => parseResponseText(turn.resultJson), [turn.resultJson]);
  const toolInvocations = useMemo(() => {
    const tools = usage?.tool_invocations;
    if (Array.isArray(tools)) return tools;
    const called = usage?.tools_called;
    if (Array.isArray(called)) return called.map((name) => ({ tool_name: String(name), type: "tool" }));
    return [];
  }, [usage]);

  const [{ data, fetching }] = useQuery({
    query: TurnInvocationLogsQuery,
    variables: { tenantId: tenantId!, turnId: turn.id },
    pause: !expanded || !tenantId,
  });

  const invocations = (data?.turnInvocationLogs ?? []) as any[];
  const events = invocations.length > 0
    ? buildTimeline(invocations, toolInvocations, responseText)
    : buildTimelineFromUsage(
      toolInvocations,
      responseText,
      String(usage?.model || ""),
      Number(usage?.input_tokens || usage?.inputTokens || 0),
      Number(usage?.output_tokens || usage?.outputTokens || 0),
      turn.totalCost || 0,
    );

  if (events.length === 0) {
    return fetching ? <Muted className="text-xs">Loading execution...</Muted> : null;
  }

  const totalCost = invocations.length > 0
    ? invocations.reduce((sum: number, inv: any) => sum + (inv.costUsd || 0), 0)
    : turn.totalCost || 0;
  const totalInputTokens = invocations.length > 0
    ? invocations.reduce((sum: number, inv: any) => sum + (inv.inputTokenCount || 0), 0)
    : Number(usage?.input_tokens || usage?.inputTokens || 0);
  const totalOutputTokens = invocations.length > 0
    ? invocations.reduce((sum: number, inv: any) => sum + (inv.outputTokenCount || 0), 0)
    : Number(usage?.output_tokens || usage?.outputTokens || 0);

  const branches = buildBranches(events);
  const hasBranches = branches.length > 0;
  const maxLane = hasBranches ? Math.max(...branches.map((b) => b.laneIndex)) : -1;
  const svgWidth = hasBranches ? laneX(maxLane) + 14 : 24;
  const contentPadding = hasBranches ? laneX(maxLane) + 20 : 30;
  const svgHeight = Math.max(events.length * ROW_H, ROW_H);
  const firstFork = hasBranches ? Math.min(...branches.map((b) => b.forkIdx)) : -1;
  const lastMerge = hasBranches ? Math.max(...branches.map((b) => b.mergeIdx)) : -1;
  let lastParentBeforeFork = 0;
  if (hasBranches) {
    for (let i = firstFork - 1; i >= 0; i--) {
      if (!isSubAgentBranch(events[i].branch)) {
        lastParentBeforeFork = i;
        break;
      }
    }
  }

  return (
    <View className="gap-2">
      <Muted className="text-[10px] uppercase tracking-wider">
        Execution ({events.length} steps) · {formatTokens(totalInputTokens)} in + {formatTokens(totalOutputTokens)} out · {formatCost(totalCost)}
      </Muted>

      <View style={{ position: "relative", paddingLeft: contentPadding }}>
        <Svg width={svgWidth} height={svgHeight} style={{ position: "absolute", left: 0, top: 0 }}>
          {!hasBranches ? (
            <Line x1={MAIN_X} y1={ROW_H / 2} x2={MAIN_X} y2={svgHeight - ROW_H / 2} stroke={MAIN_COLOR} strokeWidth={2.5} opacity={0.5} />
          ) : (
            <>
              <Line x1={MAIN_X} y1={ROW_H / 2} x2={MAIN_X} y2={firstFork * ROW_H + ROW_H / 2} stroke={MAIN_COLOR} strokeWidth={2.5} opacity={0.5} />
              <Line x1={MAIN_X} y1={firstFork * ROW_H + ROW_H / 2} x2={MAIN_X} y2={lastMerge * ROW_H + ROW_H / 2} stroke={MAIN_COLOR} strokeWidth={2.5} opacity={0.3} />
              <Line x1={MAIN_X} y1={lastMerge * ROW_H + ROW_H / 2} x2={MAIN_X} y2={svgHeight - ROW_H / 2} stroke={MAIN_COLOR} strokeWidth={2.5} opacity={0.5} />
              {branches.map((branch) => {
                const bx = laneX(branch.laneIndex);
                const departY = lastParentBeforeFork * ROW_H + ROW_H / 2;
                const mergeY = branch.mergeIdx * ROW_H + ROW_H / 2;
                const forkEndY = departY + ROW_H;
                const mergeStartY = mergeY - ROW_H;
                const lineTopY = Math.min(forkEndY, branch.forkIdx * ROW_H + ROW_H / 2);
                const lineBottomY = Math.max(mergeStartY, branch.eventIndices[branch.eventIndices.length - 1] * ROW_H + ROW_H / 2);
                return (
                  <React.Fragment key={branch.name}>
                    <Path d={`M ${MAIN_X} ${departY} C ${MAIN_X} ${departY + ROW_H * 0.6} ${bx} ${forkEndY - ROW_H * 0.4} ${bx} ${forkEndY}`} fill="none" stroke={branch.color} strokeWidth={2.5} opacity={0.55} />
                    {lineTopY < lineBottomY && (
                      <Line x1={bx} y1={lineTopY} x2={bx} y2={lineBottomY} stroke={branch.color} strokeWidth={2.5} opacity={0.55} />
                    )}
                    <Path d={`M ${bx} ${mergeStartY} C ${bx} ${mergeStartY + ROW_H * 0.6} ${MAIN_X} ${mergeY - ROW_H * 0.4} ${MAIN_X} ${mergeY}`} fill="none" stroke={branch.color} strokeWidth={2.5} opacity={0.55} />
                  </React.Fragment>
                );
              })}
            </>
          )}
          {events.map((event, index) => {
            const branch = getBranchForEvent(index, branches);
            const cx = branch ? laneX(branch.laneIndex) : MAIN_X;
            return <Circle key={`${event.type}-${index}`} cx={cx} cy={index * ROW_H + ROW_H / 2} r={NODE_R} fill={branch ? branch.color : MAIN_COLOR} />;
          })}
        </Svg>

        {events.map((event, index) => {
          const branch = getBranchForEvent(index, branches);
          const color = branch?.color || (event.type === "response" ? RESPONSE_COLOR : MAIN_COLOR);
          const label = event.type === "llm"
            ? event.modelId || "LLM"
            : event.type === "response"
              ? "Response"
              : event.toolName || "tool";
          const right = event.type === "llm"
            ? `${formatTokens(event.inputTokens || 0)}→${formatTokens(event.outputTokens || 0)} ${formatCost(event.costUsd || 0)}`
            : event.type === "response"
              ? (event.responseText || "").slice(0, 36)
              : event.toolType === "sub_agent"
                ? "sub-agent"
                : "tool";
          const detailParts: string[] = [];
          if (event.type === "llm") {
            detailParts.push(`Request: ${event.requestId || "unknown"}`);
            if (event.inputPreview) detailParts.push(`INPUT\n\n${event.inputPreview}`);
            if (event.outputPreview) detailParts.push(`OUTPUT\n\n${event.outputPreview}`);
          } else if (event.type === "tool_call") {
            detailParts.push(`${event.toolType === "sub_agent" ? "Sub-agent" : "Tool"}: ${event.toolName || "tool"}`);
            if (event.toolInput) detailParts.push(`INPUT\n\n${event.toolInput}`);
            if (event.toolOutput) detailParts.push(`OUTPUT\n\n${event.toolOutput}`);
          } else {
            detailParts.push(event.responseText || "");
          }
          const hasDetail = detailParts.join("\n\n").trim().length > 0;

          return (
            <Pressable
              key={`${event.type}-${index}`}
              onPress={() => hasDetail && setDetail({ title: label, content: detailParts.join("\n\n") })}
              className="flex-row items-center gap-2 rounded-md active:opacity-70"
              style={{ minHeight: ROW_H }}
            >
              <EventIcon event={event} color={color} />
              <Text className="flex-1 text-sm font-medium" numberOfLines={1}>{label}</Text>
              <Muted className="text-[11px]" numberOfLines={1}>{right}</Muted>
              {hasDetail && <ChevronRight size={14} color={colors.mutedForeground} />}
            </Pressable>
          );
        })}
      </View>

      <Modal visible={!!detail} transparent animationType="fade" onRequestClose={() => setDetail(null)}>
        <View className="flex-1 justify-end bg-black/60">
          <View className="max-h-[80%] rounded-t-2xl border px-4 pb-6 pt-4" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-base font-semibold" numberOfLines={1}>{detail?.title}</Text>
              <Pressable onPress={() => setDetail(null)} className="p-1 rounded-full active:opacity-70">
                <X size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <ScrollView>
              <Text
                className="text-xs"
                style={{ fontFamily: "Menlo", color: isDark ? "#d4d4d4" : "#404040", lineHeight: 18 }}
              >
                {detail?.content}
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
