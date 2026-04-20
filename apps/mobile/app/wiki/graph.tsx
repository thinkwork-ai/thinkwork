import { Inter_500Medium, useFonts } from "@expo-google-fonts/inter";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KnowledgeGraph } from "@/components/wiki/graph";
import type { WikiSubgraph } from "@/components/wiki/graph";
import { COLORS } from "@/lib/theme";

const NOW = new Date().toISOString();

const FIXTURE: WikiSubgraph = {
  focalPageId: "page-1",
  depth: 1,
  atTime: NOW,
  hasMore: {},
  nodes: [
    {
      id: "page-1",
      slug: "eric-odom",
      label: "Eric Odom",
      pageType: "ENTITY",
      subtype: "person",
      lastCompiledAt: NOW,
      status: "ACTIVE",
      primaryAgentIds: ["agent-1"],
      x: 0,
      y: 0,
    },
    {
      id: "page-2",
      slug: "thinkwork",
      label: "ThinkWork",
      pageType: "ENTITY",
      subtype: "company",
      lastCompiledAt: NOW,
      status: "ACTIVE",
      primaryAgentIds: ["agent-1"],
      x: 140,
      y: -90,
    },
    {
      id: "page-3",
      slug: "compounding-memory",
      label: "Compounding Memory",
      pageType: "TOPIC",
      lastCompiledAt: NOW,
      status: "ACTIVE",
      primaryAgentIds: ["agent-1"],
      x: 160,
      y: 80,
    },
    {
      id: "page-4",
      slug: "force-graph-spike",
      label: "Force Graph Spike",
      pageType: "DECISION",
      lastCompiledAt: NOW,
      status: "ACTIVE",
      primaryAgentIds: ["agent-1"],
      x: -150,
      y: 100,
    },
    {
      id: "page-5",
      slug: "claude-code",
      label: "Claude Code",
      pageType: "ENTITY",
      subtype: "product",
      lastCompiledAt: NOW,
      status: "ACTIVE",
      primaryAgentIds: ["agent-1"],
      x: -160,
      y: -90,
    },
    {
      id: "page-6",
      slug: "wiki-pipeline",
      label: "Wiki Pipeline",
      pageType: "TOPIC",
      lastCompiledAt: NOW,
      status: "ACTIVE",
      primaryAgentIds: ["agent-1"],
      x: 40,
      y: -200,
    },
    {
      id: "page-7",
      slug: "marco",
      label: "Marco",
      pageType: "ENTITY",
      subtype: "person",
      lastCompiledAt: NOW,
      status: "ACTIVE",
      primaryAgentIds: ["agent-1"],
      x: 240,
      y: -10,
    },
    {
      id: "page-8",
      slug: "skia-renderer",
      label: "Skia Renderer",
      pageType: "DECISION",
      lastCompiledAt: NOW,
      status: "ACTIVE",
      primaryAgentIds: ["agent-1"],
      x: -50,
      y: 220,
    },
    {
      id: "page-9",
      slug: "agent-core",
      label: "AgentCore",
      pageType: "ENTITY",
      subtype: "product",
      lastCompiledAt: NOW,
      status: "ACTIVE",
      primaryAgentIds: ["agent-1"],
      x: -240,
      y: 0,
    },
    {
      id: "page-10",
      slug: "memory-canonical-plane",
      label: "Memory Canonical Plane",
      pageType: "TOPIC",
      lastCompiledAt: NOW,
      status: "ACTIVE",
      primaryAgentIds: ["agent-1"],
      x: 0,
      y: -120,
    },
  ],
  edges: [
    { id: "e1", source: "page-1", target: "page-2", firstSeenAt: NOW, lastSeenAt: NOW, isCurrent: true },
    { id: "e2", source: "page-1", target: "page-3", firstSeenAt: NOW, lastSeenAt: NOW, isCurrent: true },
    { id: "e3", source: "page-1", target: "page-4", firstSeenAt: NOW, lastSeenAt: NOW, isCurrent: true },
    { id: "e4", source: "page-1", target: "page-5", firstSeenAt: NOW, lastSeenAt: NOW, isCurrent: true },
    { id: "e5", source: "page-2", target: "page-6", firstSeenAt: NOW, lastSeenAt: NOW, isCurrent: true },
    { id: "e6", source: "page-2", target: "page-7", firstSeenAt: NOW, lastSeenAt: NOW, isCurrent: true },
    { id: "e7", source: "page-3", target: "page-6", firstSeenAt: NOW, lastSeenAt: NOW, isCurrent: true },
    { id: "e8", source: "page-3", target: "page-10", firstSeenAt: NOW, lastSeenAt: NOW, isCurrent: true },
    { id: "e9", source: "page-4", target: "page-8", firstSeenAt: NOW, lastSeenAt: NOW, isCurrent: true },
    { id: "e10", source: "page-5", target: "page-9", firstSeenAt: NOW, lastSeenAt: NOW, isCurrent: true },
    { id: "e11", source: "page-6", target: "page-10", firstSeenAt: NOW, lastSeenAt: NOW, isCurrent: true },
    { id: "e12", source: "page-9", target: "page-10", firstSeenAt: NOW, lastSeenAt: NOW, isCurrent: true },
  ],
};

export default function WikiGraphScreen() {
  const [fontsLoaded] = useFonts({ Inter: Inter_500Medium });
  const subgraph = useMemo(() => FIXTURE, []);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.banner}>
        <Text style={styles.bannerText}>
          Wiki graph (Unit 1 fixture) — pan with one finger, pinch with two
        </Text>
      </View>
      {fontsLoaded ? <KnowledgeGraph subgraph={subgraph} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.dark.background },
  banner: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: COLORS.dark.card,
    borderBottomColor: COLORS.dark.border,
    borderBottomWidth: 1,
  },
  bannerText: { color: COLORS.dark.foreground, fontSize: 12 },
});
