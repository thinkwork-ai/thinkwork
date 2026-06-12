import { memo, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { InlineShortcutText } from "@/components/workbench/InlineShortcutText";
import { useTenant } from "@/context/TenantContext";
import { useQuery, useSubscription } from "urql";
import {
  Badge,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@thinkwork/ui";
import { SystemPromptViewer } from "@/components/workbench/SystemPromptViewer";
import { formatCost } from "@/lib/settings-activity";
import { extractSkillName } from "./skill-row-label";
import { SettingsTenantModelCatalogQuery } from "@/lib/settings-queries";
import {
  SettingsActivityThreadTurnsQuery,
  ThreadTurnEventsQuery,
  TurnInvocationLogsQuery,
  ThreadTurnUpdatedSubscription,
} from "@/lib/graphql-queries";
import { relativeTime } from "@/lib/utils";
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
  SkipForward,
  User,
  Bot,
  Brain,
  Zap,
} from "lucide-react";

const statusConfig: Record<
  string,
  { icon: typeof CheckCircle2; color: string; label: string }
> = {
  succeeded: {
    icon: CheckCircle2,
    color: "text-green-500",
    label: "Succeeded",
  },
  failed: { icon: AlertCircle, color: "text-red-500", label: "Failed" },
  running: { icon: Loader2, color: "text-blue-500", label: "Running" },
  skipped: {
    icon: SkipForward,
    color: "text-muted-foreground",
    label: "Skipped",
  },
  cancelled: {
    icon: AlertCircle,
    color: "text-muted-foreground",
    label: "Cancelled",
  },
};

function parseJsonField(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
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

function formatInvocationSource(source: unknown): string | null {
  const raw = String(source || "").trim();
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[\s-]+/g, "_");
  const labels: Record<string, string> = {
    chat: "Manual chat",
    chat_message: "Manual chat",
    manual: "Manual chat",
    manual_chat: "Manual chat",
    schedule: "Schedule",
    scheduled: "Schedule",
    webhook: "Webhook",
    api: "Automation",
    email: "Email",
  };
  return (
    labels[key] ??
    raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function formatRuntimeType(runtimeType: unknown): string | null {
  if (typeof runtimeType !== "string") return null;
  const normalized = runtimeType.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "pi" || normalized === "flue" || normalized === "strands")
    return "Pi";
  return runtimeType.trim().toUpperCase();
}

// ─── Turn Events ────────────────────────────────────────────────────────────

function TurnEvents({ runId }: { runId: string }) {
  const [result] = useQuery({
    query: ThreadTurnEventsQuery,
    variables: { runId, limit: 50 },
  });

  const events = (result.data as any)?.threadTurnEvents ?? [];
  if (events.length === 0)
    return (
      <p className="text-xs text-muted-foreground pl-6">No events recorded.</p>
    );

  return (
    <div className="pl-6 space-y-1">
      {events.map((evt: any) => {
        const payload = parseJsonField(evt.payload);
        return (
          <div key={evt.id} className="flex items-start gap-2 text-xs">
            <span className="shrink-0 font-mono text-muted-foreground w-5 text-right">
              {evt.seq}
            </span>
            <EventBadge type={evt.eventType} level={evt.level} />
            <span className="text-foreground">
              {evt.message || evt.eventType}
            </span>
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
            <span className="ml-auto text-muted-foreground shrink-0 pr-4">
              {relativeTime(evt.createdAt)}
            </span>
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
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${colors[type] || "bg-muted text-muted-foreground"}`}
    >
      {type}
    </span>
  );
}

// ─── Execution Timeline (unified LLM calls + tool calls) ─────────────────────

type TimelineEvent = {
  type: "llm" | "tool_call" | "tool_result" | "profile_run" | "response";
  timestamp: string;
  branch: string; // "parent" | "sub-agent:<name>" | "profile:<slug>"
  // LLM fields
  modelId?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  costUsd?: number;
  durationMs?: number;
  requestId?: string;
  inputPreview?: string;
  outputPreview?: string;
  toolUses?: string[];
  hasToolResult?: boolean;
  // Tool fields
  toolCallId?: string;
  toolName?: string;
  toolType?: string;
  toolInput?: string;
  toolOutput?: string;
  routeModelId?: string;
  routeInputTokens?: number | null;
  routeOutputTokens?: number | null;
  routeCacheReadTokens?: number | null;
  routeCostUsd?: number | null;
  routeStatus?: string;
  routeRuleSource?: unknown;
  routeMatch?: unknown;
  routeUnavailableReason?: string;
  // Agent Profile fields
  profileRunId?: string;
  profileId?: string;
  profileSlug?: string;
  profileName?: string;
  profileStatus?: string;
  profileModelId?: string;
  profileInputTokens?: number;
  profileOutputTokens?: number;
  profileCacheReadTokens?: number;
  profileCostUsd?: number;
  profileDurationMs?: number;
  profileHandoffSummary?: string;
  profileToolInvocations?: Record<string, unknown>[];
  loopEvidence?: Record<string, unknown> | null;
  loopPhase?: string;
  loopStatus?: string;
  loopVerdict?: string;
  loopIterationIndex?: number;
  reviewerRole?: boolean;
  // Response
  responseText?: string;
};

type ToolModelEvidence = Pick<
  TimelineEvent,
  | "routeModelId"
  | "routeInputTokens"
  | "routeOutputTokens"
  | "routeCacheReadTokens"
  | "routeCostUsd"
  | "routeStatus"
  | "routeRuleSource"
  | "routeMatch"
  | "routeUnavailableReason"
>;

type ModelDisplayNames = Map<string, string>;

type TokenTotals = {
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
};

export interface ExecutionTraceModelRouteTrace {
  parentRequestId?: string | null;
  toolCallId?: string | null;
  toolName?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  durationMs?: number | null;
  costUsd?: number | null;
  modelRoutingStatus?: string | null;
  profileRunId?: string | null;
  profileId?: string | null;
  profileSlug?: string | null;
  profileName?: string | null;
  profileStatus?: string | null;
  laneKey?: string | null;
  loopId?: string | null;
  loopOwnerType?: string | null;
  loopOwnerSlug?: string | null;
  loopPhase?: string | null;
  loopStatus?: string | null;
  loopVerdict?: string | null;
  reviewerRole?: boolean | null;
  loopEvidence?: unknown;
  ruleSource?: unknown;
  match?: unknown;
  metadata?: unknown;
}

function normalizeName(name: string): string {
  return name.replace(/[-\s]/g, "_");
}

function getSubAgentName(branch: string): string | null {
  if (branch.startsWith("sub-agent:")) return branch.slice("sub-agent:".length);
  if (branch === "sub-agent") return "unknown";
  return null;
}

function getProfileBranchName(branch: string): string | null {
  if (branch.startsWith("profile:")) {
    const raw = branch.slice("profile:".length);
    return raw.split(":")[0] || raw;
  }
  return null;
}

function profileBranchKey(slug: string, runId?: string): string {
  return `profile:${slug}${runId ? `:${runId}` : ""}`;
}

function getBranchName(branch: string): string | null {
  return getSubAgentName(branch) ?? getProfileBranchName(branch);
}

function getBranchIdentity(branch: string): string | null {
  if (branch.startsWith("profile:")) return branch.slice("profile:".length);
  return getSubAgentName(branch);
}

function isBranchLane(branch: string): boolean {
  return branch.startsWith("sub-agent") || branch.startsWith("profile:");
}

function shortModelId(modelId: string): string {
  return modelId
    .replace(/^us\.anthropic\./, "")
    .replace(/^anthropic\./, "")
    .replace(/-v\d+:\d+$/, "");
}

function modelCatalogKeys(modelId: string): string[] {
  const trimmed = modelId.trim();
  return trimmed.startsWith("us.") ? [trimmed, trimmed.slice(3)] : [trimmed];
}

function displayModelName(
  modelId: string | null | undefined,
  modelDisplayNames?: ModelDisplayNames,
): string | null {
  if (!modelId?.trim()) return null;
  for (const key of modelCatalogKeys(modelId)) {
    const displayName = modelDisplayNames?.get(key);
    if (displayName) return displayName;
  }
  return shortModelId(modelId);
}

function ModelNameBadge({
  modelId,
  label,
  title,
  modelDisplayNames,
}: {
  modelId?: string | null;
  label?: string | null;
  title?: string | null;
  modelDisplayNames?: ModelDisplayNames;
}) {
  const badgeLabel = label ?? displayModelName(modelId, modelDisplayNames);
  if (!badgeLabel) return null;
  return (
    <Badge
      variant="outline"
      title={title ?? modelId ?? badgeLabel}
      className="max-w-36 truncate px-1.5 py-0 text-[9px] text-muted-foreground"
    >
      {badgeLabel}
    </Badge>
  );
}

function numberValue(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function modelRoutingRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function profileRunField(run: Record<string, unknown>, key: string) {
  const snakeKey = key.replace(
    /[A-Z]/g,
    (letter) => `_${letter.toLowerCase()}`,
  );
  return run[key] ?? run[snakeKey];
}

function profileRunName(run: Record<string, unknown>): string {
  return (
    stringValue(profileRunField(run, "profileName")) ??
    stringValue(profileRunField(run, "profileSlug")) ??
    "Agent Profile"
  );
}

function displayNameFromSlug(slug: string | null | undefined): string {
  return (slug?.trim() || "Agent Profile")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function profileRunSlug(run: Record<string, unknown>): string {
  return (
    stringValue(profileRunField(run, "profileSlug")) ??
    normalizeName(profileRunName(run)).toLowerCase()
  );
}

function profileRunStatus(run: Record<string, unknown>): string {
  return stringValue(profileRunField(run, "status")) ?? "completed";
}

function profileRunModel(run: Record<string, unknown>): string {
  return stringValue(profileRunField(run, "model")) ?? "";
}

function profileRunTokens(
  run: Record<string, unknown>,
  key: "inputTokens" | "outputTokens" | "cachedReadTokens",
): number {
  return numberValue(profileRunField(run, key)) ?? 0;
}

function profileRunCost(run: Record<string, unknown>): number {
  return numberValue(profileRunField(run, "costUsd")) ?? 0;
}

function profileRunDuration(run: Record<string, unknown>): number {
  return numberValue(profileRunField(run, "durationMs")) ?? 0;
}

function profileRunHandoff(run: Record<string, unknown>): string {
  return stringValue(profileRunField(run, "handoffSummary")) ?? "";
}

function profileRunTools(
  run: Record<string, unknown>,
): Record<string, unknown>[] {
  return arrayOfRecords(profileRunField(run, "toolInvocations"));
}

function profileRunLoopEvidence(
  run: Record<string, unknown>,
): Record<string, unknown> | null {
  const evidence = modelRoutingRecord(profileRunField(run, "loopEvidence"));
  return Object.keys(evidence).length > 0 ? evidence : null;
}

function profileRunId(run: Record<string, unknown>): string | undefined {
  return stringValue(profileRunField(run, "profileRunId"));
}

function nestedAgentProfileRunRecord(
  value: unknown,
): Record<string, unknown> | null {
  const record = modelRoutingRecord(value);
  const nested =
    record.agent_profile_run ??
    record.agentProfileRun ??
    modelRoutingRecord(record.result).agent_profile_run ??
    modelRoutingRecord(record.result).agentProfileRun;
  const nestedRecord = modelRoutingRecord(nested);
  return Object.keys(nestedRecord).length > 0 ? nestedRecord : null;
}

function profileRunIdFromToolInvocation(value: unknown): string | undefined {
  const record = modelRoutingRecord(value);
  const nested = nestedAgentProfileRunRecord(record);
  return (
    stringValue(profileRunField(nested ?? {}, "profileRunId")) ??
    stringValue(record.profileRunId) ??
    stringValue(record.profile_run_id) ??
    (stringValue(record.tool_name) === "delegate_to_agent_profile" ||
    stringValue(record.name) === "delegate_to_agent_profile"
      ? stringValue(record.id)
      : undefined)
  );
}

function profileSlugFromToolInvocation(value: unknown): string | undefined {
  const record = modelRoutingRecord(value);
  const nested = nestedAgentProfileRunRecord(record);
  const args = modelRoutingRecord(record.args);
  return (
    stringValue(profileRunField(nested ?? {}, "profileSlug")) ??
    stringValue(record.profileSlug) ??
    stringValue(record.profile_slug) ??
    stringValue(args.profileSlug) ??
    stringValue(args.profile_slug) ??
    stringValue(args.profile)
  );
}

function timelineToolEvent(ti: Record<string, unknown>): TimelineEvent {
  const toolName =
    stringValue(ti.tool_name) ?? stringValue(ti.toolName) ?? "unknown";
  const record = modelRoutingRecord(ti);
  return {
    type: "tool_call",
    timestamp: "",
    branch:
      ti.type === "sub_agent"
        ? `sub-agent:${(toolName || "").toLowerCase()}`
        : "parent",
    toolName,
    toolCallId: stringValue(ti.id) ?? stringValue(ti.toolCallId),
    toolType: stringValue(ti.type) ?? "tool",
    toolInput:
      stringValue(ti.input_preview) ?? stringValue(ti.inputPreview) ?? "",
    toolOutput:
      stringValue(ti.output_preview) ?? stringValue(ti.outputPreview) ?? "",
    ...extractToolModelEvidence(record),
  };
}

function aggregateProfileRunTokens(
  agentProfileRuns: Record<string, unknown>[],
): TokenTotals {
  return agentProfileRuns.reduce<TokenTotals>(
    (sum, run) => ({
      inputTokens: sum.inputTokens + profileRunTokens(run, "inputTokens"),
      outputTokens: sum.outputTokens + profileRunTokens(run, "outputTokens"),
      cachedReadTokens:
        sum.cachedReadTokens + profileRunTokens(run, "cachedReadTokens"),
    }),
    { inputTokens: 0, outputTokens: 0, cachedReadTokens: 0 },
  );
}

function aggregateTurnTokens(usage: Record<string, unknown> | null): {
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
} {
  const directTotals = {
    inputTokens: numberValue(usage?.input_tokens) ?? 0,
    outputTokens: numberValue(usage?.output_tokens) ?? 0,
    cachedReadTokens: numberValue(usage?.cached_read_tokens) ?? 0,
  };
  if (usage?.parent_usage || usage?.parentUsage) {
    return directTotals;
  }

  const agentProfileRuns = Array.isArray(usage?.agent_profile_runs)
    ? (usage.agent_profile_runs as Record<string, unknown>[])
    : [];
  const profileTotals = aggregateProfileRunTokens(agentProfileRuns);
  return {
    inputTokens: directTotals.inputTokens + profileTotals.inputTokens,
    outputTokens: directTotals.outputTokens + profileTotals.outputTokens,
    cachedReadTokens:
      directTotals.cachedReadTokens + profileTotals.cachedReadTokens,
  };
}

function loopEvidenceRecords(
  evidence: Record<string, unknown> | null | undefined,
  key: "iterations" | "phases",
): Record<string, unknown>[] {
  return arrayOfRecords(evidence?.[key]);
}

function latestLoopRecord(
  evidence: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const iterations = loopEvidenceRecords(evidence, "iterations");
  if (iterations.length > 0) return iterations[iterations.length - 1];
  const phases = loopEvidenceRecords(evidence, "phases");
  if (phases.length > 0) {
    return (
      [...phases].reverse().find((phase) => {
        const status = stringValue(phase.status)?.toLowerCase();
        return status !== "skipped";
      }) ?? phases[phases.length - 1]
    );
  }
  return null;
}

function loopValueFromEvidence(
  evidence: Record<string, unknown> | null | undefined,
  key: "phase" | "status" | "verdict",
): string | undefined {
  const latest = latestLoopRecord(evidence);
  const handoff = modelRoutingRecord(evidence?.handoff);
  const goalState = modelRoutingRecord(evidence?.goalState);
  const completion = modelRoutingRecord(goalState.completion);
  return (
    stringValue(latest?.[key]) ??
    (key === "verdict" ? stringValue(handoff.verdict) : undefined) ??
    (key === "verdict" ? stringValue(completion.verdict) : undefined)
  );
}

function loopIterationIndexFromEvidence(
  evidence: Record<string, unknown> | null | undefined,
): number | undefined {
  const latest = latestLoopRecord(evidence);
  const value = numberValue(latest?.index);
  return value == null ? undefined : value;
}

function formatLoopLabel(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized === "self_review" || normalized === "final_review") {
    return "Verification";
  }
  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function profileLoopSummary(event: TimelineEvent): string | null {
  const parts = [
    formatLoopLabel(event.loopPhase),
    formatLoopLabel(event.loopVerdict),
    event.loopIterationIndex != null
      ? `iteration ${event.loopIterationIndex}`
      : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function profileLoopPhaseLines(
  evidence: Record<string, unknown> | null | undefined,
): string[] {
  const phases = loopEvidenceRecords(evidence, "phases");
  if (phases.length === 0) return [];
  return phases.map((phase) => {
    const phaseLabel = formatLoopLabel(stringValue(phase.phase)) ?? "Unknown";
    const status = formatLoopLabel(stringValue(phase.status));
    const verdict = formatLoopLabel(stringValue(phase.verdict));
    const summary = stringValue(phase.summary);
    const feedback = stringValue(phase.feedback);
    return [
      `- ${phaseLabel}`,
      status ? `: ${status}` : "",
      verdict ? ` · verdict ${verdict}` : "",
      summary ? ` — ${summary}` : "",
      feedback ? ` Feedback: ${feedback}` : "",
    ].join("");
  });
}

function collectTimelineModelNames(
  events: TimelineEvent[],
  modelDisplayNames?: ModelDisplayNames,
): string[] {
  const names = new Set<string>();
  for (const event of events) {
    const modelIds = [
      event.modelId,
      event.routeModelId,
      event.profileModelId,
    ].filter((modelId): modelId is string => Boolean(modelId?.trim()));
    for (const modelId of modelIds) {
      names.add(displayModelName(modelId, modelDisplayNames) ?? modelId);
    }
  }
  return [...names];
}

function extractToolModelEvidence(
  record: Record<string, unknown>,
): ToolModelEvidence {
  const routing = modelRoutingRecord(
    record.model_routing ?? record.modelRouting,
  );
  const status =
    String(
      record.model_routing_status ??
        record.modelRoutingStatus ??
        routing.status ??
        "",
    ).trim() || undefined;
  const model =
    String(
      record.model ??
        record.model_id ??
        record.modelId ??
        routing.model ??
        routing.model_id ??
        routing.modelId ??
        "",
    ).trim() || undefined;
  const inputTokens = numberValue(
    record.input_tokens ??
      record.inputTokens ??
      routing.input_tokens ??
      routing.inputTokens,
  );
  const outputTokens = numberValue(
    record.output_tokens ??
      record.outputTokens ??
      routing.output_tokens ??
      routing.outputTokens,
  );
  const cacheReadTokens = numberValue(
    record.cached_read_tokens ??
      record.cachedReadTokens ??
      record.cacheReadTokens ??
      routing.cached_read_tokens ??
      routing.cachedReadTokens ??
      routing.cacheReadTokens,
  );
  const costUsd = numberValue(
    record.cost_usd ?? record.costUsd ?? routing.cost_usd ?? routing.costUsd,
  );
  const ruleSource =
    record.model_routing_rule_source ??
    record.modelRoutingRuleSource ??
    routing.rule_source ??
    routing.ruleSource;
  const match =
    record.model_routing_match ?? record.modelRoutingMatch ?? routing.match;
  const error =
    String(
      record.error ?? record.error_message ?? routing.error ?? "",
    ).trim() || undefined;

  if (
    !model &&
    !status &&
    inputTokens == null &&
    outputTokens == null &&
    costUsd == null &&
    ruleSource == null &&
    match == null
  ) {
    return {};
  }

  return {
    routeModelId: model,
    routeInputTokens: inputTokens,
    routeOutputTokens: outputTokens,
    routeCacheReadTokens: cacheReadTokens,
    routeCostUsd: costUsd,
    routeStatus: status,
    routeRuleSource: ruleSource,
    routeMatch: match,
    routeUnavailableReason: error,
  };
}

function extractToolModelEvidenceFromEvent(event: any): TimelineEvent | null {
  if (event?.eventType !== "model_routed_tool_call") return null;
  const payload = parseJsonField(event.payload) ?? {};
  return extractToolModelEvidenceFromRouteRecord(
    payload,
    event.createdAt ?? "",
  );
}

function extractToolModelEvidenceFromRouteRecord(
  record: Record<string, unknown>,
  timestamp = "",
): TimelineEvent | null {
  const toolName =
    String(
      record.tool_name ?? record.toolName ?? record.name ?? "workspace_skill",
    ).trim() || "workspace_skill";
  const evidence = extractToolModelEvidence({
    ...record,
    model_routing_status:
      record.model_routing_status ?? record.modelRoutingStatus ?? record.status,
  });
  return {
    type: "tool_call",
    timestamp,
    branch: "parent",
    toolCallId:
      String(record.tool_call_id ?? record.toolCallId ?? "").trim() ||
      undefined,
    toolName,
    toolType: "tool",
    toolInput: "",
    toolOutput: "",
    ...evidence,
  };
}

function toolRouteKey(event: TimelineEvent): string {
  return normalizeName(event.toolName ?? "tool").toLowerCase();
}

function toolEventCallId(event: TimelineEvent): string | null {
  return typeof event.toolCallId === "string" && event.toolCallId.trim()
    ? event.toolCallId.trim()
    : null;
}

function toolTraceRouteKey(trace: ExecutionTraceModelRouteTrace): string {
  return normalizeName(trace.toolName ?? "tool").toLowerCase();
}

function traceToolCallId(trace: ExecutionTraceModelRouteTrace): string | null {
  if (typeof trace.toolCallId === "string" && trace.toolCallId.trim()) {
    return trace.toolCallId.trim();
  }
  const metadata = modelRoutingRecord(trace.metadata);
  const raw = metadata.tool_call_id ?? metadata.toolCallId;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function traceEvidence(
  trace: ExecutionTraceModelRouteTrace,
): ToolModelEvidence {
  return {
    routeModelId: trace.model?.trim() || undefined,
    routeInputTokens: numberValue(trace.inputTokens),
    routeOutputTokens: numberValue(trace.outputTokens),
    routeCostUsd: numberValue(trace.costUsd),
    routeStatus: trace.modelRoutingStatus?.trim() || undefined,
    routeRuleSource: trace.ruleSource,
    routeMatch: trace.match,
  };
}

function loopEvidenceFromTrace(
  trace: ExecutionTraceModelRouteTrace,
): Record<string, unknown> | null {
  const direct = modelRoutingRecord(trace.loopEvidence);
  if (Object.keys(direct).length > 0) return direct;
  const metadata = modelRoutingRecord(trace.metadata);
  const metadataEvidence = modelRoutingRecord(
    metadata.loop_evidence ?? metadata.loopEvidence,
  );
  return Object.keys(metadataEvidence).length > 0 ? metadataEvidence : null;
}

function profileEventFromLoopTrace(
  trace: ExecutionTraceModelRouteTrace,
): TimelineEvent | null {
  if (!trace.profileRunId && !trace.profileSlug && !trace.profileName) {
    return null;
  }
  const evidence = loopEvidenceFromTrace(trace);
  const profileSlug =
    trace.profileSlug?.trim() ||
    trace.loopOwnerSlug?.trim() ||
    trace.profileName?.trim().toLowerCase().replace(/\s+/g, "-") ||
    "profile";
  const branch = `profile:${profileSlug}`;
  return {
    type: "profile_run",
    timestamp: "",
    branch,
    profileRunId: trace.profileRunId ?? undefined,
    profileId: trace.profileId ?? undefined,
    profileSlug,
    profileName:
      trace.profileName?.trim() ||
      displayNameFromSlug(trace.loopOwnerSlug ?? profileSlug),
    profileStatus: trace.profileStatus ?? trace.loopStatus ?? undefined,
    profileModelId: trace.model ?? undefined,
    profileInputTokens: numberValue(trace.inputTokens) ?? 0,
    profileOutputTokens: numberValue(trace.outputTokens) ?? 0,
    profileCostUsd: numberValue(trace.costUsd) ?? 0,
    profileDurationMs: numberValue(trace.durationMs) ?? 0,
    loopEvidence: evidence,
    loopPhase:
      trace.loopPhase?.trim() || loopValueFromEvidence(evidence, "phase"),
    loopStatus:
      trace.loopStatus?.trim() || loopValueFromEvidence(evidence, "status"),
    loopVerdict:
      trace.loopVerdict?.trim() || loopValueFromEvidence(evidence, "verdict"),
    loopIterationIndex: loopIterationIndexFromEvidence(evidence),
    reviewerRole: trace.reviewerRole === true,
  };
}

function enrichEventsWithRouteTraces(
  events: TimelineEvent[],
  traces: ExecutionTraceModelRouteTrace[] = [],
  turnId?: string,
): TimelineEvent[] {
  const sameTurn = (trace: ExecutionTraceModelRouteTrace) =>
    !turnId || !trace.parentRequestId || trace.parentRequestId === turnId;
  const scopedTraces = traces.filter(
    (trace) => trace.toolName?.trim() && sameTurn(trace),
  );
  const profileTraceEvents = traces
    .filter((trace) => sameTurn(trace))
    .map(profileEventFromLoopTrace)
    .filter((event): event is TimelineEvent => event !== null);
  if (scopedTraces.length === 0 && profileTraceEvents.length === 0) {
    return events;
  }

  const tracesById = new Map<string, ExecutionTraceModelRouteTrace>();
  const tracesByTool = new Map<string, ExecutionTraceModelRouteTrace[]>();
  for (const trace of scopedTraces) {
    const toolCallId = traceToolCallId(trace);
    if (toolCallId) tracesById.set(toolCallId, trace);
    const key = toolTraceRouteKey(trace);
    const bucket = tracesByTool.get(key) ?? [];
    bucket.push(trace);
    tracesByTool.set(key, bucket);
  }

  const enriched = events.map((event) => {
    if (event.type !== "tool_call") return event;
    const toolCallId = toolEventCallId(event);
    const matchedById = toolCallId ? tracesById.get(toolCallId) : null;
    const bucket = tracesByTool.get(toolRouteKey(event));
    const matched = matchedById ?? bucket?.shift();
    if (!matched) return event;
    return {
      ...event,
      ...traceEvidence(matched),
      routeRuleSource: event.routeRuleSource ?? matched.ruleSource,
      routeMatch: event.routeMatch ?? matched.match,
      routeUnavailableReason: undefined,
    };
  });

  if (profileTraceEvents.length === 0) return enriched;

  const existingProfileKeys = new Set(
    enriched
      .filter((event) => event.type === "profile_run")
      .map(
        (event) =>
          event.profileRunId ??
          `${event.profileSlug ?? "profile"}:${event.profileName ?? ""}`,
      ),
  );
  const missingProfileEvents = profileTraceEvents.filter((event) => {
    const key =
      event.profileRunId ??
      `${event.profileSlug ?? "profile"}:${event.profileName ?? ""}`;
    if (existingProfileKeys.has(key)) return false;
    existingProfileKeys.add(key);
    return true;
  });
  if (missingProfileEvents.length === 0) return enriched;

  const responseIndex = enriched.findIndex(
    (event) => event.type === "response",
  );
  if (responseIndex < 0) return [...enriched, ...missingProfileEvents];
  return [
    ...enriched.slice(0, responseIndex),
    ...missingProfileEvents,
    ...enriched.slice(responseIndex),
  ];
}

function appendUnmatchedRouteEvents(
  events: TimelineEvent[],
  turnEvents: any[] = [],
): TimelineEvent[] {
  const routeEvents = turnEvents
    .map(extractToolModelEvidenceFromEvent)
    .filter((event): event is TimelineEvent => event !== null);
  if (routeEvents.length === 0) return events;

  const routeEventsById = new Map<string, TimelineEvent>();
  const routeEventsByTool = new Map<string, TimelineEvent[]>();
  for (const routeEvent of routeEvents) {
    const toolCallId = toolEventCallId(routeEvent);
    if (toolCallId) routeEventsById.set(toolCallId, routeEvent);
    const key = toolRouteKey(routeEvent);
    const bucket = routeEventsByTool.get(key) ?? [];
    bucket.push(routeEvent);
    routeEventsByTool.set(key, bucket);
  }
  const consumedRouteEvents = new Set<TimelineEvent>();
  const merged = events.map((event) => {
    if (event.type !== "tool_call") return event;
    const toolCallId = toolEventCallId(event);
    const byId = toolCallId ? routeEventsById.get(toolCallId) : null;
    const bucket = routeEventsByTool.get(toolRouteKey(event));
    const routeEvent = byId ?? bucket?.shift();
    if (!routeEvent) return event;
    consumedRouteEvents.add(routeEvent);
    return {
      ...event,
      routeModelId: event.routeModelId ?? routeEvent.routeModelId,
      routeInputTokens: event.routeInputTokens ?? routeEvent.routeInputTokens,
      routeOutputTokens:
        event.routeOutputTokens ?? routeEvent.routeOutputTokens,
      routeCacheReadTokens:
        event.routeCacheReadTokens ?? routeEvent.routeCacheReadTokens,
      routeCostUsd: event.routeCostUsd ?? routeEvent.routeCostUsd,
      routeStatus: event.routeStatus ?? routeEvent.routeStatus,
      routeRuleSource: event.routeRuleSource ?? routeEvent.routeRuleSource,
      routeMatch: event.routeMatch ?? routeEvent.routeMatch,
      routeUnavailableReason: undefined,
    };
  });

  const existing = new Set(
    merged
      .filter((event) => event.type === "tool_call")
      .map((event) => toolRouteKey(event)),
  );
  const unmatchedRouteEvents = routeEvents
    .filter((event) => !consumedRouteEvents.has(event))
    .filter((event) => {
      const key = toolRouteKey(event);
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    });
  return unmatchedRouteEvents.length > 0
    ? [...merged, ...unmatchedRouteEvents]
    : merged;
}

function mergeRouteEvidence(
  events: TimelineEvent[],
  routeRecords: Record<string, unknown>[] = [],
  turnEvents: any[] = [],
): TimelineEvent[] {
  const syntheticTurnEvents =
    routeRecords.length === 0
      ? turnEvents
      : [
          ...turnEvents,
          ...routeRecords.map((record) => ({
            eventType: "model_routed_tool_call",
            payload: record,
          })),
        ];
  return appendUnmatchedRouteEvents(events, syntheticTurnEvents);
}

function hasConcreteRouteEvidence(event: TimelineEvent): boolean {
  return Boolean(
    event.routeModelId ||
    event.routeStatus ||
    event.routeInputTokens != null ||
    event.routeOutputTokens != null ||
    event.routeCostUsd != null,
  );
}

function routeStatusLabel(status?: string): string {
  if (!status) return "";
  return status.replace(/_/g, " ");
}

function formatRouteTokens(event: TimelineEvent): string | null {
  if (event.routeInputTokens == null && event.routeOutputTokens == null) {
    return null;
  }
  const input = formatTokens(event.routeInputTokens ?? 0);
  const output = formatTokens(event.routeOutputTokens ?? 0);
  const cached =
    event.routeCacheReadTokens && event.routeCacheReadTokens > 0
      ? ` (${formatTokens(event.routeCacheReadTokens)} cached)`
      : "";
  return `${input}->${output}${cached}`;
}

function routeEvidenceLines(
  event: TimelineEvent,
  modelDisplayNames?: ModelDisplayNames,
): string[] {
  const status = routeStatusLabel(event.routeStatus);
  const lines = [];
  lines.push(
    `Model: ${displayModelName(event.routeModelId, modelDisplayNames) ?? "--"}`,
  );
  lines.push(`Tokens: ${formatRouteTokens(event) ?? "--"}`);
  lines.push(
    `Cost: ${event.routeCostUsd != null ? formatCost(event.routeCostUsd) : "--"}`,
  );
  if (status) lines.push(`Routing status: ${status}`);
  if (event.routeRuleSource != null) {
    lines.push(
      `Rule source: ${JSON.stringify(event.routeRuleSource, null, 2)}`,
    );
  }
  if (event.routeMatch != null) {
    lines.push(`Match: ${JSON.stringify(event.routeMatch, null, 2)}`);
  }
  if (event.routeUnavailableReason) {
    lines.push(`Note: ${event.routeUnavailableReason}`);
  }
  return lines;
}

function ToolRouteDetail({
  event,
  modelDisplayNames,
}: {
  event: TimelineEvent;
  modelDisplayNames?: ModelDisplayNames;
}) {
  const routed = hasConcreteRouteEvidence(event);
  if (!routed) return null;
  const tokenLabel = formatRouteTokens(event);
  return (
    <span className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
      {tokenLabel ? <span className="tabular-nums">{tokenLabel}</span> : null}
      {event.routeCostUsd != null ? (
        <span className="tabular-nums">{formatCost(event.routeCostUsd)}</span>
      ) : null}
      <ModelNameBadge
        modelId={event.routeModelId}
        modelDisplayNames={modelDisplayNames}
      />
    </span>
  );
}

type BranchSpan = {
  name: string;
  laneIndex: number;
  color: string;
  departIdx: number;
  forkIdx: number;
  mergeIdx: number;
  eventIndices: number[];
};

/** Fallback timeline when CloudWatch invocation logs aren't available.
 * Builds events from the turn's tool_invocations usage data + a synthetic
 * LLM entry from the turn's aggregate token/cost stats. */
function buildTimelineFromUsage(
  toolInvocations: any[],
  agentProfileRuns: Record<string, unknown>[],
  modelRoutedToolCalls: Record<string, unknown>[],
  responseText: string,
  model?: string,
  inputTokens?: number,
  outputTokens?: number,
  durationMs?: number,
  totalCost?: number,
  turnEvents?: any[],
  modelRouteTraces?: ExecutionTraceModelRouteTrace[],
  turnId?: string,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // Add LLM call if we have model info
  if (model) {
    events.push({
      type: "llm",
      timestamp: "",
      branch: "parent",
      modelId: model,
      inputTokens: inputTokens || 0,
      outputTokens: outputTokens || 0,
      durationMs,
      costUsd: totalCost || 0,
      toolUses: toolInvocations.map((ti: any) => ti.tool_name).filter(Boolean),
    });
  }

  const renderedProfileRunKeys = new Set<string>();
  const profileRunEntries = agentProfileRuns.map((run, index) => ({
    run,
    key: profileRunId(run) ?? `${profileRunSlug(run)}:${index}`,
  }));

  function matchingProfileRunForToolInvocation(ti: unknown) {
    const toolProfileRunId = profileRunIdFromToolInvocation(ti);
    if (toolProfileRunId) {
      const match = profileRunEntries.find(
        (entry) =>
          !renderedProfileRunKeys.has(entry.key) &&
          profileRunId(entry.run) === toolProfileRunId,
      );
      if (match) return match;
    }

    const toolProfileSlug = profileSlugFromToolInvocation(ti);
    if (!toolProfileSlug) return null;
    return (
      profileRunEntries.find(
        (entry) =>
          !renderedProfileRunKeys.has(entry.key) &&
          profileRunSlug(entry.run).toLowerCase() ===
            toolProfileSlug.toLowerCase(),
      ) ?? null
    );
  }

  function appendProfileRun(run: Record<string, unknown>) {
    const profileName = profileRunName(run);
    const profileSlug = profileRunSlug(run);
    const runId = profileRunId(run);
    const branch = profileBranchKey(profileSlug, runId);
    const childTools = profileRunTools(run);
    const loopEvidence = profileRunLoopEvidence(run);
    const profileInputTokens = profileRunTokens(run, "inputTokens");
    const profileOutputTokens = profileRunTokens(run, "outputTokens");
    const profileCacheReadTokens = profileRunTokens(run, "cachedReadTokens");
    const profileCostUsd = profileRunCost(run);
    const profileDurationMs = profileRunDuration(run);

    events.push({
      type: "profile_run",
      timestamp:
        stringValue(profileRunField(run, "startedAt")) ??
        stringValue(profileRunField(run, "finishedAt")) ??
        "",
      branch,
      profileRunId: runId,
      profileId: stringValue(profileRunField(run, "profileId")),
      profileSlug,
      profileName,
      profileStatus: profileRunStatus(run),
      profileModelId: profileRunModel(run),
      profileInputTokens,
      profileOutputTokens,
      profileCacheReadTokens,
      profileCostUsd,
      profileDurationMs,
      profileHandoffSummary: profileRunHandoff(run),
      profileToolInvocations: childTools,
      loopEvidence,
      loopPhase:
        loopValueFromEvidence(loopEvidence, "phase") ??
        stringValue(profileRunField(run, "loopPhase")),
      loopStatus:
        loopValueFromEvidence(loopEvidence, "status") ??
        stringValue(profileRunField(run, "loopStatus")),
      loopVerdict:
        loopValueFromEvidence(loopEvidence, "verdict") ??
        stringValue(profileRunField(run, "loopVerdict")),
      loopIterationIndex: loopIterationIndexFromEvidence(loopEvidence),
      reviewerRole: profileSlug.toLowerCase() === "reviewer",
    });

    for (const childTool of childTools) {
      const childToolName =
        stringValue(childTool.tool_name) ??
        stringValue(childTool.toolName) ??
        stringValue(childTool.name) ??
        "tool";
      events.push({
        type: "tool_call",
        timestamp: "",
        branch,
        toolName: childToolName,
        toolCallId:
          stringValue(childTool.id) ??
          stringValue(childTool.tool_call_id) ??
          stringValue(childTool.toolCallId),
        toolType: stringValue(childTool.type) ?? "tool",
        toolInput:
          stringValue(childTool.input_preview) ??
          stringValue(childTool.inputPreview) ??
          "",
        toolOutput:
          stringValue(childTool.output_preview) ??
          stringValue(childTool.outputPreview) ??
          "",
        ...extractToolModelEvidence(modelRoutingRecord(childTool)),
      });
    }
  }

  // Walk parent tool invocations in their recorded order. When a delegate tool
  // points at a profile run, render that child lane immediately after the
  // delegate so multi-profile turns read as delegate -> profile -> delegate.
  for (const ti of toolInvocations) {
    const matchingProfileRun = matchingProfileRunForToolInvocation(ti);
    events.push(timelineToolEvent(modelRoutingRecord(ti)));
    if (matchingProfileRun) {
      renderedProfileRunKeys.add(matchingProfileRun.key);
      appendProfileRun(matchingProfileRun.run);
    }
  }

  for (const entry of profileRunEntries) {
    if (renderedProfileRunKeys.has(entry.key)) continue;
    renderedProfileRunKeys.add(entry.key);
    appendProfileRun(entry.run);
  }

  if (responseText) {
    events.push({
      type: "response",
      timestamp: "",
      branch: "parent",
      responseText,
    });
  }

  return enrichEventsWithRouteTraces(
    mergeRouteEvidence(events, modelRoutedToolCalls, turnEvents),
    modelRouteTraces,
    turnId,
  );
}

function buildTimeline(
  invocations: any[],
  toolInvocations: any[],
  modelRoutedToolCalls: Record<string, unknown>[],
  userMessage: string,
  responseText: string,
  turnEvents?: any[],
  modelRouteTraces?: ExecutionTraceModelRouteTrace[],
  turnId?: string,
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
        const matchingTool = toolInvocations.find(
          (ti: any) => ti.tool_name === toolName,
        );

        let toolInput = matchingTool?.input_preview || "";
        if (!toolInput && inv.outputPreview) {
          const toolUseMatch = inv.outputPreview.match(
            new RegExp(
              `\\[tool_use:\\s*${toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\((.+?)\\)\\]`,
            ),
          );
          if (toolUseMatch) toolInput = toolUseMatch[1];
        }

        let toolOutput = matchingTool?.output_preview || "";
        if (!toolOutput) {
          const invIdx = invocations.indexOf(inv);
          for (let j = invIdx + 1; j < invocations.length; j++) {
            const nextInv = invocations[j];
            if (nextInv.inputPreview?.includes("tool_result")) {
              const resultMatch = nextInv.inputPreview.match(
                /\[tool_result:\s*([\s\S]*?)(?:\]$|\[(?:Assistant|User|Tools)\])/,
              );
              if (resultMatch) {
                toolOutput = resultMatch[1].trim();
                break;
              }
            }
          }
        }

        const toolBranch =
          matchingTool?.type === "sub_agent"
            ? `sub-agent:${toolName.toLowerCase()}`
            : branch;
        const matchingRecord = modelRoutingRecord(matchingTool);

        events.push({
          type: "tool_call",
          timestamp: inv.timestamp,
          branch: toolBranch,
          toolName,
          toolCallId: matchingTool?.id,
          toolType: matchingTool?.type || "mcp_tool",
          toolInput,
          toolOutput,
          ...extractToolModelEvidence(matchingRecord),
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

  return enrichEventsWithRouteTraces(
    mergeRouteEvidence(events, modelRoutedToolCalls, turnEvents),
    modelRouteTraces,
    turnId,
  );
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
      if (isBranchLane(inner.branch)) break;

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
const RESPONSE_COLOR = "rgb(6, 182, 212)";
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
  const activeLanes = new Map<number, number>();

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (
      !(
        (ev.type === "tool_call" && ev.toolType === "sub_agent") ||
        ev.type === "profile_run"
      )
    ) {
      continue;
    }

    const name =
      ev.type === "profile_run"
        ? (ev.profileSlug ?? "profile").toLowerCase()
        : ev.toolName?.toLowerCase() || "unknown";
    const identity = getBranchIdentity(ev.branch) ?? name;

    const eventIndices = [i];
    for (let j = i + 1; j < events.length; j++) {
      const branchIdentity = getBranchIdentity(events[j].branch);
      if (
        branchIdentity &&
        normalizeName(branchIdentity) === normalizeName(identity)
      ) {
        eventIndices.push(j);
      }
    }

    const lastBranchIdx = eventIndices[eventIndices.length - 1];
    let mergeIdx = events.length - 1;
    for (let j = lastBranchIdx + 1; j < events.length; j++) {
      if (!isBranchLane(events[j].branch)) {
        mergeIdx = j;
        break;
      }
    }

    let departIdx = i;
    for (let j = i - 1; j >= 0; j--) {
      if (!isBranchLane(events[j].branch)) {
        departIdx = j;
        break;
      }
    }

    let lane = 0;
    while ((activeLanes.get(lane) ?? -1) > departIdx) lane++;
    activeLanes.set(lane, mergeIdx);

    branches.push({
      name,
      laneIndex: lane,
      color: BRANCH_COLORS[branches.length % BRANCH_COLORS.length],
      departIdx,
      forkIdx: i,
      mergeIdx,
      eventIndices,
    });
  }

  return branches;
}

function getBranchForEvent(
  eventIdx: number,
  branches: BranchSpan[],
): BranchSpan | null {
  return branches.find((b) => b.eventIndices.includes(eventIdx)) ?? null;
}

function ExecutionTimeline({
  turnId,
  toolInvocations,
  model,
  inputTokens,
  outputTokens,
  summaryInputTokens,
  summaryOutputTokens,
  durationMs,
  totalCostFromTurn,
  responseText,
  agentName,
  modelDisplayNames,
  modelRouteTraces,
  modelRoutedToolCalls = [],
  agentProfileRuns = [],
  systemPrompt,
  onViewDetail,
  onViewSystemPrompt,
}: {
  turnId: string;
  toolInvocations: any[];
  agentProfileRuns?: Record<string, unknown>[];
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  summaryInputTokens?: number;
  summaryOutputTokens?: number;
  durationMs?: number;
  totalCostFromTurn?: number;
  responseText: string;
  agentName?: string | null;
  modelDisplayNames?: ModelDisplayNames;
  modelRouteTraces?: ExecutionTraceModelRouteTrace[];
  modelRoutedToolCalls?: Record<string, unknown>[];
  /** Captured system prompt for this turn; shown when the Agent (llm) row is clicked. */
  systemPrompt?: string | null;
  onViewDetail: (title: string, content: string) => void;
  onViewSystemPrompt: (prompt: string) => void;
}) {
  const { tenantId } = useTenant();
  const [result] = useQuery({
    query: TurnInvocationLogsQuery,
    variables: { tenantId: tenantId!, turnId },
    pause: !tenantId,
  });
  const [eventsResult] = useQuery({
    query: ThreadTurnEventsQuery,
    variables: { runId: turnId, limit: 100 },
  });

  const invocations = (result.data as any)?.turnInvocationLogs ?? [];
  const turnEvents = (eventsResult.data as any)?.threadTurnEvents ?? [];
  if (result.fetching && invocations.length === 0)
    return (
      <p className="text-[10px] text-muted-foreground px-3">
        Loading timeline...
      </p>
    );

  // Build timeline from CloudWatch invocations if available, otherwise from tool_invocations usage data
  const shouldUseUsageTimeline =
    agentProfileRuns.length > 0 || invocations.length === 0;
  const events = !shouldUseUsageTimeline
    ? buildTimeline(
        invocations,
        toolInvocations,
        modelRoutedToolCalls,
        "",
        responseText,
        turnEvents,
        modelRouteTraces,
        turnId,
      )
    : buildTimelineFromUsage(
        toolInvocations,
        agentProfileRuns,
        modelRoutedToolCalls,
        responseText,
        model,
        inputTokens,
        outputTokens,
        durationMs,
        totalCostFromTurn,
        turnEvents,
        modelRouteTraces,
        turnId,
      );

  if (events.length === 0) return null;

  const timelineModelNames = collectTimelineModelNames(
    events,
    modelDisplayNames,
  );
  const hasMixedModels = timelineModelNames.length > 1;
  const svgHeight = events.length * ROW_H;

  const branches = buildBranches(events);
  const hasBranches = branches.length > 0;
  const maxLane = hasBranches
    ? Math.max(...branches.map((b) => b.laneIndex))
    : -1;
  const svgWidth = hasBranches ? laneX(maxLane) + 12 : 52;
  const contentPadding = hasBranches ? laneX(maxLane) + 14 : 34;

  const firstFork = hasBranches
    ? Math.min(...branches.map((b) => b.departIdx))
    : -1;
  const lastMerge = hasBranches
    ? Math.max(...branches.map((b) => b.mergeIdx))
    : -1;

  return (
    <div className="px-3">
      <div className="relative" style={{ paddingLeft: contentPadding }}>
        {/* SVG branch lines */}
        <svg
          className="absolute left-0 top-0"
          width={svgWidth}
          height={svgHeight}
          style={{ overflow: "visible" }}
        >
          {!hasBranches ? (
            <line
              x1={MAIN_X}
              y1={ROW_H / 2}
              x2={MAIN_X}
              y2={svgHeight - ROW_H / 2}
              stroke={MAIN_COLOR}
              strokeWidth={2.5}
              strokeOpacity={0.5}
            />
          ) : (
            <>
              <line
                x1={MAIN_X}
                y1={ROW_H / 2}
                x2={MAIN_X}
                y2={firstFork * ROW_H + ROW_H / 2}
                stroke={MAIN_COLOR}
                strokeWidth={2.5}
                strokeOpacity={0.5}
              />
              <line
                x1={MAIN_X}
                y1={firstFork * ROW_H + ROW_H / 2}
                x2={MAIN_X}
                y2={lastMerge * ROW_H + ROW_H / 2}
                stroke={MAIN_COLOR}
                strokeWidth={2.5}
                strokeOpacity={0.3}
              />
              <line
                x1={MAIN_X}
                y1={lastMerge * ROW_H + ROW_H / 2}
                x2={MAIN_X}
                y2={svgHeight - ROW_H / 2}
                stroke={MAIN_COLOR}
                strokeWidth={2.5}
                strokeOpacity={0.5}
              />

              {branches.map((branch) => {
                const bx = laneX(branch.laneIndex);
                const departY = branch.departIdx * ROW_H + ROW_H / 2;
                const mergeY = branch.mergeIdx * ROW_H + ROW_H / 2;
                const forkEndY = departY + ROW_H;
                const mergeStartY = mergeY - ROW_H;
                const lineTopY = Math.min(
                  forkEndY,
                  branch.forkIdx * ROW_H + ROW_H / 2,
                );
                const lineBottomY = Math.max(
                  mergeStartY,
                  branch.eventIndices[branch.eventIndices.length - 1] * ROW_H +
                    ROW_H / 2,
                );

                return (
                  <g
                    key={`${branch.name}:${branch.laneIndex}:${branch.departIdx}:${branch.mergeIdx}`}
                  >
                    <path
                      d={`M ${MAIN_X} ${departY} C ${MAIN_X} ${departY + ROW_H * 0.6} ${bx} ${forkEndY - ROW_H * 0.4} ${bx} ${forkEndY}`}
                      fill="none"
                      stroke={branch.color}
                      strokeWidth={2.5}
                      strokeOpacity={0.5}
                    />
                    {lineTopY < lineBottomY && (
                      <line
                        x1={bx}
                        y1={lineTopY}
                        x2={bx}
                        y2={lineBottomY}
                        stroke={branch.color}
                        strokeWidth={2.5}
                        strokeOpacity={0.5}
                      />
                    )}
                    <path
                      d={`M ${bx} ${mergeStartY} C ${bx} ${mergeStartY + ROW_H * 0.6} ${MAIN_X} ${mergeY - ROW_H * 0.4} ${MAIN_X} ${mergeY}`}
                      fill="none"
                      stroke={branch.color}
                      strokeWidth={2.5}
                      strokeOpacity={0.5}
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
            return <circle key={i} cx={cx} cy={cy} r={NODE_R} fill={color} />;
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
            const eventInputTokens = summaryInputTokens ?? ev.inputTokens ?? 0;
            const eventOutputTokens =
              summaryOutputTokens ?? ev.outputTokens ?? 0;
            icon = (
              <Bot className="h-3.5 w-3.5" style={{ color: RESPONSE_COLOR }} />
            );
            label = agentName || "Agent";
            rightDetail = (
              <span className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
                <span className="tabular-nums">
                  {formatTokens(eventInputTokens)}→
                  {formatTokens(eventOutputTokens)}
                  {ev.cacheReadTokens ? (
                    <span className="text-green-500 ml-1">
                      ({formatTokens(ev.cacheReadTokens)} cached)
                    </span>
                  ) : null}
                </span>
                {ev.durationMs != null ? (
                  <span className="tabular-nums">
                    {formatDuration(ev.durationMs)}
                  </span>
                ) : null}
                <span className="tabular-nums">
                  {formatCost(ev.costUsd || 0)}
                </span>
                <ModelNameBadge
                  modelId={ev.modelId}
                  label={hasMixedModels ? "Mixed" : undefined}
                  title={
                    hasMixedModels
                      ? `Models: ${timelineModelNames.join(", ")}`
                      : undefined
                  }
                  modelDisplayNames={modelDisplayNames}
                />
              </span>
            );
            const parts: string[] = [];
            parts.push(
              `Request: ${ev.requestId}  ·  ${ev.timestamp}  ·  ${eventInputTokens} in → ${eventOutputTokens} out  ·  ${ev.durationMs != null ? `${formatDuration(ev.durationMs)}  ·  ` : ""}${formatCost(ev.costUsd || 0)}  ·  ${hasMixedModels ? `Mixed (${timelineModelNames.join(", ")})` : (displayModelName(ev.modelId, modelDisplayNames) ?? "--")}`,
            );
            if (ev.inputPreview)
              parts.push(`── INPUT ──\n\n${ev.inputPreview}`);
            if (ev.outputPreview)
              parts.push(`── OUTPUT ──\n\n${ev.outputPreview}`);
            clickTitle = `${label}${isOnBranch ? ` (${branch!.name})` : ""}`;
            clickContent = parts.join("\n\n");
          } else if (ev.type === "profile_run") {
            const loopSummary = profileLoopSummary(ev);
            icon = (
              <Brain
                className="h-3.5 w-3.5"
                style={{ color: branch?.color || "rgb(168, 85, 247)" }}
              />
            );
            label = ev.profileName || "Agent Profile";
            const tokenLabel = `${formatTokens(ev.profileInputTokens || 0)}→${formatTokens(ev.profileOutputTokens || 0)}${
              ev.profileCacheReadTokens
                ? ` (${formatTokens(ev.profileCacheReadTokens)} cached)`
                : ""
            }`;
            rightDetail = (
              <span className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
                <span className="tabular-nums">{tokenLabel}</span>
                <span className="tabular-nums">
                  {formatDuration(ev.profileDurationMs)}
                </span>
                <span className="tabular-nums">
                  {formatCost(ev.profileCostUsd || 0)}
                </span>
                <ModelNameBadge
                  modelId={ev.profileModelId}
                  modelDisplayNames={modelDisplayNames}
                />
              </span>
            );
            const parts: string[] = [];
            parts.push(`Agent Profile  ·  ${ev.profileName || "Profile"}`);
            parts.push(
              [
                "── PROFILE RUN ──",
                "",
                `Profile run: ${ev.profileRunId || "--"}`,
                `Model: ${displayModelName(ev.profileModelId, modelDisplayNames) ?? "--"}`,
                `Tokens: ${tokenLabel}`,
                `Duration: ${formatDuration(ev.profileDurationMs)}`,
                `Cost: ${formatCost(ev.profileCostUsd || 0)}`,
                `Status: ${routeStatusLabel(ev.profileStatus) || "--"}`,
                loopSummary ? `Loop: ${loopSummary}` : null,
                profileLoopPhaseLines(ev.loopEvidence).length
                  ? `Loop phases:\n${profileLoopPhaseLines(ev.loopEvidence).join("\n")}`
                  : null,
              ]
                .filter((line): line is string => line != null)
                .join("\n"),
            );
            if (ev.loopEvidence) {
              parts.push(
                `── LOOP EVIDENCE ──\n\n${JSON.stringify(ev.loopEvidence, null, 2)}`,
              );
            }
            if (ev.profileHandoffSummary) {
              parts.push(`── HANDOFF ──\n\n${ev.profileHandoffSummary}`);
            }
            if (ev.profileToolInvocations?.length) {
              parts.push(
                `── CHILD TOOLS ──\n\n${JSON.stringify(ev.profileToolInvocations, null, 2)}`,
              );
            }
            clickTitle = `Agent Profile: ${ev.profileName || "Profile"}`;
            clickContent = parts.join("\n\n");
          } else if (ev.type === "tool_call") {
            const isSub = ev.toolType === "sub_agent";
            const skillName = extractSkillName(ev.toolName, ev.toolInput);
            const isSkill = skillName !== null;
            icon = isSub ? (
              <Bot
                className="h-3.5 w-3.5"
                style={{ color: branch?.color || "rgb(168, 85, 247)" }}
              />
            ) : (
              <Zap className="h-3.5 w-3.5 text-amber-400" />
            );
            const baseName = ev.toolName || "tool";
            label = isSkill
              ? `Skill: ${skillName}`
              : isSub
                ? `Sub-Agent: ${baseName}`
                : `Tool: ${baseName}`;

            if (isSub && branch) {
              const branchEvents = branch.eventIndices
                .map((idx) => events[idx])
                .filter((e) => e.type === "llm");
              const branchIn = branchEvents.reduce(
                (s, e) => s + (e.inputTokens || 0),
                0,
              );
              const branchOut = branchEvents.reduce(
                (s, e) => s + (e.outputTokens || 0),
                0,
              );
              const branchCost = branchEvents.reduce(
                (s, e) => s + (e.costUsd || 0),
                0,
              );
              rightDetail = (
                <span className="flex items-center gap-2">
                  <span
                    className="text-[11px] tabular-nums"
                    style={{ color: branch.color }}
                  >
                    {formatTokens(branchIn)}→{formatTokens(branchOut)}{" "}
                    {formatCost(branchCost)}
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[9px] px-1.5 py-0 text-muted-foreground"
                  >
                    sub-agent
                  </Badge>
                </span>
              );
            } else {
              rightDetail = (
                <ToolRouteDetail
                  event={ev}
                  modelDisplayNames={modelDisplayNames}
                />
              );
            }
            const parts: string[] = [];
            const detailHeader = isSub
              ? "Sub-Agent"
              : isSkill
                ? "Skill"
                : "MCP Tool";
            const detailName = isSkill ? skillName : ev.toolName;
            parts.push(`${detailHeader}  ·  ${detailName}`);
            parts.push(
              `── MODEL ROUTING ──\n\n${routeEvidenceLines(ev, modelDisplayNames).join("\n")}`,
            );
            if (ev.toolInput) parts.push(`── INPUT ──\n\n${ev.toolInput}`);
            if (ev.toolOutput) parts.push(`── OUTPUT ──\n\n${ev.toolOutput}`);
            clickTitle = isSkill
              ? `Skill: ${skillName}`
              : isSub
                ? `Sub-Agent: ${baseName}`
                : `Tool: ${baseName}`;
            clickContent = parts.join("\n\n");
          } else if (ev.type === "response") {
            icon = (
              <Bot className="h-3.5 w-3.5" style={{ color: RESPONSE_COLOR }} />
            );
            label = agentName || "Agent";
            rightDetail = (
              <span className="text-[11px] text-muted-foreground truncate max-w-[250px]">
                {(ev.responseText || "").slice(0, 60)}...
              </span>
            );
            clickTitle = agentName || "Agent";
            clickContent = ev.responseText || "";
          }

          return (
            <button
              key={i}
              type="button"
              data-timeline-event-type={ev.type}
              data-branch-lane={branch?.laneIndex ?? ""}
              data-branch-name={branch?.name ?? ""}
              className="w-full flex items-center gap-2 hover:bg-accent/20 transition-colors rounded text-left"
              style={{ height: ROW_H }}
              onClick={() =>
                ev.type === "llm"
                  ? onViewSystemPrompt(systemPrompt ?? "")
                  : onViewDetail(clickTitle, clickContent)
              }
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

function TurnRow({
  turn,
  agentName,
  modelDisplayNames,
  modelRouteTraces,
}: {
  turn: any;
  agentName?: string | null;
  modelDisplayNames?: ModelDisplayNames;
  modelRouteTraces?: ExecutionTraceModelRouteTrace[];
}) {
  const [open, setOpen] = useState(false);
  const [detailDialog, setDetailDialog] = useState<{
    title: string;
    content: string;
  } | null>(null);
  const [systemPromptDialog, setSystemPromptDialog] = useState<{
    prompt: string;
  } | null>(null);
  const usage = parseJsonField(turn.usageJson);
  const result = parseJsonField(turn.resultJson);
  const resultResponse =
    result?.response && typeof result.response === "object"
      ? (result.response as Record<string, unknown>)
      : null;
  const runtimeLabel = formatRuntimeType(
    turn.runtimeType || result?.runtime || resultResponse?.runtime,
  );
  const cfg = statusConfig[turn.status] || statusConfig.failed;

  const durationMs = usage?.duration_ms as number | undefined;
  const inputTokens = usage?.input_tokens;
  const outputTokens = usage?.output_tokens;
  const toolInvocations = Array.isArray(usage?.tool_invocations)
    ? (usage.tool_invocations as any[])
    : Array.isArray(usage?.tools_called)
      ? (usage.tools_called as string[]).map((name) => ({
          tool_name: name,
          type: "tool",
          status: "success",
        }))
      : [];
  const modelRoutedToolCalls = Array.isArray(usage?.model_routed_tool_calls)
    ? (usage.model_routed_tool_calls as Record<string, unknown>[])
    : [];
  const agentProfileRuns = Array.isArray(usage?.agent_profile_runs)
    ? (usage.agent_profile_runs as Record<string, unknown>[])
    : [];
  const aggregateTokens = aggregateTurnTokens(usage);
  const hasAggregateTokens =
    aggregateTokens.inputTokens > 0 ||
    aggregateTokens.outputTokens > 0 ||
    aggregateTokens.cachedReadTokens > 0 ||
    inputTokens != null;
  const title = "Thinking";
  const sourceLabel = formatInvocationSource(
    turn.triggerName || turn.invocationSource,
  );
  const statusColorClass = cfg.color;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full">
        <div className="flex items-start gap-3 px-4 py-3 hover:bg-accent/20 transition-colors rounded-md text-sm group">
          <div className="mt-0.5 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-muted">
            <Brain className={`h-3.5 w-3.5 shrink-0 ${statusColorClass}`} />
          </div>

          {/* Source label */}
          <div className="shrink-0 text-left">
            <span className="block font-medium">{title}</span>
            {sourceLabel && (
              <span className="block text-[11px] text-muted-foreground truncate">
                {sourceLabel}
              </span>
            )}
          </div>
          {open ? (
            <ChevronDown className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}

          {turn.turnNumber && (
            <span className="text-xs text-muted-foreground">
              Turn #{turn.turnNumber}
            </span>
          )}

          {turn.retryAttempt > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              retry #{turn.retryAttempt}
            </Badge>
          )}

          {runtimeLabel && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {runtimeLabel}
            </Badge>
          )}

          {/* Metrics row */}
          <div className="mt-1 flex min-w-0 flex-1 items-center justify-end gap-3 overflow-hidden text-xs text-muted-foreground">
            {hasAggregateTokens && (
              <span
                className="flex min-w-0 items-center gap-0.5 truncate"
                title="Input / Output tokens"
              >
                <Zap className="h-3 w-3" />
                {formatTokens(aggregateTokens.inputTokens)} →{" "}
                {formatTokens(aggregateTokens.outputTokens)}
                {aggregateTokens.cachedReadTokens
                  ? ` (${formatTokens(aggregateTokens.cachedReadTokens)} cached)`
                  : ""}
              </span>
            )}
            {durationMs != null && (
              <span
                className="flex min-w-0 items-center gap-0.5 truncate"
                title="Duration"
              >
                <Clock className="h-3 w-3" />
                {formatDuration(durationMs)}
              </span>
            )}
            {turn.totalCost != null && turn.totalCost > 0 && (
              <span
                className="flex min-w-0 items-center gap-0.5 truncate font-medium"
                title="Cost"
              >
                <DollarSign className="h-3 w-3" />
                {formatCost(turn.totalCost)}
              </span>
            )}
            <span className="w-16 shrink-0 text-right">
              {relativeTime(turn.startedAt || turn.createdAt)}
            </span>
          </div>
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="ml-7 pl-2 pb-2 space-y-3">
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
              toolInvocations={toolInvocations}
              model={typeof usage?.model === "string" ? usage.model : ""}
              inputTokens={
                typeof usage?.input_tokens === "number" ? usage.input_tokens : 0
              }
              outputTokens={
                typeof usage?.output_tokens === "number"
                  ? usage.output_tokens
                  : 0
              }
              summaryInputTokens={aggregateTokens.inputTokens}
              summaryOutputTokens={aggregateTokens.outputTokens}
              durationMs={durationMs}
              totalCostFromTurn={turn.totalCost || 0}
              responseText={result?.response ? String(result.response) : ""}
              agentName={agentName}
              modelDisplayNames={modelDisplayNames}
              modelRouteTraces={modelRouteTraces}
              modelRoutedToolCalls={modelRoutedToolCalls}
              agentProfileRuns={agentProfileRuns}
              systemPrompt={turn.systemPrompt}
              onViewDetail={(t, c) => setDetailDialog({ title: t, content: c })}
              onViewSystemPrompt={(p) => setSystemPromptDialog({ prompt: p })}
            />
          )}
        </div>
      </CollapsibleContent>

      {/* Detail viewer dialog */}
      <Dialog
        open={!!detailDialog}
        onOpenChange={(open) => {
          if (!open) setDetailDialog(null);
        }}
      >
        <DialogContent
          className="h-[85vh] flex flex-col"
          style={{ width: "90vw", maxWidth: 900 }}
        >
          <DialogHeader>
            <div className="flex items-center justify-between pr-8">
              <DialogTitle className="text-sm font-medium font-mono">
                {detailDialog?.title}
              </DialogTitle>
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

      {/* System prompt viewer — opened from the Agent (llm) execution step */}
      <Dialog
        open={!!systemPromptDialog}
        onOpenChange={(open) => {
          if (!open) setSystemPromptDialog(null);
        }}
      >
        <DialogContent
          className="flex h-[85vh] flex-col gap-3"
          style={{ width: "90vw", maxWidth: 900 }}
          data-testid="trace-system-prompt-dialog"
        >
          <DialogHeader>
            <DialogTitle>System prompt</DialogTitle>
            <DialogDescription>
              Captured when this turn completed. Read-only.
            </DialogDescription>
          </DialogHeader>
          {systemPromptDialog && systemPromptDialog.prompt.trim().length > 0 ? (
            <SystemPromptViewer prompt={systemPromptDialog.prompt} />
          ) : (
            <p
              className="py-8 text-center text-sm text-muted-foreground"
              data-testid="trace-system-prompt-empty"
            >
              No system prompt was captured for this turn.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </Collapsible>
  );
}

interface AgentRef {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

// ─── Message Row (chat messages in timeline) ────────────────────────────────

const MessageRow = memo(function MessageRow({
  message,
  agentMap,
  defaultAgentName,
  assistantLabel,
  userLabel,
  onOpenArtifact,
}: {
  message: ChatMessage;
  agentMap?: Map<string, AgentRef>;
  defaultAgentName?: string | null;
  assistantLabel?: string | null;
  userLabel?: string | null;
  onOpenArtifact?: (artifact: {
    id: string;
    title: string;
    type: string;
    status: string;
  }) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const isUser = message.role.toLowerCase() === "user";
  const Icon = isUser ? User : Bot;
  const label = isUser
    ? userLabel || "User"
    : assistantLabel ||
      (message.senderId ? agentMap?.get(message.senderId)?.name : null) ||
      defaultAgentName ||
      "Agent";
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
      <div
        className={`mt-0.5 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${isUser ? "bg-blue-500/10 text-blue-500" : "bg-cyan-500/10 text-cyan-400"}`}
      >
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0 overflow-hidden">
        <div
          className={`flex items-center gap-2 mb-0.5 ${hasContent ? "cursor-pointer" : ""}`}
          onClick={hasContent ? () => setExpanded((v) => !v) : undefined}
        >
          <span className="text-sm font-medium">{label}</span>
          {hasContent &&
            (expanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ))}
          <span className="ml-auto text-xs text-muted-foreground shrink-0">
            {relativeTime(message.createdAt)}
          </span>
        </div>
        {expanded ? (
          <>
            <div className="text-sm text-muted-foreground prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-headings:my-2 max-w-none">
              {isUser ? (
                <InlineShortcutText
                  text={content}
                  fallbackAgentProfiles
                  fallbackMentions
                  fallbackSkills
                />
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {content}
                </ReactMarkdown>
              )}
            </div>
            {!isUser && (
              <div className="flex justify-end mt-1">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="p-1 rounded hover:bg-accent transition-colors"
                  title="Copy message"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground line-clamp-1 break-all">
            <InlineShortcutText
              text={firstLine}
              fallbackAgentProfiles
              fallbackMentions
              fallbackSkills
            />
          </p>
        )}
        {artifact && onOpenArtifact && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenArtifact(artifact);
            }}
            className="flex items-center gap-2 mt-2 px-3 py-2 rounded-md border border-border hover:bg-accent/40 transition-colors text-left w-full"
          >
            <FileText className="h-4 w-4 shrink-0 text-primary" />
            <span className="text-sm font-medium text-primary truncate">
              {artifact.title}
            </span>
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
  ownerType?: string | null;
  ownerId?: string | null;
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
  | { kind: "message"; message: ChatMessage; sortDate: number };

// ─── Main Component ─────────────────────────────────────────────────────────

interface ExecutionTraceProps {
  threadId: string;
  tenantId: string;
  activityLabel?: string | null;
  messages?: ChatMessage[];
  modelRouteTraces?: ExecutionTraceModelRouteTrace[];
  agentMap?: Map<string, AgentRef>;
  defaultAgentName?: string | null;
  assistantLabel?: string | null;
  userLabel?: string | null;
  onOpenArtifact?: (artifact: {
    id: string;
    title: string;
    type: string;
    status: string;
  }) => void;
}

export function ExecutionTrace({
  threadId,
  tenantId,
  activityLabel,
  messages = [],
  modelRouteTraces = [],
  agentMap,
  defaultAgentName,
  assistantLabel,
  userLabel,
  onOpenArtifact,
}: ExecutionTraceProps) {
  const [modelCatalogResult] = useQuery({
    query: SettingsTenantModelCatalogQuery,
    variables: { tenantId, includeDisabled: false },
    pause: !tenantId,
  });
  const [result, reexecuteTurns] = useQuery({
    query: SettingsActivityThreadTurnsQuery,
    variables: { tenantId, threadId: threadId, limit: 50 },
  });

  // Refetch turns when subscription notifies of a change for this thread
  const [turnSub] = useSubscription({
    query: ThreadTurnUpdatedSubscription,
    variables: { tenantId },
    pause: !tenantId,
  });
  useEffect(() => {
    if ((turnSub.data as any)?.onThreadTurnUpdated?.threadId === threadId) {
      reexecuteTurns({ requestPolicy: "network-only" });
    }
  }, [turnSub.data, threadId, reexecuteTurns]);

  const turns = (result.data as any)?.threadTurns ?? [];
  const modelDisplayNames = useMemo(() => {
    const names: ModelDisplayNames = new Map();
    for (const model of modelCatalogResult.data?.tenantModelCatalog ?? []) {
      if (!model.modelId || !model.displayName) continue;
      for (const key of modelCatalogKeys(model.modelId)) {
        names.set(key, model.displayName);
      }
    }
    return names;
  }, [modelCatalogResult.data?.tenantModelCatalog]);

  // Build merged timeline (turns + messages sorted by date)
  const timeline: TimelineItem[] = [
    ...turns.map((t: any) => ({
      kind: "turn" as const,
      turn: t,
      sortDate: new Date(t.startedAt || t.createdAt).getTime(),
    })),
    ...messages.map((m) => ({
      kind: "message" as const,
      message: m,
      sortDate: new Date(m.createdAt).getTime(),
    })),
  ].sort((a, b) => a.sortDate - b.sortDate);

  // Aggregate turn stats
  const totalCost = turns.reduce(
    (sum: number, t: any) => sum + (t.totalCost || 0),
    0,
  );
  const totalTurns = turns.length;
  const succeededTurns = turns.filter(
    (t: any) => t.status === "succeeded",
  ).length;
  const totalTokens = turns.reduce((sum: number, t: any) => {
    const u = parseJsonField(t.usageJson);
    const aggregateTokens = aggregateTurnTokens(u);
    return sum + aggregateTokens.inputTokens + aggregateTokens.outputTokens;
  }, 0);

  const activityHeader = (
    <div className="flex items-center justify-between gap-4 pr-1">
      <h3 className="flex min-w-0 items-center gap-1.5 font-mono text-sm font-medium text-muted-foreground">
        <Activity className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{activityLabel || "Activity"}</span>
      </h3>
      {totalTurns > 0 && (
        <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Cpu className="h-3.5 w-3.5" />
            {totalTurns} turn{totalTurns !== 1 ? "s" : ""} ({succeededTurns}{" "}
            succeeded)
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
              <TurnRow
                key={item.turn.id}
                turn={item.turn}
                modelRouteTraces={modelRouteTraces}
                agentName={
                  item.turn.agentId
                    ? agentMap?.get(item.turn.agentId)?.name
                    : null
                }
                modelDisplayNames={modelDisplayNames}
              />
            ) : (
              <MessageRow
                key={item.message.id}
                message={item.message}
                agentMap={agentMap}
                defaultAgentName={defaultAgentName}
                assistantLabel={assistantLabel}
                userLabel={userLabel}
                onOpenArtifact={onOpenArtifact}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}
