import React, { useCallback, useState } from "react";
import { Alert, Keyboard } from "react-native";
import { useCaptureMobileMemory } from "@thinkwork/react-native-sdk";
import { MessageInputFooter } from "@/components/input/MessageInputFooter";
import type { COLORS } from "@/lib/theme";

interface CaptureFooterProps {
  agentId: string | null | undefined;
  agentName: string | null | undefined;
  colors: (typeof COLORS)["dark"];
  isDark: boolean;
  onCaptured?: () => void;
}

export function CaptureFooter({
  agentId,
  agentName,
  colors,
  isDark,
  onCaptured,
}: CaptureFooterProps) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const capture = useCaptureMobileMemory();

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    if (!agentId) {
      Alert.alert("No agent selected", "Choose an agent before capturing a memory.");
      return;
    }
    setSubmitting(true);
    try {
      await capture({ agentId, content: trimmed });
      setText("");
      Keyboard.dismiss();
      onCaptured?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Try again in a moment.";
      Alert.alert("Couldn't save memory", message);
    } finally {
      setSubmitting(false);
    }
  }, [text, submitting, agentId, capture, onCaptured]);

  const placeholder = agentName ? `Add new memory for ${agentName}...` : "Add new memory...";

  return (
    <MessageInputFooter
      value={text}
      onChangeText={setText}
      onSubmit={handleSubmit}
      placeholder={placeholder}
      colors={colors}
      isDark={isDark}
    />
  );
}
