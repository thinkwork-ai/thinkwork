import { useState, useRef, useCallback } from "react";
import { View, Pressable, Modal, Dimensions } from "react-native";
import { useColorScheme } from "nativewind";
import { Check, ChevronDown, Archive } from "lucide-react-native";
import { Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";

export interface ThreadFilters {
  channels: string[];
  agentId: string;
  showArchived: boolean;
}

interface ThreadFilterBarProps {
  filters: ThreadFilters;
  onFiltersChange: (filters: ThreadFilters) => void;
}

const CHANNEL_OPTIONS = [
  { label: "Chat", value: "CHAT" },
  { label: "Email", value: "EMAIL" },
  { label: "Task", value: "TASK" },
  { label: "Job", value: "JOB" },
  { label: "Webhook", value: "WEBHOOK" },
];

function summarize(selected: string[], options: Array<{ label: string; value: string }>): string {
  if (selected.length === 0) return "All";
  if (selected.length === 1) return options.find((o) => o.value === selected[0])?.label ?? selected[0];
  return `${selected.length} selected`;
}

// ── Multi-select dropdown popover ─────────────────────────────────────────

function MultiSelectDropdown({
  visible,
  anchor,
  options,
  selected,
  onToggle,
  onClose,
}: {
  visible: boolean;
  anchor: { x: number; y: number; width: number; height: number } | null;
  options: Array<{ label: string; value: string }>;
  selected: string[];
  onToggle: (value: string) => void;
  onClose: () => void;
}) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const screenWidth = Dimensions.get("window").width;

  if (!visible || !anchor) return null;

  const dropdownTop = anchor.y + anchor.height + 4;
  const dropdownLeft = Math.min(anchor.x, screenWidth - 200);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Tap outside to close */}
      <Pressable style={{ flex: 1 }} onPress={onClose}>
        <View
          onStartShouldSetResponder={() => true}
          style={{
            position: "absolute",
            top: dropdownTop,
            left: dropdownLeft,
            minWidth: 180,
            maxWidth: 240,
            backgroundColor: isDark ? "#1c1c1e" : "#ffffff",
            borderRadius: 12,
            borderWidth: 1,
            borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)",
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: isDark ? 0.5 : 0.15,
            shadowRadius: 12,
            elevation: 8,
            overflow: "hidden",
          }}
        >
          {/* Clear all / select all */}
          <Pressable
            onPress={() => {
              // If anything selected, clear all. Otherwise do nothing.
              if (selected.length > 0) {
                // Clear by toggling each selected off — or just pass empty
                onToggle("__CLEAR__");
              }
            }}
            className="px-4 py-2.5 active:opacity-70"
            style={{
              borderBottomWidth: 0.5,
              borderBottomColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
            }}
          >
            <Text className={`text-xs font-medium ${selected.length === 0 ? "text-primary" : ""}`}
              style={selected.length === 0 ? { color: colors.primary } : { color: colors.mutedForeground }}
            >
              {selected.length === 0 ? "✓ All (no filter)" : "Clear filter"}
            </Text>
          </Pressable>

          {options.map((opt, i) => {
            const isSelected = selected.includes(opt.value);
            const isLast = i === options.length - 1;
            return (
              <Pressable
                key={opt.value}
                onPress={() => onToggle(opt.value)}
                className="flex-row items-center justify-between px-4 py-3 active:opacity-70"
                style={!isLast ? {
                  borderBottomWidth: 0.5,
                  borderBottomColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                } : undefined}
              >
                <Text className={`text-sm ${isSelected ? "font-semibold" : ""}`}
                  style={isSelected ? { color: colors.primary } : undefined}
                >
                  {opt.label}
                </Text>
                {isSelected && <Check size={16} color={colors.primary} />}
              </Pressable>
            );
          })}
        </View>
      </Pressable>
    </Modal>
  );
}

// ── Filter trigger button ─────────────────────────────────────────────────

function FilterButton({
  label,
  value,
  isActive,
  onPress,
  buttonRef,
}: {
  label: string;
  value: string;
  isActive: boolean;
  onPress: () => void;
  buttonRef: React.RefObject<View | null>;
}) {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  return (
    <Pressable
      ref={buttonRef}
      onPress={onPress}
      className={`flex-row items-center gap-1 px-3 py-1.5 rounded-lg border active:opacity-70 ${
        isActive
          ? "border-primary bg-primary/10"
          : "border-neutral-300 dark:border-neutral-700"
      }`}
    >
      <Text className={`text-xs font-medium ${isActive ? "text-primary" : ""}`}>
        {label}: {value}
      </Text>
      <ChevronDown size={12} color={isActive ? colors.primary : colors.mutedForeground} />
    </Pressable>
  );
}

// ── Exported component ────────────────────────────────────────────────────

export function ThreadFilterBar({ filters, onFiltersChange }: ThreadFilterBarProps) {
  const { colorScheme } = useColorScheme();
  const fColors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const [activeDropdown, setActiveDropdown] = useState<"channel" | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  const channelRef = useRef<View>(null);

  const openDropdown = useCallback((type: "channel", ref: React.RefObject<View | null>) => {
    ref.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
      setActiveDropdown(type);
    });
  }, []);

  const toggleChannel = useCallback((value: string) => {
    if (value === "__CLEAR__") {
      onFiltersChange({ ...filters, channels: [] });
      return;
    }
    const current = filters.channels;
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onFiltersChange({ ...filters, channels: next });
  }, [filters, onFiltersChange]);

  return (
    <View className="flex-row items-center gap-2 px-4 py-2.5 border-b border-neutral-200 dark:border-neutral-800">
      <FilterButton
        label="Type"
        value={summarize(filters.channels, CHANNEL_OPTIONS)}
        isActive={filters.channels.length > 0}
        onPress={() => openDropdown("channel", channelRef)}
        buttonRef={channelRef}
      />

      <Pressable
        onPress={() => onFiltersChange({ ...filters, showArchived: !filters.showArchived })}
        className={`flex-row items-center gap-1 px-3 py-1.5 rounded-lg border active:opacity-70 ${
          filters.showArchived
            ? "border-primary bg-primary/10"
            : "border-neutral-300 dark:border-neutral-700"
        }`}
      >
        <Archive size={12} color={filters.showArchived ? fColors.primary : fColors.mutedForeground} />
        <Text className={`text-xs font-medium ${filters.showArchived ? "text-primary" : ""}`}>
          Archived
        </Text>
      </Pressable>

      <MultiSelectDropdown
        visible={activeDropdown === "channel"}
        anchor={anchor}
        options={CHANNEL_OPTIONS}
        selected={filters.channels}
        onToggle={toggleChannel}
        onClose={() => setActiveDropdown(null)}
      />
    </View>
  );
}
