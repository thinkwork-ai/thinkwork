import { useState } from "react";
import { View, ScrollView, Pressable, Alert, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRoutine } from "@/lib/hooks/use-routines";
import { Link, Clock, ChevronRight, Plus } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";
import { Text, Muted } from "@/components/ui/typography";
import { DetailLayout } from "@/components/layout/detail-layout";
import { WebContent } from "@/components/layout/web-content";

type Trigger = {
  id: string;
  triggerType: string;
  type?: string;
  config?: any;
  enabled?: boolean;
  schedule?: string;
  scheduleLabel?: string;
  timezone?: string;
  webhookToken?: string;
  lastTriggeredAt?: number;
  createdAt?: string;
  [key: string]: any;
};

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

function TriggerCard({
  trigger,
  onPress,
  isLast,
}: {
  trigger: Trigger;
  onPress: () => void;
  isLast?: boolean;
}) {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const isWebhook = (trigger.triggerType ?? trigger.type) === "webhook";

  const timezoneAbbr =
    !isWebhook && trigger.timezone
      ? new Intl.DateTimeFormat("en-US", {
          timeZoneName: "short",
          timeZone: trigger.timezone,
        })
          .formatToParts(new Date())
          .find((p) => p.type === "timeZoneName")?.value ?? ""
      : "";

  const title = isWebhook
    ? "Webhook"
    : trigger.scheduleLabel
      ? `${trigger.scheduleLabel}${timezoneAbbr ? ` ${timezoneAbbr}` : ""}`
      : trigger.schedule ?? "Schedule";

  const subtitle = trigger.lastTriggeredAt
    ? `Last triggered ${formatRelativeTime(trigger.lastTriggeredAt)}`
    : isWebhook
      ? "Never triggered"
      : "Not yet run";

  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-start px-4 py-3.5 active:bg-neutral-50 dark:active:bg-neutral-800 ${
        isLast ? "" : "border-b border-neutral-100 dark:border-neutral-800"
      }`}
    >
      {isWebhook ? (
        <Link size={18} color={colors.primary} style={{ marginTop: 4 }} />
      ) : (
        <Clock size={18} color={colors.primary} style={{ marginTop: 4 }} />
      )}
      <View className="flex-1 ml-3">
        <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          {title}
        </Text>
        <Muted className="text-xs mt-0.5">{subtitle}</Muted>
      </View>
      {/* chevron removed */}
    </Pressable>
  );
}

export default function TriggersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  // Get triggers from routine detail
  const [{ data: routineData }] = useRoutine(id);
  const triggers = routineData?.routine?.triggers;

  // TODO: Migrate api.routineTriggers.createWebhookTrigger to GraphQL
  const [adding, setAdding] = useState(false);

  const handleAddWebhook = async () => {
    if (!id) return;
    // TODO: Migrate createWebhookTrigger to GraphQL
    Alert.alert("Not Implemented", "Webhook trigger creation not yet migrated to GraphQL.");
  };

  const handleAddTrigger = () => {
    Alert.alert(
      "Add Trigger",
      "What type of trigger would you like to add?",
      [
        {
          text: "Webhook",
          onPress: handleAddWebhook,
        },
        {
          text: "Schedule",
          onPress: () => router.push(`/routines/${id}/triggers/add-schedule`),
        },
        { text: "Cancel", style: "cancel" },
      ],
    );
  };

  return (
    <DetailLayout
      title="Triggers"
      headerRight={
        <Pressable
          onPress={handleAddTrigger}
          disabled={adding}
          className="flex-row items-center gap-1"
        >
          {adding ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <>
              <Plus size={18} color={colors.primary} />
              <Text style={{ color: colors.primary }} className="font-semibold text-base">
                Add
              </Text>
            </>
          )}
        </Pressable>
      }
    >
      <ScrollView className="flex-1 bg-neutral-50 dark:bg-neutral-950 pt-4">
        <WebContent>
          {triggers === undefined ? (
            <View className="items-center py-12">
              <Muted>Loading...</Muted>
            </View>
          ) : triggers.length === 0 ? (
            <View className="items-center py-12 px-6">
              <Muted className="text-center">
                No triggers yet. Add a webhook or schedule to automatically run this routine.
              </Muted>
              <Pressable
                onPress={handleAddTrigger}
                className="mt-4 flex-row items-center gap-2 px-5 py-3 rounded-xl border"
                style={{ borderColor: colors.primary }}
              >
                <Plus size={16} color={colors.primary} />
                <Text style={{ color: colors.primary }} className="font-semibold">
                  Add Trigger
                </Text>
              </Pressable>
            </View>
          ) : (
            <View className="bg-white dark:bg-neutral-900 rounded-xl overflow-hidden mx-4 mb-3">
              {triggers.map((trigger: any, idx: number) => (
                <TriggerCard
                  key={trigger.id}
                  trigger={trigger}
                  isLast={idx === triggers.length - 1}
                  onPress={() => router.push(`/routines/${id}/triggers/${trigger.id}`)}
                />
              ))}
            </View>
          )}

          <View className="h-8" />
        </WebContent>
      </ScrollView>
    </DetailLayout>
  );
}
