import React from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { useColorScheme } from "nativewind";
import { Text } from "@/components/ui/typography";

export const FLOATING_MENU_ROW_HEIGHT = 48;

export function FloatingMenuSurface({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";

  return (
    <View
      style={[
        {
          backgroundColor: isDark ? "#1c1c1e" : "#ffffff",
          borderRadius: 12,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: isDark ? 0.5 : 0.15,
          shadowRadius: 12,
          elevation: 8,
          borderWidth: 1,
          borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)",
          overflow: "hidden",
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function FloatingMenuItem({
  label,
  icon: Icon,
  destructive,
  separator,
  onPress,
}: {
  label: string;
  icon?: React.ComponentType<{ size: number; color: string }>;
  destructive?: boolean;
  separator?: boolean;
  onPress: () => void;
}) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const color = destructive ? "#ef4444" : isDark ? "#f5f5f5" : "#111827";

  return (
    <Pressable
      onPress={onPress}
      style={
        separator
          ? {
              borderTopWidth: 0.5,
              borderTopColor: isDark
                ? "rgba(255,255,255,0.08)"
                : "rgba(0,0,0,0.06)",
            }
          : undefined
      }
    >
      {({ pressed }) => (
        <View
          style={{
            height: FLOATING_MENU_ROW_HEIGHT,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 16,
            backgroundColor: pressed
              ? isDark
                ? "rgba(255,255,255,0.08)"
                : "rgba(0,0,0,0.04)"
              : "transparent",
          }}
        >
          {Icon ? <Icon size={16} color={color} /> : null}
          <Text numberOfLines={1} style={{ flex: 1, color }}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
