import { useState, useEffect, useRef } from "react";
import {
  View,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  Platform,
  Modal,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";
import { Text, Muted } from "@/components/ui/typography";
import { DetailLayout } from "@/components/layout/detail-layout";
import { WebContent } from "@/components/layout/web-content";
import { ChevronRight } from "lucide-react-native";

// --- Frequency Options ---

type FrequencyKey =
  | "every_5m"
  | "every_10m"
  | "every_15m"
  | "every_30m"
  | "every_hour"
  | "every_day"
  | "every_weekday"
  | "every_week"
  | "every_month";

interface FrequencyOption {
  key: FrequencyKey;
  label: string;
  hasTime: boolean;
  hasDays: boolean;
  hasDate: boolean;
  hasActiveHours: boolean;
}

const FREQUENCY_OPTIONS: FrequencyOption[] = [
  { key: "every_5m",      label: "Every 5 minutes",           hasTime: false, hasDays: false, hasDate: false, hasActiveHours: true },
  { key: "every_10m",     label: "Every 10 minutes",          hasTime: false, hasDays: false, hasDate: false, hasActiveHours: true },
  { key: "every_15m",     label: "Every 15 minutes",          hasTime: false, hasDays: false, hasDate: false, hasActiveHours: true },
  { key: "every_30m",     label: "Every 30 minutes",          hasTime: false, hasDays: false, hasDate: false, hasActiveHours: true },
  { key: "every_hour",    label: "Every hour",                hasTime: false, hasDays: false, hasDate: false, hasActiveHours: true },
  { key: "every_day",     label: "Every day",                 hasTime: true,  hasDays: false, hasDate: false, hasActiveHours: false },
  { key: "every_weekday", label: "Every weekday (Mon\u2013Fri)",   hasTime: true,  hasDays: false, hasDate: false, hasActiveHours: false },
  { key: "every_week",    label: "Every week",                hasTime: true,  hasDays: true,  hasDate: false, hasActiveHours: false },
  { key: "every_month",   label: "Every month",               hasTime: true,  hasDays: false, hasDate: true,  hasActiveHours: false },
];

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_CRON_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const TIMEZONES = [
  { label: "UTC",                    value: "UTC" },
  { label: "Eastern Time (ET)",      value: "America/New_York" },
  { label: "Central Time (CT)",      value: "America/Chicago" },
  { label: "Mountain Time (MT)",     value: "America/Denver" },
  { label: "Pacific Time (PT)",      value: "America/Los_Angeles" },
  { label: "Alaska Time (AKT)",      value: "America/Anchorage" },
  { label: "Hawaii Time (HST)",      value: "Pacific/Honolulu" },
];

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1-12

// --- Cron / Label Generators ---

interface ScheduleConfig {
  frequency: FrequencyKey;
  hour: number;       // 1-12
  minute: number;     // 0-59 (currently fixed to 0, shown as :00)
  ampm: "AM" | "PM";
  weekdays: number[]; // 0=Sun..6=Sat
  dayOfMonth: number; // 1-28
  timezone: string;
  activeHoursEnabled: boolean;
  activeHoursStart: number; // 0-23
  activeHoursEnd: number;   // 0-23
}

function buildHour(hour12: number, ampm: "AM" | "PM"): number {
  if (ampm === "AM") return hour12 === 12 ? 0 : hour12;
  return hour12 === 12 ? 12 : hour12 + 12;
}

function buildCron(config: ScheduleConfig): string {
  const hour24 = buildHour(config.hour, config.ampm);

  switch (config.frequency) {
    case "every_5m":      return "0/5 * * * ? *";
    case "every_10m":     return "0/10 * * * ? *";
    case "every_15m":     return "0/15 * * * ? *";
    case "every_30m":     return "0/30 * * * ? *";
    case "every_hour":    return "0 * * * ? *";
    case "every_day":     return `0 ${hour24} * * ? *`;
    case "every_weekday": return `0 ${hour24} ? * MON-FRI *`;
    case "every_week": {
      const days = config.weekdays.length > 0
        ? config.weekdays.map((d) => DAY_CRON_NAMES[d]).join(",")
        : "MON";
      return `0 ${hour24} ? * ${days} *`;
    }
    case "every_month":   return `0 ${hour24} ${config.dayOfMonth} * ? *`;
    default:              return "0 * * * ? *";
  }
}

function buildLabel(config: ScheduleConfig): string {
  const timeStr = `${config.hour}:00 ${config.ampm}`;

  switch (config.frequency) {
    case "every_5m":      return "Every 5 minutes";
    case "every_10m":     return "Every 10 minutes";
    case "every_15m":     return "Every 15 minutes";
    case "every_30m":     return "Every 30 minutes";
    case "every_hour":    return "Every hour";
    case "every_day":     return `Every day at ${timeStr}`;
    case "every_weekday": return `Every weekday at ${timeStr}`;
    case "every_week": {
      const names = config.weekdays.map((d) => ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d]);
      return `Every week on ${names.length > 0 ? names.join(", ") : "Monday"} at ${timeStr}`;
    }
    case "every_month":   return `Monthly on day ${config.dayOfMonth} at ${timeStr}`;
    default:              return "Custom schedule";
  }
}

