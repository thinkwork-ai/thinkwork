import { useState, useEffect } from "react";
import { View, ScrollView, Pressable, ActivityIndicator, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import { DetailLayout } from "@/components/layout/detail-layout";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { getWorkspaceFile } from "@/lib/workspace-api";

export default function WorkspaceFileView() {
  const { file, assistantId } = useLocalSearchParams<{
    file: string;
    assistantId: string;
  }>();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const router = useRouter();

  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);

  const fileName = decodeURIComponent(file ?? "");

  useEffect(() => {
    if (!assistantId || !fileName) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getWorkspaceFile({ agentId: assistantId }, fileName)
      .then((data) => {
        if (!cancelled) setContent(data.content ?? "");
      })
      .catch((err) => {
        console.error("Failed to load workspace file:", err);
        if (!cancelled) setContent("");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [assistantId, fileName]);

  const editButton = (
    <Pressable
      onPress={() =>
        router.push(
          `/memory/edit-file?file=${encodeURIComponent(fileName)}&assistantId=${assistantId}`,
        )
      }
      className="active:opacity-70"
    >
      <Text style={{ color: colors.primary }} className="font-semibold text-base">Edit</Text>
    </Pressable>
  );

  return (
    <DetailLayout title={fileName} headerRight={!loading ? editButton : undefined}>
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {content ? (
            <Text
              className="text-sm leading-6 text-neutral-700 dark:text-neutral-300 px-4 pt-4"
              style={{ fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}
              selectable
            >
              {content}
            </Text>
          ) : (
            <View className="items-center justify-center py-16 px-6">
              <Muted className="text-center">
                This file is empty. Tap Edit to add content.
              </Muted>
            </View>
          )}
        </ScrollView>
      )}
    </DetailLayout>
  );
}
