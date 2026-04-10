import { useRef, useEffect, useCallback } from "react";
import { View, Pressable, Modal, StyleSheet, Animated, ScrollView, ActivityIndicator } from "react-native";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Inbox, X } from "lucide-react-native";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { useAuth } from "@/lib/auth-context";
import { useQuery } from "urql";
import { InboxItemsQuery } from "@/lib/graphql-queries";
import { useDecideInboxItem, useInboxStatusSubscription } from "@/lib/hooks/use-inbox";
import { InboxItemCard } from "./InboxItemCard";

interface InboxSheetProps {
  visible: boolean;
  onClose: () => void;
  onThreadPress?: (threadId: string) => void;
}

export function InboxSheet({ visible, onClose, onThreadPress }: InboxSheetProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const tenantId = user?.tenantId;

  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Pause query when sheet is not visible to avoid setState-during-render
  const [{ data, fetching }, reexecute] = useQuery({
    query: InboxItemsQuery,
    variables: { tenantId: tenantId!, status: "PENDING" as any },
    pause: !tenantId || !visible,
  });
  const [, executeDecide] = useDecideInboxItem();
  const items = data?.inboxItems ?? [];

  // Re-fetch on subscription event
  const [{ data: subEvent }] = useInboxStatusSubscription(tenantId);
  useEffect(() => {
    if (subEvent?.onInboxItemStatusChanged) {
      reexecute({ requestPolicy: "network-only" });
    }
  }, [subEvent?.onInboxItemStatusChanged?.inboxItemId]);

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 1, damping: 20, stiffness: 200, useNativeDriver: true }),
      ]).start();
    } else {
      slideAnim.setValue(0);
      fadeAnim.setValue(0);
    }
  }, [visible]);

  const handleClose = useCallback(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(() => onClose());
  }, [onClose]);

  const handleApprove = useCallback(async (id: string, comment?: string) => {
    await executeDecide({ id, input: { status: "APPROVED" as any, comment } });
    reexecute({ requestPolicy: "network-only" });
  }, [executeDecide, reexecute]);

  const handleReject = useCallback(async (id: string, comment?: string) => {
    await executeDecide({ id, input: { status: "REJECTED" as any, comment } });
    reexecute({ requestPolicy: "network-only" });
  }, [executeDecide, reexecute]);

  const handleRequestRevision = useCallback(async (id: string, comment: string) => {
    await executeDecide({ id, input: { status: "REVISION_REQUESTED" as any, comment } });
    reexecute({ requestPolicy: "network-only" });
  }, [executeDecide, reexecute]);

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleClose}>
      <View style={StyleSheet.absoluteFill}>
        {/* Backdrop */}
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.4)", opacity: fadeAnim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
        </Animated.View>

        {/* Sheet */}
        <Animated.View
          style={[
            styles.sheet,
            {
              paddingBottom: Math.max(insets.bottom, 16),
              backgroundColor: isDark ? "#171717" : "#ffffff",
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              maxHeight: "70%",
              transform: [{
                translateY: slideAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [600, 0],
                }),
              }],
            },
          ]}
        >
          {/* Handle */}
          <View className="items-center pt-2 pb-1">
            <View className="w-10 h-1 rounded-full bg-neutral-300 dark:bg-neutral-700" />
          </View>

          {/* Header */}
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
            <View className="flex-row items-center gap-2">
              <Inbox size={20} color={colors.foreground} />
              <Text className="text-lg font-semibold">Inbox</Text>
              {items.length > 0 && (
                <View className="bg-amber-500 rounded-full px-2 py-0.5 min-w-[22px] items-center">
                  <Text className="text-xs font-bold text-white">{items.length}</Text>
                </View>
              )}
            </View>
            <Pressable onPress={handleClose} className="p-1 active:opacity-70">
              <X size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {/* Content */}
          <ScrollView className="flex-1 px-4 py-3" contentContainerStyle={{ gap: 8 }}>
            {fetching && items.length === 0 ? (
              <View className="items-center py-8">
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : items.length === 0 ? (
              <View className="items-center py-8 gap-2">
                <Inbox size={32} color={colors.mutedForeground} />
                <Muted>No pending items</Muted>
              </View>
            ) : (
              (items as any[]).map((item: any) => (
                <InboxItemCard
                  key={item.id}
                  item={item}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onRequestRevision={handleRequestRevision}
                  onThreadPress={onThreadPress}
                />
              ))
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
  },
});
