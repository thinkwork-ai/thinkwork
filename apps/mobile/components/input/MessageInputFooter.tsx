import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  View,
  Text,
  TextInput,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
  type TextInputSelectionChangeEventData,
  type ViewStyle,
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
import {
  ComposerPickerOverlay,
  MentionAutocomplete,
  type MentionCandidate,
  type ComposerPickerOption,
} from "@/components/chat/MentionAutocomplete";
import { currentMentionQuery } from "@/lib/thread-mentions";

export interface SelectedWorkspace {
  id: string;
  name: string;
}

export interface SelectedSpace {
  id: string | null;
  name: string;
}

export interface MessageInputMention {
  id: string;
  targetType: "USER" | "AGENT";
  targetId: string;
  displayName: string;
  rawText: string;
  type: "member" | "assistant";
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
  /** Mention candidates exposed by the current thread or tenant context. */
  mentionCandidates?: MentionCandidate[];
  selectedMentions?: MessageInputMention[];
  onMentionsChange?: (mentions: MessageInputMention[]) => void;
  /** A local URI for the pending attached image, shown as a removable chip above the input. */
  attachedImageUri?: string | null;
  /** Display name for a pending attached file. */
  attachedFileName?: string | null;
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
  spaceOptions?: SelectedSpace[];
  onSpaceSelect?: (space: SelectedSpace) => void;
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
    mentionCandidates = [],
    selectedMentions = [],
    onMentionsChange,
    attachedImageUri,
    attachedFileName,
    onRemoveAttachment,
    agentEnabled,
    onToggleAgent,
    onSpacePress,
    spaceOptions = [],
    onSpaceSelect,
    selectedSpace,
    disabled,
    selectedWorkspaces,
    onRemoveWorkspace,
  },
  ref,
) {
  const containerRef = useRef<View>(null);
  const inputRef = useRef<TextInput>(null);
  const inputAnchorRef = useRef<View>(null);
  const spaceAnchorRef = useRef<View>(null);
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));
  const [isDictating, setIsDictating] = useState(false);
  const [draftValue, setDraftValue] = useState(value);
  const [cursorPos, setCursorPos] = useState(value.length);
  const [composerHeight, setComposerHeight] = useState(0);
  const [rootWidth, setRootWidth] = useState(0);
  const [inputAnchor, setInputAnchor] = useState<{
    x: number;
    width: number;
  } | null>(null);
  const [spaceAnchor, setSpaceAnchor] = useState<{
    x: number;
    width: number;
  } | null>(null);
  const [spacePickerVisible, setSpacePickerVisible] = useState(false);
  const [dismissedMentionKey, setDismissedMentionKey] = useState<string | null>(
    null,
  );
  const insets = useSafeAreaInsets();

  useEffect(() => {
    setDraftValue(value);
    setCursorPos((pos) => Math.min(pos, value.length));
  }, [value]);

  const commitText = useCallback(
    (nextText: string, nextCursor = nextText.length) => {
      setDraftValue(nextText);
      setCursorPos(nextCursor);
      onChangeText(nextText);
    },
    [onChangeText],
  );

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

  // A turn is sendable with text OR a visible native attachment.
  const canSubmit =
    !disabled &&
    (draftValue.trim().length > 0 || !!attachedImageUri || !!attachedFileName);

  const handleSubmit = useCallback(() => {
    if (
      disabled ||
      (!draftValue.trim() && !attachedImageUri && !attachedFileName)
    )
      return;
    onSubmit();
  }, [disabled, draftValue, attachedImageUri, attachedFileName, onSubmit]);

  const hasWorkspaces = selectedWorkspaces && selectedWorkspaces.length > 0;
  const mentionQuery = currentMentionQuery(draftValue, cursorPos);
  const mentionKey =
    mentionQuery === null ? null : `${draftValue}:${cursorPos}:${mentionQuery}`;
  const autocompleteVisible =
    mentionQuery !== null && mentionCandidates.length > 0;
  const mentionPickerVisible =
    autocompleteVisible &&
    !spacePickerVisible &&
    mentionKey !== dismissedMentionKey;
  const visibleSpaceOptions = useMemo(
    () =>
      spaceOptions.map((space) => ({
        id: space.id ?? "__default__",
        label: space.name,
        space,
      })),
    [spaceOptions],
  );

  const measureAnchor = useCallback(
    (
      anchorRef: React.RefObject<View | null>,
      setAnchor: (anchor: { x: number; width: number }) => void,
    ) => {
      const root = containerRef.current;
      const anchor = anchorRef.current;
      if (!root || !anchor) return;

      root.measureInWindow((rootX, _rootY, rootMeasuredWidth) => {
        anchor.measureInWindow((anchorX, _anchorY, width) => {
          setRootWidth(rootMeasuredWidth);
          setAnchor({
            x: anchorX - rootX,
            width,
          });
        });
      });
    },
    [],
  );

  useEffect(() => {
    if (autocompleteVisible) {
      setSpacePickerVisible(false);
      measureAnchor(inputAnchorRef, setInputAnchor);
    }
  }, [autocompleteVisible, measureAnchor]);

  useEffect(() => {
    if (!onMentionsChange || selectedMentions.length === 0) return;
    const filtered = selectedMentions.filter((mention) =>
      draftValue.includes(mention.rawText),
    );
    if (filtered.length !== selectedMentions.length) {
      onMentionsChange(filtered);
    }
  }, [draftValue, onMentionsChange, selectedMentions]);

  function handleMentionSelect(candidate: MentionCandidate) {
    const before = draftValue.slice(0, cursorPos);
    const after = draftValue.slice(cursorPos);
    const atIndex = before.lastIndexOf("@");
    if (atIndex === -1) return;

    const displayName = candidate.displayName ?? candidate.name;
    const rawText = `@${displayName}`;
    const nextValue = `${before.slice(0, atIndex)}${rawText} ${after}`;
    const nextCursor = atIndex + rawText.length + 1;
    commitText(nextValue, nextCursor);
    setDismissedMentionKey(null);
    setSpacePickerVisible(false);

    const targetType =
      candidate.targetType ??
      (candidate.type === "assistant" ? "AGENT" : "USER");
    const targetId = candidate.targetId ?? candidate.id;
    const mention: MessageInputMention = {
      id: candidate.id,
      targetType,
      targetId,
      displayName,
      rawText,
      type: candidate.type,
    };
    const nextMentions = selectedMentions.some(
      (item) =>
        item.targetType === mention.targetType &&
        item.targetId === mention.targetId,
    )
      ? selectedMentions
      : [...selectedMentions, mention];
    onMentionsChange?.(nextMentions);

    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.setNativeProps({
        selection: { start: nextCursor, end: nextCursor },
      });
    }, 10);
  }

  function handleSelectionChange(
    event: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
  ) {
    setCursorPos(event.nativeEvent.selection.end);
  }

  function handleKeyPress(
    event: NativeSyntheticEvent<TextInputKeyPressEventData>,
  ) {
    if (event.nativeEvent.key !== "Backspace") return;

    const safeCursorPos = Math.max(0, Math.min(cursorPos, draftValue.length));
    if (safeCursorPos === 0) return;

    const nextText =
      draftValue.slice(0, safeCursorPos - 1) + draftValue.slice(safeCursorPos);
    const nextCursor = safeCursorPos - 1;
    const wasMentioning = currentMentionQuery(draftValue, safeCursorPos);
    const willBeMentioning = currentMentionQuery(nextText, nextCursor);

    if (wasMentioning !== null && willBeMentioning === null) {
      commitText(nextText, nextCursor);
    }
  }

  function handleComposerLayout(event: LayoutChangeEvent) {
    setComposerHeight(event.nativeEvent.layout.height);
    setRootWidth(event.nativeEvent.layout.width);
  }

  function handleSpacePress() {
    if (disabled) return;
    if (onSpaceSelect && visibleSpaceOptions.length > 0) {
      Keyboard.dismiss();
      measureAnchor(spaceAnchorRef, setSpaceAnchor);
      if (mentionKey) setDismissedMentionKey(mentionKey);
      setSpacePickerVisible((visible) => !visible);
      return;
    }
    onSpacePress?.();
  }

  function handleSpaceSelect(
    option: ComposerPickerOption & {
      space: SelectedSpace;
    },
  ) {
    setSpacePickerVisible(false);
    onSpaceSelect?.(option.space);
  }

  function handlePickerDismiss() {
    if (mentionKey) setDismissedMentionKey(mentionKey);
    setSpacePickerVisible(false);
  }

  function getAnchoredPickerStyle(
    anchor: { x: number; width: number } | null,
  ): { style: ViewStyle; width: number } {
    const horizontalInset = 16;
    const maxPickerWidth = 280;
    const availableWidth = Math.max(rootWidth - horizontalInset * 2, 0);
    const width = Math.min(maxPickerWidth, availableWidth || maxPickerWidth);
    const fallbackX = horizontalInset;
    const desiredLeft = anchor
      ? anchor.x + Math.min(anchor.width, width) / 2 - width / 2
      : fallbackX;
    const left = Math.min(
      Math.max(desiredLeft, horizontalInset),
      Math.max(rootWidth - width - horizontalInset, horizontalInset),
    );

    return {
      width,
      style: {
        position: "absolute",
        left,
        bottom: Math.max(composerHeight + 6, 0),
        zIndex: 20,
        elevation: 20,
      },
    };
  }

  const mentionPicker = getAnchoredPickerStyle(inputAnchor);
  const spacePicker = getAnchoredPickerStyle(spaceAnchor);
  const pickerOpen = mentionPickerVisible || spacePickerVisible;

  return (
    <View
      ref={containerRef}
      style={{ position: "relative", overflow: "visible" }}
    >
      <View
        onLayout={handleComposerLayout}
        className="border-t border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900"
        style={{
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          overflow: "hidden",
          position: "relative",
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

        {attachedFileName ? (
          <View className="px-4 pt-3">
            <View
              className="flex-row items-center gap-2 border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800"
              style={{
                alignSelf: "flex-start",
                borderRadius: 12,
                paddingHorizontal: 10,
                paddingVertical: 8,
                maxWidth: "85%",
              }}
            >
              <Paperclip size={16} color={colors.mutedForeground} />
              <Text
                numberOfLines={1}
                style={{
                  color: colors.foreground,
                  fontSize: 14,
                  maxWidth: 220,
                }}
              >
                {attachedFileName}
              </Text>
              {onRemoveAttachment ? (
                <Pressable onPress={onRemoveAttachment} hitSlop={8}>
                  <X
                    size={16}
                    color={colors.mutedForeground}
                    strokeWidth={2.5}
                  />
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* Text input */}
        <View ref={inputAnchorRef} className="px-4 pt-3">
          <TextInput
            ref={inputRef}
            value={draftValue}
            onChangeText={(nextText) => {
              setSpacePickerVisible(false);
              setDismissedMentionKey(null);
              commitText(nextText);
            }}
            onSelectionChange={handleSelectionChange}
            onKeyPress={handleKeyPress}
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
            onInterim={(text) => commitText(text)}
            onTranscript={(text) => {
              commitText(text);
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
              {(onSpacePress || onSpaceSelect) && (
                <View ref={spaceAnchorRef}>
                  <Pressable
                    onPress={handleSpacePress}
                    disabled={disabled}
                    // Borderless/transparent to match the desktop composer's space picker —
                    // it sits inline with the other toolbar icons, no filled pill.
                    className="flex-row items-center gap-1.5 active:opacity-70"
                    style={{
                      minHeight: 32,
                      paddingTop: 2,
                      opacity: disabled ? 0.35 : 1,
                    }}
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
                </View>
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
                  color={canSubmit ? "#ffffff" : isDark ? "#737373" : "#a3a3a3"}
                />
              </Pressable>
            </View>
          </View>
        )}
      </View>

      {pickerOpen ? (
        <Pressable
          onPress={handlePickerDismiss}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: Math.max(composerHeight, 0),
            height: 2000,
            zIndex: 19,
            elevation: 19,
          }}
        />
      ) : null}
      <MentionAutocomplete
        query={mentionQuery ?? ""}
        candidates={mentionCandidates}
        onSelect={handleMentionSelect}
        visible={mentionPickerVisible}
        style={mentionPicker.style}
        width={mentionPicker.width}
      />
      <ComposerPickerOverlay
        options={visibleSpaceOptions}
        onSelect={handleSpaceSelect}
        visible={spacePickerVisible}
        style={spacePicker.style}
        width={spacePicker.width}
      />
    </View>
  );
});
