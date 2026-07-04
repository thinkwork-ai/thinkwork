import React, { useMemo, useRef } from "react";
import { Pressable, View } from "react-native";
import { useColorScheme } from "nativewind";
import { ChevronRight, CirclePause, FastForward } from "lucide-react-native";
import Swipeable, {
  SwipeDirection,
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { Muted, Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import {
  WorkItemPriority,
  WorkItemStatusCategory,
  type WorkItemsQuery,
} from "@/lib/gql/graphql";
import { workItemAgeBucket } from "@/lib/work-items/age-bucket";

export type WorkItemRowItem = WorkItemsQuery["workItems"][number];

interface WorkItemRowProps {
  item: WorkItemRowItem;
  onPress: (item: WorkItemRowItem) => void;
  onAdvance: (item: WorkItemRowItem, close: () => void) => void;
  onBlock: (item: WorkItemRowItem, close: () => void) => void;
  onReassign: (item: WorkItemRowItem) => void;
}

const PRIORITY_LABEL: Record<WorkItemPriority, string> = {
  [WorkItemPriority.Urgent]: "Urgent",
  [WorkItemPriority.High]: "High",
  [WorkItemPriority.Normal]: "Normal",
  [WorkItemPriority.Low]: "Low",
};

const CATEGORY_LABEL: Record<WorkItemStatusCategory, string> = {
  [WorkItemStatusCategory.Todo]: "Todo",
  [WorkItemStatusCategory.Active]: "Active",
  [WorkItemStatusCategory.Blocked]: "Blocked",
  [WorkItemStatusCategory.Done]: "Done",
  [WorkItemStatusCategory.Skipped]: "Skipped",
};

export function WorkItemRow({
  item,
  onPress,
  onAdvance,
  onBlock,
  onReassign,
}: WorkItemRowProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const swipeableRef = useRef<SwipeableMethods>(null);
  const category = item.status?.category ?? WorkItemStatusCategory.Todo;
  const swipeEnabled =
    category !== WorkItemStatusCategory.Done &&
    category !== WorkItemStatusCategory.Skipped;
  const canBlock =
    category !== WorkItemStatusCategory.Blocked &&
    category !== WorkItemStatusCategory.Done &&
    category !== WorkItemStatusCategory.Skipped;

  const content = (
    <Pressable
      onPress={() => onPress(item)}
      onLongPress={() => onReassign(item)}
      delayLongPress={400}
      className="bg-white dark:bg-neutral-950 px-4 py-3 active:opacity-70"
      style={{ minHeight: 72 }}
      accessibilityRole="button"
      accessibilityLabel={item.title}
    >
      <View className="flex-row items-start gap-3">
        <View className="min-w-0 flex-1 gap-2">
          <View className="flex-row items-start gap-2">
            <Text className="flex-1 text-base font-semibold" numberOfLines={2}>
              {item.title}
            </Text>
            <ChevronRight size={18} color={colors.mutedForeground} />
          </View>
          {item.notes ? (
            <Muted className="text-sm" numberOfLines={2}>
              {item.notes}
            </Muted>
          ) : null}
          <View className="flex-row flex-wrap items-center gap-2">
            <StatusPill
              label={item.status?.name ?? CATEGORY_LABEL[category]}
              color={item.status?.color ?? colors.primary}
              colors={colors}
            />
            <AgePill dueAt={item.dueAt ?? null} colors={colors} />
            <Muted className="text-xs">
              {PRIORITY_LABEL[item.priority]} priority
            </Muted>
          </View>
        </View>
      </View>
    </Pressable>
  );

  if (!swipeEnabled) return content;

  return (
    <Swipeable
      ref={swipeableRef}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={() => (
        <SwipeAction
          label="Advance"
          color="#10b981"
          icon={<FastForward size={18} color="#ffffff" />}
        />
      )}
      renderRightActions={
        canBlock
          ? () => (
              <SwipeAction
                label="Block"
                color="#f59e0b"
                icon={<CirclePause size={18} color="#111827" />}
                textColor="#111827"
              />
            )
          : undefined
      }
      onSwipeableOpen={(direction) => {
        const close = () => swipeableRef.current?.close();
        if (direction === SwipeDirection.LEFT) {
          onAdvance(item, close);
          return;
        }
        if (direction === SwipeDirection.RIGHT && canBlock) {
          onBlock(item, close);
        }
      }}
    >
      {content}
    </Swipeable>
  );
}

function SwipeAction({
  label,
  color,
  icon,
  textColor = "#ffffff",
}: {
  label: string;
  color: string;
  icon: React.ReactNode;
  textColor?: string;
}) {
  return (
    <View
      className="flex-1 flex-row items-center justify-center gap-2 px-5"
      style={{ backgroundColor: color, minHeight: 72 }}
    >
      {icon}
      <Text className="text-sm font-semibold" style={{ color: textColor }}>
        {label}
      </Text>
    </View>
  );
}

function StatusPill({
  label,
  color,
  colors,
}: {
  label: string;
  color: string;
  colors: (typeof COLORS)["dark"];
}) {
  return (
    <View
      className="rounded-full border px-2.5 py-1"
      style={{ borderColor: color, backgroundColor: `${color}22` }}
    >
      <Text
        className="text-xs font-semibold"
        style={{ color: colors.foreground }}
      >
        {label}
      </Text>
    </View>
  );
}

function AgePill({
  dueAt,
  colors,
}: {
  dueAt: string | null;
  colors: (typeof COLORS)["dark"];
}) {
  const bucket = useMemo(() => workItemAgeBucket(dueAt, new Date()), [dueAt]);
  const hue =
    bucket === "overdue"
      ? "#ef4444"
      : bucket === "due-soon"
        ? "#f59e0b"
        : colors.mutedForeground;
  const label = dueAt ? formatDueDate(dueAt, bucket) : "No due date";

  return (
    <View
      className="rounded-full border px-2.5 py-1"
      style={{ borderColor: hue, backgroundColor: `${hue}1f` }}
    >
      <Text
        className="text-xs font-semibold"
        style={{ color: colors.foreground }}
      >
        {label}
      </Text>
    </View>
  );
}

function formatDueDate(dueAt: string, bucket: string) {
  const date = new Date(dueAt);
  if (!Number.isFinite(date.getTime())) return "No due date";
  const prefix =
    bucket === "overdue" ? "Overdue" : bucket === "due-soon" ? "Due" : "Due";
  return `${prefix} ${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;
}
