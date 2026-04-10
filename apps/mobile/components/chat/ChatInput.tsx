import React, { useState, useRef, useEffect, useCallback } from "react";
import { View, TextInput, Pressable, Platform, NativeSyntheticEvent, TextInputKeyPressEventData, useWindowDimensions } from "react-native";
import { Send } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";
import { MentionAutocomplete, type MentionCandidate } from "./MentionAutocomplete";

export interface SelectedMention {
  id: string;
  name: string;
  type: "member" | "assistant";
}

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  initialValue?: string;
  mentions?: MentionCandidate[];
  onMentionsChange?: (mentions: SelectedMention[]) => void;
}

/** Extract @mention query from text at cursor position. Returns null if not in a mention. */
function getMentionQuery(text: string, cursorPos: number): string | null {
  const before = text.slice(0, cursorPos);
  // Find the last @ before cursor that is either at start or preceded by whitespace
  const match = before.match(/@([^\s@]*)$/);
  if (!match) return null;
  return match[1]; // partial name after @
}

export function ChatInput({ onSend, disabled, initialValue, mentions = [], onMentionsChange }: ChatInputProps) {
  const [text, setText] = useState(initialValue ? initialValue + "\n" : "");
  const [cursorPos, setCursorPos] = useState(0);
  const [selectedMentions, setSelectedMentions] = useState<SelectedMention[]>([]);
  const inputRef = useRef<TextInput>(null);
  const [inputHeight, setInputHeight] = useState(40);
  const { height: windowHeight } = useWindowDimensions();
  const maxInputHeight = Math.max(Math.round(windowHeight * 0.3), 80);
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  useEffect(() => {
    if (initialValue && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 300);
    }
  }, []);

  const canSend = text.trim().length > 0 && !disabled;

  // Determine if autocomplete should be visible and what query to use
  const mentionQuery = mentions.length > 0 ? getMentionQuery(text, cursorPos) : null;
  // Debug: remove after confirming it works
  if (mentionQuery !== null) console.log("[ChatInput] mentionQuery:", mentionQuery, "candidates:", mentions.length, "cursorPos:", cursorPos);
  const autocompleteVisible = mentionQuery !== null;

  const handleSend = useCallback(() => {
    if (!canSend) return;
    onSend(text.trim());
    setText("");
    setInputHeight(40);
    setSelectedMentions([]);
    if (onMentionsChange) onMentionsChange([]);
  }, [canSend, text, onSend, onMentionsChange]);

  const handleMentionSelect = (candidate: MentionCandidate) => {
    // Replace the @partial with @Name<space>
    const before = text.slice(0, cursorPos);
    const after = text.slice(cursorPos);
    const atIndex = before.lastIndexOf("@");
    if (atIndex === -1) return;

    const newText = before.slice(0, atIndex) + "@" + candidate.name + " " + after;
    setText(newText);
    // Update cursor position immediately (onChangeText won't fire for programmatic setText)
    const newCursorPos = atIndex + candidate.name.length + 2; // @Name<space>
    setCursorPos(newCursorPos);

    // Track in selectedMentions (avoid dupes)
    const updated = selectedMentions.some((m) => m.id === candidate.id)
      ? selectedMentions
      : [...selectedMentions, { id: candidate.id, name: candidate.name, type: candidate.type }];
    setSelectedMentions(updated);
    if (onMentionsChange) onMentionsChange(updated);

    // Move native cursor after inserted mention
    setTimeout(() => {
      inputRef.current?.setNativeProps({ selection: { start: newCursorPos, end: newCursorPos } });
    }, 10);
  };

  const handleKeyPress = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (Platform.OS !== "web") return;
      const nativeEvent = e.nativeEvent as any;
      if (nativeEvent.key === "Enter" && !nativeEvent.shiftKey && !nativeEvent.metaKey && !nativeEvent.ctrlKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <View style={{ position: "relative" }}>
      <MentionAutocomplete
        query={mentionQuery ?? ""}
        candidates={mentions}
        onSelect={handleMentionSelect}
        visible={autocompleteVisible}
      />
      <View className="flex-row items-end gap-2 px-4 py-3 bg-white dark:bg-neutral-950">
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={(newText) => {
            setText(newText);
            // Use text length as fallback cursor position (covers typing without tapping)
            setCursorPos(newText.length);
          }}
          onSelectionChange={(e) => setCursorPos(e.nativeEvent.selection.end)}
          onKeyPress={handleKeyPress}
          onContentSizeChange={(e) => {
            const h = e.nativeEvent.contentSize.height;
            setInputHeight(Math.min(Math.max(h, 40), maxInputHeight));
          }}
          placeholder="Message..."
          placeholderTextColor={colors.mutedForeground}
          multiline
          maxLength={4000}
          scrollEnabled={inputHeight >= maxInputHeight}
          style={{
            flex: 1,
            height: inputHeight,
            color: colors.foreground,
            fontSize: 16,
            lineHeight: 20,
            paddingVertical: 8,
            paddingHorizontal: 12,
            backgroundColor: colorScheme === "dark" ? "#1a1a1a" : "#f5f5f5",
            borderRadius: 20,
          }}
        />
        <Pressable
          onPress={handleSend}
          disabled={!canSend}
          className="w-10 h-10 rounded-full items-center justify-center"
          style={{
            backgroundColor: colorScheme === "dark" ? "#1f1f1f" : "#f1f1f1",
          }}
        >
          <Send size={18} color={canSend ? colors.primary : colors.mutedForeground} />
        </Pressable>
      </View>
    </View>
  );
}
