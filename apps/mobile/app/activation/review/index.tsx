import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "urql";
import { randomUUID } from "expo-crypto";
import { DetailLayout } from "@/components/layout/detail-layout";
import { Button } from "@/components/ui/button";
import { Text, Muted } from "@/components/ui/typography";
import {
  BundleItemCard,
  type BundleItem,
} from "@/components/activation/BundleItemCard";
import {
  ActivationSessionQuery,
  ApplyActivationBundleMutation,
} from "@/lib/graphql-queries";

export default function ActivationReview() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const [{ data }] = useQuery({
    query: ActivationSessionQuery,
    variables: { sessionId },
    pause: !sessionId,
  });
  const [, applyBundle] = useMutation(ApplyActivationBundleMutation);
  const items = useMemo(
    () => extractItems(data?.activationSession?.layerStates),
    [data],
  );
  const [actions, setActions] = useState<
    Record<string, "apply" | "defer" | "dismiss">
  >({});

  const apply = async () => {
    if (!sessionId) return;
    await applyBundle({
      input: {
        sessionId,
        applyId: randomUUID(),
        approvals: items.map((item) => ({
          itemId: item.id,
          layer: item.layer,
          action: actions[item.id] ?? "apply",
          target:
            item.layer === "friction" ? "memory" : (item.target ?? "memory"),
          payload: JSON.stringify(item),
        })),
      },
    });
    router.replace("/activation/apply");
  };

  return (
    <DetailLayout title="Review activation">
      <ScrollView className="flex-1" contentContainerClassName="gap-4 p-4">
        <View className="gap-1">
          <Text className="text-xl font-semibold">Staged updates</Text>
          <Muted>
            Apply, defer, or dismiss each recommendation before agents see it.
          </Muted>
        </View>
        {items.map((item) => (
          <BundleItemCard
            key={item.id}
            item={item}
            action={actions[item.id] ?? "apply"}
            onAction={(action) =>
              setActions((current) => ({ ...current, [item.id]: action }))
            }
          />
        ))}
        <Button onPress={apply}>Apply approved updates</Button>
      </ScrollView>
    </DetailLayout>
  );
}

function extractItems(layerStates?: unknown): BundleItem[] {
  if (!layerStates) return [];
  try {
    const parsed =
      typeof layerStates === "string" ? JSON.parse(layerStates) : layerStates;
    return Object.entries(parsed).flatMap(([layer, state]: [string, any]) =>
      Array.isArray(state?.entries)
        ? state.entries.map((entry: any, index: number) => ({
            id: String(entry.id ?? `${layer}-${index}`),
            layer,
            title: String(entry.title ?? layer),
            summary: String(entry.summary ?? entry.content ?? ""),
            epistemicState: String(entry.epistemicState ?? "confirmed"),
            target: layer === "friction" ? "memory" : "memory",
          }))
        : [],
    );
  } catch {
    return [];
  }
}
