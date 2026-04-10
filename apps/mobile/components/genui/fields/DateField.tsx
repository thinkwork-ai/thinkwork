import React from "react";
import { Platform, TextInput, View, useColorScheme } from "react-native";
import { Calendar } from "lucide-react-native";
import { Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";

export interface DateFieldProps {
  id: string;
  label: string;
  required?: boolean;
  value: string | undefined; // ISO YYYY-MM-DD
  disabled?: boolean;
  onChange: (value: string) => void;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * PRD-46: Date field for QuestionCard.
 *
 * Stores ISO `YYYY-MM-DD`. On web we use a native HTML5 <input type="date">
 * via react-native-web's TextInput dataDetectorTypes hack — actually the
 * cleanest path is a hidden input. For now we use a TextInput with placeholder
 * format hint and inline validation; v2 will swap in @react-native-community
 * /datetimepicker on native and a real date input on web.
 */
export function DateField({ id, label, required, value, disabled, onChange }: DateFieldProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const placeholderColor = isDark ? "#737373" : "#a3a3a3";

  const isInvalid = !!value && !ISO_DATE.test(value);

  // On web, render a real <input type="date"> for the OS picker. On native,
  // fall back to a TextInput with a format hint until we add a picker dep.
  if (Platform.OS === "web") {
    return (
      <View className="mb-4">
        <Text size="xs" weight="medium" variant="muted" className="uppercase tracking-wide mb-1.5">
          {label}{required ? " *" : ""}
        </Text>
        {/* Raw HTML input on web — gives us the OS date picker for free. */}
        <input
          type="date"
          data-testid={`questioncard-field-${id}`}
          value={value || ""}
          disabled={disabled}
          onChange={(e: any) => onChange(e.target.value)}
          style={{
            height: 44,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)",
            backgroundColor: isDark ? "#262626" : "#fff",
            color: colors.foreground,
            paddingLeft: 12,
            paddingRight: 12,
            fontSize: 16,
            opacity: disabled ? 0.6 : 1,
          }}
        />
      </View>
    );
  }

  return (
    <View className="mb-4">
      <Text size="xs" weight="medium" variant="muted" className="uppercase tracking-wide mb-1.5">
        {label}{required ? " *" : ""}
      </Text>
      <View
        className="flex-row items-center rounded-xl border px-3"
        style={{
          backgroundColor: isDark ? "#262626" : "#fff",
          borderColor: isInvalid
            ? "#ef4444"
            : (isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)"),
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <Calendar size={16} color={colors.mutedForeground} />
        <TextInput
          testID={`questioncard-field-${id}`}
          value={value || ""}
          editable={!disabled}
          onChangeText={onChange}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={placeholderColor}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
          className="flex-1 py-3 pl-2 text-base"
          style={{ color: colors.foreground }}
        />
      </View>
      {isInvalid && (
        <Text size="xs" className="mt-1 text-red-500">Use format YYYY-MM-DD</Text>
      )}
    </View>
  );
}

export default DateField;
