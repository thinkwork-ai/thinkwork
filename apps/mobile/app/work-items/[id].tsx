import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { Check, ChevronRight, MessageSquarePlus } from "lucide-react-native";
import { useMutation, useQuery } from "urql";
import { DetailLayout } from "@/components/layout/detail-layout";
import { Muted, Text } from "@/components/ui/typography";
import {
  CreateWorkItemCommentMutation,
  UpdateWorkItemStatusMutation,
  WorkItemQuery,
  WorkItemStatusesQuery,
} from "@/lib/graphql-queries";
import { COLORS } from "@/lib/theme";

export default function WorkItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const insets = useSafeAreaInsets();
  const statusSheetRef = useRef<BottomSheet>(null);
  const [commentText, setCommentText] = useState("");
  const [{ data, fetching, error }, reexecute] = useQuery({
    query: WorkItemQuery,
    variables: { id: id! },
    pause: !id,
    requestPolicy: "cache-and-network",
  });
  const item = data?.workItem ?? null;
  const [{ data: statusesData }] = useQuery({
    query: WorkItemStatusesQuery,
    variables: {
      tenantId: item?.tenantId,
      spaceId: item?.spaceId!,
    },
    pause: !item?.spaceId,
  });
  const [, updateStatus] = useMutation(UpdateWorkItemStatusMutation);
  const [, createComment] = useMutation(CreateWorkItemCommentMutation);
  const snapPoints = useMemo(() => ["50%"], []);
  const activeStatuses = useMemo(
    () =>
      [...(statusesData?.workItemStatuses ?? [])]
        .filter((status) => status.isActive)
        .sort((a, b) => a.displayOrder - b.displayOrder),
    [statusesData?.workItemStatuses],
  );
  const comments = useMemo(
    () =>
      [...(item?.comments ?? [])].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [item?.comments],
  );

  const refetch = useCallback(
    () => reexecute({ requestPolicy: "network-only" }),
    [reexecute],
  );

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
      />
    ),
    [],
  );

  const handleStatusSelect = useCallback(
    async (statusId: string) => {
      if (!item) return;
      statusSheetRef.current?.close();
      const result = await updateStatus({
        input: {
          tenantId: item.tenantId,
          workItemId: item.id,
          statusId,
        },
      });
      if (result.error) {
        Alert.alert("Status update failed", result.error.message);
        return;
      }
      refetch();
    },
    [item, refetch, updateStatus],
  );

  const submitComment = useCallback(async () => {
    const body = commentText.trim();
    if (!item || !body) return;
    setCommentText("");
    const result = await createComment({
      input: {
        tenantId: item.tenantId,
        workItemId: item.id,
        body,
      },
    });
    if (result.error) {
      setCommentText(body);
      Alert.alert("Comment failed", result.error.message);
      return;
    }
    refetch();
  }, [commentText, createComment, item, refetch]);

  return (
    <DetailLayout title={item?.title ?? "Work Item"}>
      {error ? (
        <CenteredState
          title="Could not load work item"
          message={error.message}
          actionLabel="Retry"
          onAction={refetch}
        />
      ) : !item && fetching ? (
        <CenteredState title="Loading work item" message="Please wait." />
      ) : !item ? (
        <CenteredState title="Work item not found" message="It may be gone." />
      ) : (
        <>
          <ScrollView
            className="flex-1"
            contentContainerStyle={{
              padding: 16,
              paddingBottom: insets.bottom + 24,
              gap: 18,
            }}
          >
            <View className="gap-2">
              <Text className="text-xl font-semibold">{item.title}</Text>
              <Muted>{item.notes || "No description."}</Muted>
            </View>

            <View className="gap-2">
              <Text className="text-sm font-semibold">Status</Text>
              <Pressable
                onPress={() => statusSheetRef.current?.snapToIndex(0)}
                className="flex-row items-center justify-between rounded-xl border px-3 py-3"
                style={{
                  minHeight: 44,
                  borderColor: colors.border,
                  backgroundColor: isDark ? "#171717" : "#ffffff",
                }}
                accessibilityRole="button"
                accessibilityLabel="Change work item status"
              >
                <View>
                  <Text className="text-sm font-semibold">
                    {item.status?.name ?? "No status"}
                  </Text>
                  <Muted className="text-xs">{item.status?.category ?? ""}</Muted>
                </View>
                <ChevronRight size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>

            <View className="gap-2">
              <Text className="text-sm font-semibold">Linked threads</Text>
              {item.threadLinks.length === 0 ? (
                <Muted>No linked threads.</Muted>
              ) : (
                item.threadLinks.map((link) => (
                  <Pressable
                    key={link.id}
                    onPress={() => router.push(`/thread/${link.threadId}`)}
                    className="flex-row items-center justify-between rounded-xl border px-3 py-3"
                    style={{ minHeight: 44, borderColor: colors.border }}
                  >
                    <View>
                      <Text className="text-sm font-medium">
                        Thread {link.threadId.slice(0, 8)}
                      </Text>
                      <Muted className="text-xs">{link.relationship}</Muted>
                    </View>
                    <ChevronRight size={18} color={colors.mutedForeground} />
                  </Pressable>
                ))
              )}
            </View>

            <View className="gap-3">
              <Text className="text-sm font-semibold">Comments</Text>
              {comments.length === 0 ? (
                <Muted>No comments yet.</Muted>
              ) : (
                comments.map((comment) => (
                  <View
                    key={comment.id}
                    className="rounded-xl border px-3 py-3"
                    style={{ borderColor: colors.border }}
                  >
                    <Text className="text-sm">{comment.body}</Text>
                    <Muted className="mt-2 text-xs">
                      {new Date(comment.createdAt).toLocaleString()}
                    </Muted>
                  </View>
                ))
              )}
            </View>
          </ScrollView>

          <View
            className="border-t border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950"
            style={{ paddingBottom: insets.bottom + 8 }}
          >
            <View
              className="flex-row items-end gap-2 rounded-2xl border px-3 py-2"
              style={{ borderColor: colors.border }}
            >
              <TextInput
                value={commentText}
                onChangeText={setCommentText}
                placeholder="Add a comment"
                placeholderTextColor={colors.mutedForeground}
                multiline
                className="max-h-28 min-h-[36px] flex-1 text-base"
                style={{ color: colors.foreground }}
              />
              <Pressable
                onPress={submitComment}
                disabled={!commentText.trim()}
                className="items-center justify-center rounded-full"
                style={{
                  width: 44,
                  height: 44,
                  backgroundColor: commentText.trim()
                    ? colors.primary
                    : colors.muted,
                }}
                accessibilityRole="button"
                accessibilityLabel="Add comment"
              >
                <MessageSquarePlus
                  size={19}
                  color={
                    commentText.trim()
                      ? "#ffffff"
                      : colors.mutedForeground
                  }
                />
              </Pressable>
            </View>
          </View>

          <BottomSheet
            ref={statusSheetRef}
            index={-1}
            snapPoints={snapPoints}
            enablePanDownToClose
            backdropComponent={renderBackdrop}
            backgroundStyle={{
              backgroundColor: isDark ? "#1c1c1e" : "#ffffff",
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
            }}
            handleIndicatorStyle={{
              backgroundColor: isDark
                ? "rgba(255,255,255,0.2)"
                : "rgba(0,0,0,0.15)",
              width: 36,
            }}
          >
            <BottomSheetScrollView
              contentContainerStyle={{
                padding: 16,
                paddingBottom: insets.bottom + 16,
              }}
            >
              <Text className="mb-3 text-base font-semibold">
                Change status
              </Text>
              {activeStatuses.map((status) => {
                const selected = status.id === item.statusId;
                return (
                  <Pressable
                    key={status.id}
                    onPress={() => void handleStatusSelect(status.id)}
                    className="flex-row items-center justify-between border-b border-neutral-200 py-3 dark:border-neutral-800"
                    style={{ minHeight: 44 }}
                  >
                    <View>
                      <Text className="text-sm font-medium">{status.name}</Text>
                      <Muted className="text-xs">{status.category}</Muted>
                    </View>
                    {selected ? <Check size={18} color={colors.primary} /> : null}
                  </Pressable>
                );
              })}
            </BottomSheetScrollView>
          </BottomSheet>
        </>
      )}
    </DetailLayout>
  );
}

function CenteredState({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  return (
    <View className="flex-1 items-center justify-center gap-2 px-8">
      <Text className="text-base font-semibold text-center">{title}</Text>
      <Muted className="text-center">{message}</Muted>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          className="mt-2 items-center justify-center rounded-full px-4"
          style={{ minHeight: 44, backgroundColor: colors.primary }}
        >
          <Text className="text-sm font-semibold text-white">
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
