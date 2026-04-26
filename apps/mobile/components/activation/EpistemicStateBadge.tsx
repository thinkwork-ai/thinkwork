import { View } from "react-native";
import { Check, Sparkles, CircleAlert } from "lucide-react-native";
import { Text } from "@/components/ui/typography";

export function EpistemicStateBadge({ state }: { state: string }) {
  const normalized = state || "tentative";
  const icon =
    normalized === "confirmed" ? (
      <Check size={13} color="#047857" />
    ) : normalized === "synthesized" ? (
      <Sparkles size={13} color="#6d28d9" />
    ) : (
      <CircleAlert size={13} color="#92400e" />
    );
  const classes =
    normalized === "confirmed"
      ? "border-emerald-200 bg-emerald-50"
      : normalized === "synthesized"
        ? "border-violet-300 bg-violet-50 border-dashed"
        : "border-amber-200 bg-amber-50";
  return (
    <View
      className={`self-start flex-row items-center gap-1 rounded-full border px-2 py-1 ${classes}`}
    >
      {icon}
      <Text className="text-xs font-medium capitalize text-neutral-800">
        {normalized}
      </Text>
    </View>
  );
}
