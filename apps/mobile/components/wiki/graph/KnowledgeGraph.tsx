import { StyleSheet, View, useWindowDimensions } from "react-native";
import { COLORS } from "@/lib/theme";
import { GraphCanvas } from "./GraphCanvas";
import type { WikiSubgraph } from "./types";

interface KnowledgeGraphProps {
  subgraph: WikiSubgraph;
}

export function KnowledgeGraph({ subgraph }: KnowledgeGraphProps) {
  const { width, height } = useWindowDimensions();

  return (
    <View style={styles.root}>
      <GraphCanvas subgraph={subgraph} width={width} height={height} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.dark.background },
});
