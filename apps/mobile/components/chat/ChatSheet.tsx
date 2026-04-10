import React, { useRef, useEffect, useCallback } from "react";
import {
  View,
  Pressable,
  Modal,
  StyleSheet,
  Animated,
  Dimensions,
} from "react-native";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronDown, CheckCircle } from "lucide-react-native";
import { Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { useMutation } from "urql";
import { UpdateThreadMutation } from "@/lib/graphql-queries";
import { ChatScreen } from "./ChatScreen";

interface ChatSheetProps {
  visible: boolean;
  onClose: () => void;
  baseUrl: string;
  token: string;
  agentId?: string;
  agentName?: string;
  agents?: any[];
  selectedAgentId?: string;
  onSelectAgent?: (agent: any) => void;
  threadId?: string;
  tenantId?: string;
  threadIdentifier?: string;
  caller?: { name?: string; email?: string; role?: string };
  onNewChat?: () => void;
  mentionCandidates?: any[];
}

export function ChatSheet({
  visible,
  onClose,
  baseUrl,
  token,
  agentId,
  agentName,
  agents,
  selectedAgentId,
  onSelectAgent,
  threadId,
  tenantId,
  threadIdentifier,
  caller,
  onNewChat,
  mentionCandidates,
}: ChatSheetProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const insets = useSafeAreaInsets();

  const slideAnim = useRef(new Animated.Value(0)).current;
  const [, executeUpdateThread] = useMutation(UpdateThreadMutation);
  const screenHeight = Dimensions.get("window").height;

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 1,
        damping: 22,
        stiffness: 200,
        useNativeDriver: true,
      }).start();
    } else {
      slideAnim.setValue(0);
    }
  }, [visible]);

  const animateClose = useCallback(() => {
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => onClose());
  }, [onClose]);

  const handleComplete = useCallback(async () => {
    if (!threadId) return;
    await executeUpdateThread({
      id: threadId,
      input: { status: "DONE" as any },
    });
    animateClose();
  }, [threadId, executeUpdateThread, animateClose]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={animateClose}
    >
      <View style={StyleSheet.absoluteFill}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: isDark ? "#0a0a0a" : "#ffffff",
              transform: [{
                translateY: slideAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [screenHeight, 0],
                }),
              }],
            },
          ]}
        >
          {/* Header — tappable handle + close + complete */}
          <View style={{ paddingTop: insets.top }}>
            {/* Drag handle — tap to close */}
            <Pressable onPress={animateClose} className="items-center pt-2 pb-1">
              <View className="w-10 h-1 rounded-full bg-neutral-300 dark:bg-neutral-700" />
            </Pressable>

            {/* Header row */}
            <View className="flex-row items-center justify-between px-4 py-2 border-b border-neutral-200 dark:border-neutral-800">
              {/* Left: Complete (only if thread exists) */}
              {threadId ? (
                <Pressable
                  onPress={handleComplete}
                  className="flex-row items-center gap-1 px-3 py-1.5 rounded-md bg-green-600 active:opacity-70"
                >
                  <CheckCircle size={14} color="#ffffff" />
                  <Text className="text-xs font-semibold text-white">Complete</Text>
                </Pressable>
              ) : (
                <View style={{ width: 80 }} />
              )}

              {/* Center: thread ID */}
              <Text className="text-sm font-medium" variant="muted">
                {threadIdentifier || "New Thread"}
              </Text>

              {/* Right: close */}
              <Pressable onPress={animateClose} className="p-1 active:opacity-70">
                <ChevronDown size={22} color={colors.foreground} />
              </Pressable>
            </View>
          </View>

          {/* Chat content */}
          <View className="flex-1">
            <ChatScreen
              baseUrl={baseUrl}
              token={token}
              agentId={agentId}
              agentName={agentName}
              agents={agents}
              selectedAgentId={selectedAgentId}
              onSelectAgent={onSelectAgent}
              threadId={threadId}
              tenantId={tenantId}
              caller={caller}
              onNewChat={onNewChat}
              mentionCandidates={mentionCandidates}
              hideHeader
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
