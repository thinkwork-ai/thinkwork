import { useState } from "react";
import { View, ScrollView, Pressable, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useAgents } from "@/lib/hooks/use-agents";
import { useRoutines } from "@/lib/hooks/use-routines";
import { useCreateTrigger } from "@/lib/hooks/use-triggers";
import { useAuth } from "@/lib/auth-context";
import { DetailLayout } from "@/components/layout/detail-layout";
import { Text, Muted } from "@/components/ui/typography";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";

// Schedule config types & helpers

type FrequencyKey =
  | "every_5m" | "every_10m" | "every_15m" | "every_30m" | "every_hour"
  | "every_day" | "every_weekday" | "every_week" | "every_month";

const FREQUENCIES: { key: FrequencyKey; label: string }[] = [
  { key: "every_5m", label: "Every 5 minutes" },
  { key: "every_10m", label: "Every 10 minutes" },
  { key: "every_15m", label: "Every 15 minutes" },
  { key: "every_30m", label: "Every 30 minutes" },
  { key: "every_hour", label: "Every hour" },
  { key: "every_day", label: "Every day" },
  { key: "every_weekday", label: "Every weekday" },
  { key: "every_week", label: "Every week" },
  { key: "every_month", label: "Every month" },
];

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_CRON_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const TIMEZONES = [
  { label: "UTC", value: "UTC" },
  { label: "Eastern Time (ET)", value: "America/New_York" },
  { label: "Central Time (CT)", value: "America/Chicago" },
  { label: "Mountain Time (MT)", value: "America/Denver" },
  { label: "Pacific Time (PT)", value: "America/Los_Angeles" },
  { label: "Alaska Time (AKT)", value: "America/Anchorage" },
  { label: "Hawaii Time (HST)", value: "Pacific/Honolulu" },
];

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);

function buildHour(hour12: number, ampm: "AM" | "PM"): number {
  if (ampm === "AM") return hour12 === 12 ? 0 : hour12;
  return hour12 === 12 ? 12 : hour12 + 12;
}

function buildCron(freq: FrequencyKey, hour: number, ampm: "AM" | "PM", weekdays: number[], dayOfMonth: number): string {
  const h24 = buildHour(hour, ampm);
  switch (freq) {
    case "every_5m":      return "0/5 * * * ? *";
    case "every_10m":     return "0/10 * * * ? *";
    case "every_15m":     return "0/15 * * * ? *";
    case "every_30m":     return "0/30 * * * ? *";
    case "every_hour":    return "0 * * * ? *";
    case "every_day":     return `0 ${h24} * * ? *`;
    case "every_weekday": return `0 ${h24} ? * MON-FRI *`;
    case "every_week": {
      const days = weekdays.length > 0 ? weekdays.map((d) => DAY_CRON_NAMES[d]).join(",") : "MON";
      return `0 ${h24} ? * ${days} *`;
    }
    case "every_month":   return `0 ${h24} ${dayOfMonth} * ? *`;
    default:              return "0 * * * ? *";
  }
}

function buildLabel(freq: FrequencyKey, hour: number, ampm: "AM" | "PM", weekdays: number[], dayOfMonth: number): string {
  const t = `${hour}:00 ${ampm}`;
  switch (freq) {
    case "every_5m":      return "Every 5 minutes";
    case "every_10m":     return "Every 10 minutes";
    case "every_15m":     return "Every 15 minutes";
    case "every_30m":     return "Every 30 minutes";
    case "every_hour":    return "Every hour";
    case "every_day":     return `Every day at ${t}`;
    case "every_weekday": return `Every weekday at ${t}`;
    case "every_week": {
      const names = weekdays.map((d) => ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d]);
      return `Every week on ${names.length > 0 ? names.join(", ") : "Monday"} at ${t}`;
    }
    case "every_month":   return `Monthly on day ${dayOfMonth} at ${t}`;
    default:              return "Custom schedule";
  }
}

const needsTime = (f: FrequencyKey) => ["every_day","every_weekday","every_week","every_month"].includes(f);

// Screen

