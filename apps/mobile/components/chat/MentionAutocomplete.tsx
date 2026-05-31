import React from "react";
import { View, ScrollView, type StyleProp, type ViewStyle } from "react-native";
import {
  FLOATING_MENU_ROW_HEIGHT,
  FloatingMenuItem,
  FloatingMenuSurface,
} from "@/components/ui/floating-menu";

export interface MentionCandidate {
  id: string;
  name: string;
  type: "member" | "assistant";
  targetId?: string;
  targetType?: "USER" | "AGENT";
  displayName?: string;
  rawText?: string;
}

export const COMPOSER_PICKER_VISIBLE_ROWS = 5;
export const COMPOSER_PICKER_HEIGHT =
  FLOATING_MENU_ROW_HEIGHT * COMPOSER_PICKER_VISIBLE_ROWS;

export interface ComposerPickerOption {
  id: string;
  label: string;
}

interface ComposerPickerOverlayProps<T extends ComposerPickerOption> {
  options: T[];
  onSelect: (option: T) => void;
  visible: boolean;
  style?: StyleProp<ViewStyle>;
  width?: number;
}

interface MentionAutocompleteProps {
  query: string;
  candidates: MentionCandidate[];
  onSelect: (candidate: MentionCandidate) => void;
  visible: boolean;
  style?: StyleProp<ViewStyle>;
  width?: number;
}

export function ComposerPickerOverlay<T extends ComposerPickerOption>({
  options,
  onSelect,
  visible,
  style,
  width,
}: ComposerPickerOverlayProps<T>) {
  if (!visible || options.length === 0) return null;

  return (
    <FloatingMenuSurface
      style={[
        {
          width,
          height:
            Math.min(options.length, COMPOSER_PICKER_VISIBLE_ROWS) *
            FLOATING_MENU_ROW_HEIGHT,
          maxHeight: COMPOSER_PICKER_HEIGHT,
        },
        style,
      ]}
    >
      <ScrollView keyboardShouldPersistTaps="always">
        {options.map((option) => (
          <FloatingMenuItem
            key={option.id}
            label={option.label}
            onPress={() => onSelect(option)}
          />
        ))}
      </ScrollView>
    </FloatingMenuSurface>
  );
}

export function MentionAutocomplete({
  query,
  candidates,
  onSelect,
  visible,
  style,
  width,
}: MentionAutocompleteProps) {
  if (!visible) return null;

  const filtered = candidates
    .filter((c) => c.name.toLowerCase().startsWith(query.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 6);

  if (filtered.length === 0) return null;

  return (
    <ComposerPickerOverlay
      options={filtered.map((candidate) => ({
        ...candidate,
        label: candidate.name,
      }))}
      onSelect={onSelect}
      visible={visible}
      style={style}
      width={width}
    />
  );
}
