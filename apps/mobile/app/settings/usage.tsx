import { View, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { useColorScheme } from "nativewind";
import { DetailLayout } from "@/components/layout/detail-layout";
import { RefreshCw, ChevronDown, ChevronUp } from "lucide-react-native";
import { COLORS } from "@/lib/theme";
import { useState } from "react";
import { Text, Muted } from "@/components/ui/typography";
import { useIsLargeScreen } from "@/lib/hooks/use-media-query";
import { WebContent } from "@/components/layout/web-content";
import { HeaderContextMenu } from "@/components/ui/header-context-menu";

// TODO: Replace with GraphQL query for usage summary
// Previously: useQuery(api.usage.getUsageSummary, { tzOffsetMinutes })

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatCost(cost: number): string {
  if (cost <= 0) return "$0.0000";
  return `$${cost.toFixed(4)}`;
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function BarSegment({ pct, total }: { pct: number; total: number }) {
  const width = Math.max(2, Math.round(pct));
  return (
    <View className="h-2 rounded-full bg-sky-500 dark:bg-sky-400" style={{ flex: pct / 100, minWidth: 2, maxWidth: `${width}%` }} />
  );
}

interface ModelRowProps {
  model: string;
  tokens: number;
  totalTokens: number;
  cost: number;
  isLast?: boolean;
}

function ModelRow({ model, tokens, totalTokens, cost, isLast }: ModelRowProps) {
  const pct = totalTokens > 0 ? (tokens / totalTokens) * 100 : 0;
  const displayModel = model.split("/").pop() ?? model; // strip provider prefix
  return (
    <View className={`py-3 ${isLast ? "" : "border-b border-neutral-200 dark:border-neutral-800"}`}>
      <View className="flex-row justify-between items-center mb-1.5">
        <Text className="text-sm font-medium text-neutral-800 dark:text-neutral-200 flex-1 mr-4" numberOfLines={1}>
          {displayModel}
        </Text>
        <Text className="text-sm text-neutral-600 dark:text-neutral-400">
          {formatNumber(tokens)} tokens
        </Text>
      </View>
      {/* Bar */}
      <View className="flex-row h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
        <View
          className="h-1.5 rounded-full bg-sky-500 dark:bg-sky-400"
          style={{ width: `${Math.max(1, pct)}%` }}
        />
      </View>
      <View className="flex-row justify-between mt-1">
        <Muted className="text-xs">{pct.toFixed(1)}%</Muted>
        {cost > 0 && <Muted className="text-xs">{formatCost(cost)}</Muted>}
      </View>
    </View>
  );
}

interface DayRowProps {
  date: string;
  tokens: number;
  maxTokens: number;
  isLast?: boolean;
}

function DayRow({ date, tokens, maxTokens, isLast }: DayRowProps) {
  const pct = maxTokens > 0 ? (tokens / maxTokens) * 100 : 0;
  return (
    <View className={`py-3 ${isLast ? "" : "border-b border-neutral-200 dark:border-neutral-800"}`}>
      <View className="flex-row justify-between items-center mb-1.5">
        <Text className="text-sm text-neutral-600 dark:text-neutral-400">{formatDate(date)}</Text>
        <Text className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {formatNumber(tokens)}
        </Text>
      </View>
      <View className="flex-row h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
        <View
          className="h-1.5 rounded-full bg-sky-500 dark:bg-sky-400"
          style={{ width: `${Math.max(tokens > 0 ? 1 : 0, pct)}%` }}
        />
      </View>
    </View>
  );
}

export default function UsageScreen() {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const isLargeScreen = useIsLargeScreen();

  // TODO: Replace with GraphQL query for usage summary
  const summary: any = undefined;

  const [syncing, setSyncing] = useState(false);
  const [byModelExpanded, setByModelExpanded] = useState(true);
  const [byDayExpanded, setByDayExpanded] = useState(true);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch("https://api.thinkwork.ai/usage-sync", {
        method: "POST",
      });
      // Give the backend a moment to process the inserted records
      await new Promise((r) => setTimeout(r, 1000));
    } catch (e) {
      console.warn("[Usage] sync failed:", e);
    }
    setSyncing(false);
  };

  const isLoading = summary === undefined;

  const maxDayTokens = summary
    ? Math.max(1, ...summary.byDay.map((d: any) => d.tokens))
    : 1;

  const content = (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ paddingBottom: 32 }}
    >
      <WebContent>
        <View className="mt-4 px-4">
          {isLoading ? (
            <View className="items-center justify-center py-16">
              <ActivityIndicator size="large" color="#0ea5e9" />
              <Muted className="mt-3">Loading usage data…</Muted>
            </View>
          ) : summary === null ? (
            <View className="items-center justify-center py-16">
              <Muted>Sign in to view usage</Muted>
            </View>
          ) : (
            <>
              {/* Hero — total tokens */}
              <View className="rounded-lg border border-neutral-200 dark:border-neutral-800 px-5 py-6 mb-4 items-center">
                <Text className="text-5xl font-bold text-neutral-900 dark:text-neutral-100">
                  {formatNumber(summary.totalTokens)}
                </Text>
                <Muted className="mt-1 text-sm">total tokens used</Muted>
                {summary.totalCost > 0 && (
                  <View className="mt-3 px-3 py-1 rounded-full border border-sky-500 bg-transparent">
                    <Text className="text-sm text-sky-400 font-medium">
                      {formatCost(summary.totalCost)} estimated cost
                    </Text>
                  </View>
                )}
                {/* Prompt / Completion breakdown */}
                {summary.totalTokens > 0 && (
                  <View className="mt-4 flex-row gap-6">
                    <View className="items-center">
                      <Text className="text-lg font-semibold text-neutral-800 dark:text-neutral-200">
                        {formatNumber(summary.totalPromptTokens)}
                      </Text>
                      <Muted className="text-xs">prompt</Muted>
                    </View>
                    <View className="items-center">
                      <Text className="text-lg font-semibold text-neutral-800 dark:text-neutral-200">
                        {formatNumber(summary.totalCompletionTokens)}
                      </Text>
                      <Muted className="text-xs">completion</Muted>
                    </View>
                    <View className="items-center">
                      <Text className="text-lg font-semibold text-neutral-800 dark:text-neutral-200">
                        {summary.recordCount}
                      </Text>
                      <Muted className="text-xs">requests</Muted>
                    </View>
                  </View>
                )}
              </View>

              {/* By Model (collapsible) */}
              {summary.byModel.length > 0 && (
                <View className="rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden mb-4">
                  <Pressable
                    onPress={() => setByModelExpanded(!byModelExpanded)}
                    className="flex-row items-center justify-between px-4 py-3"
                  >
                    <Text className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
                      By Model
                    </Text>
                    {byModelExpanded ? (
                      <ChevronUp size={18} color={colors.mutedForeground} />
                    ) : (
                      <ChevronDown size={18} color={colors.mutedForeground} />
                    )}
                  </Pressable>
                  {byModelExpanded && (
                    <View className="px-4 border-t border-neutral-200 dark:border-neutral-800">
                      {summary.byModel.map((m: any, i: number) => (
                        <ModelRow
                          key={m.model}
                          model={m.model}
                          tokens={m.tokens}
                          totalTokens={summary.totalTokens}
                          cost={m.cost}
                          isLast={i === summary.byModel.length - 1}
                        />
                      ))}
                    </View>
                  )}
                </View>
              )}

              {/* Last 7 Days (collapsible) */}
              <View className="rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden mb-4">
                <Pressable
                  onPress={() => setByDayExpanded(!byDayExpanded)}
                  className="flex-row items-center justify-between px-4 py-3"
                >
                  <Text className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
                    Last 7 Days
                  </Text>
                  {byDayExpanded ? (
                    <ChevronUp size={18} color={colors.mutedForeground} />
                  ) : (
                    <ChevronDown size={18} color={colors.mutedForeground} />
                  )}
                </Pressable>
                {byDayExpanded && (
                  <View className="px-4 border-t border-neutral-200 dark:border-neutral-800">
                    {summary.byDay.map((d: any, i: number) => (
                      <DayRow
                        key={d.date}
                        date={d.date}
                        tokens={d.tokens}
                        maxTokens={maxDayTokens}
                        isLast={i === summary.byDay.length - 1}
                      />
                    ))}
                  </View>
                )}
              </View>

              {/* Empty state */}
              {summary.totalTokens === 0 && (
                <View className="items-center py-8">
                  <Text className="text-4xl mb-3">📊</Text>
                  <Text className="text-neutral-700 dark:text-neutral-300 font-medium">No usage yet</Text>
                  <Muted className="text-sm text-center mt-1 max-w-xs">
                    Token usage will appear here after your first AI interaction.
                  </Muted>
                </View>
              )}
            </>
          )}
        </View>
      </WebContent>
    </ScrollView>
  );

  return (
    <DetailLayout
      title="Usage"
      headerRight={
        <HeaderContextMenu
          items={[
            {
              label: syncing ? "Syncing…" : "Sync now",
              icon: RefreshCw,
              onPress: () => { void handleSync(); },
            },
          ]}
        />
      }
    >
      {content}
    </DetailLayout>
  );
}
