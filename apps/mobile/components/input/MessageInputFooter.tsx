import React, { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from "react";
import { View, TextInput, Pressable, Platform, Keyboard, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowUp, Plus, Zap, Mic } from "lucide-react-native";
import { COLORS } from "@/lib/theme";
import { VoiceDictationBar } from "./VoiceDictationBar";
import { WorkspaceChip } from "./WorkspaceChip";

export interface SelectedWorkspace {
  id: string;
  name: string;
}

interface MessageInputFooterProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  colors: (typeof COLORS)["dark"];
  isDark: boolean;
  /** Show the quick actions button (Zap icon) */
  onQuickActions?: () => void;
  /** Skip bottom safe area inset (when parent already handles it) */
  skipBottomInset?: boolean;
  /** Open workspace picker (+ button) */
  onPlusPress?: () => void;
  /** Currently selected workspaces shown as chips */
  selectedWorkspaces?: SelectedWorkspace[];
  /** Remove a workspace chip */
  onRemoveWorkspace?: (id: string) => void;
}

export interface MessageInputFooterRef {
  focus: () => void;
}

export const MessageInputFooter = forwardRef<MessageInputFooterRef, MessageInputFooterProps>(function MessageInputFooter({
  value,
  onChangeText,
  onSubmit,
  placeholder = "Message...",
  colors,
  isDark,
  skipBottomInset,
  onQuickActions,
  onPlusPress,
  selectedWorkspaces,
  onRemoveWorkspace,
}, ref) {
  const inputRef = useRef<TextInput>(null);
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));
  const [isDictating, setIsDictating] = useState(false);
  const insets = useSafeAreaInsets();

  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const showSub = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setKeyboardVisible(false));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const handleSubmit = useCallback(() => {
    if (!value.trim()) return;
    onSubmit();
  }, [value, onSubmit]);

  const hasWorkspaces = selectedWorkspaces && selectedWorkspaces.length > 0;

  return (
    <View
      className="border-t border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900"
      style={{ borderTopLeftRadius: 16, borderTopRightRadius: 16, overflow: "hidden", paddingBottom: keyboardVisible ? 4 : (skipBottomInset ? 4 : insets.bottom) }}
    >
      {/* Workspace chips row */}
      {hasWorkspaces && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8 }}
        >
          {selectedWorkspaces.map((ws) => (
            <WorkspaceChip
              key={ws.id}
              name={ws.name}
              onRemove={() => onRemoveWorkspace?.(ws.id)}
            />
          ))}
        </ScrollView>
      )}

      {/* Text input */}
      <View className="px-4 pt-3">
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          multiline
          className="max-h-[120px]"
          style={{ color: colors.foreground, fontSize: 18, lineHeight: 24, paddingTop: 4, paddingBottom: 4 }}
          returnKeyType="default"
          blurOnSubmit={false}
          onSubmitEditing={Platform.OS === "web" ? handleSubmit : undefined}
        />
      </View>

      {/* Action buttons row / Dictation bar */}
      {isDictating ? (
        <VoiceDictationBar
          onInterim={(text) => onChangeText(text)}
          onTranscript={(text) => {
            onChangeText(text);
            setIsDictating(false);
          }}
          onCancel={() => setIsDictating(false)}
          colors={colors}
          isDark={isDark}
        />
      ) : (
        <View className="flex-row items-center justify-between px-4 pt-1 pb-2">
          <View className="flex-row items-center gap-4">
            {onPlusPress && (
              <Pressable onPress={onPlusPress} className="p-1 active:opacity-70">
                <Plus size={26} color={colors.mutedForeground} />
              </Pressable>
            )}
            {onQuickActions && (
              <Pressable onPress={onQuickActions} className="p-1 active:opacity-70">
                <Zap size={24} color={colors.mutedForeground} />
              </Pressable>
            )}
          </View>
          <View className="flex-row items-center gap-4">
            <Pressable onPress={() => setIsDictating(true)} className="p-1 active:opacity-70">
              <Mic size={24} color={colors.mutedForeground} />
            </Pressable>
            <Pressable
              onPress={handleSubmit}
              disabled={!value.trim()}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: value.trim() ? colors.primary : isDark ? "#404040" : "#d4d4d4",
              }}
            >
              <ArrowUp size={20} strokeWidth={2.5} color={value.trim() ? "#ffffff" : isDark ? "#737373" : "#a3a3a3"} />
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
});
