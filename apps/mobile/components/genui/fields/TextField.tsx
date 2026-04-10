import React from "react";
import { TextInput, View, useColorScheme, Platform } from "react-native";
import { Text } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

export interface TextFieldProps {
  id: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  multiline?: boolean;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

/**
 * PRD-46: Text / textarea field for QuestionCard.
 * `multiline=true` renders a 4-line textarea, otherwise a single-line input.
 */
export function TextField({
  id,
  label,
  required,
  placeholder,
  multiline,
  value,
  disabled,
  onChange,
}: TextFieldProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const placeholderColor = isDark ? "#737373" : "#a3a3a3";

  return (
    <View className="mb-4">
      <Text size="xs" weight="medium" variant="muted" className="uppercase tracking-wide mb-1.5">
        {label}{required ? " *" : ""}
      </Text>
      <TextInput
        testID={`questioncard-field-${id}`}
        value={value}
        editable={!disabled}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={placeholderColor}
        multiline={!!multiline}
        numberOfLines={multiline ? 4 : 1}
        className={cn(
          "rounded-xl border px-3 py-3 text-base",
          isDark ? "bg-neutral-800 border-neutral-700 text-neutral-100" : "bg-white border-neutral-300 text-neutral-900",
          disabled && "opacity-60",
        )}
        style={[
          multiline ? { minHeight: 96, textAlignVertical: "top" } : undefined,
          Platform.OS === "android" && !multiline ? { textAlignVertical: "center" as const } : undefined,
        ].filter(Boolean) as any}
      />
    </View>
  );
}

export default TextField;
