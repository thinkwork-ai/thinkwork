import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Pressable, FlatList, Animated, Easing, RefreshControl } from "react-native";
import { useColorScheme } from "nativewind";
import { useRouter } from "expo-router";
import { User, Bot, Brain, Check, AlertCircle, ChevronDown, ChevronRight, Copy, FileText, MapPin, DollarSign, UserPlus, CheckSquare, Building2, RefreshCw, MoreHorizontal, Bookmark, ClipboardList } from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import { useMutation } from "urql";
import { Text, Muted } from "@/components/ui/typography";
import { MarkdownMessage } from "@/components/chat/MarkdownMessage";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { HeaderContextMenu } from "@/components/ui/header-context-menu";
import { COLORS } from "@/lib/theme";
import { getGenUIComponent } from "@/lib/genui-registry";
import { RefreshGenUIMutation } from "@/lib/graphql-queries";
import { TurnExecutionTimeline } from "@/components/threads/TurnExecutionTimeline";

const RESPONSE_COLOR = "#06b6d4";

// ---------------------------------------------------------------------------
// Spinning refresh icon
// ---------------------------------------------------------------------------

function SpinningRefresh({ size, color }: { size: number; color: string }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1500, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <RefreshCw size={size} color={color} />
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Message {
  id: string;
  role: string;
  content: string;
  senderType: string;
  senderId: string;
  createdAt: string;
  toolResults?: Array<Record<string, unknown>> | null;
  metadata?: any;
  durableArtifact?: {
    id: string;
    title: string;
    type: string;
    status: string;
  } | null;
}

interface Turn {
  id: string;
  agentId: string;
  turnNumber: number;
  status: string;
  triggerName: string;
  invocationSource?: string | null;
  startedAt: string;
  finishedAt?: string | null;
  error?: string | null;
  resultJson?: any;
  usageJson?: any;
  totalCost?: number | null;
  createdAt: string;
}

type TimelineItem =
  | { kind: "message"; data: Message; sortKey: number }
  | { kind: "turn"; data: Turn; sortKey: number }
  | { kind: "fallback-response"; data: { turnId: string; content: string; agentName: string; createdAt: string }; sortKey: number }
  | { kind: "genui"; data: { id: string; toolResult: Record<string, unknown>; toolIndex: number; message: Message; createdAt: string }; sortKey: number };

export interface SaveRecipeInfo {
  label: string;
  genuiType: string;
  toolInfo: { server: string; tool: string; params: Record<string, unknown> };
  messageId: string;
  threadId: string;
  tenantId: string;
}

export interface ActivityTimelineProps {
  messages: any[];
  turns: any[];
  agentName?: string;
  isAdmin?: boolean;
  tenantId?: string | null;
  isAgentRunning?: boolean;
  onScrollToEnd?: () => void;
  onLinkPress?: (url: string) => void;
  onSaveRecipe?: (info: SaveRecipeInfo) => void;
  listHeaderComponent?: React.ReactElement | null;
  /**
   * Suppress the centered "No activity yet" placeholder. The Task Detail
   * page uses this because the pinned external-task card already fills the
   * viewport and the "empty" message is misleading there.
   */
  hideEmptyState?: boolean;
  /**
   * PRD-46: current user's id, threaded into GenUI cards so interactive
   * cards (e.g. QuestionCard) can stamp `senderId` on outgoing messages.
   */
  currentUserId?: string;
  refreshing?: boolean;
  onRefresh?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(startedAt: string, finishedAt: string): string {
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

function parseUsage(usageJson: any): { inp: number; out: number } | null {
  try {
    const u = typeof usageJson === "string" ? JSON.parse(usageJson) : usageJson;
    if (!u) return null;
    const inp = u.inputTokens ?? u.input_tokens ?? 0;
    const out = u.outputTokens ?? u.output_tokens ?? 0;
    return { inp, out };
  } catch { return null; }
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
  return labels[key] ?? raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}


function parseResponseText(resultJson: any): string | null {
  if (!resultJson) return null;
  try {
    const parsed = typeof resultJson === "string" ? JSON.parse(resultJson) : resultJson;
    return parsed?.responseText || parsed?.response || parsed?.content || null;
  } catch { return null; }
}

function mergeTimeline(messages: Message[], turns: Turn[], agentName: string): TimelineItem[] {
  const items: TimelineItem[] = [];

  for (const m of messages) {
    items.push({ kind: "message", data: m, sortKey: new Date(m.createdAt).getTime() });
    // Extract GenUI tool results as separate timeline items
    if (m.toolResults) {
      for (let ti = 0; ti < m.toolResults.length; ti++) {
        const tr = m.toolResults[ti];
        if (tr && typeof tr._type === "string" && getGenUIComponent(tr._type)) {
          items.push({
            kind: "genui",
            data: { id: `${m.id}-genui-${tr._type}`, toolResult: tr, toolIndex: ti, message: m, createdAt: m.createdAt },
            sortKey: new Date(m.createdAt).getTime() + 1,
          });
        }
      }
    }
  }

  // Build a set of turn time ranges that have corresponding assistant messages
  const assistantTimes = messages
    .filter((m) => (m.role || "").toLowerCase() === "assistant")
    .map((m) => new Date(m.createdAt).getTime());

  for (const t of turns) {
    const turnTime = t.startedAt ? new Date(t.startedAt).getTime() : new Date(t.createdAt).getTime();
    items.push({ kind: "turn", data: t, sortKey: turnTime });

    // Fallback: if this succeeded turn has resultJson but no assistant message nearby, show it
    if (t.status === "succeeded" && t.resultJson) {
      const finishTime = t.finishedAt ? new Date(t.finishedAt).getTime() : turnTime;
      const hasNearbyMessage = assistantTimes.some((at) => Math.abs(at - finishTime) < 10000);
      if (!hasNearbyMessage) {
        const responseText = parseResponseText(t.resultJson);
        if (responseText) {
          items.push({
            kind: "fallback-response",
            data: { turnId: t.id, content: responseText, agentName, createdAt: t.finishedAt || t.createdAt },
            sortKey: finishTime + 1,
          });
        }
      }
    }
  }

  items.sort((a, b) => a.sortKey - b.sortKey);
  return items;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Resolve turn status → color */
function getTurnStatusStyle(status: string, isDark: boolean) {
  const isSucceeded = status === "succeeded";
  const isFailed = status === "failed";
  const color = isSucceeded
    ? isDark ? "#4ade80" : "#16a34a"
    : isFailed
      ? isDark ? "#f87171" : "#dc2626"
      : isDark ? "#60a5fa" : "#3b82f6";
  return { color };
}

/** Timeline row wrapper — owns the icon column + vertical connector lines */
function TimelineRow({
  icon,
  iconBg,
  iconBorder,
  showLineAbove,
  showLineBelow,
  borderColor,
  children,
}: {
  icon: React.ReactNode;
  iconBg: string;
  iconBorder?: string;
  showLineAbove: boolean;
  showLineBelow: boolean;
  borderColor: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 12, paddingHorizontal: 16 }}>
      {/* Timeline column — icon pinned to top, line extends edge-to-edge */}
      <View style={{ width: 32, alignItems: "center", alignSelf: "stretch" }}>
        {/* Line above icon — bridges gap from previous row; spacer on first item to align with content padding */}
        {showLineAbove ? (
          <View style={{ width: 2.5, height: 12, backgroundColor: borderColor }} />
        ) : (
          <View style={{ height: 10 }} />
        )}
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: iconBg,
            ...(iconBorder ? { borderWidth: 1.5, borderColor: iconBorder } : {}),
          }}
        >
          {icon}
        </View>
        {/* Line below icon — stretches to very bottom edge of row */}
        {showLineBelow && (
          <View style={{ width: 2.5, flex: 1, backgroundColor: borderColor, marginTop: 4 }} />
        )}
      </View>
      {/* Content column — owns the vertical padding */}
      <View style={{ flex: 1, gap: 2, paddingVertical: 8 }}>
        {children}
      </View>
    </View>
  );
}

