import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { X } from "lucide-react-native";
import { useClient, useMutation, useQuery } from "urql";
import { Muted, Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import {
  SpacesWithMembersQuery,
  UpdateWorkItemMutation,
  UpdateWorkItemStatusMutation,
  WorkItemQuery,
  WorkItemsQuery,
  WorkItemStatusesQuery,
} from "@/lib/graphql-queries";
import {
  WorkItemStatusCategory,
  type SpacesWithMembersQuery as SpacesWithMembersResult,
  type WorkItemQuery as WorkItemResult,
  type WorkItemStatusesQuery as WorkItemStatusesResult,
} from "@/lib/gql/graphql";
import {
  advanceTargetCategory,
  firstActiveStatusInCategory,
  type WorkItemStatusLookup,
} from "@/lib/work-items/advance-mapping";
import {
  compareWorkItems,
  shouldShowWorkItemByCategory,
} from "@/lib/work-items/list-model";
import { isStale } from "@/lib/work-items/stale-guard";
import { WorkItemRow, type WorkItemRowItem } from "./WorkItemRow";

interface WorkItemListProps {
  tenantId: string | null | undefined;
  callerUserId: string | null | undefined;
  filtersOpen?: boolean;
}

const CATEGORY_OPTIONS: Array<{
  label: string;
  value: WorkItemStatusCategory;
}> = [
  { label: "Todo", value: WorkItemStatusCategory.Todo },
  { label: "Active", value: WorkItemStatusCategory.Active },
  { label: "Blocked", value: WorkItemStatusCategory.Blocked },
  { label: "Done", value: WorkItemStatusCategory.Done },
  { label: "Skipped", value: WorkItemStatusCategory.Skipped },
];

const BLOCK_REASONS = [
  "Waiting on external input",
  "Blocked by another item",
  "Need clarification",
  "Other",
];

const statusCache = new Map<string, WorkItemStatusLookup[]>();

export function WorkItemList({
  tenantId,
  callerUserId,
  filtersOpen = false,
}: WorkItemListProps) {
  const router = useRouter();
  const client = useClient();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const insets = useSafeAreaInsets();
  const [selectedCategories, setSelectedCategories] = useState<
    WorkItemStatusCategory[]
  >([]);
  const [statusesBySpaceId, setStatusesBySpaceId] = useState(statusCache);
  const [refreshing, setRefreshing] = useState(false);
  const [blockingItem, setBlockingItem] = useState<WorkItemRowItem | null>(
    null,
  );
  const [blockingClose, setBlockingClose] = useState<(() => void) | null>(null);
  const [blockOtherText, setBlockOtherText] = useState("");
  const [reassignItem, setReassignItem] = useState<WorkItemRowItem | null>(
    null,
  );
  const blockSheetRef = useRef<BottomSheet>(null);
  const reassignSheetRef = useRef<BottomSheet>(null);
  const blockSubmittingRef = useRef(false);
  const snapPoints = useMemo(() => ["45%"], []);
  const [, updateStatus] = useMutation(UpdateWorkItemStatusMutation);
  const [, updateWorkItem] = useMutation(UpdateWorkItemMutation);

  const [{ data, fetching, error }, reexecute] = useQuery({
    query: WorkItemsQuery,
    variables: {
      input: {
        tenantId,
        ownerUserId: callerUserId,
        includeArchived: false,
      },
    },
    pause: !tenantId || !callerUserId,
    requestPolicy: "cache-and-network",
  });

  const [{ data: spacesData }] = useQuery({
    query: SpacesWithMembersQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });

  const items = useMemo(
    () =>
      [...((data?.workItems ?? []) as WorkItemRowItem[])]
        .filter((item) =>
          shouldShowWorkItemByCategory(item, selectedCategories),
        )
        .sort(compareWorkItems),
    [data?.workItems, selectedCategories],
  );

  const refetch = useCallback(() => {
    reexecute({ requestPolicy: "network-only" });
  }, [reexecute]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    refetch();
    setTimeout(() => setRefreshing(false), 500);
  }, [refetch]);

  useEffect(() => {
    if (!tenantId) return;
    const spaceIds = Array.from(
      new Set(
        ((data?.workItems ?? []) as WorkItemRowItem[])
          .map((item) => item.spaceId)
          .filter(Boolean),
      ),
    );
    for (const spaceId of spaceIds) {
      const cacheKey = `${tenantId}:${spaceId}`;
      if (statusCache.has(cacheKey)) continue;
      client
        .query(WorkItemStatusesQuery, { tenantId, spaceId })
        .toPromise()
        .then((result) => {
          const statuses = ((result.data as WorkItemStatusesResult | undefined)
            ?.workItemStatuses ?? []) as WorkItemStatusLookup[];
          statusCache.set(cacheKey, statuses);
          setStatusesBySpaceId(new Map(statusCache));
        })
        .catch(() => {});
    }
  }, [client, data?.workItems, tenantId]);

  const statusesForItem = useCallback(
    (item: WorkItemRowItem) =>
      tenantId
        ? (statusesBySpaceId.get(`${tenantId}:${item.spaceId}`) ?? [])
        : [],
    [statusesBySpaceId, tenantId],
  );

  const statusCategoryByIdForItem = useCallback(
    (item: WorkItemRowItem) =>
      new Map(
        statusesForItem(item).map((status) => [status.id, status.category]),
      ),
    [statusesForItem],
  );

  const fetchFreshItem = useCallback(
    async (item: WorkItemRowItem) => {
      const result = await client
        .query(
          WorkItemQuery,
          { tenantId: tenantId ?? undefined, id: item.id },
          { requestPolicy: "network-only" },
        )
        .toPromise();
      return (result.data as WorkItemResult | undefined)?.workItem ?? null;
    },
    [client, tenantId],
  );

  const guardFreshStatus = useCallback(
    async (item: WorkItemRowItem) => {
      const fresh = await fetchFreshItem(item);
      if (!fresh) return null;
      if (isStale(item.statusId, fresh.statusId)) {
        Alert.alert(
          "Work item changed",
          "This item was updated elsewhere. The list has been refreshed.",
        );
        refetch();
        return null;
      }
      return fresh;
    },
    [fetchFreshItem, refetch],
  );

  const handleAdvance = useCallback(
    async (item: WorkItemRowItem, close: () => void) => {
      close();
      if (!tenantId || !item.status?.category) return;
      const fresh = await guardFreshStatus(item);
      if (!fresh) return;
      const statuses = statusesForItem(item);
      const targetCategory = advanceTargetCategory(
        item.status.category,
        item,
        statusCategoryByIdForItem(item),
      );
      if (!targetCategory) return;
      const targetStatus = firstActiveStatusInCategory(
        statuses,
        targetCategory,
      );
      if (!targetStatus) {
        Alert.alert("No target status", "This space has no matching status.");
        return;
      }
      const result = await updateStatus({
        input: {
          tenantId,
          workItemId: item.id,
          statusId: targetStatus.id,
        },
      });
      if (result.error) {
        Alert.alert("Update failed", result.error.message);
        return;
      }
      refetch();
    },
    [
      guardFreshStatus,
      refetch,
      statusCategoryByIdForItem,
      statusesForItem,
      tenantId,
      updateStatus,
    ],
  );

  const openBlockSheet = useCallback(
    (item: WorkItemRowItem, close: () => void) => {
      setBlockingItem(item);
      setBlockingClose(() => close);
      setBlockOtherText("");
      blockSheetRef.current?.snapToIndex(0);
    },
    [],
  );

  const submitBlockReason = useCallback(
    async (reason: string) => {
      const item = blockingItem;
      const close = blockingClose;
      blockSubmittingRef.current = true;
      close?.();
      setBlockingItem(null);
      setBlockingClose(null);
      blockSheetRef.current?.close();
      if (!item || !tenantId) return;
      const fresh = await guardFreshStatus(item);
      if (!fresh) return;
      const blockedStatus = firstActiveStatusInCategory(
        statusesForItem(item),
        WorkItemStatusCategory.Blocked,
      );
      const result = await updateStatus({
        input: {
          tenantId,
          workItemId: item.id,
          ...(blockedStatus
            ? { statusId: blockedStatus.id }
            : { statusCategory: WorkItemStatusCategory.Blocked }),
          note: reason,
        },
      });
      if (result.error) {
        Alert.alert("Update failed", result.error.message);
        return;
      }
      refetch();
    },
    [
      blockingClose,
      blockingItem,
      guardFreshStatus,
      refetch,
      statusesForItem,
      tenantId,
      updateStatus,
    ],
  );

  const cancelBlock = useCallback(() => {
    blockingClose?.();
    setBlockingItem(null);
    setBlockingClose(null);
    blockSheetRef.current?.close();
  }, [blockingClose]);

  const openReassignSheet = useCallback((item: WorkItemRowItem) => {
    setReassignItem(item);
    reassignSheetRef.current?.snapToIndex(0);
  }, []);

  const reassignMembers = useMemo(() => {
    if (!reassignItem) return [];
    const spaces =
      (spacesData as SpacesWithMembersResult | undefined)?.spaces ?? [];
    return (
      spaces
        .find((space) => space.id === reassignItem.spaceId)
        ?.members.filter((member) => member.userId) ?? []
    );
  }, [reassignItem, spacesData]);

  const handleReassign = useCallback(
    async (ownerUserId: string) => {
      const item = reassignItem;
      reassignSheetRef.current?.close();
      setReassignItem(null);
      if (!item || !tenantId) return;
      const result = await updateWorkItem({
        input: {
          tenantId,
          workItemId: item.id,
          ownerUserId,
        },
      });
      if (result.error) {
        Alert.alert("Reassign failed", result.error.message);
        return;
      }
      refetch();
    },
    [reassignItem, refetch, tenantId, updateWorkItem],
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

  if (!tenantId || !callerUserId) {
    return (
      <CenteredState
        title="Work Items"
        message="Sign in to view work items assigned to you."
      />
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      {filtersOpen ? (
        <View className="border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-950">
          <FlatList
            horizontal
            data={CATEGORY_OPTIONS}
            keyExtractor={(item) => item.value}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item }) => {
              const selected = selectedCategories.includes(item.value);
              return (
                <Pressable
                  onPress={() =>
                    setSelectedCategories((prev) =>
                      prev.includes(item.value)
                        ? prev.filter((value) => value !== item.value)
                        : [...prev, item.value],
                    )
                  }
                  className="mr-2 flex-row items-center rounded-full border px-3"
                  style={{
                    minHeight: 32,
                    paddingVertical: 6,
                    borderColor: selected ? colors.primary : colors.border,
                    backgroundColor: selected
                      ? isDark
                        ? "#1e3a5f"
                        : "#e0f2fe"
                      : "transparent",
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  hitSlop={6}
                >
                  <Text
                    className="text-sm font-medium"
                    style={{
                      color: selected ? colors.primary : colors.foreground,
                    }}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            }}
          />
        </View>
      ) : null}

      {error ? (
        <CenteredState
          title="Could not load work items"
          message={error.message}
          actionLabel="Retry"
          onAction={refetch}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <WorkItemRow
              item={item}
              onPress={(pressed) => router.push(`/work-items/${pressed.id}`)}
              onAdvance={handleAdvance}
              onBlock={openBlockSheet}
              onReassign={openReassignSheet}
            />
          )}
          ItemSeparatorComponent={() => (
            <View className="h-px bg-neutral-200 dark:bg-neutral-800" />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing || fetching}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
          contentContainerStyle={
            items.length === 0
              ? { flexGrow: 1, justifyContent: "center" }
              : { paddingTop: 8, paddingBottom: insets.bottom + 16 }
          }
          ListEmptyComponent={
            <CenteredState
              title="No work items assigned to you"
              message="Pull to refresh or adjust filters."
            />
          }
        />
      )}

      <BottomSheet
        ref={blockSheetRef}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        onClose={() => {
          if (blockSubmittingRef.current) {
            blockSubmittingRef.current = false;
            return;
          }
          blockingClose?.();
          setBlockingItem(null);
          setBlockingClose(null);
        }}
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
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-base font-semibold">Block reason</Text>
            <Pressable onPress={cancelBlock} className="p-2">
              <X size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>
          {BLOCK_REASONS.map((reason) => (
            <Pressable
              key={reason}
              onPress={() => {
                if (reason !== "Other") void submitBlockReason(reason);
              }}
              className="border-b border-neutral-200 py-3 dark:border-neutral-800"
              style={{ minHeight: 44 }}
            >
              <Text className="text-sm font-medium">{reason}</Text>
            </Pressable>
          ))}
          <TextInput
            value={blockOtherText}
            onChangeText={setBlockOtherText}
            placeholder="Other reason"
            placeholderTextColor={colors.mutedForeground}
            className="mt-3 rounded-xl border px-3 py-2 text-base"
            style={{ borderColor: colors.border, color: colors.foreground }}
          />
          <Pressable
            onPress={() => {
              const text = blockOtherText.trim();
              if (text) void submitBlockReason(text);
            }}
            className="mt-3 items-center justify-center rounded-full"
            style={{ minHeight: 44, backgroundColor: colors.primary }}
          >
            <Text className="text-sm font-semibold text-white">
              Submit reason
            </Text>
          </Pressable>
        </BottomSheetScrollView>
      </BottomSheet>

      <BottomSheet
        ref={reassignSheetRef}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        onClose={() => setReassignItem(null)}
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
          <Text className="mb-3 text-base font-semibold">Reassign</Text>
          {reassignMembers.map((member) => (
            <Pressable
              key={member.id}
              onPress={() => void handleReassign(member.userId)}
              className="border-b border-neutral-200 py-3 dark:border-neutral-800"
              style={{ minHeight: 44 }}
            >
              <Text className="text-sm font-medium">
                {member.user?.name ?? member.user?.email ?? member.userId}
              </Text>
              <Muted className="text-xs">{member.role}</Muted>
            </Pressable>
          ))}
          {reassignMembers.length === 0 ? (
            <Muted className="py-6 text-center">
              No members found for this space.
            </Muted>
          ) : null}
        </BottomSheetScrollView>
      </BottomSheet>
    </View>
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
