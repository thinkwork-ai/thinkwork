import { View, TextInput } from "react-native";
import { Send, CheckCircle2 } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Text, Muted } from "@/components/ui/typography";

export function InterviewTurn({
  layer,
  mode = "full",
  agentMessage,
  value,
  onChangeText,
  onSubmit,
  onCheckpoint,
  loading,
}: {
  layer: string;
  mode?: "full" | "refresh";
  agentMessage?: string | null;
  value: string;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  onCheckpoint: () => void;
  loading?: boolean;
}) {
  return (
    <View className="flex-1 gap-5 px-5 py-6">
      <View className="gap-1">
        <Text className="text-sm font-semibold uppercase text-neutral-500">
          {mode === "refresh" ? `Refreshing ${layer}` : layer}
        </Text>
        <Text className="text-2xl font-semibold text-neutral-950 dark:text-neutral-50">
          {agentMessage || "Tell me what matters here."}
        </Text>
      </View>
      <View className="min-h-40 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <TextInput
          multiline
          value={value}
          onChangeText={onChangeText}
          placeholder="Reply in your own words..."
          placeholderTextColor="#737373"
          className="min-h-32 text-base text-neutral-950 dark:text-neutral-50"
          textAlignVertical="top"
        />
      </View>
      <View className="flex-row gap-3">
        <Button className="flex-1" onPress={onSubmit} loading={loading}>
          <Send size={18} color="white" />
          Send
        </Button>
        <Button variant="outline" className="flex-1" onPress={onCheckpoint}>
          <CheckCircle2 size={18} color="#111827" />
          Checkpoint
        </Button>
      </View>
      <Muted>
        Confirmed notes are staged for review before anything is applied.
      </Muted>
    </View>
  );
}