/** User message content — tap anywhere to expand when collapsed, title-only to collapse */
function UserMessageContent({ item, colors, onLinkPress }: { item: Message; colors: (typeof COLORS)["dark"]; onLinkPress?: (url: string) => void }) {
  const [expanded, setExpanded] = useState(false);

  const header = (
    <View className="flex-row items-center justify-between">
      <View className="flex-row items-center gap-1">
        <Text className="text-base font-medium">You</Text>
        {expanded
          ? <ChevronDown size={14} color={colors.mutedForeground} />
          : <ChevronRight size={14} color={colors.mutedForeground} />}
      </View>
      <Muted className="text-xs">{formatRelativeTime(item.createdAt)}</Muted>
    </View>
  );

  return (
    <>
      <Pressable onPress={() => setExpanded(expanded ? false : true)}>
        {header}
      </Pressable>
      {expanded
        ? <>
            <MarkdownMessage content={item.content} isUser={false} onLinkPress={onLinkPress} />
            {/* GenUI: render typed tool results below the text */}
            {(item.toolResults || []).map((tr: Record<string, unknown>, i: number) => {
              if (!tr || typeof tr._type !== 'string') return null;
              const Comp = getGenUIComponent(tr._type);
              if (!Comp) return null;
              return (
                <React.Suspense key={i} fallback={<Text className="text-sm text-neutral-400">Loading...</Text>}>
                  <Comp data={tr} />
                </React.Suspense>
              );
            })}
          </>
        : <Pressable onPress={() => setExpanded(true)}><Text style={{ fontSize: 16, lineHeight: 21 }} variant="muted" numberOfLines={2}>{item.content?.replace(/[#*_`]/g, "").trim()}</Text></Pressable>}
    </>
  );
}

/** Agent message content — tap anywhere to expand when collapsed, title-only to collapse */
function AgentMessageContent({ item, agentName, colors, defaultExpanded, onLinkPress }: { item: Message; agentName: string; colors: (typeof COLORS)["dark"]; defaultExpanded?: boolean; onLinkPress?: (url: string) => void }) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  const handleCopy = useCallback(() => {
    Clipboard.setStringAsync(item.content || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [item.content]);

  const artifact = item.durableArtifact;

  const header = (
    <View className="flex-row items-center justify-between">
      <View className="flex-row items-center gap-1">
        <Text className="text-base font-medium">{agentName || "Agent"}</Text>
        {expanded
          ? <ChevronDown size={14} color={colors.mutedForeground} />
          : <ChevronRight size={14} color={colors.mutedForeground} />}
      </View>
      <Muted className="text-xs">{formatRelativeTime(item.createdAt)}</Muted>
    </View>
  );

  return (
    <>
      <Pressable onPress={() => setExpanded(expanded ? false : true)}>
        {header}
      </Pressable>
      {expanded ? (
        <>
          <View className="flex-row flex-wrap items-end">
            <View className="flex-1">
              <MarkdownMessage content={item.content} isUser={false} onLinkPress={onLinkPress} />
            </View>
            <Pressable
              onPress={handleCopy}
              className="p-1 rounded-md active:opacity-70 ml-2 mb-0.5"
            >
              {copied
                ? <Check size={14} color={colors.mutedForeground} />
                : <Copy size={14} color={colors.mutedForeground} />}
            </Pressable>
          </View>
          {artifact && (
            <Pressable
              onPress={() => router.push(`/artifacts/${artifact.id}`)}
              className="flex-row items-center gap-2 mt-2 px-3 py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-800 active:opacity-70"
              style={{ backgroundColor: "rgba(255,255,255,0.03)" }}
            >
              <FileText size={16} color={colors.primary} />
              <Text className="flex-1 text-sm font-medium" style={{ color: colors.primary }} numberOfLines={1}>
                {artifact.title}
              </Text>
              <ChevronRight size={16} color={colors.mutedForeground} />
            </Pressable>
          )}
        </>
      ) : (
        <Pressable onPress={() => setExpanded(true)}>
          <Text style={{ fontSize: 16, lineHeight: 21 }} variant="muted" numberOfLines={1}>{item.content?.replace(/[#*_`]/g, "").trim()}</Text>
        </Pressable>
      )}
    </>
  );
}

/** Turn content — collapsed by default, shows details when expanded */
function TurnContent({
  item,
  isDark,
  colors,
  isAdmin,
  agentName,
  tenantId,
}: {
  item: Turn;
  isDark: boolean;
  colors: (typeof COLORS)["dark"];
  isAdmin?: boolean;
  agentName: string;
  tenantId?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const { color: stColor } = getTurnStatusStyle(item.status, isDark);
  const hasDuration = item.startedAt && item.finishedAt;
  const usage = parseUsage(item.usageJson);
  const cost = item.totalCost ? `$${item.totalCost.toFixed(2)}` : "";
  const sourceLabel = formatInvocationSource(item.triggerName || item.invocationSource);
  const title = "Thinking";

  const header = (
    <View className="flex-row items-center justify-between">
      <View className="flex-1 flex-row items-center gap-1 pr-2">
        <Text className="text-base font-medium" numberOfLines={1}>
          {title}
        </Text>
        {expanded
          ? <ChevronDown size={14} color={colors.mutedForeground} />
          : <ChevronRight size={14} color={colors.mutedForeground} />}
      </View>
      <Muted className="text-xs">{formatRelativeTime(item.createdAt)}</Muted>
    </View>
  );

  const statusLine = (
    <View className="flex-row items-center gap-2 flex-wrap">
      <Text className="text-xs capitalize" style={{ color: stColor }}>{item.status}</Text>
      {hasDuration && <Muted className="text-xs">{formatDuration(item.startedAt, item.finishedAt!)}</Muted>}
      {usage && <Muted className="text-xs">{`${(usage.inp / 1000).toFixed(1)}K → ${usage.out}`}</Muted>}
      {cost ? <Muted className="text-xs">{cost}</Muted> : null}
    </View>
  );

  return (
    <>
      <Pressable onPress={() => setExpanded(expanded ? false : true)}>
        {header}
        {sourceLabel ? <Muted className="text-xs">{sourceLabel}</Muted> : null}
        {statusLine}
      </Pressable>
      {expanded && (
        <View className="gap-2">
          {item.status !== "queued" && item.status !== "running" && (
            <TurnExecutionTimeline
              tenantId={tenantId}
              turn={item}
              expanded={expanded}
              isDark={isDark}
              colors={colors}
              agentName={agentName}
            />
          )}
          {item.status === "failed" && item.error && (
            <View className="p-2 rounded-md" style={{ backgroundColor: isDark ? "rgba(239,68,68,0.1)" : "#fef2f2" }}>
              <View className="flex-row items-start gap-1.5">
                <AlertCircle size={14} color={stColor} style={{ marginTop: 2 }} />
                <Text className="text-xs flex-1" style={{ color: stColor }}>{item.error}</Text>
              </View>
            </View>
          )}
        </View>
      )}
    </>
  );
}

/** Derive a short summary line for a GenUI tool result */
/** Icon + color config for GenUI timeline blocks */
function getGenuiIconConfig(type: string): { icon: any; color: string } {
  if (type.startsWith("opportunity")) return { icon: DollarSign, color: "#22c55e" };
  if (type.startsWith("lead")) return { icon: UserPlus, color: "#3b82f6" };
  if (type.startsWith("task")) return { icon: CheckSquare, color: "#8b5cf6" };
  if (type.startsWith("account")) return { icon: Building2, color: "#64748b" };
  if (type === "crm_mutation_result") return { icon: RefreshCw, color: "#f59e0b" };
  if (type === "question_card") return { icon: ClipboardList, color: "#0ea5e9" }; // PRD-46
  return { icon: MapPin, color: "#6366f1" }; // Places + default
}

/** Label for GenUI timeline block header */
const GENUI_LABELS: Record<string, string> = {
  place_search_results: "Places", place_list: "Places", place: "Places",
  opportunity_list: "Opportunities", opportunity: "Opportunity",
  lead_list: "Leads", lead: "Lead",
  task_list: "Tasks", task: "Task",
  account_list: "Accounts", account: "Account",
  crm_mutation_result: "Update Result",
  question_card: "Form",
};

function genuiSummary(toolResult: Record<string, unknown>): string {
  const type = String(toolResult._type || "");
  // Places
  if (type === "place_search_results") {
    const saved = (toolResult.saved_places as unknown[] || []).length;
    const discovered = (toolResult.discovered_places as unknown[] || []).length;
    const parts: string[] = [];
    if (saved) parts.push(`${saved} saved`);
    if (discovered) parts.push(`${discovered} suggestions`);
    return parts.join(", ") || "No results";
  }
  if (type === "place_list") {
    const count = (toolResult.places as unknown[] || []).length;
    return count === 0 ? "No places found" : `${count} place${count !== 1 ? "s" : ""}`;
  }
  if (type === "place") {
    const name = String(toolResult.name || "");
    const city = String(toolResult.city || "");
    return city ? `${name} — ${city}` : name;
  }
  // CRM lists
  if (type.endsWith("_list")) {
    const items = (toolResult.items as unknown[] || []);
    const count = (toolResult.count as number) || items.length;
    const entity = type.replace("_list", "");
    const plural = entity.endsWith("y") ? entity.slice(0, -1) + "ies" : entity + "s";
    if (count === 0) return `No ${plural} found`;
    return `${count} ${count !== 1 ? plural : entity}`;
  }
  // CRM detail
  if (type === "opportunity") return `${toolResult.title || ""}${toolResult.value ? ` — $${Number(toolResult.value).toLocaleString()}` : ""}`;
  if (type === "lead") return `${toolResult.title || ""}${toolResult.company ? ` — ${toolResult.company}` : ""}`;
  if (type === "task") return `#${toolResult.taskNumber || ""} ${toolResult.title || ""}`;
  if (type === "account") return String(toolResult.name || "");
  // Mutation result
  if (type === "crm_mutation_result") return String(toolResult.summary || (toolResult.success ? "Updated" : "Update failed"));
  // PRD-46: Question Card
  if (type === "question_card") {
    const schema = toolResult.schema as { title?: string; fields?: unknown[] } | undefined;
    const title = schema?.title || "Form";
    const count = Array.isArray(schema?.fields) ? schema!.fields!.length : 0;
    return count > 0 ? `${title} — ${count} field${count !== 1 ? "s" : ""}` : String(title);
  }
  return "";
}

/** Extract MCP tool info — prefer _source from tool result, fall back to metadata */
function extractToolInfo(toolResult: Record<string, unknown>, metadata: any, toolIndex: number): { server: string; tool: string; params: Record<string, unknown> } | null {
  // 1. Try _source embedded in tool result (set by AgentCore)
  const source = toolResult._source as { tool?: string; params?: Record<string, unknown> } | undefined;
  if (source?.tool) {
    const tool = source.tool;
    let server = "crm";
    if (tool.startsWith("crm_")) server = "crm";
    else if (tool.startsWith("places_") || tool === "place_detail") server = "places";
    return { server, tool, params: source.params || {} };
  }
  // 2. Fall back: if toolResult has a known _type, we know it's refreshable via the backend map
  const knownTypes = ["opportunity_list", "opportunity", "lead_list", "lead", "task_list", "task", "account_list", "account", "place_search_results", "place"];
  if (toolResult._type && knownTypes.includes(String(toolResult._type))) {
    return { server: "mapped", tool: "mapped", params: {} }; // backend handles the actual mapping
  }
  return null;
}

/** GenUI content — collapsible block for rich tool results (Places, etc.) */
function GenUIContent({ toolResult, toolIndex, message, colors, defaultExpanded, onSaveRecipe, currentUserId }: {
  toolResult: Record<string, unknown>;
  toolIndex: number;
  message: Message;
  colors: (typeof COLORS)["dark"];
  defaultExpanded?: boolean;
  onSaveRecipe?: (info: { label: string; genuiType: string; toolInfo: { server: string; tool: string; params: Record<string, unknown> }; messageId: string; threadId: string; tenantId: string }) => void;
  currentUserId?: string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? true);
  const [refreshing, setRefreshing] = useState(false);
  const [liveData, setLiveData] = useState<Record<string, unknown> | null>(null);
  const [, executeRefresh] = useMutation(RefreshGenUIMutation);

  const typeStr = String(toolResult._type || "");
  const label = GENUI_LABELS[typeStr] || typeStr.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const displayData = liveData || toolResult;
  const summary = genuiSummary(displayData);
  const refreshedAt = displayData._refreshedAt as string | undefined;

  const Comp = getGenUIComponent(String(toolResult._type));
  if (!Comp) return null;

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const result = await executeRefresh({ messageId: message.id, toolIndex });
      if (result.data?.refreshGenUI?.toolResults) {
        const results = typeof result.data.refreshGenUI.toolResults === "string"
          ? JSON.parse(result.data.refreshGenUI.toolResults)
          : result.data.refreshGenUI.toolResults;
        if (Array.isArray(results) && results[toolIndex]) {
          setLiveData(results[toolIndex]);
        }
      }
    } catch {}
    setRefreshing(false);
  };

  const handleSaveRecipe = () => {
    console.log("[GenUI] Save as Recipe pressed, onSaveRecipe:", !!onSaveRecipe, "messageId:", message.id, "tenantId:", (message as any).tenantId);
    if (!onSaveRecipe) return;
    const source = displayData._source as { tool?: string; params?: Record<string, unknown> } | undefined;
    const server = source?.tool?.startsWith("places") ? "places" : "crm";
    const tool = source?.tool || typeStr;
    const params = source?.params || {};
    onSaveRecipe({
      label,
      genuiType: typeStr,
      toolInfo: { server, tool, params },
      messageId: message.id,
      threadId: (message as any).threadId,
      tenantId: (message as any).tenantId,
    });
  };

  const hasToolInfo = !!extractToolInfo(displayData, message.metadata, toolIndex);

  return (
    <>
      <Pressable onPress={() => setExpanded(!expanded)}>
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-1">
            <Text className="text-base font-medium">{label}</Text>
            {expanded
              ? <ChevronDown size={14} color={colors.mutedForeground} />
              : <ChevronRight size={14} color={colors.mutedForeground} />}
          </View>
          {refreshedAt && (() => {
            const mins = Math.round((Date.now() - new Date(refreshedAt).getTime()) / 60000);
            const label = mins < 1 ? "just now" : mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
            return <Muted className="text-xs">{label}</Muted>;
          })()}
        </View>
        {summary ? <Muted className="text-sm mb-2">{summary}</Muted> : null}
      </Pressable>
      {expanded && (
        <View style={{ position: "relative" }}>
          {/* ... menu trigger — aligned with card header row */}
          <View style={{ position: "absolute", top: 6, right: 8, zIndex: 10 }}>
            {refreshing ? (
              <SpinningRefresh size={20} color={colors.mutedForeground} />
            ) : (
              <HeaderContextMenu
                trigger={<MoreHorizontal size={22} color={colors.mutedForeground} />}
                items={[
                  { label: "Refresh Data", icon: RefreshCw, onPress: handleRefresh },
                  ...(hasToolInfo ? [{ label: "Save as Recipe", icon: Bookmark, onPress: handleSaveRecipe }] : []),
                ]}
              />
            )}
          </View>
          <React.Suspense fallback={<Text className="text-sm text-neutral-400">Loading...</Text>}>
            <Comp
              data={displayData}
              context={{
                threadId: (message as any).threadId,
                tenantId: (message as any).tenantId,
                messageId: message.id,
                toolIndex,
                currentUserId,
              }}
            />
          </React.Suspense>
        </View>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ActivityTimeline({
  messages,
  turns,
  agentName = "Agent",
  isAdmin,
  tenantId,
  isAgentRunning,
  onScrollToEnd,
  onLinkPress,
  onSaveRecipe,
  listHeaderComponent,
  hideEmptyState,
  currentUserId,
  refreshing,
  onRefresh,
}: ActivityTimelineProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;

  const flatListRef = useRef<FlatList>(null);
  const rawTimeline = mergeTimeline(messages, turns, agentName);
  // Filter out admin-only items (turns) when user is not admin
  const timeline = isAdmin ? rawTimeline : rawTimeline.filter((t) => t.kind !== "turn");
  const prevCountRef = useRef(timeline.length);

  // Find last agent message index for auto-expand + scroll
  // When a genui block follows, scroll to the agent message (so both are visible)
  const lastAgentIndex = useMemo(() => {
    for (let i = timeline.length - 1; i >= 0; i--) {
      const item = timeline[i];
      if (item.kind === "genui") continue; // skip genui, find the agent message before it
      if (item.kind === "message" && (item.data.role || "").toLowerCase() === "assistant") return i;
      if (item.kind === "fallback-response") return i;
    }
    return -1;
  }, [timeline]);

  // Scroll to last agent message on initial mount (no animation)
  // Use a short delay so expanded content has rendered and FlatList knows item heights
  const didInitialScroll = useRef(false);
  useEffect(() => {
    if (!didInitialScroll.current && lastAgentIndex >= 0 && timeline.length > 0) {
      didInitialScroll.current = true;
      setTimeout(() => {
        try {
          flatListRef.current?.scrollToIndex({ index: lastAgentIndex, animated: false, viewPosition: 0 });
        } catch {}
      }, 150);
    }
  }, [lastAgentIndex, timeline.length]);

  // Auto-scroll to bottom when new items arrive (after initial load)
  useEffect(() => {
    if (didInitialScroll.current && timeline.length > prevCountRef.current && timeline.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
        onScrollToEnd?.();
      }, 200);
    }
    prevCountRef.current = timeline.length;
  }, [timeline.length, onScrollToEnd]);

  // Auto-scroll when agent starts running
  useEffect(() => {
    if (isAgentRunning && didInitialScroll.current) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 200);
    }
  }, [isAgentRunning]);

  const renderItem = useCallback(
    ({ item, index }: { item: TimelineItem; index: number }) => {
      const isLastAgent = index === lastAgentIndex;
      const isFirst = index === 0;
      const isLastItem = index === timeline.length - 1;

      // Determine icon, background, and optional border per item type
      let icon: React.ReactNode;
      let iconBg = "transparent";
      let iconBorder: string | undefined;

      if (item.kind === "turn") {
        const { color } = getTurnStatusStyle(item.data.status, isDark);
        icon = <Brain size={16} color={color} />;
        iconBorder = color;
      } else if (item.kind === "genui") {
        const genuiType = String(item.data.toolResult._type || "");
        const { icon: gIcon, color: gColor } = getGenuiIconConfig(genuiType);
        icon = React.createElement(gIcon, { size: 16, color: gColor });
        iconBorder = gColor;
      } else {
        const isUser =
          item.kind === "message" &&
          ((item.data.role || "").toLowerCase() === "user" || (item.data.senderType || "").toLowerCase() === "user");
        if (isUser) {
          const userColor = "#3b82f6";
          icon = <User size={16} color={userColor} />;
          iconBorder = userColor;
        } else {
          icon = <Bot size={16} color={RESPONSE_COLOR} />;
          iconBorder = RESPONSE_COLOR;
        }
      }

      // Determine content
      let content: React.ReactNode;
      if (item.kind === "genui") {
        content = <GenUIContent toolResult={item.data.toolResult} toolIndex={item.data.toolIndex} message={item.data.message} colors={colors} onSaveRecipe={onSaveRecipe} currentUserId={currentUserId} />;
      } else if (item.kind === "message") {
        const isUser = (item.data.role || "").toLowerCase() === "user" || (item.data.senderType || "").toLowerCase() === "user";
        if (isUser) content = <UserMessageContent item={item.data} colors={colors} onLinkPress={onLinkPress} />;
        else {
          // Collapse agent message by default when it has GenUI tool results (the GenUI block below shows the key content)
          const hasGenUI = (item.data.toolResults || []).some((tr: Record<string, unknown>) => tr && typeof tr._type === "string" && getGenUIComponent(tr._type));
          content = <AgentMessageContent item={item.data} agentName={agentName} colors={colors} defaultExpanded={isLastAgent && !hasGenUI} onLinkPress={onLinkPress} />;
        }
      } else if (item.kind === "fallback-response") {
        content = <AgentMessageContent item={{ id: item.data.turnId, role: "assistant", content: item.data.content, senderType: "agent", senderId: "", createdAt: item.data.createdAt }} agentName={item.data.agentName} colors={colors} defaultExpanded={isLastAgent} onLinkPress={onLinkPress} />;
      } else {
        content = <TurnContent item={item.data} isDark={isDark} colors={colors} isAdmin={isAdmin} agentName={agentName} tenantId={tenantId} />;
      }

      return (
        <TimelineRow
          icon={icon}
          iconBg={iconBg}
          iconBorder={iconBorder}
          showLineAbove={!isFirst}
          showLineBelow={!isLastItem}
          borderColor={colors.border}
        >
          {content}
        </TimelineRow>
      );
    },
    [agentName, colors, isDark, isAdmin, lastAgentIndex, onLinkPress, timeline.length, onSaveRecipe, currentUserId, tenantId],
  );

  const keyExtractor = useCallback(
    (item: TimelineItem) => {
      if (item.kind === "fallback-response") return `fallback-${item.data.turnId}`;
      return `${item.kind}-${item.data.id}`;
    },
    [],
  );


  // Always render through the FlatList so the pinned list-header element
  // (e.g. ExternalTaskCard for external-task threads) can scroll when its
  // content overflows the viewport. Empty timelines get a centered
  // "No activity yet" fallback via ListEmptyComponent. `flexGrow: 1` on the
  // contentContainerStyle lets the empty component fill the remaining
  // space when the header is short, while still allowing the list to
  // scroll when the header is tall.
  return (
    <FlatList
      ref={flatListRef}
      data={timeline}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      ListHeaderComponent={listHeaderComponent}
      ListFooterComponent={isAgentRunning ? <TypingIndicator /> : null}
      ListEmptyComponent={
        hideEmptyState ? null : (
          <View className="items-center justify-center py-12">
            <Muted>No activity yet</Muted>
          </View>
        )
      }
      contentContainerStyle={{ paddingVertical: 8, flexGrow: 1 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={!!refreshing}
            onRefresh={onRefresh}
            tintColor={colors.mutedForeground}
          />
        ) : undefined
      }
      onScrollToIndexFailed={(info) => {
        setTimeout(() => {
          try { flatListRef.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0 }); } catch {}
        }, 100);
      }}
    />
  );
}
