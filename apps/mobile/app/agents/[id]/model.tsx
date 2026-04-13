import { useEffect, useState } from "react";
import { View, Text, Pressable, Alert, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useAgent, useUpdateAgent } from "@/lib/hooks/use-agents";
import { Check } from "lucide-react-native";
import { DetailLayout } from "@/components/layout/detail-layout";
import { WebContent } from "@/components/layout/web-content";
import { DEFAULT_AGENT_MODEL, modelLabel } from "@/lib/models";

function formatPerMillion(price?: number) {
  if (typeof price !== "number" || !Number.isFinite(price)) return null;
  if (price >= 100) return `$${price.toFixed(0)}`;
  if (price >= 10) return `$${price.toFixed(1)}`;
  return `$${price.toFixed(2)}`;
}

function pricingLine(model: any) {
  const input = formatPerMillion(model?.pricing?.inputPer1M);
  const output = formatPerMillion(model?.pricing?.outputPer1M);
  if (!input || !output) return "Pricing not set";
  return `input ${input} / 1M • output ${output} / 1M`;
}

export default function AgentModelScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [{ data: agentData }] = useAgent(id!);
  const agent = agentData?.agent ?? undefined;
  // TODO: listRuntimeModels action not yet available via GraphQL hooks
  const [catalogModels, setCatalogModels] = useState<any[] | null>(null);
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);
  const [, executeUpdateAgent] = useUpdateAgent();

  const currentModel = (agent as any)?.model ?? DEFAULT_AGENT_MODEL;
  const canEdit = (agent as any)?.capabilities?.canEdit !== false;

  useEffect(() => {
    // TODO: Replace with GraphQL model catalog query when available
    setCatalogModels([]);
    setModelLoadError("Model catalog not yet available via GraphQL");
  }, []);

  const selectModel = async (model: string) => {
    if (!canEdit) return;
    try {
      await executeUpdateAgent({ id: id!, model });
    } catch (err: any) {
      Alert.alert("Failed to update model", err?.message || "Please try again");
    }
  };

  return (
    <DetailLayout title="Model">
      <WebContent>
        <View className="px-4 pt-4 pb-2">
          <Text className="text-sm text-neutral-500 dark:text-neutral-400 leading-5">
            Pick the default runtime model for this agent. New conversations use this model immediately.
          </Text>
        </View>

        {agent === undefined || catalogModels === null ? (
          <View className="p-6 items-center">
            <ActivityIndicator color="#0ea5e9" />
          </View>
        ) : agent === null ? (
          <View className="px-4 py-8">
            <Text className="text-sm text-neutral-500 dark:text-neutral-400">No access to this agent.</Text>
          </View>
        ) : catalogModels.length === 0 ? (
          <View className="px-4 py-8">
            <Text className="text-sm text-neutral-500 dark:text-neutral-400">No enabled models available yet. Ask an admin to seed or enable models.</Text>
          </View>
        ) : (
          <>
            {modelLoadError ? (
              <View className="mx-4 mt-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 px-3 py-2">
                <Text className="text-xs text-amber-700 dark:text-amber-300">
                  Showing cached model list. Pull to refresh.
                </Text>
              </View>
            ) : null}
            <View className="mx-4 mt-2 rounded-xl overflow-hidden bg-white dark:bg-neutral-900">
              {catalogModels.map((model: any, index: number) => {
                const selected = currentModel === model.id;
                return (
                  <Pressable
                    key={model.id}
                    disabled={!canEdit}
                    onPress={() => selectModel(model.id)}
                    className={`px-4 py-4 flex-row items-center justify-between ${index < catalogModels.length - 1 ? "border-b border-neutral-100 dark:border-neutral-800" : ""}`}
                    style={{ opacity: canEdit ? 1 : 0.55 }}
                  >
                    <View className="pr-4">
                      <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                        {model.label}
                      </Text>
                      <Text className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                        {model.providerModelId || modelLabel(model.id)}
                      </Text>
                      <Text className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">
                        {pricingLine(model)}
                      </Text>
                    </View>

                    {selected ? <Check size={18} color="#0ea5e9" /> : null}
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </WebContent>
    </DetailLayout>
  );
}
