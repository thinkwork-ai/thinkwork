import React, {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { InteractionManager } from "react-native";
import {
  ActivityIndicator,
  View,
  FlatList,
  Pressable,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Alert,
  RefreshControl,
  TextInput,
  ScrollView,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ChevronLeft,
  ChevronRight,
  Info,
  Check,
  ListChecks,
  AlertCircle,
  Clock,
  Trash2,
  Pencil,
  RefreshCw,
} from "lucide-react-native";
import { HeaderContextMenu } from "@/components/ui/header-context-menu";
import { ShimmerText } from "@/components/ui/ShimmerText";
import {
  getExternalProviderLabel,
  getThreadHeaderLabel,
} from "@/lib/thread-display";
import { MessageInputFooter } from "@/components/input/MessageInputFooter";
import {
  QuickActionsSheet,
  type QuickActionsSheetRef,
} from "@/components/chat/QuickActionsSheet";
import {
  useQuickActions,
  type QuickAction,
} from "@/lib/hooks/use-quick-actions";
import {
  WebViewSheet,
  type WebViewSheetRef,
} from "@/components/chat/WebViewSheet";
import { useAuth } from "@/lib/auth-context";
import {
  useNewMessageSubscription,
  useThreadUpdatedSubscription,
} from "@thinkwork/react-native-sdk";
import { useTurnCompletion } from "@/lib/hooks/use-turn-completion";
import {
  useThreadReadState,
  isLocallyRead,
} from "@/lib/hooks/use-thread-read-state";
import {
  ActivityTimeline,
  type SaveRecipeInfo,
} from "@/components/threads/ActivityTimeline";
import { MarkdownMessage } from "@/components/chat/MarkdownMessage";
import {
  SaveRecipeSheet,
  type SaveRecipeSheetRef,
} from "@/components/genui/SaveRecipeSheet";
import { BrainEnrichmentReviewPanel } from "@/components/brain/BrainEnrichmentReviewPanel";
import { CreateRecipeMutation } from "@/lib/graphql-queries";
import { useAppMode } from "@/lib/hooks/use-app-mode";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { useQuery, useMutation } from "urql";
import {
  ThreadQuery,
  MeQuery,
  AgentsQuery,
  ThreadTurnsForThreadQuery,
  SendMessageMutation,
  MessagesQuery,
  UpdateThreadMutation,
  AgentWorkspaceReviewsQuery,
  AgentWorkspaceReviewQuery,
  AcceptAgentWorkspaceReviewMutation,
  CancelAgentWorkspaceReviewMutation,
  ResumeAgentWorkspaceRunMutation,
} from "@/lib/graphql-queries";
import {
  candidatesForBrainEnrichmentReview,
  isBrainEnrichmentReviewPayload,
  serializeBrainEnrichmentSelection,
} from "@/lib/brain-enrichment-review";
import {
  type WorkspaceReviewDecision,
  workspaceReviewActionsForStatus,
  workspaceReviewDecisionLabel,
  workspaceReviewDecisionToast,
  workspaceReviewErrorMessage,
} from "@/lib/workspace-review-state";

type HitlDetailTab = "review" | "thread";

function ThreadHitlPrompt({
  review,
  note,
  onChangeResponse,
  colors,
  isDark,
}: {
  review: any;
  note: string;
  onChangeResponse: (value: string) => void;
  colors: (typeof COLORS)["dark"];
  isDark: boolean;
}) {
  const proposedChanges = (review?.proposedChanges ?? []) as any[];
  const body = String(review?.reviewBody ?? "").trim();
  const reviewPayload = useMemo(() => reviewPayloadFor(review), [review]);
  const isBrainEnrichment = isBrainEnrichmentReviewPayload(reviewPayload);
  const enrichmentReviewRunId = String(review?.run?.id ?? review?.id ?? "");
  const enrichmentProposal = useMemo(
    () =>
      isBrainEnrichment
        ? {
            candidates: Array.isArray(reviewPayload.candidates)
              ? reviewPayload.candidates
              : [],
            providerStatuses: Array.isArray(reviewPayload.providerStatuses)
              ? reviewPayload.providerStatuses
              : [],
            reviewRunId: enrichmentReviewRunId,
          }
        : null,
    [enrichmentReviewRunId, isBrainEnrichment, reviewPayload],
  );
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>(
    () =>
      candidatesForBrainEnrichmentReview(enrichmentProposal).map(
        (candidate) => candidate.id,
      ),
  );

  useEffect(() => {
    if (!isBrainEnrichment) return;
    setSelectedCandidateIds(
      candidatesForBrainEnrichmentReview(enrichmentProposal).map(
        (candidate) => candidate.id,
      ),
    );
  }, [enrichmentReviewRunId, isBrainEnrichment]);

  useEffect(() => {
    if (!isBrainEnrichment) return;
    onChangeResponse(
      serializeBrainEnrichmentSelection({
        selectedCandidateIds,
        note,
      }),
    );
  }, [isBrainEnrichment, selectedCandidateIds, note, onChangeResponse]);

  return (
    <View
      className="flex-1 px-4 pt-4 pb-3"
      style={{ backgroundColor: colors.background }}
    >
      {!isBrainEnrichment ? (
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1">
            <Text
              className="text-sm font-semibold"
              style={{ color: colors.foreground }}
            >
              Agent waiting for confirmation
            </Text>
            <Muted className="text-xs" numberOfLines={1}>
              {review?.targetPath ||
                review?.run?.targetPath ||
                "Workspace review"}
            </Muted>
          </View>
        </View>
      ) : null}

      {body && !isBrainEnrichment ? (
        <Text
          className="mt-2 text-sm"
          numberOfLines={5}
          style={{ color: colors.foreground }}
        >
          {body.replace(/^#+\s*/gm, "").trim()}
        </Text>
      ) : !isBrainEnrichment && review?.reason ? (
        <Muted className="mt-2 text-sm">
          {String(review.reason).replace(/[_-]+/g, " ")}
        </Muted>
      ) : null}

      {isBrainEnrichment ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 8 }}
          showsVerticalScrollIndicator={false}
        >
          <BrainEnrichmentReviewPanel
            proposal={enrichmentProposal}
            colors={colors}
            note={note}
            onNoteChange={() => {}}
            selectedCandidateIds={selectedCandidateIds}
            onSelectedCandidateIdsChange={setSelectedCandidateIds}
            showNote={false}
          />
        </ScrollView>
      ) : proposedChanges.length > 0 ? (
        <View className="mt-3 gap-1.5">
          {proposedChanges.slice(0, 3).map((change, index) => (
            <View
              key={`${change.path ?? "change"}-${index}`}
              className="rounded-lg px-2.5 py-2"
              style={{
                backgroundColor: isDark
                  ? "rgba(255,255,255,0.06)"
                  : "rgba(255,255,255,0.72)",
              }}
            >
              <Text
                className="text-xs font-semibold"
                style={{ color: colors.foreground }}
                numberOfLines={1}
              >
                {change.path || change.kind || "Proposed change"}
              </Text>
              <Muted className="text-xs" numberOfLines={2}>
                {change.summary || "Review includes proposed workspace changes"}
              </Muted>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function parseReviewPayload(payload: unknown): any | null {
  if (!payload) return null;
  if (typeof payload === "object") return payload;
  if (typeof payload !== "string") return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function reviewPayloadFor(review: any): any | null {
  return (
    parseReviewPayload(review?.payload) ??
    parseReviewPayload(review?.latestEvent?.payload) ??
    parseReviewPayload(
      (review?.events as any[] | undefined)?.find(
        (event) => event?.eventType === "review.requested",
      )?.payload,
    )
  );
}

function brainEnrichmentCandidates(payload: any): any[] | null {
  if (payload?.kind !== "brain_enrichment_review") return null;
  return Array.isArray(payload.candidates)
    ? dedupeBrainEnrichmentCandidates(payload.candidates)
    : [];
}

function sourceFamilyLabel(sourceFamily?: string | null): string {
  if (sourceFamily === "WEB") return "Web";
  if (sourceFamily === "KNOWLEDGE_BASE") return "KB";
  return "Brain";
}

function dedupeBrainEnrichmentCandidates(candidates: any[]): any[] {
  const deduped: any[] = [];

  for (const candidate of candidates) {
    const existingIndex = deduped.findIndex((existing) =>
      areSimilarEnrichmentCandidates(existing, candidate),
    );

    if (existingIndex === -1) {
      deduped.push(candidate);
      continue;
    }

    const existingScore = Number(deduped[existingIndex]?.score ?? 0);
    const candidateScore = Number(candidate?.score ?? 0);
    if (candidateScore > existingScore) deduped[existingIndex] = candidate;
  }

  return deduped;
}

function areSimilarEnrichmentCandidates(a: any, b: any): boolean {
  const titleA = normalizeCandidateText(String(a?.title ?? ""));
  const titleB = normalizeCandidateText(String(b?.title ?? ""));
  if (!titleA || titleA !== titleB) return false;

  const summaryA = normalizeCandidateText(String(a?.summary ?? ""));
  const summaryB = normalizeCandidateText(String(b?.summary ?? ""));
  if (!summaryA || !summaryB) return false;
  if (summaryA === summaryB) return true;

  return candidateTokenSimilarity(summaryA, summaryB) >= 0.88;
}

function normalizeCandidateText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+\|\s*(involving|when|where|source|sources):.*$/i, "")
    .replace(/[*_`#>[\](){}]/g, " ")
    .replace(/[^a-z0-9'\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function candidateTokenSimilarity(a: string, b: string): number {
  const aTokens = new Set(tokensForCandidateSimilarity(a));
  const bTokens = new Set(tokensForCandidateSimilarity(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection += 1;
  }

  const union = new Set([...aTokens, ...bTokens]).size;
  const jaccard = intersection / union;
  const containment = intersection / Math.min(aTokens.size, bTokens.size);
  return Math.max(jaccard, containment);
}

function tokensForCandidateSimilarity(value: string): string[] {
  return value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

function ThreadHitlTabs({
  value,
  onChange,
  colors,
  isDark,
}: {
  value: HitlDetailTab;
  onChange: (next: HitlDetailTab) => void;
  colors: (typeof COLORS)["dark"];
  isDark: boolean;
}) {
  return (
    <View
      className="items-center justify-center border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
      style={{
        height: 52,
        paddingBottom: 8,
      }}
    >
      <View
        className="flex-row rounded-full"
        style={{ backgroundColor: colors.secondary, padding: 2 }}
      >
        {(["review", "thread"] as const).map((tab) => {
          const selected = value === tab;
          return (
            <Pressable
              key={tab}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => onChange(tab)}
              className="flex-row items-center justify-center rounded-full"
              style={{
                minWidth: 96,
                paddingHorizontal: 16,
                paddingVertical: 5,
                backgroundColor: selected
                  ? isDark
                    ? "#525252"
                    : "#ffffff"
                  : "transparent",
              }}
            >
              <Text
                className="text-sm font-semibold"
                style={{
                  color: selected ? colors.foreground : colors.mutedForeground,
                }}
              >
                {tab === "review" ? "Review" : "Thread"}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ReviewActionButton({
  label,
  decision,
  pendingDecision,
  onPress,
  tone,
}: {
  label: string;
  decision: WorkspaceReviewDecision;
  pendingDecision: WorkspaceReviewDecision | null;
  onPress: (decision: WorkspaceReviewDecision) => void;
  tone: "primary" | "neutral" | "danger";
}) {
  const disabled = pendingDecision !== null;
  const backgroundColor =
    tone === "primary"
      ? "#16a34a"
      : tone === "danger"
        ? "#dc2626"
        : "transparent";
  const borderColor =
    tone === "primary" ? "#16a34a" : tone === "danger" ? "#dc2626" : "#a3a3a3";
  const color = tone === "neutral" ? "#737373" : "#ffffff";

  return (
    <Pressable
      onPress={() => onPress(decision)}
      disabled={disabled}
      className="min-h-[36px] flex-1 items-center justify-center rounded-lg border px-2"
      style={{ backgroundColor, borderColor, opacity: disabled ? 0.65 : 1 }}
    >
      {pendingDecision === decision ? (
        <ActivityIndicator color={color} size="small" />
      ) : (
        <Text
          className="text-xs font-semibold"
          style={{ color }}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function ThreadHitlReviewFooter({
  review,
  note,
  onChangeNote,
  onDecide,
  pendingDecision,
  colors,
}: {
  review: any;
  note: string;
  onChangeNote: (value: string) => void;
  onDecide: (decision: WorkspaceReviewDecision) => void;
  pendingDecision: WorkspaceReviewDecision | null;
  colors: (typeof COLORS)["dark"];
}) {
  const insets = useSafeAreaInsets();
  const actions = workspaceReviewActionsForStatus(review?.run?.status);
  const isBrainEnrichment =
    reviewPayloadFor(review)?.kind === "brain_enrichment_review";
  const showResume = actions.resume && !isBrainEnrichment;

  return (
    <View
      className="border-t border-neutral-200 bg-neutral-100 px-4 pt-3 dark:border-neutral-800 dark:bg-neutral-900"
      style={{
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        overflow: "hidden",
        paddingBottom: insets.bottom || 8,
      }}
    >
      <TextInput
        value={note}
        onChangeText={onChangeNote}
        placeholder="Optional note for the agent..."
        placeholderTextColor={colors.mutedForeground}
        multiline
        className="max-h-[96px]"
        style={{
          color: colors.foreground,
          fontSize: 18,
          lineHeight: 24,
          paddingTop: 4,
          paddingBottom: 4,
        }}
        returnKeyType="default"
        blurOnSubmit={false}
      />

      <View className="flex-row gap-2 pt-3 pb-2">
        {actions.accept ? (
          <ReviewActionButton
            label={workspaceReviewDecisionLabel("accept")}
            decision="accept"
            pendingDecision={pendingDecision}
            onPress={onDecide}
            tone="primary"
          />
        ) : null}
        {showResume ? (
          <ReviewActionButton
            label={workspaceReviewDecisionLabel("resume")}
            decision="resume"
            pendingDecision={pendingDecision}
            onPress={onDecide}
            tone="neutral"
          />
        ) : null}
        {actions.cancel ? (
          <ReviewActionButton
            label={workspaceReviewDecisionLabel("cancel")}
            decision="cancel"
            pendingDecision={pendingDecision}
            onPress={onDecide}
            tone="danger"
          />
        ) : null}
      </View>
    </View>
  );
}

function LoadingTitle() {
  const [dots, setDots] = useState("");
  useEffect(() => {
    const iv = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "" : d + "."));
    }, 350);
    return () => clearInterval(iv);
  }, []);
  return <Text className="text-lg font-semibold">{`Loading${dots}`}</Text>;
}

export default function ThreadDetailRoute() {
  const { threadId, title: initialTitle } = useLocalSearchParams<{
    threadId: string;
    title?: string;
  }>();
  const router = useRouter();
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const { isThreadActive, markThreadActive, clearThreadActive } =
    useTurnCompletion(tenantId);
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const insets = useSafeAreaInsets();

  // Defer queries by one frame to avoid setState-during-render with URQL shared cache
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() =>
      setMounted(true),
    );
    return () => handle.cancel();
  }, []);

  const [{ data: meData }] = useQuery({ query: MeQuery, pause: !mounted });
  const currentUser = (meData as any)?.me;

  const { isAdmin } = useAppMode();
  const [{ data: agentsData }] = useQuery({
    query: AgentsQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId || !mounted,
  });
  const agentMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of (agentsData?.agents ?? []) as any[]) {
      map[a.id] = a.name || "Agent";
    }
    return map;
  }, [agentsData?.agents]);

  // ── Thread data ──
  const [{ data: threadData, fetching: fetchingThread }, reexecuteThread] =
    useQuery({
      query: ThreadQuery,
      variables: { id: threadId! },
      pause: !threadId,
    });
  const thread = threadData?.thread as any;
  const agentName = thread?.agentId
    ? agentMap[thread.agentId] || "Agent"
    : "Agent";

  // ── Messages (separate query to include toolResults for GenUI) ──
  const [
    { data: messagesData, fetching: fetchingMessages },
    reexecuteMessages,
  ] = useQuery({
    query: MessagesQuery,
    variables: { threadId: threadId!, limit: 100 },
    pause: !threadId,
  });
  // Raw messages (post toolResults parse, pre role-filter). We derive two
  // arrays from this: `messages` for the chat timeline (user+assistant only)
  // and `activityRows` for the ExternalTaskCard's activity_list block (system
  // rows emitted by the webhook ingest pipeline, PR #75). The chat timeline
  // stays chat-only — system audit rows live on the task card, not in the
  // agent message history.
  const rawMessages = useMemo(() => {
    const edges = (messagesData?.messages?.edges ?? []) as any[];
    return edges.map((e: any) => {
      const m = e.node;
      // Parse toolResults for GenUI rendering
      let toolResults = null;
      if (m.toolResults) {
        try {
          const parsed =
            typeof m.toolResults === "string"
              ? JSON.parse(m.toolResults)
              : m.toolResults;
          if (Array.isArray(parsed) && parsed.length > 0) toolResults = parsed;
        } catch {}
      }
      return { ...m, toolResults };
    });
  }, [messagesData]);

  const messages = useMemo(() => {
    return rawMessages.filter((m: any) => {
      const role = (m.role || "").toLowerCase();
      return role === "user" || role === "assistant";
    });
  }, [rawMessages]);

  // Pre-filter webhook audit rows for the task card's activity_list block.
  // The server-side ingest (PR #75) inserts these as role=system messages
  // with metadata.kind="external_task_event" and human-readable content.
  const activityRows = useMemo(() => {
    return rawMessages
      .filter((m: any) => {
        const role = (m.role || "").toLowerCase();
        if (role !== "system") return false;
        const kind = (m.metadata as Record<string, unknown> | null | undefined)
          ?.kind;
        return kind === "external_task_event";
      })
      .map((m: any) => ({
        id: String(m.id),
        content: String(m.content ?? ""),
        createdAt: String(m.createdAt ?? ""),
      }));
  }, [rawMessages]);

  // ── Turns ──
  const [{ data: turnsData, fetching: fetchingTurns }, reexecuteTurns] =
    useQuery({
      query: ThreadTurnsForThreadQuery,
      variables: { tenantId: tenantId!, threadId: threadId!, limit: 50 },
      pause: !threadId || !tenantId,
    });
  const turns = (turnsData?.threadTurns ?? []) as any[];
  const hasRunningTurn = turns.some((t: any) => t.status === "running");
  // Scope reviews to the calling user — the resolver chain-walks
  // `parent_agent_id` so a sub-agent review whose chain resolves to this
  // user surfaces here (in the parent agent's thread). Pause until both
  // tenantId and the resolved user id are known.
  const callerUserId = currentUser?.id ?? null;
  const [
    { data: reviewListData, fetching: fetchingReviews },
    reexecuteReviews,
  ] = useQuery({
    query: AgentWorkspaceReviewsQuery,
    variables: {
      tenantId: tenantId!,
      responsibleUserId: callerUserId!,
      status: "awaiting_review",
      limit: 50,
    },
    pause: !threadId || !tenantId || !callerUserId,
  });
  const pendingReview = useMemo(() => {
    return ((reviewListData?.agentWorkspaceReviews ?? []) as any[]).find(
      (review) => review.threadId === threadId,
    );
  }, [reviewListData?.agentWorkspaceReviews, threadId]);
  const pendingReviewRunId = pendingReview?.run?.id as string | undefined;
  const [
    { data: reviewDetailData, fetching: fetchingReviewDetail },
    reexecuteReviewDetail,
  ] = useQuery({
    query: AgentWorkspaceReviewQuery,
    variables: { runId: pendingReviewRunId! },
    pause: !pendingReviewRunId,
  });
  const refreshReviewDetail = useCallback(() => {
    if (!pendingReviewRunId) return;
    reexecuteReviewDetail({ requestPolicy: "network-only" });
  }, [pendingReviewRunId, reexecuteReviewDetail]);
  const reviewDetail = (reviewDetailData?.agentWorkspaceReview ??
    pendingReview) as any | null;
  const [reviewResponse, setReviewResponse] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [hitlTab, setHitlTab] = useState<HitlDetailTab>("review");
  const previousReviewRunIdRef = useRef<string | undefined>(undefined);
  const [pendingDecision, setPendingDecision] =
    useState<WorkspaceReviewDecision | null>(null);
  const [, executeAcceptReview] = useMutation(
    AcceptAgentWorkspaceReviewMutation,
  );
  const [, executeCancelReview] = useMutation(
    CancelAgentWorkspaceReviewMutation,
  );
  const [, executeResumeReview] = useMutation(ResumeAgentWorkspaceRunMutation);

  useEffect(() => {
    if (!pendingReviewRunId) {
      previousReviewRunIdRef.current = undefined;
      setHitlTab("thread");
      setReviewNote("");
      setReviewResponse("");
      return;
    }

    if (previousReviewRunIdRef.current === pendingReviewRunId) return;
    previousReviewRunIdRef.current = pendingReviewRunId;
    setHitlTab("review");
    setReviewNote("");
    setReviewResponse("");
  }, [pendingReviewRunId]);

  // Continuously poll messages/turns while the screen is mounted. Fast cadence
  // while a turn is running, slower cadence when idle — the idle poll is a
  // safety net for cases where the new-message subscription drops an event
  // (WebSocket hiccup) or where the final assistant message lands a beat after
  // the turn flips to `succeeded` (so the running-only poll would have
  // stopped too early and left the tail message missing).
  useEffect(() => {
    if (!threadId) return;
    const delay = hasRunningTurn ? 3000 : 8000;
    const interval = setInterval(() => {
      reexecuteTurns({ requestPolicy: "network-only" });
      reexecuteThread({ requestPolicy: "network-only" });
      reexecuteMessages({ requestPolicy: "network-only" });
      reexecuteReviews({ requestPolicy: "network-only" });
      refreshReviewDetail();
    }, delay);
    return () => clearInterval(interval);
  }, [
    threadId,
    hasRunningTurn,
    reexecuteTurns,
    reexecuteThread,
    reexecuteMessages,
    reexecuteReviews,
    refreshReviewDetail,
  ]);

  // Refresh whenever the screen gains focus — covers returning to the thread
  // from info/details and app foregrounding.
  useFocusEffect(
    useCallback(() => {
      if (!threadId) return;
      reexecuteThread({ requestPolicy: "network-only" });
      reexecuteMessages({ requestPolicy: "network-only" });
      reexecuteTurns({ requestPolicy: "network-only" });
      reexecuteReviews({ requestPolicy: "network-only" });
      refreshReviewDetail();
    }, [
      threadId,
      reexecuteThread,
      reexecuteMessages,
      reexecuteTurns,
      reexecuteReviews,
      refreshReviewDetail,
    ]),
  );

  // ── Subscriptions (deferred to avoid setState-during-render warnings) ──
  const [{ data: threadEvent }] = useThreadUpdatedSubscription(tenantId);
  useEffect(() => {
    if (threadEvent?.onThreadUpdated?.threadId === threadId) {
      setTimeout(() => {
        reexecuteThread({ requestPolicy: "network-only" });
        reexecuteTurns({ requestPolicy: "network-only" });
        reexecuteMessages({ requestPolicy: "network-only" });
        reexecuteReviews({ requestPolicy: "network-only" });
        refreshReviewDetail();
      }, 0);
    }
  }, [
    threadEvent?.onThreadUpdated?.updatedAt,
    reexecuteThread,
    reexecuteTurns,
    reexecuteMessages,
    reexecuteReviews,
    refreshReviewDetail,
  ]);

  const [{ data: msgEvent }] = useNewMessageSubscription(threadId);
  useEffect(() => {
    if (msgEvent?.onNewMessage) {
      setTimeout(() => {
        reexecuteThread({ requestPolicy: "network-only" });
        reexecuteMessages({ requestPolicy: "network-only" });
      }, 0);
      if (threadId && msgEvent.onNewMessage.role === "assistant") {
        clearThreadActive(threadId);
      }
    }
  }, [msgEvent?.onNewMessage?.messageId]);

  // ── Read state ──
  // The list-row tap already fires markRead (instant optimistic + server
  // mutation), so on mount we skip the redundant mutation when the row
  // was already locally marked. Without this guard, firing updateThread
  // here invalidates our own ThreadQuery via urql's document cache and
  // shows a brief "loading…" flash after the card first appears.
  // Deep-link / fresh-session entries still fire the mutation because
  // `isLocallyRead` returns false for them.
  const { markRead } = useThreadReadState();
  useEffect(() => {
    if (!threadId) return;
    if (isLocallyRead(threadId)) return;
    setTimeout(() => markRead(threadId), 0);
  }, [threadId]);
  useEffect(() => {
    if (threadEvent?.onThreadUpdated?.threadId === threadId) {
      setTimeout(() => markRead(threadId!), 0);
    }
  }, [threadEvent?.onThreadUpdated?.updatedAt]);

  const [, executeUpdateThread] = useMutation(UpdateThreadMutation);
  const isTask = false;
  const hasExternalTask = false;
  const isPreSyncExternalTask = false;
  const externalProviderLabel: string | null = null;
  const useTaskFlatList = false;
  const visibleMessages = messages;
  const visibleTurns = turns;

  const quickActionsRef = useRef<QuickActionsSheetRef>(null);
  const webViewSheetRef = useRef<WebViewSheetRef>(null);
  const saveRecipeRef = useRef<SaveRecipeSheetRef>(null);
  const pendingRecipeRef = useRef<SaveRecipeInfo | null>(null);
  const [, executeCreateRecipe] = useMutation(CreateRecipeMutation);

  const handleSaveRecipe = useCallback((info: SaveRecipeInfo) => {
    console.log(
      "[ThreadDetail] handleSaveRecipe called:",
      info.label,
      "sheetRef:",
      !!saveRecipeRef.current,
    );
    pendingRecipeRef.current = info;
    saveRecipeRef.current?.present({ title: info.label });
  }, []);

  const handleSaveRecipeConfirm = useCallback(
    async (data: { title: string; summary: string }) => {
      const info = pendingRecipeRef.current;
      if (!info) return;
      await executeCreateRecipe({
        input: {
          tenantId: info.tenantId,
          threadId: info.threadId,
          title: data.title,
          summary: data.summary || null,
          server: info.toolInfo.server,
          tool: info.toolInfo.tool,
          params: JSON.stringify(info.toolInfo.params),
          genuiType: info.genuiType,
          sourceMessageId: info.messageId,
        },
      });
      pendingRecipeRef.current = null;
    },
    [executeCreateRecipe],
  );

  // Quick Actions (per-user, from DB) — defer until mounted to avoid setState-during-render
  const [{ data: qaData }] = useQuickActions(mounted ? tenantId : undefined);
  const quickActions: QuickAction[] = (qaData?.userQuickActions ??
    []) as QuickAction[];

  const handleLinkPress = useCallback((url: string) => {
    if (webViewSheetRef.current) {
      webViewSheetRef.current.open(url);
    } else {
      import("react-native").then(({ Linking }) =>
        Linking.openURL(url).catch(() => null),
      );
    }
  }, []);

  // ── Pull-to-refresh ──
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const handleRefresh = useCallback(() => {
    if (!threadId) return;
    setPullRefreshing(true);
    reexecuteThread({ requestPolicy: "network-only" });
    reexecuteMessages({ requestPolicy: "network-only" });
    reexecuteTurns({ requestPolicy: "network-only" });
    reexecuteReviews({ requestPolicy: "network-only" });
    refreshReviewDetail();
  }, [
    threadId,
    reexecuteThread,
    reexecuteMessages,
    reexecuteTurns,
    reexecuteReviews,
    refreshReviewDetail,
  ]);
  useEffect(() => {
    if (
      pullRefreshing &&
      !fetchingThread &&
      !fetchingMessages &&
      !fetchingTurns
    ) {
      setPullRefreshing(false);
    }
  }, [
    pullRefreshing,
    fetchingThread,
    fetchingMessages,
    fetchingTurns,
    fetchingReviews,
    fetchingReviewDetail,
  ]);

  const handleReviewDecision = useCallback(
    async (decision: WorkspaceReviewDecision) => {
      if (!pendingReviewRunId) return;
      setPendingDecision(decision);
      try {
        const isBrainEnrichmentReview =
          reviewPayloadFor(reviewDetail)?.kind === "brain_enrichment_review";
        const input = {
          idempotencyKey: `mobile-${pendingReviewRunId}-${decision}-${Date.now()}`,
          expectedReviewEtag:
            reviewDetail?.reviewEtag ?? pendingReview?.reviewEtag ?? null,
          responseMarkdown: reviewResponse.trim() || null,
        };
        const result =
          decision === "accept"
            ? await executeAcceptReview({ runId: pendingReviewRunId, input })
            : decision === "cancel"
              ? await executeCancelReview({ runId: pendingReviewRunId, input })
              : await executeResumeReview({ runId: pendingReviewRunId, input });

        if (result.error) throw result.error;
        setReviewResponse("");
        setReviewNote("");
        if (isBrainEnrichmentReview && threadId) {
          clearThreadActive(threadId);
        } else if (decision !== "cancel" && threadId) {
          markThreadActive(threadId);
        }
        reexecuteReviews({ requestPolicy: "network-only" });
        refreshReviewDetail();
        reexecuteThread({ requestPolicy: "network-only" });
        reexecuteTurns({ requestPolicy: "network-only" });
        reexecuteMessages({ requestPolicy: "network-only" });
        Alert.alert(
          "Done",
          isBrainEnrichmentReview
            ? decision === "accept"
              ? "Brain enrichment applied"
              : decision === "cancel"
                ? "Brain enrichment rejected"
                : "Brain enrichment review resumed"
            : workspaceReviewDecisionToast(decision),
        );
      } catch (error: any) {
        Alert.alert(
          "Could not update review",
          workspaceReviewErrorMessage(error?.message ?? String(error)),
        );
      } finally {
        setPendingDecision(null);
      }
    },
    [
      pendingReviewRunId,
      reviewDetail?.reviewEtag,
      pendingReview?.reviewEtag,
      reviewDetail,
      reviewResponse,
      executeAcceptReview,
      executeCancelReview,
      executeResumeReview,
      threadId,
      markThreadActive,
      clearThreadActive,
      reexecuteReviews,
      refreshReviewDetail,
      reexecuteThread,
      reexecuteTurns,
      reexecuteMessages,
    ],
  );

  const handleReviewNoteChange = useCallback(
    (value: string) => {
      setReviewNote(value);
      if (reviewPayloadFor(reviewDetail)?.kind !== "brain_enrichment_review") {
        setReviewResponse(value);
      }
    },
    [reviewDetail],
  );

  // ── Send message ──
  const [messageText, setMessageText] = useState("");
  const [, executeSendMessage] = useMutation(SendMessageMutation);

  const handleSend = useCallback(async () => {
    const text = messageText.trim();
    if (!text || !threadId) return;
    setMessageText("");
    Keyboard.dismiss();
    await executeSendMessage({
      input: {
        threadId: threadId,
        role: "USER" as any,
        content: text,
        senderType: "human",
        senderId: currentUser?.id,
      },
    });
    markThreadActive(threadId);
    // Re-fetch immediately so the new message appears and auto-scroll kicks in
    reexecuteThread({ requestPolicy: "network-only" });
    reexecuteMessages({ requestPolicy: "network-only" });
    reexecuteTurns({ requestPolicy: "network-only" });
  }, [
    messageText,
    threadId,
    currentUser?.id,
    executeSendMessage,
    reexecuteThread,
    reexecuteMessages,
    reexecuteTurns,
    markThreadActive,
  ]);

  // Don't render stale content — wait until the correct thread is loaded
  const isLoaded = thread && thread.id === threadId;
  const showsReviewTabs = isLoaded && Boolean(reviewDetail);
  const showingReviewForm = showsReviewTabs && hitlTab === "review";

  if (!threadId) return <View className="flex-1 bg-white dark:bg-black" />;

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: isDark ? "#171717" : "#f5f5f5" }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View
        style={
          showsReviewTabs
            ? { paddingTop: insets.top }
            : { paddingTop: insets.top, backgroundColor: colors.background }
        }
        className={
          showsReviewTabs
            ? "bg-white dark:bg-neutral-950"
            : "border-b border-neutral-200 dark:border-neutral-800"
        }
      >
        <View
          className="flex-row items-center justify-between pl-2 pr-4"
          style={{ height: 48 }}
        >
          {/* Left: back + title */}
          <Pressable
            onPress={() =>
              router.canGoBack() ? router.back() : router.replace("/")
            }
            className="flex-row items-center gap-1.5 active:opacity-70 flex-shrink"
            style={{ maxWidth: useTaskFlatList ? "65%" : "80%" }}
          >
            <ChevronLeft size={24} color={colors.foreground} />
            {isLoaded ? (
              <Text className="text-lg font-semibold" numberOfLines={1}>
                {hasExternalTask && externalProviderLabel
                  ? externalProviderLabel
                  : thread.title}
              </Text>
            ) : initialTitle ? (
              <Text className="text-lg font-semibold" numberOfLines={1}>
                {initialTitle}
              </Text>
            ) : (
              <LoadingTitle />
            )}
          </Pressable>

          {/* Right actions */}
          {isLoaded && (
            <View className="flex-row items-center gap-2">
              <HeaderContextMenu
                items={[
                  {
                    label: "Thread Info",
                    icon: Info,
                    onPress: () => router.push(`/thread/${threadId}/info`),
                  },
                  {
                    label: "Delete Thread",
                    icon: Trash2,
                    destructive: true,
                    separator: true,
                    onPress: () => {
                      Alert.alert(
                        "Delete Thread?",
                        "This action cannot be undone.",
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Delete",
                            style: "destructive",
                            onPress: async () => {
                              try {
                                await executeUpdateThread({
                                  id: threadId,
                                  input: {
                                    archivedAt: new Date().toISOString(),
                                  },
                                });
                                if (router.canGoBack()) router.back();
                                else router.replace("/");
                              } catch (e) {
                                console.error(
                                  "[ThreadDetail] Delete failed:",
                                  e,
                                );
                                Alert.alert(
                                  "Error",
                                  "Failed to delete. Please try again.",
                                );
                              }
                            },
                          },
                        ],
                      );
                    },
                  },
                ]}
              />
            </View>
          )}
        </View>
      </View>

      {showsReviewTabs ? (
        <ThreadHitlTabs
          value={hitlTab}
          onChange={setHitlTab}
          colors={colors}
          isDark={isDark}
        />
      ) : null}

      {/* Content area */}
      <View className="flex-1" style={{ backgroundColor: colors.background }}>
        {isLoaded ? (
          reviewDetail && hitlTab === "review" ? (
            <ThreadHitlPrompt
              review={reviewDetail}
              note={reviewNote}
              onChangeResponse={setReviewResponse}
              colors={colors}
              isDark={isDark}
            />
          ) : (
            <ActivityTimeline
              key={threadId}
              messages={visibleMessages}
              turns={visibleTurns}
              agentName={agentName}
              isAdmin={isAdmin}
              tenantId={tenantId}
              isAgentRunning={!!threadId && isThreadActive(threadId)}
              onLinkPress={handleLinkPress}
              onSaveRecipe={handleSaveRecipe}
              refreshing={pullRefreshing}
              onRefresh={handleRefresh}
              currentUserId={currentUser?.id}
            />
          )
        ) : (
          <View className="flex-1 items-center justify-center">
            <ShimmerText
              text="loading…"
              fontSize={12}
              lineHeight={16}
              fontFamily={Platform.OS === "ios" ? "Menlo" : "monospace"}
              dimColor={isDark ? "#525252" : "#a3a3a3"}
              brightColor={isDark ? "#a3a3a3" : "#525252"}
            />
          </View>
        )}
      </View>

      {/* Footer input */}
      {showingReviewForm && reviewDetail ? (
        <ThreadHitlReviewFooter
          review={reviewDetail}
          note={reviewNote}
          onChangeNote={handleReviewNoteChange}
          onDecide={handleReviewDecision}
          pendingDecision={pendingDecision}
          colors={colors}
        />
      ) : (
        <MessageInputFooter
          value={messageText}
          onChangeText={setMessageText}
          onSubmit={handleSend}
          placeholder="Message..."
          colors={colors}
          isDark={isDark}
          onQuickActions={() => quickActionsRef.current?.present()}
        />
      )}

      {/* Quick Actions Bottom Sheet */}
      <QuickActionsSheet
        ref={quickActionsRef}
        actions={quickActions}
        onSelect={(action) => {
          quickActionsRef.current?.dismiss();
          setMessageText(action.prompt);
          // Auto-send after a brief delay to let state update
          setTimeout(() => {
            const text = action.prompt.trim();
            if (text && threadId) {
              setMessageText("");
              Keyboard.dismiss();
              executeSendMessage({
                input: {
                  threadId: threadId,
                  role: "USER" as any,
                  content: text,
                  senderType: "human",
                  senderId: currentUser?.id,
                },
              }).then(() => {
                markThreadActive(threadId);
                reexecuteThread({ requestPolicy: "network-only" });
                reexecuteMessages({ requestPolicy: "network-only" });
                reexecuteTurns({ requestPolicy: "network-only" });
              });
            }
          }, 50);
        }}
        onLongPress={(action) => {
          quickActionsRef.current?.dismiss();
          setMessageText(action.prompt);
        }}
        onAdd={() => {
          quickActionsRef.current?.dismiss();
        }}
      />

      {/* WebView for in-app link viewing */}
      <WebViewSheet ref={webViewSheetRef} />

      {/* Save as Recipe bottom sheet */}
      <SaveRecipeSheet ref={saveRecipeRef} onSave={handleSaveRecipeConfirm} />
    </KeyboardAvoidingView>
  );
}
