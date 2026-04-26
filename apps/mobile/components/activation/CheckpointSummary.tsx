import { View } from "react-native";
import { Text, Muted } from "@/components/ui/typography";
import { EpistemicStateBadge } from "./EpistemicStateBadge";

export function CheckpointSummary({
  layer,
  entries,
}: {
  layer: string;
  entries: Array<Record<string, any>>;
}) {
  return (
    <View className="gap-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <Text className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
        {layer}
      </Text>
      {entries.length === 0 ? (
        <Muted>No durable notes for this layer yet.</Muted>
      ) : (
        entries.map((entry, index) => (
          <View key={`${entry.id ?? index}`} className="gap-1">
            <View className="flex-row items-center justify-between gap-2">
              <Text className="flex-1 font-medium">
                {entry.title ?? "Note"}
              </Text>
              <EpistemicStateBadge
                state={entry.epistemicState ?? "confirmed"}
              />
            </View>
            <Muted>{entry.summary ?? entry.content ?? ""}</Muted>
          </View>
        ))
      )}
    </View>
  );
}
