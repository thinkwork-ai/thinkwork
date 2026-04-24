import { memo, useEffect, useRef, useState, lazy, Suspense } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAuth } from "@/context/AuthContext";
import { useTenant } from "@/context/TenantContext";
import { useQuery, useSubscription } from "urql";
import { graphql } from "@/gql";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatCost } from "@/lib/activity-utils";
import { ThreadTurnsForThreadQuery, ThreadTurnEventsQuery, TurnInvocationLogsQuery, OnThreadTurnUpdatedSubscription } from "@/lib/graphql-queries";
import { formatDateTime, relativeTime } from "@/lib/utils";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Cpu,
  DollarSign,
  FileText,
  Loader2,
  MessageSquare,
  SkipForward,
  User,
  Bot,
  Zap,
  Maximize2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const statusConfig: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  succeeded: { icon: CheckCircle2, color: "text-green-500", label: "Succeeded" },
  failed: { icon: AlertCircle, color: "text-red-500", label: "Failed" },
  running: { icon: Loader2, color: "text-blue-500", label: "Running" },
  skipped: { icon: SkipForward, color: "text-muted-foreground", label: "Skipped" },
  cancelled: { icon: AlertCircle, color: "text-muted-foreground", label: "Cancelled" },
};

function parseJsonField(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return null; } }
  return raw as Record<string, unknown>;
}

