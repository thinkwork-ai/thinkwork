import { useRef, useState, useCallback, useEffect } from "react";
import { View, Pressable, Dimensions, ActivityIndicator, Animated as RNAnimated } from "react-native";
import { useColorScheme } from "nativewind";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { ChevronRight, Check, X, Archive, MessageSquare, Mail, Briefcase, Webhook, FileText, CheckSquare, type LucideIcon } from "lucide-react-native";
import { IconClockBolt } from "@tabler/icons-react-native";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";

const SCREEN_WIDTH = Dimensions.get("window").width;
const SNAP_THRESHOLD = SCREEN_WIDTH * 0.5;


/** Shimmer text for active threads – a bright window of ~3 chars sweeps left to right */
const SHIMMER_TEXT = "Processing...";
const SHIMMER_WINDOW = 3;
const CHAR_DURATION = 120;
const TOTAL_STEPS = SHIMMER_TEXT.length + SHIMMER_WINDOW;

export function ShimmerProcessing() {
  const step = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    const anim = RNAnimated.loop(
      RNAnimated.timing(step, {
        toValue: TOTAL_STEPS,
        duration: CHAR_DURATION * TOTAL_STEPS,
        useNativeDriver: false,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [step]);

  return (
    <RNAnimated.Text style={{ fontSize: 14, lineHeight: 18, marginTop: 1 }}>
      {SHIMMER_TEXT.split("").map((char, i) => (
        <AnimatedChar key={i} char={char} index={i} step={step} />
      ))}
    </RNAnimated.Text>
  );
}

function AnimatedChar({ char, index, step }: { char: string; index: number; step: RNAnimated.Value }) {
  const color = step.interpolate({
    inputRange: [index, index + SHIMMER_WINDOW / 2, index + SHIMMER_WINDOW],
    outputRange: ["#6b7280", "#d1d5db", "#6b7280"],
    extrapolate: "clamp",
  });
  return <RNAnimated.Text style={{ color, fontSize: 14, lineHeight: 18 }}>{char}</RNAnimated.Text>;
}

const CHANNEL_CONFIG: Record<string, { icon: any; bg: string; fg: string }> = {
  CHAT:     { icon: MessageSquare, bg: "rgba(59,130,246,0.15)",  fg: "#3b82f6" },
  EMAIL:    { icon: Mail,          bg: "rgba(20,184,166,0.15)",  fg: "#14b8a6" },
  JOB:      { icon: Briefcase,     bg: "rgba(245,158,11,0.15)",  fg: "#f59e0b" },
  WEBHOOK:  { icon: Webhook,       bg: "rgba(168,85,247,0.15)",  fg: "#a855f7" },
  SCHEDULE: { icon: IconClockBolt,  bg: "rgba(249,115,22,0.15)",  fg: "#f97316" },
  TASK:     { icon: CheckSquare,   bg: "rgba(34,197,94,0.15)",   fg: "#22c55e" },
};
const DEFAULT_CHANNEL = { icon: FileText, bg: "rgba(107,114,128,0.15)", fg: "#6b7280" } as const;

interface ThreadRowProps {
  thread: {
    id: string;
    identifier?: string | null;
    title: string;
    lastResponsePreview?: string | null;
    status: string;
    channel?: string;
    agentId?: string;
    createdAt: string;
    updatedAt: string;
    lastActivityAt?: string | null;
    lastTurnCompletedAt?: string | null;
  };
  agentName?: string;
  isUnread?: boolean;
  needsHitl?: boolean;
  hitlPreview?: string | null;
  isActive?: boolean;
  turnStatus?: "succeeded" | "failed" | null;
  onArchive?: (threadId: string) => Promise<boolean>;
  onPress: () => void;
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ThreadRow({
  thread,
  agentName,
  isUnread,
  needsHitl,
  hitlPreview,
  isActive,
  turnStatus,
  onArchive,
  onPress,
}: ThreadRowProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const [isArchiving, setIsArchiving] = useState(false);

  // Reanimated shared values for the custom swipe gesture
  const translateX = useSharedValue(0);
  const hasSnapped = useSharedValue(false);
  const isArchivingShared = useSharedValue(false);

  const triggerHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const triggerArchive = useCallback(async () => {
    if (!onArchive || isArchivingShared.value) return;
    isArchivingShared.value = true;
    setIsArchiving(true);
    const success = await onArchive(thread.id);
    if (!success) {
      setIsArchiving(false);
      isArchivingShared.value = false;
      translateX.value = withSpring(0);
    }
  }, [onArchive, thread.id, translateX, isArchivingShared]);

  const panGesture = Gesture.Pan()
    .activeOffsetX(-10) // only activate on horizontal swipe left
    .failOffsetY([-10, 10]) // fail if vertical
    .onUpdate((e) => {
      // Only allow swiping left (negative translationX), not right
      if (hasSnapped.value) return;
      const clampedX = Math.min(0, e.translationX);
      translateX.value = clampedX;

      // When crossing 50% threshold, snap to full open
      if (clampedX < -SNAP_THRESHOLD && !hasSnapped.value) {
        hasSnapped.value = true;
        runOnJS(triggerHaptic)();
        translateX.value = withTiming(-SCREEN_WIDTH, { duration: 200 });
        runOnJS(triggerArchive)();
      }
    })
    .onEnd(() => {
      if (!hasSnapped.value) {
        // Didn't reach threshold — spring back
        translateX.value = withSpring(0);
      }
    })
    .onFinalize(() => {
      if (!hasSnapped.value) {
        hasSnapped.value = false;
      }
    });

  // Animated style for the row content sliding left
  const rowAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  // Animated style for the archive icon — centered in the revealed area
  const iconAnimatedStyle = useAnimatedStyle(() => {
    const revealedWidth = -translateX.value;
    return {
      position: "absolute" as const,
      right: 0,
      top: 0,
      bottom: 0,
      width: Math.max(revealedWidth, 0),
      justifyContent: "center" as const,
      alignItems: "center" as const,
    };
  });

  const channelKey = (thread.channel || "").toUpperCase();
  const chan = CHANNEL_CONFIG[channelKey] || DEFAULT_CHANNEL;
  const ChannelIcon = chan.icon;

  const content = (
    <Pressable
      onPress={onPress}
      className="flex-row items-start py-2 pr-4 active:bg-neutral-50 dark:active:bg-neutral-900"
      style={{ backgroundColor: colors.background }}
    >
      {/* Dot + icon row — dot vertically centered on the icon */}
      <View style={{ flexDirection: "row", alignItems: "center", width: 56 }}>
        <View style={{ width: 16, alignItems: "center", justifyContent: "center" }}>
          {(needsHitl || isUnread) && (
            <View
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: needsHitl ? "#f59e0b" : "#3b82f6" }}
            />
          )}
        </View>
        <View
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: chan.bg, borderWidth: 0.25, borderColor: chan.fg, alignItems: "center", justifyContent: "center" }}
        >
          <ChannelIcon size={channelKey === "SCHEDULE" ? 24 : 20} color={chan.fg} />
        </View>
      </View>

      {/* Content */}
      <View className="flex-1 ml-3">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            {thread.identifier && (
              <Text className="text-xs font-mono text-primary" style={{ lineHeight: 14 }}>
                {thread.identifier}
              </Text>
            )}
            {turnStatus === "succeeded" && (
              <View className="flex-row items-center gap-0.5">
                <Check size={12} color={isDark ? "#4ade80" : "#16a34a"} />
                <Text className="text-[10px]" style={{ color: isDark ? "#4ade80" : "#16a34a" }}>Done</Text>
              </View>
            )}
            {turnStatus === "failed" && (
              <View className="flex-row items-center gap-0.5">
                <X size={12} color={isDark ? "#f87171" : "#dc2626"} />
                <Text className="text-[10px]" style={{ color: isDark ? "#f87171" : "#dc2626" }}>Failed</Text>
              </View>
            )}
            {needsHitl && (
              <View className="flex-row items-center rounded-full px-1.5 py-0.5" style={{ backgroundColor: isDark ? "rgba(245,158,11,0.18)" : "rgba(245,158,11,0.14)" }}>
                <Text className="text-[10px] font-semibold" style={{ color: isDark ? "#fbbf24" : "#b45309" }}>
                  Needs answer
                </Text>
              </View>
            )}
          </View>
          <View className="flex-row items-center gap-1">
            <Muted className="text-xs">{formatRelativeTime(thread.lastTurnCompletedAt || thread.createdAt)}</Muted>
            <ChevronRight size={14} color={colors.mutedForeground} />
          </View>
        </View>
        <Text className={`text-base ${isUnread ? "font-semibold" : ""}`} style={{ lineHeight: 20, marginTop: -1, marginBottom: 2 }} numberOfLines={1}>
          {thread.title || "Untitled"}
        </Text>
        {needsHitl ? (
          <Muted style={{ fontSize: 14, lineHeight: 18 }} numberOfLines={2}>
            {hitlPreview || "Waiting for your confirmation"}
          </Muted>
        ) : isActive ? (
          <ShimmerProcessing />
        ) : thread.lastResponsePreview ? (
          <Muted style={{ fontSize: 14, lineHeight: 18 }} numberOfLines={2}>{thread.lastResponsePreview}</Muted>
        ) : null}
      </View>
    </Pressable>
  );

  if (!onArchive) return content;

  return (
    <View style={{ overflow: "hidden" }}>
      {/* Red background with centered archive icon */}
      <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "#dc2626" }}>
        <Animated.View style={iconAnimatedStyle}>
          {isArchiving ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Archive size={20} color="#ffffff" />
          )}
        </Animated.View>
      </View>
      {/* Sliding row content */}
      <GestureDetector gesture={panGesture}>
        <Animated.View style={rowAnimatedStyle}>
          {content}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
