import { useState, useEffect } from "react";
import { View, Text, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { DetailLayout } from "@/components/layout/detail-layout";

// TODO: files.readFile action not yet available via GraphQL hooks

export default function FileViewScreen() {
  const { id, path, name } = useLocalSearchParams<{ id: string; path: string; name: string }>();
  const agentId = id!;

  // TODO: Replace with GraphQL file read hook when available
  const readFile = async (_args: { agentId: string; path: string }): Promise<{ content?: string; error?: string }> => {
    return { error: "File reading not yet available via GraphQL" };
  };
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!path) return;
    setLoading(true);
    readFile({ agentId, path })
      .then((result) => {
        setContent(result.content || "(empty file)");
        if (result.error) setContent(`Error: ${result.error}`);
      })
      .catch((err) => {
        setContent(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
      })
      .finally(() => setLoading(false));
  }, [agentId, path]);

  return (
    <DetailLayout title={name || "File"}>
      <View className="flex-1">
        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : (
          <ScrollView className="flex-1" contentContainerClassName="p-4">
            <Text className="font-mono text-sm text-neutral-800 dark:text-neutral-200 leading-5">
              {content}
            </Text>
          </ScrollView>
        )}
      </View>
    </DetailLayout>
  );
}
