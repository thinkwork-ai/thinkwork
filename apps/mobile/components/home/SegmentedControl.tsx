import React from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { useColorScheme } from "nativewind";
import { Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";

export interface SegmentOption {
  key: string;
  label: string;
}

interface SegmentedControlProps {
  segments: readonly SegmentOption[];
  activeKey: string;
  onChange: (key: string) => void;
}

export function segmentPanelStyle(
  segmentKey: string,
  activeKey: string,
): ViewStyle {
  return {
    flex: 1,
    display: segmentKey === activeKey ? "flex" : "none",
  };
}

export function SegmentedControl({
  segments,
  activeKey,
  onChange,
}: SegmentedControlProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;

  return (
    <View
      className="border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 items-center justify-center"
      style={{ paddingTop: 6, paddingBottom: 8 }}
    >
      <View
        className="flex-row rounded-full bg-neutral-200 dark:bg-neutral-800"
        style={{ padding: 2 }}
      >
        {segments.map((segment) => {
          const selected = segment.key === activeKey;
          return (
            <Pressable
              key={segment.key}
              onPress={() => onChange(segment.key)}
              className="items-center justify-center rounded-full"
              style={{
                minWidth: 84,
                paddingHorizontal: 16,
                paddingVertical: 5,
                backgroundColor: selected
                  ? isDark
                    ? "#525252"
                    : "#ffffff"
                  : "transparent",
              }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              hitSlop={8}
            >
              <Text
                className="text-sm font-semibold"
                style={{
                  color: selected ? colors.foreground : colors.mutedForeground,
                }}
                numberOfLines={1}
              >
                {segment.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function PersistentSegmentPanels<TSegment extends SegmentOption>({
  segments,
  activeKey,
  renderSegment,
}: {
  segments: readonly TSegment[];
  activeKey: string;
  renderSegment: (segment: TSegment) => React.ReactNode;
}) {
  return (
    <>
      {segments.map((segment) => (
        <View key={segment.key} style={segmentPanelStyle(segment.key, activeKey)}>
          {renderSegment(segment)}
        </View>
      ))}
    </>
  );
}
