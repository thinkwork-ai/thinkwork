import { View, ScrollView, Pressable, Alert, Switch } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRoutine } from "@/lib/hooks/use-routines";
import { ChevronRight, Copy, Trash2 } from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";
import { Text, Muted } from "@/components/ui/typography";
import { DetailLayout } from "@/components/layout/detail-layout";
import { WebContent } from "@/components/layout/web-content";
import { HeaderContextMenu } from "@/components/ui/header-context-menu";

const WEBHOOK_BASE_URL = "https://hooks.thinkwork.ai";

function formatDate(ts: number | string): string {
  const date = typeof ts === "string" ? new Date(ts) : new Date(ts);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function SectionHeader({ title }: { title: string }) {
  return (
    <Text className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide px-4 mb-1 mt-4">
      {title}
    </Text>
  );
}

function InfoRow({
  label,
  right,
  onPress,
  isLast,
}: {
  label: string;
  right: React.ReactNode;
  onPress?: () => void;
  isLast?: boolean;
}) {
  const inner = (
    <View
      className={`flex-row items-center justify-between px-4 py-3.5 ${
        isLast ? "" : "border-b border-neutral-100 dark:border-neutral-800"
      }`}
    >
      <Text className="text-base text-neutral-900 dark:text-neutral-100">{label}</Text>
      <View className="flex-row items-center gap-2">{right}</View>
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} className="active:bg-neutral-50 dark:active:bg-neutral-800">
        {inner}
      </Pressable>
    );
  }
  return inner;
}

