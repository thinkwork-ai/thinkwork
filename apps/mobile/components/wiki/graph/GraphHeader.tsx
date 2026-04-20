import { Pressable, StyleSheet, Text, View } from "react-native";
import { COLORS } from "@/lib/theme";

interface GraphHeaderProps {
  focalTitle: string | null;
  depth: number;
  onIncreaseDepth: () => void;
  onDecreaseDepth: () => void;
  truncated?: boolean;
}

const MAX_DEPTH = 2;

export function GraphHeader({
  focalTitle,
  depth,
  onIncreaseDepth,
  onDecreaseDepth,
  truncated = false,
}: GraphHeaderProps) {
  return (
    <View style={styles.bar}>
      <View style={styles.titleColumn}>
        <Text style={styles.label}>Focal</Text>
        <Text style={styles.title} numberOfLines={1}>
          {focalTitle ?? "Loading…"}
        </Text>
        {truncated ? (
          <Text style={styles.truncated}>Showing 500 — expand to see more</Text>
        ) : null}
      </View>
      <View style={styles.depthGroup}>
        <Pressable
          onPress={onDecreaseDepth}
          disabled={depth <= 0}
          style={({ pressed }) => [
            styles.depthBtn,
            (pressed || depth <= 0) && styles.depthBtnDim,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Decrease graph depth"
        >
          <Text style={styles.depthBtnText}>−</Text>
        </Pressable>
        <Text style={styles.depthValue}>d={depth}</Text>
        <Pressable
          onPress={onIncreaseDepth}
          disabled={depth >= MAX_DEPTH}
          style={({ pressed }) => [
            styles.depthBtn,
            (pressed || depth >= MAX_DEPTH) && styles.depthBtnDim,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Increase graph depth"
        >
          <Text style={styles.depthBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: COLORS.dark.card,
    borderBottomColor: COLORS.dark.border,
    borderBottomWidth: 1,
    gap: 12,
  },
  titleColumn: { flex: 1, minWidth: 0 },
  label: {
    color: COLORS.dark.mutedForeground,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  title: { color: COLORS.dark.foreground, fontSize: 14, fontWeight: "600" },
  truncated: { color: COLORS.dark.mutedForeground, fontSize: 11, marginTop: 2 },
  depthGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  depthBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.dark.secondary,
  },
  depthBtnDim: { opacity: 0.4 },
  depthBtnText: { color: COLORS.dark.foreground, fontSize: 16, fontWeight: "600" },
  depthValue: {
    color: COLORS.dark.foreground,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    minWidth: 28,
    textAlign: "center",
  },
});
