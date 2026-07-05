import React from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  TextInput,
  View,
} from "react-native";
import { X } from "lucide-react-native";
import { Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import {
  composeGoalObjective,
  type GoalIntentDraft,
} from "@/lib/composer-goal-intent";

interface GoalIntentCardProps {
  visible: boolean;
  draft: GoalIntentDraft;
  colors: (typeof COLORS)["dark"];
  isDark: boolean;
  onChangeDraft: (draft: GoalIntentDraft) => void;
  onApply: (draft: GoalIntentDraft) => void;
  onCancel: () => void;
  onClear: () => void;
}

export function GoalIntentCard({
  visible,
  draft,
  colors,
  isDark,
  onChangeDraft,
  onApply,
  onCancel,
  onClear,
}: GoalIntentCardProps) {
  const objective = composeGoalObjective(draft);
  const canApply = objective.length > 0;

  function update(field: keyof GoalIntentDraft, value: string) {
    onChangeDraft({ ...draft, [field]: value });
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, justifyContent: "flex-end" }}
      >
        <Pressable
          onPress={onCancel}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: "rgba(0,0,0,0.35)",
          }}
        />
        <View
          className="px-4 pt-3 pb-5"
          style={{
            backgroundColor: isDark ? "#1c1c1e" : "#ffffff",
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
          }}
        >
          <View className="flex-row items-center justify-between pb-3">
            <Text className="text-base font-semibold">Goal</Text>
            <Pressable
              onPress={onCancel}
              accessibilityLabel="Close goal"
              hitSlop={8}
              className="p-1 active:opacity-70"
              style={{ minWidth: 44, minHeight: 44 }}
            >
              <X size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <GoalField
            label="What does done look like?"
            value={draft.doneLooksLike}
            colors={colors}
            isDark={isDark}
            onChangeText={(value) => update("doneLooksLike", value)}
          />
          <GoalField
            label="What NOT to do"
            value={draft.notToDo}
            colors={colors}
            isDark={isDark}
            onChangeText={(value) => update("notToDo", value)}
          />
          <GoalField
            label="Check in when"
            value={draft.checkInWhen}
            colors={colors}
            isDark={isDark}
            onChangeText={(value) => update("checkInWhen", value)}
          />

          <View className="mt-3 flex-row items-center justify-between gap-3">
            <Pressable
              onPress={onClear}
              className="items-center justify-center rounded-full border border-neutral-300 dark:border-neutral-700 active:opacity-70"
              style={{ minHeight: 44, paddingHorizontal: 16 }}
            >
              <Text className="text-sm font-semibold">Clear</Text>
            </Pressable>
            <View className="flex-row items-center gap-2">
              <Pressable
                onPress={onCancel}
                className="items-center justify-center rounded-full border border-neutral-300 dark:border-neutral-700 active:opacity-70"
                style={{ minHeight: 44, paddingHorizontal: 16 }}
              >
                <Text className="text-sm font-semibold">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={canApply ? () => onApply(draft) : undefined}
                disabled={!canApply}
                className="items-center justify-center rounded-full active:opacity-70"
                style={{
                  minHeight: 44,
                  paddingHorizontal: 18,
                  backgroundColor: canApply
                    ? colors.primary
                    : isDark
                      ? "#404040"
                      : "#d4d4d4",
                }}
              >
                <Text className="text-sm font-semibold text-white">Apply</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function GoalField({
  label,
  value,
  colors,
  isDark,
  onChangeText,
}: {
  label: string;
  value: string;
  colors: (typeof COLORS)["dark"];
  isDark: boolean;
  onChangeText: (value: string) => void;
}) {
  return (
    <View className="mb-3">
      <Text className="mb-1.5 text-sm font-semibold">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        multiline
        placeholderTextColor={colors.mutedForeground}
        className="rounded-xl px-3 py-2"
        style={{
          minHeight: 64,
          color: colors.foreground,
          backgroundColor: isDark ? "#2c2c2e" : "#f5f5f5",
          textAlignVertical: "top",
        }}
      />
    </View>
  );
}
