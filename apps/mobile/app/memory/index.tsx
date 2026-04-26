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
    // Server already scopes agents to the authed user; pick the team agent or first.
    const all = (agents as any[]).filter((a: any) => a.type !== "local");
    return all.find((a: any) => a.role === "team") ?? all[0] ?? null;
  }, [agents]);

  if (fetching) {
    return (
      <DetailLayout title="Memory">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      </DetailLayout>
    );
  }

  if (activeAgent?.id && currentUser?.id) {
    return <Redirect href={`/memory/list?strategy=semantic&userId=${currentUser.id}&assistantId=${activeAgent.id}`} />;
  }

  return (
    <DetailLayout title="Memory">
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    </DetailLayout>
  );
}