function formatDuration(ms: number | undefined | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function formatTokens(n: unknown): string {
  const num = Number(n);
  if (!num) return "0";
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}

// ─── Turn Events ────────────────────────────────────────────────────────────

function TurnEvents({ runId }: { runId: string }) {
  const [result] = useQuery({
    query: ThreadTurnEventsQuery,
    variables: { runId, limit: 50 },
  });

  const events = (result.data as any)?.threadTurnEvents ?? [];
  if (events.length === 0) return <p className="text-xs text-muted-foreground pl-6">No events recorded.</p>;

  return (
    <div className="pl-6 space-y-1">
      {events.map((evt: any) => {
        const payload = parseJsonField(evt.payload);
        return (
          <div key={evt.id} className="flex items-start gap-2 text-xs">
            <span className="shrink-0 font-mono text-muted-foreground w-5 text-right">{evt.seq}</span>
            <EventBadge type={evt.eventType} level={evt.level} />
            <span className="text-foreground">{evt.message || evt.eventType}</span>
            {payload && Object.keys(payload).length > 0 && (
              <span className="text-muted-foreground truncate max-w-[300px]">
                {evt.eventType === "signal" && payload.signal
                  ? `signal: ${payload.signal}`
                  : evt.eventType === "completed" && payload.duration_ms
                    ? `${formatDuration(payload.duration_ms as number)}, ${payload.response_length ?? 0} chars`
                    : evt.eventType === "error"
                      ? String(payload.error || "").slice(0, 80)
                      : ""}
              </span>
            )}
            <span className="ml-auto text-muted-foreground shrink-0 pr-4">{relativeTime(evt.createdAt)}</span>
          </div>
        );
      })}
    </div>
  );
}

function EventBadge({ type, level }: { type: string; level?: string }) {
  const colors: Record<string, string> = {
    started: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    completed: "bg-green-500/15 text-green-600 dark:text-green-400",
    signal: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
    error: "bg-red-500/15 text-red-600 dark:text-red-400",
    turn_loop: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${colors[type] || "bg-muted text-muted-foreground"}`}>
      {type}
    </span>
  );
}

// ─── Execution Timeline (unified LLM calls + tool calls) ─────────────────────

type TimelineEvent = {
  type: "llm" | "tool_call" | "tool_result" | "response";
  timestamp: string;
  branch: string; // "parent" | "sub-agent:<name>" | "sub-agent"
  // LLM fields
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
  // Tool fields
  toolName?: string;
  toolType?: string;
  toolInput?: string;
  toolOutput?: string;
  // Response
  responseText?: string;
};

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

type BranchSpan = {
  name: string;
  laneIndex: number;
  color: string;
  forkIdx: number;
  mergeIdx: number;
  eventIndices: number[];
};

/** Fallback timeline when CloudWatch invocation logs aren't available.
 * Builds events from the turn's tool_invocations usage data + a synthetic
 * LLM entry from the turn's aggregate token/cost stats. */
function buildTimelineFromUsage(
  toolInvocations: any[],
  responseText: string,
  model?: string,
  inputTokens?: number,
  outputTokens?: number,
  totalCost?: number,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // Add LLM call if we have model info
  if (model) {
    const shortModel = model.replace(/^us\.anthropic\./, "").replace(/-v\d+:\d+$/, "");
    events.push({
      type: "llm",
      timestamp: "",
      branch: "parent",
      modelId: shortModel,
      inputTokens: inputTokens || 0,
      outputTokens: outputTokens || 0,
      costUsd: totalCost || 0,
      toolUses: toolInvocations.map((ti: any) => ti.tool_name).filter(Boolean),
    });
  }

  // Add tool call events from usage data
  for (const ti of toolInvocations) {
    events.push({
      type: "tool_call",
      timestamp: "",
      branch: ti.type === "sub_agent" ? `sub-agent:${(ti.tool_name || "").toLowerCase()}` : "parent",
      toolName: ti.tool_name || "unknown",
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

function buildTimeline(
  invocations: any[],
  toolInvocations: any[],
  userMessage: string,
  responseText: string,
): TimelineEvent[] {
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

        let toolInput = matchingTool?.input_preview || "";
        if (!toolInput && inv.outputPreview) {
          const toolUseMatch = inv.outputPreview.match(
            new RegExp(`\\[tool_use:\\s*${toolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\((.+?)\\)\\]`)
          );
          if (toolUseMatch) toolInput = toolUseMatch[1];
        }

        let toolOutput = matchingTool?.output_preview || "";
        if (!toolOutput) {
          const invIdx = invocations.indexOf(inv);
          for (let j = invIdx + 1; j < invocations.length; j++) {
            const nextInv = invocations[j];
            if (nextInv.inputPreview?.includes("tool_result")) {
              const resultMatch = nextInv.inputPreview.match(/\[tool_result:\s*([\s\S]*?)(?:\]$|\[(?:Assistant|User|Tools)\])/);
              if (resultMatch) {
                toolOutput = resultMatch[1].trim();
                break;
              }
            }
          }
        }

        const toolBranch = matchingTool?.type === "sub_agent"
          ? `sub-agent:${toolName.toLowerCase()}`
          : branch;

        events.push({
          type: "tool_call",
          timestamp: inv.timestamp,
          branch: toolBranch,
          toolName,
          toolType: matchingTool?.type || "mcp_tool",
          toolInput,
          toolOutput,
        });
      }
    }
  }

  if (responseText) {
    events.push({
      type: "response",
      timestamp: "",
      branch: "parent",
      responseText,
    });
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

const MAIN_COLOR = "rgb(234, 179, 8)";
const BRANCH_COLORS = [
  "rgb(168, 85, 247)",
  "rgb(59, 130, 246)",
  "rgb(236, 72, 153)",
  "rgb(20, 184, 166)",
  "rgb(249, 115, 22)",
];

const ROW_H = 30;
const NODE_R = 4;
const MAIN_X = 10;
const BRANCH_X = 22;
const LANE_GAP = 12;

function laneX(laneIndex: number): number {
  return BRANCH_X + laneIndex * LANE_GAP;
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
  return branches.find(b => b.eventIndices.includes(eventIdx)) ?? null;
}

function ExecutionTimeline({ turnId, toolInvocations, model, inputTokens, outputTokens, totalCostFromTurn, responseText, onViewDetail }: {
  turnId: string;
  toolInvocations: any[];
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalCostFromTurn?: number;
  responseText: string;
  onViewDetail: (title: string, content: string) => void;
}) {
  const { tenantId } = useTenant();
  const [result] = useQuery({
    query: TurnInvocationLogsQuery,
    variables: { tenantId: tenantId!, turnId },
    pause: !tenantId,
  });

  const invocations = (result.data as any)?.turnInvocationLogs ?? [];
  if (result.fetching && invocations.length === 0) return <p className="text-[10px] text-muted-foreground px-3">Loading timeline...</p>;

  // Build timeline from CloudWatch invocations if available, otherwise from tool_invocations usage data
  const events = invocations.length > 0
    ? buildTimeline(invocations, toolInvocations, "", responseText)
    : buildTimelineFromUsage(toolInvocations, responseText, model, inputTokens, outputTokens, totalCostFromTurn);

  if (events.length === 0) return null;

  const totalCost = invocations.reduce((sum: number, inv: any) => sum + (inv.costUsd || 0), 0);
  const totalInputTokens = invocations.reduce((sum: number, inv: any) => sum + (inv.inputTokenCount || 0), 0);
  const totalOutputTokens = invocations.reduce((sum: number, inv: any) => sum + (inv.outputTokenCount || 0), 0);
  const svgHeight = events.length * ROW_H;

  const branches = buildBranches(events);
  const hasBranches = branches.length > 0;
  const maxLane = hasBranches ? Math.max(...branches.map(b => b.laneIndex)) : -1;
  const svgWidth = hasBranches ? laneX(maxLane) + 12 : 52;
  const contentPadding = hasBranches ? laneX(maxLane) + 14 : 34;

  const firstFork = hasBranches ? Math.min(...branches.map(b => b.forkIdx)) : -1;
  const lastMerge = hasBranches ? Math.max(...branches.map(b => b.mergeIdx)) : -1;

  let lastParentBeforeFork = 0;
  if (hasBranches) {
    for (let i = firstFork - 1; i >= 0; i--) {
      if (!isSubAgentBranch(events[i].branch)) { lastParentBeforeFork = i; break; }
    }
  }

  return (
    <div className="px-3 space-y-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
        Execution ({events.length} steps) · {formatTokens(totalInputTokens)} in + {formatTokens(totalOutputTokens)} out · {formatCost(totalCost)}
      </p>
      <div className="relative" style={{ paddingLeft: contentPadding }}>
        {/* SVG branch lines */}
        <svg
          className="absolute left-0 top-0"
          width={svgWidth}
          height={svgHeight}
          style={{ overflow: "visible" }}
        >
          {!hasBranches ? (
            <line x1={MAIN_X} y1={ROW_H / 2} x2={MAIN_X} y2={svgHeight - ROW_H / 2} stroke={MAIN_COLOR} strokeWidth={2.5} strokeOpacity={0.5} />
          ) : (
            <>
              <line x1={MAIN_X} y1={ROW_H / 2} x2={MAIN_X} y2={firstFork * ROW_H + ROW_H / 2} stroke={MAIN_COLOR} strokeWidth={2.5} strokeOpacity={0.5} />
              <line x1={MAIN_X} y1={firstFork * ROW_H + ROW_H / 2} x2={MAIN_X} y2={lastMerge * ROW_H + ROW_H / 2} stroke={MAIN_COLOR} strokeWidth={2.5} strokeOpacity={0.3} />
              <line x1={MAIN_X} y1={lastMerge * ROW_H + ROW_H / 2} x2={MAIN_X} y2={svgHeight - ROW_H / 2} stroke={MAIN_COLOR} strokeWidth={2.5} strokeOpacity={0.5} />

              {branches.map((branch) => {
                const bx = laneX(branch.laneIndex);
                const departY = lastParentBeforeFork * ROW_H + ROW_H / 2;
                const mergeY = branch.mergeIdx * ROW_H + ROW_H / 2;
                const forkEndY = departY + ROW_H;
                const mergeStartY = mergeY - ROW_H;
                const lineTopY = Math.min(forkEndY, branch.forkIdx * ROW_H + ROW_H / 2);
                const lineBottomY = Math.max(mergeStartY, branch.eventIndices[branch.eventIndices.length - 1] * ROW_H + ROW_H / 2);

                return (
                  <g key={branch.name}>
                    <path
                      d={`M ${MAIN_X} ${departY} C ${MAIN_X} ${departY + ROW_H * 0.6} ${bx} ${forkEndY - ROW_H * 0.4} ${bx} ${forkEndY}`}
                      fill="none" stroke={branch.color} strokeWidth={2.5} strokeOpacity={0.5}
                    />
                    {lineTopY < lineBottomY && (
                      <line
                        x1={bx} y1={lineTopY}
                        x2={bx} y2={lineBottomY}
                        stroke={branch.color} strokeWidth={2.5} strokeOpacity={0.5}
                      />
                    )}
                    <path
                      d={`M ${bx} ${mergeStartY} C ${bx} ${mergeStartY + ROW_H * 0.6} ${MAIN_X} ${mergeY - ROW_H * 0.4} ${MAIN_X} ${mergeY}`}
                      fill="none" stroke={branch.color} strokeWidth={2.5} strokeOpacity={0.5}
                    />
                  </g>
                );
              })}
            </>
          )}

          {events.map((ev, i) => {
            const branch = getBranchForEvent(i, branches);
            const cx = branch ? laneX(branch.laneIndex) : MAIN_X;
            const cy = i * ROW_H + ROW_H / 2;
            const color = branch ? branch.color : MAIN_COLOR;
            return (
              <circle key={i} cx={cx} cy={cy} r={NODE_R} fill={color} />
            );
          })}
        </svg>

        {/* Event rows */}
        {events.map((ev, i) => {
          const branch = getBranchForEvent(i, branches);
          const isOnBranch = !!branch;

          let icon: React.ReactNode;
          let label = "";
          let rightDetail: React.ReactNode = null;
          let clickTitle = "";
          let clickContent = "";

          if (ev.type === "llm") {
            icon = <Cpu className="h-3.5 w-3.5 text-muted-foreground" />;
            label = ev.modelId || "LLM";
            rightDetail = (
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {formatTokens(ev.inputTokens || 0)}→{formatTokens(ev.outputTokens || 0)}
                {ev.cacheReadTokens ? <span className="text-green-500 ml-1">({formatTokens(ev.cacheReadTokens)} cached)</span> : null}
                {" "}{formatCost(ev.costUsd || 0)}
              </span>
            );
            const parts: string[] = [];
            parts.push(`Request: ${ev.requestId}  ·  ${ev.timestamp}  ·  ${ev.inputTokens} in → ${ev.outputTokens} out  ·  ${formatCost(ev.costUsd || 0)}`);
            if (ev.inputPreview) parts.push(`── INPUT ──\n\n${ev.inputPreview}`);
            if (ev.outputPreview) parts.push(`── OUTPUT ──\n\n${ev.outputPreview}`);
            clickTitle = `${ev.modelId}${isOnBranch ? ` (${branch!.name})` : ""}`;
            clickContent = parts.join("\n\n");
          } else if (ev.type === "tool_call") {
            const isSub = ev.toolType === "sub_agent";
            icon = isSub
              ? <Bot className="h-3.5 w-3.5" style={{ color: branch?.color || "rgb(168, 85, 247)" }} />
              : <Zap className="h-3.5 w-3.5 text-amber-400" />;
            label = ev.toolName || "tool";

            if (isSub && branch) {
              const branchEvents = branch.eventIndices
                .map(idx => events[idx])
                .filter(e => e.type === "llm");
              const branchIn = branchEvents.reduce((s, e) => s + (e.inputTokens || 0), 0);
              const branchOut = branchEvents.reduce((s, e) => s + (e.outputTokens || 0), 0);
              const branchCost = branchEvents.reduce((s, e) => s + (e.costUsd || 0), 0);
              rightDetail = (
                <span className="flex items-center gap-2">
                  <span className="text-[11px] tabular-nums" style={{ color: branch.color }}>
                    {formatTokens(branchIn)}→{formatTokens(branchOut)} {formatCost(branchCost)}
                  </span>
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-muted-foreground">sub-agent</Badge>
                </span>
              );
            } else {
              rightDetail = (
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-muted-foreground">
                  {isSub ? "sub-agent" : "tool"}
                </Badge>
              );
            }
            const parts: string[] = [];
            parts.push(`${isSub ? "Sub-Agent" : "MCP Tool"}  ·  ${ev.toolName}`);
            if (ev.toolInput) parts.push(`── INPUT ──\n\n${ev.toolInput}`);
            if (ev.toolOutput) parts.push(`── OUTPUT ──\n\n${ev.toolOutput}`);
            clickTitle = `${ev.toolName}${isSub ? " (sub-agent)" : ""}`;
            clickContent = parts.join("\n\n");
          } else if (ev.type === "response") {
            icon = <MessageSquare className="h-3.5 w-3.5 text-green-400" />;
            label = "Response";
            rightDetail = (
              <span className="text-[11px] text-muted-foreground truncate max-w-[250px]">
                {(ev.responseText || "").slice(0, 60)}...
              </span>
            );
            clickTitle = "Response";
            clickContent = ev.responseText || "";
          }

          return (
            <button
              key={i}
              type="button"
              className="w-full flex items-center gap-2 hover:bg-accent/20 transition-colors rounded text-left"
              style={{ height: ROW_H }}
              onClick={() => onViewDetail(clickTitle, clickContent)}
            >
              {icon}
              <span className="text-sm font-medium truncate">{label}</span>
              <span className="flex-1" />
              {rightDetail}
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Single Turn Row ────────────────────────────────────────────────────────

function TurnRow({ turn }: { turn: any }) {
  const [open, setOpen] = useState(false);
  const [detailDialog, setDetailDialog] = useState<{ title: string; content: string } | null>(null);
  const usage = parseJsonField(turn.usageJson);
  const result = parseJsonField(turn.resultJson);
  const cfg = statusConfig[turn.status] || statusConfig.failed;
  const StatusIcon = cfg.icon;

  const durationMs = usage?.duration_ms as number | undefined;
  const inputTokens = usage?.input_tokens;
  const outputTokens = usage?.output_tokens;
  const cachedTokens = usage?.cached_read_tokens;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full">
        <div className="flex items-center gap-3 px-4 py-3 hover:bg-accent/20 transition-colors rounded-md text-sm group">
          <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-muted">
            <StatusIcon className={`h-3.5 w-3.5 shrink-0 ${cfg.color} ${turn.status === "running" ? "animate-spin" : ""}`} />
          </div>

          {/* Source label */}
          <span className="font-medium truncate">
            {turn.triggerName || turn.invocationSource?.replace(/_/g, " ") || "invocation"}
          </span>
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}

          {turn.turnNumber && (
            <span className="text-xs text-muted-foreground">Turn #{turn.turnNumber}</span>
          )}

          {turn.retryAttempt > 0 && (
            <Badge variant="secondary" className="text-[10px]">retry #{turn.retryAttempt}</Badge>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Metrics row */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
            {inputTokens != null && (
              <span className="flex items-center gap-0.5" title="Input / Output tokens">
                <Zap className="h-3 w-3" />
                {formatTokens(inputTokens)} → {formatTokens(outputTokens)}
                {cachedTokens ? ` (${formatTokens(cachedTokens)} cached)` : ""}
              </span>
            )}
            {durationMs != null && (
              <span className="flex items-center gap-0.5" title="Duration">
                <Clock className="h-3 w-3" />
                {formatDuration(durationMs)}
              </span>
            )}
            {turn.totalCost != null && turn.totalCost > 0 && (
              <span className="flex items-center gap-0.5 font-medium" title="Cost">
                <DollarSign className="h-3 w-3" />
                {formatCost(turn.totalCost)}
              </span>
            )}
            <span className="w-16 text-right">{relativeTime(turn.startedAt || turn.createdAt)}</span>
          </div>
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="ml-7 pl-2 py-2 space-y-3">
          {/* Summary info at top */}
          <div className="px-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground font-mono">
            <span>ID: {turn.id.slice(0, 8)}</span>
            {turn.startedAt && <span>Started: {formatDateTime(turn.startedAt)}</span>}
            {turn.finishedAt && <span>Finished: {formatDateTime(turn.finishedAt)}</span>}
            {turn.invocationSource && <span>Source: {turn.invocationSource}</span>}
          </div>

          {/* Error */}
          {turn.error && (
            <div className="px-3 py-2 rounded bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-mono">
              {turn.error}
            </div>
          )}

          {/* Unified execution timeline — LLM calls, tool calls, response in chronological order */}
          {turn.status !== "queued" && turn.status !== "running" && (
            <ExecutionTimeline
              turnId={turn.id}
              toolInvocations={
                (usage?.tool_invocations?.length > 0
                  ? usage.tool_invocations
                  : (usage?.tools_called || []).map((name: string) => ({ tool_name: name, type: "tool", status: "success" }))
                ) as any[]
              }
              model={usage?.model || ""}
              inputTokens={usage?.input_tokens || 0}
              outputTokens={usage?.output_tokens || 0}
              totalCostFromTurn={turn.totalCost || 0}
              responseText={result?.response ? String(result.response) : ""}
              onViewDetail={(t, c) => setDetailDialog({ title: t, content: c })}
            />
          )}
        </div>
      </CollapsibleContent>

      {/* Detail viewer dialog */}
      <Dialog open={!!detailDialog} onOpenChange={(open) => { if (!open) setDetailDialog(null); }}>
        <DialogContent className="h-[85vh] flex flex-col" style={{ width: "90vw", maxWidth: 900 }}>
          <DialogHeader>
            <div className="flex items-center justify-between pr-8">
              <DialogTitle className="text-sm font-medium font-mono">{detailDialog?.title}</DialogTitle>
              <button
                type="button"
                className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent"
                onClick={() => {
                  if (!detailDialog) return;
                  const content = detailDialog.content;
                  // Try to find and prettify JSON blocks in the content
                  const prettified = content.replace(
                    /(\{[\s\S]*\}|\[[\s\S]*\])/g,
                    (match) => {
                      try {
                        return JSON.stringify(JSON.parse(match), null, 2);
                      } catch {
                        return match;
                      }
                    },
                  );
                  setDetailDialog({ ...detailDialog, content: prettified });
                }}
              >
                Prettify JSON
              </button>
            </div>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <pre className="text-xs font-mono whitespace-pre-wrap p-4 bg-muted rounded-md">
              {detailDialog?.content}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </Collapsible>
  );
}

// ─── Comment Row (inline in timeline) ────────────────────────────────────────

interface ThreadComment {
  id: string;
  authorType?: string | null;
  authorId?: string | null;
  content: string;
  createdAt: string;
}

interface AgentRef {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

const CommentRow = memo(function CommentRow({
  comment,
  agentMap,
  userName,
  highlighted,
}: {
  comment: ThreadComment;
  agentMap?: Map<string, AgentRef>;
  userName?: string;
  highlighted?: boolean;
}) {
  const isAgent = comment.authorType === "agent";
  const isSystem = comment.authorType === "system";
  const agent = isAgent && comment.authorId ? agentMap?.get(comment.authorId) : null;

  let authorName = userName || "You";
  if (isSystem) authorName = "System";
  else if (isAgent) authorName = agent?.name ?? comment.authorId?.slice(0, 8) ?? "Agent";

  return (
    <div
      id={`comment-${comment.id}`}
      className={`flex gap-3 px-4 py-3 transition-colors duration-1000 ${
        highlighted ? "bg-primary/5" : ""
      }`}
    >
      <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-muted">
        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-medium">{authorName}</span>
          <span className="ml-auto text-xs text-muted-foreground shrink-0">{relativeTime(comment.createdAt)}</span>
        </div>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{comment.content}</p>
      </div>
    </div>
  );
});


// ─── Message Row (chat messages in timeline) ────────────────────────────────

const MessageRow = memo(function MessageRow({
  message,
  agentMap,
  onOpenArtifact,
}: {
  message: ChatMessage;
  agentMap?: Map<string, AgentRef>;
  onOpenArtifact?: (artifact: { id: string; title: string; type: string; status: string }) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const isUser = message.role.toLowerCase() === "user";
  const Icon = isUser ? User : Bot;
  const label = isUser ? "User" : (message.senderId && agentMap?.get(message.senderId)?.name) || "Agent";
  const content = (message.content || "").trim();
  const firstLine = content.split("\n")[0].slice(0, 120);
  const hasContent = content.length > 0;
  const artifact = message.durableArtifact;

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex gap-3 px-4 py-3">
      <div className={`mt-0.5 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${isUser ? "bg-blue-500/10 text-blue-500" : "bg-primary/10 text-primary"}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0 overflow-hidden">
        <div
          className={`flex items-center gap-2 mb-0.5 ${hasContent ? "cursor-pointer" : ""}`}
          onClick={hasContent ? () => setExpanded((v) => !v) : undefined}
        >
          <span className="text-sm font-medium">{label}</span>
          {hasContent && (
            expanded
              ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="ml-auto text-xs text-muted-foreground shrink-0">{relativeTime(message.createdAt)}</span>
        </div>
        {expanded ? (
          <>
            <div className="text-sm text-muted-foreground prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-headings:my-2 max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
            {!isUser && (
              <div className="flex justify-end mt-1">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="p-1 rounded hover:bg-accent transition-colors"
                  title="Copy message"
                >
                  {copied
                    ? <Check className="h-3.5 w-3.5 text-green-500" />
                    : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground line-clamp-1 break-all">
            {firstLine}
          </p>
        )}
        {artifact && onOpenArtifact && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenArtifact(artifact); }}
            className="flex items-center gap-2 mt-2 px-3 py-2 rounded-md border border-border hover:bg-accent/40 transition-colors text-left w-full"
          >
            <FileText className="h-4 w-4 shrink-0 text-primary" />
            <span className="text-sm font-medium text-primary truncate">{artifact.title}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground ml-auto" />
          </button>
        )}
      </div>
    </div>
  );
});

// ─── Timeline item type ──────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: string;
  content: string | null;
  senderType?: string | null;
  senderId?: string | null;
  createdAt: string;
  durableArtifact?: {
    id: string;
    title: string;
    type: string;
    status: string;
  } | null;
}

type TimelineItem =
  | { kind: "turn"; turn: any; sortDate: number }
  | { kind: "comment"; comment: ThreadComment; sortDate: number }
  | { kind: "message"; message: ChatMessage; sortDate: number };

// ─── Main Component ─────────────────────────────────────────────────────────

interface ExecutionTraceProps {
  threadId: string;
  tenantId: string;
  comments?: ThreadComment[];
  messages?: ChatMessage[];
  agentMap?: Map<string, AgentRef>;
  onOpenArtifact?: (artifact: { id: string; title: string; type: string; status: string }) => void;
}

export function ExecutionTrace({
  threadId,
  tenantId,
  comments = [],
  messages = [],
  agentMap,
  onOpenArtifact,
}: ExecutionTraceProps) {
  const { user } = useAuth();
  const [highlightCommentId, setHighlightCommentId] = useState<string | null>(null);
  const hasScrolledRef = useRef(false);

  const [result, reexecuteTurns] = useQuery({
    query: ThreadTurnsForThreadQuery,
    variables: { tenantId, threadId: threadId, limit: 50 },
  });

  // Refetch turns when subscription notifies of a change for this thread
  const [turnSub] = useSubscription({
    query: OnThreadTurnUpdatedSubscription,
    variables: { tenantId },
    pause: !tenantId,
  });
  useEffect(() => {
    if ((turnSub.data as any)?.onThreadTurnUpdated?.threadId === threadId) {
      reexecuteTurns({ requestPolicy: "network-only" });
    }
  }, [turnSub.data, threadId, reexecuteTurns]);

  // Scroll to comment when URL hash matches #comment-{id}
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#comment-") || comments.length === 0) return;
    const commentId = hash.slice("#comment-".length);
    if (hasScrolledRef.current) return;
    const el = document.getElementById(`comment-${commentId}`);
    if (el) {
      hasScrolledRef.current = true;
      setHighlightCommentId(commentId);
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const timer = setTimeout(() => setHighlightCommentId(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [comments]);

  const turns = (result.data as any)?.threadTurns ?? [];

  // Build merged timeline (turns + comments + messages sorted by date)
  const timeline: TimelineItem[] = [
    ...turns.map((t: any) => ({
      kind: "turn" as const,
      turn: t,
      sortDate: new Date(t.startedAt || t.createdAt).getTime(),
    })),
    ...comments.map((c) => ({
      kind: "comment" as const,
      comment: c,
      sortDate: new Date(c.createdAt).getTime(),
    })),
    ...messages.map((m) => ({
      kind: "message" as const,
      message: m,
      sortDate: new Date(m.createdAt).getTime(),
    })),
  ].sort((a, b) => a.sortDate - b.sortDate);

  // Aggregate turn stats
  const totalCost = turns.reduce((sum: number, t: any) => sum + (t.totalCost || 0), 0);
  const totalTurns = turns.length;
  const succeededTurns = turns.filter((t: any) => t.status === "succeeded").length;
  const totalTokens = turns.reduce((sum: number, t: any) => {
    const u = parseJsonField(t.usageJson);
    return sum + (Number(u?.input_tokens) || 0) + (Number(u?.output_tokens) || 0);
  }, 0);

  const activityHeader = (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-medium flex items-center gap-1.5">
        <Activity className="h-3.5 w-3.5" />
        Activity
      </h3>
      {totalTurns > 0 && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Cpu className="h-3.5 w-3.5" />
            {totalTurns} turn{totalTurns !== 1 ? "s" : ""} ({succeededTurns} succeeded)
          </span>
          {totalTokens > 0 && (
            <span className="flex items-center gap-1">
              <Zap className="h-3.5 w-3.5" />
              {formatTokens(totalTokens)} tokens
            </span>
          )}
          {totalCost > 0 && (
            <span className="flex items-center gap-1 font-medium text-foreground">
              <DollarSign className="h-3.5 w-3.5" />
              {formatCost(totalCost)}
            </span>
          )}
        </div>
      )}
    </div>
  );

  if (result.fetching) {
    return (
      <div className="space-y-3">
        {activityHeader}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {activityHeader}

      {timeline.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">No activity yet.</p>
      ) : (
        <div className="border border-border rounded-lg divide-y divide-border">
          {timeline.map((item) =>
            item.kind === "turn" ? (
              <TurnRow key={item.turn.id} turn={item.turn} />
            ) : item.kind === "message" ? (
              <MessageRow key={item.message.id} message={item.message} agentMap={agentMap} onOpenArtifact={onOpenArtifact} />
            ) : (
              <CommentRow
                key={item.comment.id}
                comment={item.comment}
                agentMap={agentMap}
                userName={user?.name}
                highlighted={highlightCommentId === item.comment.id}
              />
            ),
          )}
        </div>
      )}

    </div>
  );
}
