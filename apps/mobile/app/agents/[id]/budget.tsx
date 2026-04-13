import { useLocalSearchParams } from "expo-router";
import { DetailLayout } from "@/components/layout/detail-layout";
import { View, Switch, Pressable } from "react-native";
import { Text, Muted } from "@/components/ui/typography";
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";

// TODO: agentBudgets GraphQL hooks not yet available
// Stubbing with no-op hooks that return empty data

export default function AgentBudgetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const agentId = id!;
  // TODO: Replace with useAgentBudgetStatus(agentId) when available
  const status: any = undefined;
  // TODO: Replace with useUpsertAgentBudgetPolicy() when available
  const save = async (_args: any) => {};
  // TODO: Replace with useRefreshAgentBudgetStatus() when available
  const refresh = async (_args: any) => {};

  const [mode, setMode] = useState<"cost" | "tokens">("cost");
  const [limit, setLimit] = useState("10");
  const [hardStop, setHardStop] = useState(true);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (status?.policy) {
      setMode(status.policy.mode);
      setLimit(String(status.policy.limit));
      setHardStop(status.policy.hardStop);
      setEnabled(status.policy.enabled);
    }
  }, [status?.policy?.id]);

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh({ agentId });
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void onRefresh();
  }, [agentId]);

  const onSave = async () => {
    await save({
      agentId,
      mode,
      period: "monthly",
      limit: Number(limit || 0),
      softThresholdPct: 80,
      hardStop,
      enabled,
    });
    await onRefresh();
  };

  const enforcement = status?.enforcement;

  return (
    <DetailLayout title="Budget">
      <View className="w-full px-4 py-4 gap-4" style={{ maxWidth: 768 }}>
        <View className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 gap-2">
          <View className="flex-row items-center justify-between">
            <Text className="font-semibold">Current</Text>
            <Pressable onPress={onRefresh} className="px-2 py-1 rounded bg-neutral-200 dark:bg-neutral-800">
              <Text className="text-xs">{refreshing ? "Syncing..." : "Sync"}</Text>
            </Pressable>
          </View>
          <Muted>{status?.sourceLabel ?? "Loading..."}</Muted>
          <Text>{enforcement ? `Used ${enforcement.used.toFixed(4)} / ${enforcement.limit.toFixed(4)} (${enforcement.percentUsed.toFixed(1)}%)` : "No budget yet"}</Text>
          {enforcement && <Text>Remaining: {enforcement.remaining.toFixed(4)}</Text>}
          {status?.policy?.syncError && <Muted>{status.policy.syncError}</Muted>}
        </View>

        <View className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 gap-3">
          <Text className="font-semibold">Mode</Text>
          <View className="flex-row gap-2">
            <Pressable className={`px-3 py-2 rounded ${mode === "cost" ? "bg-sky-500" : "bg-neutral-200 dark:bg-neutral-800"}`} onPress={() => setMode("cost")}><Text className={mode === "cost" ? "text-white" : ""}>Cost ($)</Text></Pressable>
            <Pressable className={`px-3 py-2 rounded ${mode === "tokens" ? "bg-sky-500" : "bg-neutral-200 dark:bg-neutral-800"}`} onPress={() => setMode("tokens")}><Text className={mode === "tokens" ? "text-white" : ""}>Tokens</Text></Pressable>
          </View>
          <Text>Monthly limit</Text>
          <Input value={limit} onChangeText={setLimit} keyboardType="numeric" placeholder="Limit" />
          <View className="flex-row items-center justify-between">
            <Text>Hard stop</Text>
            <Switch value={hardStop} onValueChange={setHardStop} />
          </View>
          <View className="flex-row items-center justify-between">
            <Text>Enabled</Text>
            <Switch value={enabled} onValueChange={setEnabled} />
          </View>
          <Pressable onPress={onSave} className="bg-sky-500 rounded px-4 py-3 items-center"><Text className="text-white font-semibold">Save budget</Text></Pressable>
        </View>
      </View>
    </DetailLayout>
  );
}