// --- Cron -> Config Parser (for edit mode) ---

function triggerToConfig(trigger: {
  schedule?: string;
  timezone?: string;
  activeHoursStart?: number;
  activeHoursEnd?: number;
}): ScheduleConfig {
  const cron = trigger.schedule ?? "0 8 * * ? *";
  const parts = cron.split(" ");

  let frequency: FrequencyKey = "every_day";
  let hour24 = 8;
  let weekdays: number[] = [1];
  let dayOfMonth = 1;

  if (cron === "0/5 * * * ? *") frequency = "every_5m";
  else if (cron === "0/10 * * * ? *") frequency = "every_10m";
  else if (cron === "0/15 * * * ? *") frequency = "every_15m";
  else if (cron === "0/30 * * * ? *") frequency = "every_30m";
  else if (cron === "0 * * * ? *") frequency = "every_hour";
  else if (parts[4] === "MON-FRI") {
    frequency = "every_weekday";
    hour24 = parseInt(parts[1], 10);
  } else if (parts[2] === "?" && parts[4] !== "*" && parts[4] !== "?") {
    frequency = "every_week";
    hour24 = parseInt(parts[1], 10);
    const dayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    weekdays = parts[4].split(",").map((d) => dayNames.indexOf(d)).filter((i) => i >= 0);
    if (weekdays.length === 0) weekdays = [1];
  } else if (parts[2] !== "*" && parts[2] !== "?" && parts[4] === "?") {
    frequency = "every_month";
    hour24 = parseInt(parts[1], 10);
    dayOfMonth = parseInt(parts[2], 10);
  } else {
    frequency = "every_day";
    hour24 = parseInt(parts[1], 10);
  }

  // Convert 24h -> 12h + AM/PM
  let hour: number;
  let ampm: "AM" | "PM";
  if (hour24 === 0) { hour = 12; ampm = "AM"; }
  else if (hour24 < 12) { hour = hour24; ampm = "AM"; }
  else if (hour24 === 12) { hour = 12; ampm = "PM"; }
  else { hour = hour24 - 12; ampm = "PM"; }

  const activeHoursEnabled =
    trigger.activeHoursStart !== undefined && trigger.activeHoursEnd !== undefined;

  return {
    frequency,
    hour,
    minute: 0,
    ampm,
    weekdays,
    dayOfMonth,
    timezone: trigger.timezone ?? getDefaultTimezone(),
    activeHoursEnabled,
    activeHoursStart: trigger.activeHoursStart ?? 9,
    activeHoursEnd: trigger.activeHoursEnd ?? 17,
  };
}

// --- Sub-Components ---

function SectionHeader({ title }: { title: string }) {
  return (
    <Text className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide px-4 mb-1 mt-4">
      {title}
    </Text>
  );
}

