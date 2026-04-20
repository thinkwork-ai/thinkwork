import { Inter_500Medium, useFonts } from "@expo-google-fonts/inter";
import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  type WikiPageType,
  useWikiPage,
} from "@thinkwork/react-native-sdk";
import { useAuth } from "@/lib/auth-context";
import { WikiGraphView } from "@/components/wiki/graph/WikiGraphView";
import { COLORS } from "@/lib/theme";

const VALID_TYPES: WikiPageType[] = ["ENTITY", "TOPIC", "DECISION"];

function normalizeType(raw: string | undefined): WikiPageType | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  return (VALID_TYPES as string[]).includes(upper) ? (upper as WikiPageType) : null;
}

export default function WikiGraphFromSlugScreen() {
  const [fontsLoaded] = useFonts({ Inter: Inter_500Medium });
  const params = useLocalSearchParams<{ type?: string; slug?: string; agentId?: string }>();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? null;
  const type = normalizeType(params.type);
  const slug = params.slug ?? null;
  const agentId = params.agentId ?? null;

  const { page, loading, error } = useWikiPage({
    tenantId,
    ownerId: agentId,
    type,
    slug,
  });

  if (!fontsLoaded || !tenantId || !agentId || !type || !slug) {
    return (
      <SafeAreaView style={styles.fallback} edges={["top"]}>
        <Text style={styles.fallbackText}>
          Missing route context — open this view from a wiki page.
        </Text>
      </SafeAreaView>
    );
  }

  if (loading && !page) {
    return (
      <SafeAreaView style={styles.fallback} edges={["top"]}>
        <ActivityIndicator color={COLORS.dark.mutedForeground} />
      </SafeAreaView>
    );
  }

  if (error || !page) {
    return (
      <SafeAreaView style={styles.fallback} edges={["top"]}>
        <Text style={styles.fallbackText}>
          {error?.message ?? "Page not found."}
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <WikiGraphView
        tenantId={tenantId}
        agentId={agentId}
        initialFocalPageId={page.id}
      />
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