export default function TriggerDetailScreen() {
  const { id, triggerId } = useLocalSearchParams<{ id: string; triggerId: string }>();
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  // Get trigger from routine detail
  const [{ data: routineData }] = useRoutine(id);
  const trigger = routineData?.routine?.triggers?.find((t: any) => t.id === triggerId) as any;

  // TODO: Migrate api.routineTriggers.updateTrigger to GraphQL
  // TODO: Migrate api.routineTriggers.deleteTrigger to GraphQL
  // TODO: Migrate api.routineTriggers.deleteScheduleWithBridge to GraphQL

  const handleToggle = async (enabled: boolean) => {
    if (!trigger) return;
    // TODO: Migrate updateTrigger to GraphQL
    Alert.alert("Not Implemented", "Trigger toggle not yet migrated to GraphQL.");
  };

  const handleDelete = () => {
    if (!trigger) return;
    Alert.alert(
      "Delete Trigger",
      `Delete this ${trigger.triggerType ?? trigger.type} trigger?`,
      [
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            // TODO: Migrate deleteTrigger / deleteScheduleWithBridge to GraphQL
            Alert.alert("Not Implemented", "Trigger deletion not yet migrated to GraphQL.");
          },
        },
        { text: "Cancel", style: "cancel" },
      ],
    );
  };

  const handleCopyWebhookUrl = async () => {
    if (!trigger?.webhookToken) return;
    const url = `${WEBHOOK_BASE_URL}/${trigger.webhookToken}`;
    await Clipboard.setStringAsync(url);
    Alert.alert("Copied", "Webhook URL copied to clipboard.");
  };

  if (trigger === undefined && !routineData) {
    return (
      <DetailLayout title="Trigger">
        <View className="flex-1 items-center justify-center">
          <Muted>Loading...</Muted>
        </View>
      </DetailLayout>
    );
  }

  if (!trigger) {
    return (
      <DetailLayout title="Trigger">
        <View className="flex-1 items-center justify-center">
          <Muted>Trigger not found.</Muted>
        </View>
      </DetailLayout>
    );
  }

  const triggerType = trigger.triggerType ?? trigger.type;
  const isSchedule = triggerType === "schedule";
  const title = isSchedule ? "Schedule Trigger" : "Webhook Trigger";

  const timezoneAbbr = isSchedule && trigger.timezone
    ? new Intl.DateTimeFormat("en-US", {
        timeZoneName: "short",
        timeZone: trigger.timezone,
      })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value ?? ""
    : "";

  const scheduleLabel = trigger.scheduleLabel
    ? `${trigger.scheduleLabel}${timezoneAbbr ? ` ${timezoneAbbr}` : ""}`
    : trigger.schedule ?? "Schedule";

  const webhookUrl = trigger.webhookToken
    ? `${WEBHOOK_BASE_URL}/${trigger.webhookToken}`
    : null;

  return (
    <DetailLayout
      title={title}
      headerRight={
        <HeaderContextMenu
          items={[
            {
              label: "Delete Trigger",
              icon: Trash2,
              destructive: true,
              onPress: handleDelete,
            },
          ]}
        />
      }
    >
      <ScrollView className="flex-1 bg-neutral-50 dark:bg-neutral-950 pt-4">
        <WebContent>

          {/* Settings */}
          <SectionHeader title="Settings" />
          <View className="bg-white dark:bg-neutral-900 rounded-xl overflow-hidden mx-4 mb-3">
            <InfoRow
              label="Enabled"
              isLast={!isSchedule}
              right={
                <Switch
                  value={trigger.enabled}
                  onValueChange={handleToggle}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor="#fff"
                />
              }
            />
            {isSchedule && (
              <>
                <InfoRow
                  label="How often"
                  onPress={() =>
                    router.push(`/routines/${id}/triggers/add-schedule?triggerId=${trigger.id}`)
                  }
                  right={
                    <>
                      <Text className="text-sm text-neutral-500 dark:text-neutral-400" numberOfLines={1}>
                        {scheduleLabel}
                      </Text>
                      <ChevronRight size={16} color={colors.mutedForeground} />
                    </>
                  }
                />
                <InfoRow
                  label="Timezone"
                  isLast={
                    trigger.activeHoursStart === undefined ||
                    trigger.activeHoursEnd === undefined
                  }
                  right={
                    <Text className="text-sm text-neutral-500 dark:text-neutral-400">
                      {timezoneAbbr || trigger.timezone || "\u2014"}
                    </Text>
                  }
                />
                {trigger.activeHoursStart !== undefined &&
                  trigger.activeHoursEnd !== undefined && (
                    <InfoRow
                      label="Active Hours"
                      isLast
                      right={
                        <Text className="text-sm text-neutral-500 dark:text-neutral-400">
                          {trigger.activeHoursStart}:00 \u2013 {trigger.activeHoursEnd}:00
                        </Text>
                      }
                    />
                  )}
              </>
            )}
          </View>

          {/* Webhook URL (webhook only) */}
          {!isSchedule && webhookUrl && (
            <>
              <SectionHeader title="Webhook URL" />
              <View className="bg-white dark:bg-neutral-900 rounded-xl overflow-hidden mx-4 mb-3">
                <View className="px-4 py-3 border-b border-neutral-100 dark:border-neutral-800">
                  <Text
                    className="text-sm text-neutral-500 dark:text-neutral-400"
                    numberOfLines={2}
                    selectable
                  >
                    {webhookUrl}
                  </Text>
                </View>
                <Pressable
                  onPress={handleCopyWebhookUrl}
                  className="flex-row items-center justify-center gap-2 px-4 py-3 active:bg-neutral-50 dark:active:bg-neutral-800"
                >
                  <Copy size={14} color={colors.primary} />
                  <Text style={{ color: colors.primary }} className="text-sm font-semibold">
                    Copy URL
                  </Text>
                </Pressable>
              </View>
            </>
          )}

          {/* Info */}
          <SectionHeader title="Info" />
          <View className="bg-white dark:bg-neutral-900 rounded-xl overflow-hidden mx-4 mb-3">
            <InfoRow
              label="Created"
              right={
                <Text className="text-sm text-neutral-500 dark:text-neutral-400">
                  {trigger.createdAt ? formatDate(trigger.createdAt) : "\u2014"}
                </Text>
              }
            />
            <InfoRow
              label="Last run"
              isLast
              right={
                <Text className="text-sm text-neutral-500 dark:text-neutral-400">
                  {trigger.lastTriggeredAt
                    ? formatRelativeTime(trigger.lastTriggeredAt)
                    : "Never"}
                </Text>
              }
            />
          </View>

          <View className="h-8" />
        </WebContent>
      </ScrollView>
    </DetailLayout>
  );
}
