import { View, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "urql";
import { useColorScheme } from "nativewind";
import { DetailLayout } from "@/components/layout/detail-layout";
import { MarkdownMessage } from "@/components/chat/MarkdownMessage";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { ArtifactDetailQuery } from "@/lib/graphql-queries";

const TYPE_LABELS: Record<string, string> = {
  DATA_VIEW: "Data View",
  NOTE: "Note",
  REPORT: "Report",
  PLAN: "Plan",
  DRAFT: "Draft",
  DIGEST: "Digest",
};

export default function ArtifactViewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const [{ data, fetching }] = useQuery({
    query: ArtifactDetailQuery,
    variables: { id: id! },
    pause: !id,
  });

  const artifact = (data as any)?.artifact;
  const title = artifact?.title ?? "Artifact";
  const typeLabel = TYPE_LABELS[artifact?.type] ?? artifact?.type ?? "";

  return (
    <DetailLayout title={title}>
      {fetching ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : !artifact ? (
        <View className="flex-1 items-center justify-center">
          <Muted>Artifact not found.</Muted>
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-4 pt-3 pb-8">
          <View className="flex-row items-center gap-2 mb-3">
            {typeLabel ? (
              <View className="bg-neutral-200 dark:bg-neutral-700 rounded px-2 py-0.5">
                <Text className="text-xs text-neutral-600 dark:text-neutral-300">{typeLabel}</Text>
              </View>
            ) : null}
            {artifact.status?.toLowerCase() === "draft" && (
              <View className="bg-amber-100 dark:bg-amber-900/30 rounded px-2 py-0.5">
                <Text className="text-xs text-amber-700 dark:text-amber-400">Draft</Text>
              </View>
            )}
          </View>
          <MarkdownMessage content={artifact.content || artifact.summary || "No content available."} isUser={false} />
        </ScrollView>
      )}
    </DetailLayout>
  );
}
