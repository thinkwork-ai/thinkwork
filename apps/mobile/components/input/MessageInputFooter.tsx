import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Platform,
  Keyboard,
  ScrollView,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowUp,
  Mic,
  ChevronDown,
  Paperclip,
  Bot,
  X,
} from "lucide-react-native";
import { IconPlanet } from "@tabler/icons-react-native";
import { COLORS } from "@/lib/theme";
import { VoiceDictationBar } from "./VoiceDictationBar";
import { WorkspaceChip } from "./WorkspaceChip";

export interface SelectedWorkspace {
  id: string;
  name: string;
}

export interface SelectedSpace {
  id: string | null;
  name: string;
}

interface MessageInputFooterProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  colors: (typeof COLORS)["dark"];
  isDark: boolean;
  /** Skip bottom safe area inset (when parent already handles it) */
  skipBottomInset?: boolean;
  /** Open the image attach flow (paperclip). Library/Camera choice is owned by the parent. */
  onAttach?: () => void;
  /** A local URI for the pending attached image, shown as a removable chip above the input. */
  attachedImageUri?: string | null;
  /** Remove the pending attached image. */
  onRemoveAttachment?: () => void;
  /**
   * Agent toggle (Bot). When provided, renders the toggle: on = the agent
   * responds (harness turn); off = plain message (no agent). Omit to hide.
   */
  agentEnabled?: boolean;
  onToggleAgent?: () => void;
  /** Open the space picker. */
  onSpacePress?: () => void;
  selectedSpace?: SelectedSpace | null;
  /** Disable composing and submission while keeping the footer visible. */
  disabled?: boolean;
  /** Currently selected workspaces shown as chips */
  selectedWorkspaces?: SelectedWorkspace[];
  /** Remove a workspace chip */
  onRemoveWorkspace?: (id: string) => void;
}

export interface MessageInputFooterRef {
  focus: () => void;
}

export const MessageInputFooter = forwardRef<
  MessageInputFooterRef,
  MessageInputFooterProps
>(function MessageInputFooter(
  {
    value,
    onChangeText,
    onSubmit,
    placeholder = "Message...",
    colors,
    isDark,
    skipBottomInset,
    onAttach,
    attachedImageUri,
    onRemoveAttachment,
    agentEnabled,
    onToggleAgent,
    onSpacePress,
    selectedSpace,
    disabled,
    selectedWorkspaces,
    onRemoveWorkspace,
  },
  ref,
) {
  const inputRef = useRef<TextInput>(null);
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));
  const [isDictating, setIsDictating] = useState(false);
  const insets = useSafeAreaInsets();

  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const showSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setKeyboardVisible(true),
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardVisible(false),
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // A turn is sendable with text OR an attached image (an image-only turn is valid —
  // "make an opportunity from this card" with just the photo).
  const canSubmit = !disabled && (value.trim().length > 0 || !!attachedImageUri);

  const handleSubmit = useCallback(() => {
    if (disabled || (!value.trim() && !attachedImageUri)) return;
    onSubmit();
  }, [disabled, value, attachedImageUri, onSubmit]);

  const hasWorkspaces = selectedWorkspaces && selectedWorkspaces.length > 0;

  return (
    <View
      className="border-t border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900"
      style={{
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        overflow: "hidden",
        paddingBottom: keyboardVisible
          ? 4
          : skipBottomInset
            ? 4
            : insets.bottom,
      }}
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

      {/* Pending attached image chip */}
      {attachedImageUri ? (
        <View className="px-4 pt-3">
          <View
            style={{
              alignSelf: "flex-start",
              borderRadius: 12,
              overflow: "hidden",
              position: "relative",
            }}
          >
            <Image
              source={{ uri: attachedImageUri }}
              style={{ width: 64, height: 64, borderRadius: 12 }}
            />
            {onRemoveAttachment ? (
              <Pressable
                onPress={onRemoveAttachment}
                hitSlop={8}
                style={{
                  position: "absolute",
                  top: 2,
                  right: 2,
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(0,0,0,0.6)",
                }}
              >
                <X size={14} color="#ffffff" strokeWidth={2.5} />
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Text input */}
      <View className="px-4 pt-3">
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          multiline
          editable={!disabled}
          className="max-h-[120px]"
          style={{
            color: colors.foreground,
            fontSize: 18,
            lineHeight: 24,
            paddingTop: 4,
            paddingBottom: 4,
          }}
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
            {onToggleAgent && (
              <Pressable
                onPress={disabled ? undefined : onToggleAgent}
                disabled={disabled}
                accessibilityLabel="Send to agent"
                accessibilityState={{ selected: agentEnabled }}
                className="p-1 active:opacity-70"
                style={{ opacity: disabled ? 0.35 : 1 }}
              >
                <Bot
                  size={24}
                  color={agentEnabled ? "#54a9ff" : colors.mutedForeground}
                />
              </Pressable>
            )}
            {onAttach && (
              <Pressable
                onPress={disabled ? undefined : onAttach}
                disabled={disabled}
                accessibilityLabel="Attach image"
                className="p-1 active:opacity-70"
                style={{ opacity: disabled ? 0.35 : 1 }}
              >
                <Paperclip size={24} color={colors.mutedForeground} />
              </Pressable>
            )}
            {onSpacePress && (
              <Pressable
                onPress={disabled ? undefined : onSpacePress}
                disabled={disabled}
                // Borderless/transparent to match the desktop composer's space picker —
                // it sits inline with the other toolbar icons, no filled pill.
                className="flex-row items-center gap-1.5 active:opacity-70"
                style={{ minHeight: 32, opacity: disabled ? 0.35 : 1 }}
              >
                <IconPlanet size={24} color={colors.mutedForeground} />
                <Text
                  style={{
                    color: colors.mutedForeground,
                    fontSize: 18,
                    maxWidth: 140,
                  }}
                  numberOfLines={1}
                >
                  {selectedSpace?.name ?? "Default"}
                </Text>
                <ChevronDown size={20} color={colors.mutedForeground} />
              </Pressable>
            )}
          </View>
          <View className="flex-row items-center gap-4">
            <Pressable
              onPress={disabled ? undefined : () => setIsDictating(true)}
              disabled={disabled}
              className="p-1 active:opacity-70"
              style={{ opacity: disabled ? 0.35 : 1 }}
            >
              <Mic size={24} color={colors.mutedForeground} />
            </Pressable>
            <Pressable
              onPress={handleSubmit}
              disabled={!canSubmit}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: canSubmit
                  ? colors.primary
                  : isDark
                    ? "#404040"
                    : "#d4d4d4",
              }}
            >
              <ArrowUp
                size={20}
                strokeWidth={2.5}
                color={
                  canSubmit ? "#ffffff" : isDark ? "#737373" : "#a3a3a3"
                }
              />
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
});
