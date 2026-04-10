import { useState, useEffect } from "react";
import { useLocalSearchParams } from "expo-router";
import { DetailLayout } from "@/components/layout/detail-layout";
import { View, ScrollView, Modal, Pressable, Switch } from "react-native";
import { Text, Muted } from "@/components/ui/typography";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { HeaderContextMenu } from "@/components/ui/header-context-menu";
import { ChevronDown, ChevronUp, Edit2, RefreshCw } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";
import { useMediaQuery } from "@/lib/hooks/use-media-query";

interface BudgetFormProps {
  limit: string;
  setLimit: (v: string) => void;
  hardStop: boolean;
  setHardStop: (v: boolean) => void;
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  onSave: () => Promise<void>;
  colors: { primary: string };
}

function BudgetForm({ limit, setLimit, hardStop, setHardStop, enabled, setEnabled, onSave, colors }: BudgetFormProps) {
  return (
    <View className="gap-4">
      {/* Monthly limit */}
      <Input
        label="Monthly limit (USD)"
        value={limit}
        onChangeText={setLimit}
        keyboardType="numeric"
        placeholder="e.g. 10.00"
      />

      {/* Hard stop toggle */}
      <View className="flex-row items-center justify-between">
        <View>
          <Text className="font-medium">Hard stop</Text>
          <Muted className="text-xs">Block requests when limit is reached</Muted>
        </View>
        <Switch value={hardStop} onValueChange={setHardStop} />
      </View>

      {/* Enabled toggle */}
      <View className="flex-row items-center justify-between">
        <Text className="font-medium">Enabled</Text>
        <Switch value={enabled} onValueChange={setEnabled} />
      </View>

      {/* Save */}
      <Pressable
        onPress={onSave}
        className="bg-orange-500 rounded-lg px-4 py-3 items-center mt-1"
      >
        <Text className="text-white font-semibold">Save budget</Text>
      </Pressable>
    </View>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatCurrency(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default function AgentUsageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const agentId = id!;
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const { isWide } = useMediaQuery();

  // TODO: agentBudgets GraphQL hooks not yet available
  const summary: any = undefined;
  const status: any = undefined;
  const refresh = async (_args: any) => {};
  const save = async (_args: any) => {};

  // UI state
  const [refreshing, setRefreshing] = useState(false);
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [byModelExpanded, setByModelExpanded] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(true);

  // Budget form state (mirrors current policy)
  const [limit, setLimit] = useState("10");
  const [hardStop, setHardStop] = useState(true);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (status?.policy) {
      setLimit(String(status.policy.limit));
      setHardStop(status.policy.hardStop);
      setEnabled(status.policy.enabled);
    }
  }, [status?.policy?.id]);

  const doRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh({ agentId });
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void doRefresh();
  }, [agentId]);

  const doSave = async () => {
    await save({
      agentId,
      mode: "cost",
      period: "monthly",
      limit: Number(limit || 0),
      softThresholdPct: 80,
      hardStop,
      enabled,
    });
    await doRefresh();
  };

  const enforcement = status?.enforcement;
  const pctUsed = enforcement?.percentUsed ?? 0;
  const healthVariant =
    pctUsed >= 90 ? "destructive" : pctUsed >= 70 ? "warning" : "success";
  const healthLabel =
    pctUsed >= 90 ? "At Risk" : pctUsed >= 70 ? "Watch" : "Healthy";

  const overflowButton = (
    <HeaderContextMenu
      items={[
        {
          label: "Edit budget",
          icon: Edit2,
          onPress: () => setShowBudgetModal(true),
        },
        {
          label: refreshing ? "Syncing..." : "Sync now",
          icon: RefreshCw,
          onPress: () => { void doRefresh(); },
        },
      ]}
    />
  );

  const policy = status?.policy;

  return (
    <DetailLayout title="Usage" headerRight={overflowButton}>
      <ScrollView
        className="flex-1 w-full"
        contentContainerStyle={{ padding: 16, paddingBottom: 32, maxWidth: 768 }}
      >
        {/* Budget card */}
        {enforcement && policy ? (
          <View className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 mb-4">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="font-semibold text-base">Budget</Text>
              <View className="flex-row items-center gap-2">
                {policy.enabled ? (
                  <Badge variant={healthVariant}>{healthLabel}</Badge>
                ) : (
                  <Badge variant="outline">Disabled</Badge>
                )}
              </View>
            </View>

            {/* Progress bar */}
            <View className="h-2 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden mb-3">
              <View
                className={`h-full rounded-full ${
                  pctUsed >= 90
                    ? "bg-red-500"
                    : pctUsed >= 70
                      ? "bg-yellow-500"
                      : "bg-green-500"
                }`}
                style={{ width: `${Math.min(pctUsed, 100)}%` }}
              />
            </View>

            <View className="flex-row justify-between mb-3">
              <Muted className="text-sm">{formatCurrency(enforcement.used)} spent</Muted>
              <Muted className="text-sm">{formatCurrency(enforcement.limit)} limit</Muted>
            </View>

            <View className="flex-row gap-6">
              <View>
                <Muted className="text-xs mb-0.5">Remaining</Muted>
                <Text className="font-semibold">{formatCurrency(enforcement.remaining)}</Text>
              </View>
              <View>
                <Muted className="text-xs mb-0.5">% Used</Muted>
                <Text className="font-semibold">{pctUsed.toFixed(1)}%</Text>
              </View>
              <View>
                <Muted className="text-xs mb-0.5">Hard stop</Muted>
                <Text className="font-semibold">{policy.hardStop ? "On" : "Off"}</Text>
              </View>
            </View>

            {policy.syncError ? (
              <Muted className="text-xs text-red-500 mt-2">{policy.syncError}</Muted>
            ) : null}
          </View>
        ) : status !== undefined && !policy ? (
          /* No budget configured yet */
          <View className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 items-center gap-3 mb-4">
            <Muted>No budget configured</Muted>
            <Pressable
              onPress={() => setShowBudgetModal(true)}
              className="bg-orange-500 rounded-lg px-4 py-2"
            >
              <Text className="text-white font-semibold">Set budget</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Summary (collapsible) */}
        <View className="rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden mb-4">
          <Pressable
            onPress={() => setSummaryExpanded(!summaryExpanded)}
            className="flex-row items-center justify-between px-4 py-3"
          >
            <Text className="font-semibold">Summary</Text>
            {summaryExpanded ? (
              <ChevronUp size={18} color={colors.mutedForeground} />
            ) : (
              <ChevronDown size={18} color={colors.mutedForeground} />
            )}
          </Pressable>

          {summaryExpanded && (
            <View className="px-4 pb-4 border-t border-neutral-200 dark:border-neutral-800">
              {!summary ? (
                <Muted className="mt-3">Loading...</Muted>
              ) : (
                <View className="gap-3 pt-3">
                  <View className="flex-row gap-6">
                    <View className="flex-1">
                      <Muted className="text-xs mb-0.5">Total tokens</Muted>
                      <Text className="text-2xl font-bold">
                        {formatNumber(summary.totalTokens)}
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Muted className="text-xs mb-0.5">Total cost</Muted>
                      <Text className="text-2xl font-bold">
                        ${summary.totalCost.toFixed(4)}
                      </Text>
                    </View>
                  </View>
                  <Muted className="text-sm">{summary.recordCount} requests this period</Muted>
                </View>
              )}
            </View>
          )}
        </View>

        {/* By model (collapsible) */}
        <View className="rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden">
          <Pressable
            onPress={() => setByModelExpanded(!byModelExpanded)}
            className="flex-row items-center justify-between px-4 py-3"
          >
            <Text className="font-semibold">By model</Text>
            {byModelExpanded ? (
              <ChevronUp size={18} color={colors.mutedForeground} />
            ) : (
              <ChevronDown size={18} color={colors.mutedForeground} />
            )}
          </Pressable>

          {byModelExpanded && (
            <View className="border-t border-neutral-200 dark:border-neutral-800">
              {!summary ? (
                <View className="px-4 py-3">
                  <Muted>Loading...</Muted>
                </View>
              ) : summary.byModel.length === 0 ? (
                <View className="px-4 py-3">
                  <Muted>No usage data yet.</Muted>
                </View>
              ) : (
                summary.byModel.map((m: { model: string; tokens: number }, i: number) => (
                  <View
                    key={m.model}
                    className={`flex-row justify-between items-center px-4 py-3 ${
                      i < summary.byModel.length - 1
                        ? "border-b border-neutral-200 dark:border-neutral-800"
                        : ""
                    }`}
                  >
                    <Text numberOfLines={1} className="flex-1 mr-2">
                      {m.model}
                    </Text>
                    <Muted>{formatNumber(m.tokens)} tokens</Muted>
                  </View>
                ))
              )}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Budget edit modal (centered dialog on wide / bottom sheet on mobile) */}
      <Modal
        visible={showBudgetModal}
        animationType={isWide ? "fade" : "slide"}
        transparent
        onRequestClose={() => setShowBudgetModal(false)}
      >
        {isWide ? (
          /* Wide: centered dialog */
          <Pressable
            className="flex-1 bg-black/40 justify-center items-center px-6"
            onPress={() => setShowBudgetModal(false)}
          >
            <Pressable onPress={() => {}}>
              <View
                className="rounded-xl px-4 pt-4 pb-6"
                style={{
                  backgroundColor: colors.card,
                  borderWidth: 1,
                  borderColor: colors.border,
                  width: "100%",
                  maxWidth: 900,
                }}
              >
                <View className="flex-row items-center justify-between mb-5">
                  <Text className="text-lg font-bold">Edit Budget</Text>
                  <Pressable onPress={() => setShowBudgetModal(false)}>
                    <Text style={{ color: colors.primary }} className="font-semibold">
                      Cancel
                    </Text>
                  </Pressable>
                </View>
                <BudgetForm
                  limit={limit} setLimit={setLimit}
                  hardStop={hardStop} setHardStop={setHardStop}
                  enabled={enabled} setEnabled={setEnabled}
                  onSave={async () => { await doSave(); setShowBudgetModal(false); }}
                  colors={colors}
                />
              </View>
            </Pressable>
          </Pressable>
        ) : (
          /* Mobile: bottom sheet */
          <>
            <Pressable
              className="flex-1 bg-black/40"
              onPress={() => setShowBudgetModal(false)}
            />
            <View
              className="rounded-t-2xl px-4 pt-4 pb-10"
              style={{ backgroundColor: colors.card, borderTopColor: colors.border, borderTopWidth: 1 }}
            >
              <View className="flex-row items-center justify-between mb-5">
                <Text className="text-lg font-bold">Edit Budget</Text>
                <Pressable onPress={() => setShowBudgetModal(false)}>
                  <Text style={{ color: colors.primary }} className="font-semibold">
                    Cancel
                  </Text>
                </Pressable>
              </View>
              <BudgetForm
                limit={limit} setLimit={setLimit}
                hardStop={hardStop} setHardStop={setHardStop}
                enabled={enabled} setEnabled={setEnabled}
                onSave={async () => { await doSave(); setShowBudgetModal(false); }}
                colors={colors}
              />
            </View>
          </>
        )}
      </Modal>
    </DetailLayout>
  );
}