export default function NewTriggerScreen() {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const { user } = useAuth();
  const tenantId = (user as any)?.tenantId;

  const [{ data: routinesData }] = useRoutines(tenantId);
  const routines = routinesData?.routines ?? undefined;
  const [{ data: agentsData }] = useAgents(tenantId);
  const agents = agentsData?.agents ?? undefined;
  const [, executeCreateTrigger] = useCreateTrigger();

  const [jobType, setJobType] = useState<"agent" | "routine">("agent");
  const [name, setName] = useState("");
  const [selectedRoutineId, setSelectedRoutineId] = useState<string | null>(null);
  const [showRoutinePicker, setShowRoutinePicker] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [frequency, setFrequency] = useState<FrequencyKey>("every_day");
  const [hour, setHour] = useState(8);
  const [ampm, setAmpm] = useState<"AM" | "PM">("AM");
  const [weekdays, setWeekdays] = useState<number[]>([1]); // Monday
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [timezone, setTimezone] = useState("America/Chicago");
  const [showTzPicker, setShowTzPicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selectedRoutine = routines?.find((r: any) => r.id === selectedRoutineId);
  const selectedAgent = agents?.find((a: any) => a.id === selectedAgentId);
  const selectedTz = TIMEZONES.find((tz) => tz.value === timezone);

  const canSubmit = name.trim() &&
    (jobType === "agent" ? selectedAgentId && prompt.trim() : selectedRoutineId);

  const handleCreate = async () => {
    if (!name.trim()) {
      Alert.alert("Error", "Please enter a trigger name");
      return;
    }
    if (jobType === "routine" && !selectedRoutineId) {
      Alert.alert("Error", "Please select a routine");
      return;
    }
    if (jobType === "agent" && !selectedAgentId) {
      Alert.alert("Error", "Please select an agent");
      return;
    }
    if (jobType === "agent" && !prompt.trim()) {
      Alert.alert("Error", "Please enter a prompt for the agent");
      return;
    }
    setSubmitting(true);
    try {
      const cron = buildCron(frequency, hour, ampm, weekdays, dayOfMonth);
      const { error } = await executeCreateTrigger({
        input: {
          tenantId,
          triggerType: jobType === "agent" ? "agent_scheduled" : "routine_schedule",
          agentId: jobType === "agent" ? selectedAgentId! : undefined,
          routineId: jobType === "routine" ? selectedRoutineId! : undefined,
          name: name.trim(),
          prompt: jobType === "agent" ? prompt.trim() : undefined,
          scheduleType: "cron",
          scheduleExpression: `cron(${cron})`,
          timezone,
          createdByType: "user",
        },
      });
      if (error) throw error;
      router.back();
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed to create trigger");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleWeekday = (d: number) => {
    setWeekdays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort(),
    );
  };

  return (
    <DetailLayout title="New Trigger">
      <ScrollView
        className="flex-1 bg-white dark:bg-neutral-950"
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Type selector */}
        <View className="mb-4">
          <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-2">Type</Text>
          <View className="flex-row gap-2">
            {(["agent", "routine"] as const).map((t) => (
              <Pressable
                key={t}
                onPress={() => setJobType(t)}
                className={`flex-1 items-center justify-center rounded-lg border ${
                  jobType === t
                    ? "bg-sky-500 border-sky-500"
                    : "bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700"
                }`}
                style={{ height: 48 }}
              >
                <Text className={`text-base font-medium ${jobType === t ? "text-white" : "text-neutral-900 dark:text-neutral-100"}`}>
                  {t === "agent" ? "Agent Activity" : "Routine"}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Name */}
        <Input
          label="Trigger Name"
          value={name}
          onChangeText={setName}
          placeholder={jobType === "agent" ? "e.g. Check Austin headlines" : "e.g. Daily CRM sync"}
          autoCapitalize="words"
        />

        {/* Agent fields */}
        {jobType === "agent" && (
          <>
            <View className="mt-4">
              <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-2">Agent</Text>
              <Pressable
                onPress={() => setShowAgentPicker(!showAgentPicker)}
                className="h-12 border border-neutral-300 dark:border-neutral-700 rounded-lg px-3 bg-white dark:bg-neutral-900 flex-row items-center justify-between"
              >
                <Text className="text-neutral-900 dark:text-neutral-100">
                  {selectedAgent?.name || "Select agent..."}
                </Text>
                <ChevronDown size={20} color="#737373" />
              </Pressable>
              {showAgentPicker && (
                <View className="mt-2 border border-neutral-300 dark:border-neutral-700 rounded-lg overflow-hidden">
                  {(agents ?? []).filter((a: any) => a.status !== "revoked" && a.status !== "archived").map((a: any) => (
                    <Pressable
                      key={a.id}
                      onPress={() => {
                        setSelectedAgentId(a.id);
                        setShowAgentPicker(false);
                      }}
                      className={`px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 ${
                        selectedAgentId === a.id ? "bg-sky-50 dark:bg-sky-900/20" : "bg-white dark:bg-neutral-900"
                      }`}
                    >
                      <Text className={selectedAgentId === a.id ? "text-sky-600 dark:text-sky-400 font-medium" : "text-neutral-900 dark:text-neutral-100"}>
                        {a.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
            <View className="mt-4">
              <Input
                label="Prompt"
                value={prompt}
                onChangeText={setPrompt}
                placeholder="e.g. Look at the headlines for Austin and summarize any important news"
                multiline
                numberOfLines={3}
              />
            </View>
          </>
        )}

        {/* Routine picker */}
        {jobType === "routine" && (
        <View className="mt-4">
          <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-2">Routine</Text>
          <Pressable
            onPress={() => setShowRoutinePicker(!showRoutinePicker)}
            className="h-12 border border-neutral-300 dark:border-neutral-700 rounded-lg px-3 bg-white dark:bg-neutral-900 flex-row items-center justify-between"
          >
            <Text className="text-neutral-900 dark:text-neutral-100">
              {selectedRoutine?.name || "Select routine..."}
            </Text>
            <ChevronDown size={20} color="#737373" />
          </Pressable>
          {showRoutinePicker && (
            <View className="mt-2 border border-neutral-300 dark:border-neutral-700 rounded-lg overflow-hidden">
              {(routines ?? []).filter((r: any) => r.status === "active").map((r: any) => (
                <Pressable
                  key={r.id}
                  onPress={() => {
                    setSelectedRoutineId(r.id);
                    setShowRoutinePicker(false);
                    if (!name.trim()) setName(r.name);
                  }}
                  className={`px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 ${
                    selectedRoutineId === r.id ? "bg-sky-50 dark:bg-sky-900/20" : "bg-white dark:bg-neutral-900"
                  }`}
                >
                  <Text className={selectedRoutineId === r.id ? "text-sky-600 dark:text-sky-400 font-medium" : "text-neutral-900 dark:text-neutral-100"}>
                    {r.name}
                  </Text>
                </Pressable>
              ))}
              {(!routines || routines.filter((r: any) => r.status === "active").length === 0) && (
                <View className="px-4 py-3">
                  <Muted>No active routines available</Muted>
                </View>
              )}
            </View>
          )}
        </View>
        )}

        {/* Frequency */}
        <View className="mt-4">
          <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-2">Frequency</Text>
          <View className="flex-row flex-wrap gap-2">
            {FREQUENCIES.map((f) => (
              <Pressable
                key={f.key}
                onPress={() => setFrequency(f.key)}
                className={`px-3 py-2 rounded-lg border ${
                  frequency === f.key
                    ? "bg-sky-500 border-sky-500"
                    : "bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700"
                }`}
              >
                <Text className={`text-sm ${frequency === f.key ? "text-white" : "text-neutral-900 dark:text-neutral-100"}`}>
                  {f.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Time picker (for daily/weekly/monthly) */}
        {needsTime(frequency) && (
          <View className="mt-4">
            <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-2">Time</Text>
            <View className="flex-row gap-2 items-center">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, flexDirection: "row" }}>
                {HOURS.map((h) => (
                  <Pressable
                    key={h}
                    onPress={() => setHour(h)}
                    className={`w-10 h-10 rounded-lg items-center justify-center border ${
                      hour === h
                        ? "bg-sky-500 border-sky-500"
                        : "bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700"
                    }`}
                  >
                    <Text className={`text-sm ${hour === h ? "text-white font-medium" : "text-neutral-900 dark:text-neutral-100"}`}>{h}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <View className="flex-row gap-1">
                {(["AM", "PM"] as const).map((v) => (
                  <Pressable
                    key={v}
                    onPress={() => setAmpm(v)}
                    className={`px-3 h-10 rounded-lg items-center justify-center border ${
                      ampm === v
                        ? "bg-sky-500 border-sky-500"
                        : "bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700"
                    }`}
                  >
                    <Text className={`text-sm font-medium ${ampm === v ? "text-white" : "text-neutral-900 dark:text-neutral-100"}`}>{v}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        )}

        {/* Weekday picker */}
        {frequency === "every_week" && (
          <View className="mt-4">
            <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-2">Days</Text>
            <View className="flex-row gap-2">
              {DAY_LABELS.map((label, i) => (
                <Pressable
                  key={i}
                  onPress={() => toggleWeekday(i)}
                  className={`w-10 h-10 rounded-full items-center justify-center border ${
                    weekdays.includes(i)
                      ? "bg-sky-500 border-sky-500"
                      : "bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700"
                  }`}
                >
                  <Text className={`text-sm font-medium ${weekdays.includes(i) ? "text-white" : "text-neutral-900 dark:text-neutral-100"}`}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* Day of month */}
        {frequency === "every_month" && (
          <View className="mt-4">
            <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-2">Day of Month</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, flexDirection: "row" }}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <Pressable
                  key={d}
                  onPress={() => setDayOfMonth(d)}
                  className={`w-10 h-10 rounded-lg items-center justify-center border ${
                    dayOfMonth === d
                      ? "bg-sky-500 border-sky-500"
                      : "bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700"
                  }`}
                >
                  <Text className={`text-sm ${dayOfMonth === d ? "text-white font-medium" : "text-neutral-900 dark:text-neutral-100"}`}>{d}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Timezone */}
        <View className="mt-4">
          <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-2">Timezone</Text>
          <Pressable
            onPress={() => setShowTzPicker(!showTzPicker)}
            className="h-12 border border-neutral-300 dark:border-neutral-700 rounded-lg px-3 bg-white dark:bg-neutral-900 flex-row items-center justify-between"
          >
            <Text className="text-neutral-900 dark:text-neutral-100">{selectedTz?.label ?? timezone}</Text>
            <ChevronDown size={20} color="#737373" />
          </Pressable>
          {showTzPicker && (
            <View className="mt-2 border border-neutral-300 dark:border-neutral-700 rounded-lg overflow-hidden">
              {TIMEZONES.map((tz) => (
                <Pressable
                  key={tz.value}
                  onPress={() => { setTimezone(tz.value); setShowTzPicker(false); }}
                  className={`px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 ${
                    timezone === tz.value ? "bg-sky-50 dark:bg-sky-900/20" : "bg-white dark:bg-neutral-900"
                  }`}
                >
                  <Text className={timezone === tz.value ? "text-sky-600 dark:text-sky-400 font-medium" : "text-neutral-900 dark:text-neutral-100"}>
                    {tz.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* Preview */}
        <View className="mt-6 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-4 py-3">
          <Muted className="text-xs uppercase tracking-wide mb-1">Preview</Muted>
          <Text className="text-base font-medium text-neutral-900 dark:text-neutral-100">
            {buildLabel(frequency, hour, ampm, weekdays, dayOfMonth)}
          </Text>
          <Muted className="text-xs mt-0.5">{selectedTz?.label ?? timezone}</Muted>
        </View>

        {/* Submit */}
        <View className="mt-6">
          <Button onPress={handleCreate} loading={submitting} disabled={!canSubmit}>
            Create Trigger
          </Button>
        </View>
      </ScrollView>
    </DetailLayout>
  );
}
