import React, { forwardRef } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { COLORS } from "@/lib/theme";
import {
  formatComposerModelProvider,
  selectedModelForId,
  shouldRenderModelPicker,
  type ApprovedComposerModel,
} from "@/lib/composer-model-selection";

export interface ComposerModelPickerProps {
  models?: ApprovedComposerModel[] | null;
  value?: string | null;
  disabled?: boolean;
  colors: (typeof COLORS)["dark"];
  onPress: () => void;
}

export const ComposerModelPicker = forwardRef<View, ComposerModelPickerProps>(
  function ComposerModelPicker(
    { models, value, disabled = false, colors, onPress },
    ref,
  ) {
    if (!shouldRenderModelPicker(models)) return null;

    const selected = selectedModelForId(models, value);
    const label = selected?.displayName ?? "Model";
    const provider = selected
      ? formatComposerModelProvider(selected.provider)
      : null;

    return (
      <View ref={ref}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Select model"
          onPress={disabled ? undefined : onPress}
          disabled={disabled}
          className="flex-row items-center gap-1 active:opacity-70"
          hitSlop={8}
          style={{
            minHeight: 44,
            maxWidth: 150,
            opacity: disabled ? 0.35 : 1,
          }}
        >
          <View style={{ minWidth: 0 }}>
            <Text
              numberOfLines={1}
              style={{
                color: selected ? colors.foreground : colors.mutedForeground,
                fontSize: 14,
                fontWeight: "600",
                maxWidth: 116,
              }}
            >
              {label}
            </Text>
            {provider ? (
              <Text
                numberOfLines={1}
                style={{
                  color: colors.mutedForeground,
                  fontSize: 11,
                  maxWidth: 116,
                }}
              >
                {provider}
              </Text>
            ) : null}
          </View>
          <ChevronDown size={16} color={colors.mutedForeground} />
        </Pressable>
      </View>
    );
  },
);
