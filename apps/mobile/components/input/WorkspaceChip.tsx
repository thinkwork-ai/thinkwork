import React from "react";
import { View, Pressable } from "react-native";
import { X } from "lucide-react-native";
import { Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { useColorScheme } from "nativewind";

interface WorkspaceChipProps {
  name: string;
  onRemove: () => void;
}

export function WorkspaceChip({ name, onRemove }: WorkspaceChipProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;

  return (
    <View
      className="flex-row items-center rounded-full px-2.5 py-1 mr-1.5"
      style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)" }}
    >
      <Text className="text-xs font-medium mr-1" style={{ color: colors.primary }}>
        {name}
      </Text>
      <Pressable onPress={onRemove} hitSlop={8} className="active:opacity-70">
        <X size={12} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}
