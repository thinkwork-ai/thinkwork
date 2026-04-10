import React, { useState } from "react";
import { Pressable, View, useColorScheme } from "react-native";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps {
  id: string;
  label: string;
  required?: boolean;
  options: SelectOption[];
  value: string | undefined;
  disabled?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}

/**
 * PRD-46: Single-choice select field for QuestionCard.
 * Uses an inline expanding picker (matches QuickActionFormSheet pattern).
 */
export function SelectField({
  id,
  label,
  required,
  options,
  value,
  disabled,
  placeholder = "Select…",
  onChange,
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const selectedLabel = options.find((o) => o.value === value)?.label;

  return (
    <View className="mb-4">
      <Text size="xs" weight="medium" variant="muted" className="uppercase tracking-wide mb-1.5">
        {label}{required ? " *" : ""}
      </Text>
      <Pressable
        testID={`questioncard-field-${id}`}
        onPress={disabled ? undefined : () => setOpen((p) => !p)}
        className="flex-row items-center justify-between rounded-xl border px-3 py-3"
        style={{
          backgroundColor: isDark ? "#262626" : "#fff",
          borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <Text size="base" style={{ color: selectedLabel ? colors.foreground : colors.mutedForeground }}>
          {selectedLabel || placeholder}
        </Text>
        {open
          ? <ChevronUp size={18} color={colors.mutedForeground} />
          : <ChevronDown size={18} color={colors.mutedForeground} />}
      </Pressable>
      {open && (
        <View
          className="mt-1 rounded-xl overflow-hidden"
          style={{
            borderWidth: 1,
            borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)",
            backgroundColor: isDark ? "#262626" : "#fff",
          }}
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <Pressable
                key={opt.value}
                testID={`questioncard-field-${id}-option-${opt.value}`}
                onPress={() => { onChange(opt.value); setOpen(false); }}
                className="px-3 py-2.5 active:opacity-70"
                style={{
                  borderBottomWidth: 0.5,
                  borderBottomColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                  backgroundColor: active ? (isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)") : "transparent",
                }}
              >
                <Text size="sm" style={{ color: colors.foreground }}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

export default SelectField;
