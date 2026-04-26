import { useEffect, useMemo, useState } from "react";
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
  GenerateActivationAutomationCandidatesMutation,
} from "@/lib/graphql-queries";

type AutomationSuggestion = {
  id: string;
  title: string;
  summary: string;
  whySuggested?: string | null;
  targetAgentId?: string | null;
  scheduleType: string;
  scheduleExpression: string;
  timezone: string;
  prompt?: string | null;
  status: string;
  costEstimate: string;
  disclosureVersion: string;
};

export default function ActivationReview() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const [{ data }] = useQuery({
    query: ActivationSessionQuery,
    variables: { sessionId },
    pause: !sessionId,
  });
  const [, applyBundle] = useMutation(ApplyActivationBundleMutation);
  const [candidateResult, generateCandidates] = useMutation(
    GenerateActivationAutomationCandidatesMutation,
  );
  const [automationSuggestions, setAutomationSuggestions] = useState<
    AutomationSuggestion[]
  >([]);
  const [candidateRequestedFor, setCandidateRequestedFor] = useState<
    string | null
  >(null);
  const items = useMemo(
    () => extractItems(data?.activationSession?.layerStates),
    [data],
  );
  const [actions, setActions] = useState<
    Record<string, "apply" | "defer" | "dismiss">
  >({});

  useEffect(() => {
    if (!sessionId || candidateRequestedFor === sessionId) return;
    setCandidateRequestedFor(sessionId);
    generateCandidates({ sessionId }).then((result) => {
      const candidates =
        result.data?.generateActivationAutomationCandidates ?? [];
      setAutomationSuggestions(candidates as AutomationSuggestion[]);
    });
  }, [candidateRequestedFor, generateCandidates, sessionId]);

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
        <View className="gap-2 pt-2">
          <View className="gap-1">
            <Text className="text-lg font-semibold">
              Personal automation suggestions
            </Text>
            <Muted>
              Suggested recurring follow-ups from your confirmed rhythms and
              decisions.
            </Muted>
          </View>
          {candidateResult.fetching ? (
            <AutomationSuggestionShell label="Checking for suggestions..." />
          ) : automationSuggestions.length > 0 ? (
            automationSuggestions.map((candidate) => (
              <AutomationSuggestionCard
                key={candidate.id}
                candidate={candidate}
              />
            ))
          ) : (
            <AutomationSuggestionShell label="No personal automation suggestions yet." />
          )}
        </View>
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

function AutomationSuggestionCard({
  candidate,
}: {
  candidate: AutomationSuggestion;
}) {
  const estimate = parseCostEstimate(candidate.costEstimate);
  const estimateText = `${estimate.runsPerMonth} runs/month - $${estimate.monthlyUsdMin}-$${estimate.monthlyUsdMax}/month - ${candidate.disclosureVersion}`;

  return (
    <View className="gap-3 rounded-lg border border-border bg-card p-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text className="text-base font-semibold">{candidate.title}</Text>
          <Muted>{candidate.summary}</Muted>
        </View>
        <View className="rounded-full bg-muted px-3 py-1">
          <Text className="text-xs font-semibold">Suggested</Text>
        </View>
      </View>
      <View className="gap-1">
        <Text className="text-sm font-semibold">Schedule</Text>
        <Muted>
          {candidate.scheduleExpression} - {candidate.timezone}
        </Muted>
      </View>
      {candidate.whySuggested ? (
        <View className="gap-1">
          <Text className="text-sm font-semibold">Why</Text>
          <Muted>{candidate.whySuggested}</Muted>
        </View>
      ) : null}
      {candidate.prompt ? (
        <View className="gap-1">
          <Text className="text-sm font-semibold">Prompt preview</Text>
          <Muted>{candidate.prompt}</Muted>
        </View>
      ) : null}
      <View className="gap-1">
        <Text className="text-sm font-semibold">Estimate</Text>
        <Muted>{estimateText}</Muted>
      </View>
    </View>
  );
}

function AutomationSuggestionShell({ label }: { label: string }) {
  return (
    <View className="rounded-lg border border-dashed border-border p-4">
      <Muted>{label}</Muted>
    </View>
  );
}

function parseCostEstimate(value: string) {
  try {
    const parsed = JSON.parse(value);
    return {
      runsPerMonth: Number(parsed.runsPerMonth ?? 0),
      monthlyUsdMin: Number(parsed.monthlyUsdMin ?? 0),
      monthlyUsdMax: Number(parsed.monthlyUsdMax ?? 0),
    };
  } catch {
    return { runsPerMonth: 0, monthlyUsdMin: 0, monthlyUsdMax: 0 };
  }
}
