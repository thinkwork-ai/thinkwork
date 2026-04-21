import { useState, useEffect, useCallback } from "react";
import { View, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import { ChevronRight } from "lucide-react-native";
import { DetailLayout } from "@/components/layout/detail-layout";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { useAgent } from "@/lib/hooks/use-agents";
import { listWorkspaceFiles } from "@/lib/workspace-api";

const WORKSPACE_FILE_DESCRIPTIONS: Record<string, string> = {
  "SOUL.md": "Core personality, values, and behavioral guidelines",
  "USER.md": "What the assistant knows about you",
  "IDENTITY.md": "Name, role, and persona definition",
  "AGENTS.md": "Multi-agent collaboration rules",
  "TOOLS.md": "Tool usage preferences and instructions",
};

export default function AgentProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const router = useRouter();

  const [{ data: agentData }] = useAgent(id);
  const agent = agentData?.agent;

  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFiles = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await listWorkspaceFiles({ agentId: id });
      setFiles(data.files.map((f) => f.path));
    } catch (err) {
      console.error("Failed to list workspace files:", err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  return (
    <DetailLayout title="Persona">
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : files.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Muted className="text-center">
            No persona files yet. Edit your agent in the admin dashboard to generate defaults.
          </Muted>
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
          <View className="px-4">
            {files.map((fileName, i) => (
              <Pressable
                key={fileName}
                onPress={() =>
                  router.push(
                    `/memory/${encodeURIComponent(fileName)}?assistantId=${id}`,
                  )
                }
                className={`flex-row items-center justify-between py-3 active:opacity-70 ${
                  i < files.length - 1 ? "border-b border-neutral-200 dark:border-neutral-800" : ""
                }`}
              >
                <View className="flex-1 mr-2">
                  <Text className="text-base font-medium text-neutral-900 dark:text-neutral-100">
                    {fileName}
                  </Text>
                  {WORKSPACE_FILE_DESCRIPTIONS[fileName] && (
                    <Muted className="text-sm mt-0.5">
                      {WORKSPACE_FILE_DESCRIPTIONS[fileName]}
                    </Muted>
                  )}
                </View>
                <ChevronRight size={20} color={colors.mutedForeground} />
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}
    </DetailLayout>
  );
}
