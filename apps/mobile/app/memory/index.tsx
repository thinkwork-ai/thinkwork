import { useMemo } from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect } from "expo-router";
import { useColorScheme } from "nativewind";
import { useAuth } from "@/lib/auth-context";
import { useAgents } from "@/lib/hooks/use-agents";
import { useMe } from "@/lib/hooks/use-users";
import { COLORS } from "@/lib/theme";
import { DetailLayout } from "@/components/layout/detail-layout";

/**
 * Memory index — redirects straight to the long-term memory list
 * for the user's active agent.
 */
export default function MemoryScreen() {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const { user } = useAuth();
  const tenantId = user?.tenantId;

  const [{ data: meData }] = useMe();
  const currentUser = meData?.me;

  const [{ data: agentsData, fetching }] = useAgents(tenantId);
  const agents = agentsData?.agents ?? [];

  const activeAgent = useMemo(() => {
    const uid = user?.sub;
    const all = (agents as any[]).filter((a: any) => a.type !== "local");
    if (!uid) return null;
    const paired = all.filter((a: any) => a.humanPairId === uid);
    return paired.find((a: any) => a.role === "team") ?? paired[0] ?? null;
  }, [agents, user?.sub]);

  if (fetching) {
    return (
      <DetailLayout title="Memory">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      </DetailLayout>
    );
  }

  if (activeAgent?.id) {
    return <Redirect href={`/memory/list?strategy=semantic&assistantId=${activeAgent.id}`} />;
  }

  return (
    <DetailLayout title="Memory">
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    </DetailLayout>
  );
}
