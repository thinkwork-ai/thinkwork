import React from "react";
import { Pressable, View } from "react-native";
import { Search } from "lucide-react-native";
import {
  IconList,
  IconTopologyStar3,
} from "@tabler/icons-react-native";
import { Text } from "@/components/ui/typography";
import type { COLORS } from "@/lib/theme";
import type { BrainMode } from "./types";

const MODES: Array<{
  mode: BrainMode;
  label: string;
  icon: "search" | "pages" | "graph";
}> = [
  { mode: "search", label: "Search", icon: "search" },
  { mode: "pages", label: "Pages", icon: "pages" },
  { mode: "graph", label: "Graph", icon: "graph" },
];

interface BrainModeSwitchProps {
  mode: BrainMode;
  onModeChange: (mode: BrainMode) => void;
  colors: (typeof COLORS)["dark"];
  isDark: boolean;
}

export function BrainModeSwitch({
  mode,
  onModeChange,
  colors,
  isDark,
}: BrainModeSwitchProps) {
  return (
    <View
      className="px-4 py-2 bg-white dark:bg-black border-b border-neutral-200 dark:border-neutral-900"
      style={{ backgroundColor: colors.background, borderColor: colors.border }}
    >
      <View
        className="flex-row rounded-full"
        style={{
          backgroundColor: isDark ? "#171717" : "#f5f5f5",
          padding: 2,
        }}
      >
        {MODES.map((item) => {
          const selected = item.mode === mode;
          return (
            <Pressable
              key={item.mode}
              onPress={() => onModeChange(item.mode)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`Brain ${item.label}`}
              className="flex-1 flex-row items-center justify-center gap-1.5 rounded-full"
              style={{
                minHeight: 34,
                backgroundColor: selected
                  ? isDark
                    ? "#404040"
                    : "#ffffff"
                  : "transparent",
              }}
            >
              {item.icon === "search" ? (
                <Search
                  size={15}
                  color={selected ? colors.foreground : colors.mutedForeground}
                />
              ) : item.icon === "pages" ? (
                <IconList
                  size={15}
                  color={selected ? colors.foreground : colors.mutedForeground}
                  strokeWidth={2}
                />
              ) : (
                <IconTopologyStar3
                  size={15}
                  color={selected ? colors.foreground : colors.mutedForeground}
                  strokeWidth={2}
                />
              )}
              <Text
                style={{
                  color: selected ? colors.foreground : colors.mutedForeground,
                  fontSize: 13,
                  fontWeight: "700",
                }}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
