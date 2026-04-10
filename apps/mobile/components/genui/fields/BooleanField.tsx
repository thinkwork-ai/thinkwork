import React from "react";
import { Pressable, View, useColorScheme } from "react-native";
import { Check } from "lucide-react-native";
import { Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";

export interface BooleanFieldProps {
  id: string;
  label: string;
  required?: boolean;
  value: boolean | undefined;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}

/**
 * PRD-46: Boolean (yes/no) field for QuestionCard.
 * Renders as two pressable pills (Yes / No) — clearer than a toggle on a
 * touchscreen and works without a Switch primitive.
 */
export function BooleanField({ id, label, required, value, disabled, onChange }: BooleanFieldProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;

  const Pill = ({ active, label: pillLabel, onPress }: { active: boolean; label: string; onPress: () => void }) => (
    <Pressable
      testID={`questioncard-field-${id}-${pillLabel.toLowerCase()}`}
      onPress={disabled ? undefined : onPress}
      className="flex-row items-center justify-center gap-1 rounded-full px-4 py-2 active:opacity-70"
      style={{
        backgroundColor: active ? colors.primary : "transparent",
        borderWidth: 1,
        borderColor: active ? colors.primary : (isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.15)"),
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {active && <Check size={14} color={colors.primaryForeground} strokeWidth={2.5} />}
      <Text size="sm" weight="medium" style={{ color: active ? colors.primaryForeground : colors.foreground }}>
        {pillLabel}
      </Text>
    </Pressable>
  );

  return (
    <View className="mb-4">
      <Text size="xs" weight="medium" variant="muted" className="uppercase tracking-wide mb-1.5">
        {label}{required ? " *" : ""}
      </Text>
      <View className="flex-row gap-2">
        <Pill active={value === true} label="Yes" onPress={() => onChange(true)} />
        <Pill active={value === false} label="No" onPress={() => onChange(false)} />
      </View>
    </View>
  );
}

export default BooleanField;
