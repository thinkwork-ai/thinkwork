import { useMemo } from "react";
import { View, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import { useAuth } from "@/lib/auth-context";
import { useAgents, useAgent } from "@/lib/hooks/use-agents";
import { DetailLayout } from "@/components/layout/detail-layout";
import { WebContent } from "@/components/layout/web-content";
import { Text } from "@/components/ui/typography";
import { ChevronRight } from "lucide-react-native";
import { COLORS } from "@/lib/theme";
import { Pressable } from "react-native";

function NavRow({ label, badge, onPress, colors, disabled, isLast }: {
  label: string;
  badge?: number;
  onPress: () => void;
  colors: typeof COLORS.light;
  disabled?: boolean;
  isLast?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`flex-row items-center justify-between py-3 active:opacity-70 ${isLast ? "" : "border-b border-neutral-200 dark:border-neutral-800"} ${disabled ? "opacity-40" : ""}`}
    >
      <Text className="text-base text-neutral-500 dark:text-neutral-400">{label}</Text>
      <View className="flex-row items-center gap-2">
        {badge !== undefined && badge > 0 && (
          <View className="bg-neutral-200 dark:bg-neutral-700 rounded-full px-2 py-0.5 min-w-[24px] items-center">
            <Text className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{badge}</Text>
          </View>
        )}
        <ChevronRight size={20} color={colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

export default function AgentConfigScreen() {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const { user } = useAuth();
  const tenantId = user?.tenantId;

  const [{ data: agentsData }] = useAgents(tenantId);
  const agents = agentsData?.agents ?? [];

  const activeAgent = useMemo(() => {
    const uid = user?.sub;
    const all = (agents as any[]).filter((a: any) => a.type !== "local");
    if (!uid) return null;
    const paired = all.filter((a: any) => a.humanPairId === uid);
    return paired.find((a: any) => a.role === "team") ?? paired[0] ?? null;
  }, [agents, user?.sub]);

  const [{ data: agentDetail }] = useAgent(activeAgent?.id);
  const skillCount = (agentDetail?.agent as any)?.skills?.length ?? 0;

  return (
    <DetailLayout title="Agent Settings">
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
        <WebContent bordered>
          <View className="px-4">
            <NavRow
              label="Persona"
              onPress={() => activeAgent && router.push(`/agents/${activeAgent.id}/profile`)}
              colors={colors}
              disabled={!activeAgent}
            />
            <NavRow
              label="Model Selection"
              onPress={() => activeAgent && router.push(`/agents/${activeAgent.id}/model`)}
              colors={colors}
              disabled={!activeAgent}
            />
            <NavRow
              label="Skills"
              badge={skillCount}
              onPress={() => activeAgent && router.push(`/agents/${activeAgent.id}/skills`)}
              colors={colors}
              disabled={!activeAgent}
            />
            <NavRow
              label="Memory"
              onPress={() => router.push("/memory")}
              colors={colors}
              isLast
            />
          </View>
        </WebContent>
      </ScrollView>
    </DetailLayout>
  );
}
