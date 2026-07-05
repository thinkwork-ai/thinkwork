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
import { WorkItemStatusIcon } from "./WorkItemStatusIcon";

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

/** Default category → color mapping, mirrored from web's status tone palette
 * (apps/web/src/components/work-items/work-item-display.ts). Falls back to
 * this when the item's own status has no explicit color. */
const CATEGORY_COLOR: Record<WorkItemStatusCategory, string> = {
  [WorkItemStatusCategory.Todo]: "#94a3b8",
  [WorkItemStatusCategory.Active]: "#3b82f6",
  [WorkItemStatusCategory.Blocked]: "#ef4444",
  [WorkItemStatusCategory.Done]: "#10b981",
  [WorkItemStatusCategory.Skipped]: "#64748b",
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

  const statusColor = item.status?.color ?? CATEGORY_COLOR[category];

  const content = (
    <Pressable
      onPress={() => onPress(item)}
      onLongPress={() => onReassign(item)}
      delayLongPress={400}
      className="flex-row items-start py-2 pr-4 active:bg-neutral-50 dark:active:bg-neutral-900"
      style={{ backgroundColor: colors.background, minHeight: 72 }}
      accessibilityRole="button"
      accessibilityLabel={item.title}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: `${statusColor}22`,
          borderWidth: 0.25,
          borderColor: statusColor,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <WorkItemStatusIcon category={category} color={statusColor} size={20} />
      </View>

      <View className="flex-1 ml-3">
        <View className="flex-row items-start justify-between">
          <Text
            className="flex-1 text-base font-semibold mr-2"
            style={{ lineHeight: 20, marginTop: -1 }}
            numberOfLines={2}
          >
            {item.title}
          </Text>
          <ChevronRight
            size={14}
            color={colors.mutedForeground}
            style={{ marginTop: 3 }}
          />
        </View>
        {item.notes ? (
          <Muted style={{ fontSize: 14, lineHeight: 18 }} numberOfLines={2}>
            {item.notes}
          </Muted>
        ) : null}
        <View className="flex-row items-center gap-1 mt-1">
          <AgeText dueAt={item.dueAt ?? null} colors={colors} />
          <Muted className="text-xs">
            {" "}
            · {PRIORITY_LABEL[item.priority]} priority
          </Muted>
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

function AgeText({
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
    <Text className="text-xs font-medium" style={{ color: hue }}>
      {label}
    </Text>
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
