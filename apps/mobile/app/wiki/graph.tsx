import { Inter_500Medium, useFonts } from "@expo-google-fonts/inter";
import { useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth-context";
import { useAgents } from "@/lib/hooks/use-agents";
import { WikiGraphView } from "@/components/wiki/graph";
import { COLORS } from "@/lib/theme";

export default function WikiGraphScreen() {
  const [fontsLoaded] = useFonts({ Inter: Inter_500Medium });
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const [{ data: agentsData, fetching }] = useAgents(tenantId);
  const agents = agentsData?.agents ?? [];

  const activeAgent = useMemo(() => {
    const all = (agents as { id: string; type?: string; role?: string }[]).filter(
      (a) => a.type !== "local",
    );
    return all.find((a) => a.role === "team") ?? all[0] ?? null;
  }, [agents]);

  if (!tenantId || !fontsLoaded || fetching) {
    return (
      <SafeAreaView style={styles.fallback} edges={["top"]}>
        <ActivityIndicator color={COLORS.dark.mutedForeground} />
      </SafeAreaView>
    );
  }

  if (!activeAgent) {
    return (
      <SafeAreaView style={styles.fallback} edges={["top"]}>
        <Text style={styles.fallbackText}>
          No agent selected — pick one from the home tab first.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <WikiGraphView tenantId={tenantId} agentId={activeAgent.id} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.dark.background },
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    backgroundColor: COLORS.dark.background,
  },
  fallbackText: {
    color: COLORS.dark.mutedForeground,
    fontSize: 13,
    textAlign: "center",
  },
});