/** A single settings-style row with label on the left, value + chevron on the right. */
function PickerRow({
  label,
  value,
  onPress,
  isLast,
}: {
  label: string;
  value: string;
  onPress: () => void;
  isLast?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center justify-between px-4 py-3.5 active:bg-neutral-50 dark:active:bg-neutral-800 ${
        isLast ? "" : "border-b border-neutral-100 dark:border-neutral-800"
      }`}
    >
      <Text className="text-base text-neutral-900 dark:text-neutral-100">{label}</Text>
      <View className="flex-row items-center gap-2">
        <Text className="text-base text-neutral-500 dark:text-neutral-400">{value}</Text>
        <ChevronRight size={16} color="#9ca3af" />
      </View>
    </Pressable>
  );
}

/** Modal list picker -- used for frequency, timezone, hour, AM/PM, day-of-month. */
function ListPickerModal<T extends string | number>({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: Array<{ label: string; value: T }>;
  selected: T;
  onSelect: (value: T) => void;
  onClose: () => void;
}) {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        className="flex-1 bg-black/40"
        onPress={onClose}
      />
      <View
        className="rounded-t-2xl"
        style={{ backgroundColor: colors.background, maxHeight: "70%" }}
      >
        {/* Handle */}
        <View className="items-center pt-3 pb-1">
          <View className="w-10 h-1 rounded-full bg-neutral-300 dark:bg-neutral-600" />
        </View>
        <View className="flex-row items-center justify-between px-4 pt-2 pb-3">
          <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {title}
          </Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text className="text-base text-neutral-400 dark:text-neutral-500 font-medium">Done</Text>
          </Pressable>
        </View>
        <ScrollView>
          {options.map((opt) => (
            <Pressable
              key={String(opt.value)}
              onPress={() => { onSelect(opt.value); onClose(); }}
              className="flex-row items-center justify-between px-4 py-3.5 border-b border-neutral-100 dark:border-neutral-800 active:bg-neutral-50 dark:active:bg-neutral-800"
            >
              <Text className="text-base text-neutral-900 dark:text-neutral-100">
                {opt.label}
              </Text>
              {opt.value === selected && (
                <View
                  className="w-5 h-5 rounded-full items-center justify-center"
                  style={{ backgroundColor: colors.primary }}
                >
                  <Text className="text-white text-xs font-bold">{"\u2713"}</Text>
                </View>
              )}
            </Pressable>
          ))}
          <View className="h-8" />
        </ScrollView>
      </View>
    </Modal>
  );
}

// --- Web Select Helpers ---

function WebSelect<T extends string | number>({
  value,
  options,
  onChange,
  colors,
}: {
  value: T;
  options: Array<{ label: string; value: T }>;
  onChange: (v: T) => void;
  colors: typeof COLORS.light;
}) {
  return (
    <select
      value={String(value)}
      onChange={(e: any) => {
        const raw = e.target.value;
        // Preserve numeric type
        const opt = options.find((o) => String(o.value) === raw);
        if (opt) onChange(opt.value);
      }}
      style={{
        background: "transparent",
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: "4px 8px",
        color: colors.foreground,
        fontSize: 15,
      }}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// --- Defaults ---

function getDefaultTimezone(): string {
  try {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return TIMEZONES.find((t) => t.value === local)?.value ?? "UTC";
  } catch {
    return "UTC";
  }
}

// --- Main Screen ---

export default function AddScheduleScreen() {
  const { id, triggerId } = useLocalSearchParams<{ id: string; triggerId?: string }>();
  const isEditing = !!triggerId;
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  // TODO: Migrate api.routineTriggers.createScheduleWithBridge to GraphQL
  // TODO: Migrate api.routineTriggers.updateScheduleWithBridge to GraphQL
  // TODO: Migrate api.routineTriggers.getTrigger to GraphQL

  // For edit mode, get existing trigger from routine
  const existingTrigger = undefined as any; // TODO: Migrate getTrigger to GraphQL

  const [config, setConfig] = useState<ScheduleConfig>({
    frequency: "every_day",
    hour: 8,
    minute: 0,
    ampm: "AM",
    weekdays: [1],
    dayOfMonth: 1,
    timezone: getDefaultTimezone(),
    activeHoursEnabled: false,
    activeHoursStart: 9,
    activeHoursEnd: 17,
  });

  const initialized = useRef(false);
  useEffect(() => {
    if (existingTrigger && !initialized.current) {
      initialized.current = true;
      setConfig(triggerToConfig(existingTrigger));
    }
  }, [existingTrigger]);

  const [saving, setSaving] = useState(false);

  // Modal state
  const [showFreqPicker, setShowFreqPicker] = useState(false);
  const [showHourPicker, setShowHourPicker] = useState(false);
  const [showAmPmPicker, setShowAmPmPicker] = useState(false);
  const [showTzPicker, setShowTzPicker] = useState(false);
  const [showDayPicker, setShowDayPicker] = useState(false);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  const freq = FREQUENCY_OPTIONS.find((f) => f.key === config.frequency)!;
  const update = (patch: Partial<ScheduleConfig>) =>
    setConfig((prev) => ({ ...prev, ...patch }));

  const toggleWeekday = (day: number) => {
    const days = config.weekdays.includes(day)
      ? config.weekdays.filter((d) => d !== day)
      : [...config.weekdays, day];
    update({ weekdays: days.length > 0 ? days : [day] });
  };

  const handleCreate = async () => {
    if (!id) return;
    setSaving(true);
    try {
      // TODO: Migrate createScheduleWithBridge / updateScheduleWithBridge to GraphQL
      Alert.alert("Not Implemented", "Schedule creation not yet migrated to GraphQL.");
      router.back();
    } catch (err) {
      Alert.alert("Error", String(err));
    } finally {
      setSaving(false);
    }
  };

  const previewLabel = buildLabel(config);
  const tzDisplay = TIMEZONES.find((t) => t.value === config.timezone)?.label ?? config.timezone;
  const freqDisplay = freq.label;
  const timeDisplay = `${config.hour}:00 ${config.ampm}`;

  // Hour options 1-12
  const hourOptions = HOURS.map((h) => ({ label: String(h), value: h }));
  const ampmOptions = [
    { label: "AM", value: "AM" as const },
    { label: "PM", value: "PM" as const },
  ];
  // 0-23 for active hours
  const hour24Options = Array.from({ length: 24 }, (_, i) => ({
    label: `${i}:00 (${i < 12 ? (i === 0 ? "12 AM" : `${i} AM`) : (i === 12 ? "12 PM" : `${i - 12} PM`)})`,
    value: i,
  }));
  const dayOptions = Array.from({ length: 28 }, (_, i) => ({
    label: String(i + 1),
    value: i + 1,
  }));

  return (
    <DetailLayout title={isEditing ? "Edit Schedule" : "Add Schedule"}>
      <ScrollView className="flex-1 bg-neutral-50 dark:bg-neutral-950 pt-4">
        <WebContent>

          {/* -- Frequency -- */}
          <SectionHeader title="Frequency" />
          <View className="bg-white dark:bg-neutral-900 rounded-xl overflow-hidden mx-4 mb-2">
            {Platform.OS === "web" ? (
              <View className="flex-row items-center justify-between px-4 py-3.5">
                <Text className="text-base text-neutral-900 dark:text-neutral-100">How often</Text>
                <WebSelect
                  value={config.frequency}
                  options={FREQUENCY_OPTIONS.map((f) => ({ label: f.label, value: f.key }))}
                  onChange={(v) => update({ frequency: v as FrequencyKey })}
                  colors={colors}
                />
              </View>
            ) : (
              <PickerRow
                label="How often"
                value={freqDisplay}
                onPress={() => setShowFreqPicker(true)}
                isLast
              />
            )}
          </View>

          {/* -- Time (for daily/weekday/weekly/monthly) -- */}
          {freq.hasTime && (
            <>
              <SectionHeader title="Time" />
              <View className="bg-white dark:bg-neutral-900 rounded-xl overflow-hidden mx-4 mb-2">
                {Platform.OS === "web" ? (
                  <View className="flex-row items-center justify-between px-4 py-3.5">
                    <Text className="text-base text-neutral-900 dark:text-neutral-100">At</Text>
                    <View className="flex-row items-center gap-2">
                      <WebSelect
                        value={config.hour}
                        options={hourOptions}
                        onChange={(v) => update({ hour: v as number })}
                        colors={colors}
                      />
                      <WebSelect
                        value={config.ampm}
                        options={ampmOptions}
                        onChange={(v) => update({ ampm: v as "AM" | "PM" })}
                        colors={colors}
                      />
                    </View>
                  </View>
                ) : (
                  <>
                    <PickerRow
                      label="Hour"
                      value={String(config.hour)}
                      onPress={() => setShowHourPicker(true)}
                    />
                    <PickerRow
                      label="AM / PM"
                      value={config.ampm}
                      onPress={() => setShowAmPmPicker(true)}
                      isLast
                    />
                  </>
                )}
              </View>
            </>
          )}

          {/* -- Day of Week (for weekly) -- */}
          {freq.hasDays && (
            <>
              <SectionHeader title="Day of Week" />
              <View className="bg-white dark:bg-neutral-900 rounded-xl overflow-hidden mx-4 mb-2 px-4 py-3">
                <View className="flex-row justify-between">
                  {DAY_LABELS.map((label, idx) => {
                    const selected = config.weekdays.includes(idx);
                    return (
                      <Pressable
                        key={idx}
                        onPress={() => toggleWeekday(idx)}
                        className="w-9 h-9 rounded-full items-center justify-center"
                        style={{
                          backgroundColor: selected ? colors.primary : colors.muted,
                        }}
                      >
                        <Text
                          style={{ color: selected ? "#fff" : colors.mutedForeground }}
                          className="text-sm font-semibold"
                        >
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </>
          )}

          {/* -- Day of Month (for monthly) -- */}
          {freq.hasDate && (
            <>
              <SectionHeader title="Day of Month" />
              <View className="bg-white dark:bg-neutral-900 rounded-xl overflow-hidden mx-4 mb-2">
                {Platform.OS === "web" ? (
                  <View className="flex-row items-center justify-between px-4 py-3.5">
                    <Text className="text-base text-neutral-900 dark:text-neutral-100">Day</Text>
                    <WebSelect
                      value={config.dayOfMonth}
                      options={dayOptions}
                      onChange={(v) => update({ dayOfMonth: v as number })}
                      colors={colors}
                    />
                  </View>
                ) : (
                  <PickerRow
                    label="Day"
                    value={String(config.dayOfMonth)}
                    onPress={() => setShowDayPicker(true)}
                    isLast
                  />
                )}
              </View>
            </>
          )}

          {/* -- Timezone -- */}
          <SectionHeader title="Timezone" />
          <View className="bg-white dark:bg-neutral-900 rounded-xl overflow-hidden mx-4 mb-2">
            {Platform.OS === "web" ? (
              <View className="flex-row items-center justify-between px-4 py-3.5">
                <Text className="text-base text-neutral-900 dark:text-neutral-100">Timezone</Text>
                <WebSelect
                  value={config.timezone}
                  options={TIMEZONES.map((tz) => ({ label: tz.label, value: tz.value }))}
                  onChange={(v) => update({ timezone: v as string })}
                  colors={colors}
                />
              </View>
            ) : (
              <PickerRow
                label="Timezone"
                value={tzDisplay}
                onPress={() => setShowTzPicker(true)}
                isLast
              />
            )}
          </View>

          {/* -- Active Hours (minute/hourly only) -- */}
          {freq.hasActiveHours && (
            <>
              <SectionHeader title="Active Hours (Optional)" />
              <View className="bg-white dark:bg-neutral-900 rounded-xl overflow-hidden mx-4 mb-2">
                <View className="flex-row items-center justify-between px-4 py-3.5 border-b border-neutral-100 dark:border-neutral-800">
                  <View className="flex-1 mr-4">
                    <Text className="text-base text-neutral-900 dark:text-neutral-100">
                      Only during specific hours
                    </Text>
                    <Muted className="text-xs mt-0.5">Skip runs outside this window</Muted>
                  </View>
                  <Pressable
                    onPress={() => update({ activeHoursEnabled: !config.activeHoursEnabled })}
                    className="w-12 h-6 rounded-full items-center justify-center"
                    style={{
                      backgroundColor: config.activeHoursEnabled ? colors.primary : colors.muted,
                    }}
                  >
                    <View
                      className="w-5 h-5 rounded-full bg-white"
                      style={{
                        marginLeft: config.activeHoursEnabled ? 6 : -6,
                        shadowColor: "#000",
                        shadowOpacity: 0.15,
                        shadowRadius: 2,
                        shadowOffset: { width: 0, height: 1 },
                      }}
                    />
                  </Pressable>
                </View>

                {config.activeHoursEnabled && (
                  Platform.OS === "web" ? (
                    <>
                      <View className="flex-row items-center justify-between px-4 py-3.5 border-b border-neutral-100 dark:border-neutral-800">
                        <Text className="text-base text-neutral-900 dark:text-neutral-100">Start hour</Text>
                        <WebSelect
                          value={config.activeHoursStart}
                          options={hour24Options}
                          onChange={(v) => update({ activeHoursStart: v as number })}
                          colors={colors}
                        />
                      </View>
                      <View className="flex-row items-center justify-between px-4 py-3.5">
                        <Text className="text-base text-neutral-900 dark:text-neutral-100">End hour</Text>
                        <WebSelect
                          value={config.activeHoursEnd}
                          options={hour24Options}
                          onChange={(v) => update({ activeHoursEnd: v as number })}
                          colors={colors}
                        />
                      </View>
                    </>
                  ) : (
                    <>
                      <PickerRow
                        label="Start hour"
                        value={hour24Options[config.activeHoursStart]?.label ?? String(config.activeHoursStart)}
                        onPress={() => setShowStartPicker(true)}
                      />
                      <PickerRow
                        label="End hour"
                        value={hour24Options[config.activeHoursEnd]?.label ?? String(config.activeHoursEnd)}
                        onPress={() => setShowEndPicker(true)}
                        isLast
                      />
                    </>
                  )
                )}
              </View>
            </>
          )}

          {/* -- Preview -- */}
          <View className="mx-4 mt-2 mb-2 px-4 py-3.5 bg-white dark:bg-neutral-900 rounded-xl">
            <Muted className="text-xs uppercase tracking-wide mb-1">Preview</Muted>
            <Text className="text-base font-medium text-neutral-900 dark:text-neutral-100">
              {previewLabel}
            </Text>
            {!freq.hasTime && (
              <Muted className="text-xs mt-0.5">{tzDisplay}</Muted>
            )}
            {freq.hasTime && (
              <Muted className="text-xs mt-0.5">{tzDisplay}</Muted>
            )}
          </View>

          {/* -- Create button -- */}
          <View className="mx-4 mt-2 mb-4">
            <Pressable
              onPress={handleCreate}
              disabled={saving}
              className="py-4 rounded-xl items-center justify-center"
              style={{ backgroundColor: saving ? colors.muted : colors.primary }}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text className="text-white font-bold text-base">
                  {isEditing ? "Update Schedule" : "Create Schedule"}
                </Text>
              )}
            </Pressable>
          </View>

          <View className="h-8" />
        </WebContent>
      </ScrollView>

      {/* -- Modal Pickers (native only) -- */}
      <ListPickerModal
        visible={showFreqPicker}
        title="How often"
        options={FREQUENCY_OPTIONS.map((f) => ({ label: f.label, value: f.key }))}
        selected={config.frequency}
        onSelect={(v) => update({ frequency: v as FrequencyKey })}
        onClose={() => setShowFreqPicker(false)}
      />
      <ListPickerModal
        visible={showHourPicker}
        title="Hour"
        options={hourOptions}
        selected={config.hour}
        onSelect={(v) => update({ hour: v as number })}
        onClose={() => setShowHourPicker(false)}
      />
      <ListPickerModal
        visible={showAmPmPicker}
        title="AM / PM"
        options={ampmOptions}
        selected={config.ampm}
        onSelect={(v) => update({ ampm: v as "AM" | "PM" })}
        onClose={() => setShowAmPmPicker(false)}
      />
      <ListPickerModal
        visible={showTzPicker}
        title="Timezone"
        options={TIMEZONES.map((tz) => ({ label: tz.label, value: tz.value }))}
        selected={config.timezone}
        onSelect={(v) => update({ timezone: v as string })}
        onClose={() => setShowTzPicker(false)}
      />
      <ListPickerModal
        visible={showDayPicker}
        title="Day of Month"
        options={dayOptions}
        selected={config.dayOfMonth}
        onSelect={(v) => update({ dayOfMonth: v as number })}
        onClose={() => setShowDayPicker(false)}
      />
      <ListPickerModal
        visible={showStartPicker}
        title="Start Hour"
        options={hour24Options}
        selected={config.activeHoursStart}
        onSelect={(v) => update({ activeHoursStart: v as number })}
        onClose={() => setShowStartPicker(false)}
      />
      <ListPickerModal
        visible={showEndPicker}
        title="End Hour"
        options={hour24Options}
        selected={config.activeHoursEnd}
        onSelect={(v) => update({ activeHoursEnd: v as number })}
        onClose={() => setShowEndPicker(false)}
      />
    </DetailLayout>
  );
}
