import { useState, useCallback } from "react";
import { View, TextInput } from "react-native";
import { useColorScheme } from "nativewind";
import { Check, X, RotateCcw, ShieldAlert } from "lucide-react-native";
import { Text, Muted } from "@/components/ui/typography";
import { Button } from "@/components/ui/button";
import { COLORS } from "@/lib/theme";
import { useDecideInboxItem } from "@/lib/hooks/use-inbox";

interface InlineApprovalCardProps {
  inboxItemId: string;
  title: string;
  description?: string;
  type: string;
  onDecided?: () => void;
}

export function InlineApprovalCard({
  inboxItemId,
  title,
  description,
  type,
  onDecided,
}: InlineApprovalCardProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const [decided, setDecided] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [showComment, setShowComment] = useState(false);
  const [, executeDecide] = useDecideInboxItem();

  const handleDecision = useCallback(async (status: string) => {
    setDecided(status);
    await executeDecide({
      id: inboxItemId,
      input: { status: status as any, comment: comment || undefined },
    });
    onDecided?.();
  }, [inboxItemId, comment, executeDecide, onDecided]);

  if (decided) {
    const label = decided === "APPROVED" ? "Approved" : decided === "REJECTED" ? "Rejected" : "Revision requested";
    const color = decided === "APPROVED" ? "text-green-500" : decided === "REJECTED" ? "text-red-500" : "text-amber-500";
    return (
      <View className="border border-neutral-200 dark:border-neutral-800 rounded-lg p-3 my-1">
        <View className="flex-row items-center gap-2">
          <ShieldAlert size={16} color={colors.mutedForeground} />
          <Text className="text-sm font-medium flex-1">{title}</Text>
        </View>
        <Text className={`text-xs mt-1 ${color}`}>{label}</Text>
      </View>
    );
  }

  return (
    <View className="border border-amber-500/30 bg-amber-500/5 rounded-lg p-3 my-1 gap-2">
      <View className="flex-row items-center gap-2">
        <ShieldAlert size={16} color="#f59e0b" />
        <Text className="text-sm font-medium flex-1">{title}</Text>
      </View>
      {description && (
        <Muted className="text-xs">{description}</Muted>
      )}
      {showComment && (
        <TextInput
          value={comment}
          onChangeText={setComment}
          placeholder="Add a comment..."
          placeholderTextColor={colors.mutedForeground}
          className="border border-neutral-300 dark:border-neutral-700 rounded-md p-2 text-xs text-neutral-900 dark:text-neutral-100"
          style={{ backgroundColor: isDark ? "#1a1a1a" : "#ffffff" }}
        />
      )}
      <View className="flex-row items-center gap-2">
        <Button
          size="sm"
          onPress={() => handleDecision("APPROVED")}
          className="flex-1 bg-green-600 active:bg-green-700"
        >
          <View className="flex-row items-center gap-1">
            <Check size={12} color="#ffffff" />
            <Text className="text-white text-xs font-medium">Approve</Text>
          </View>
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onPress={() => handleDecision("REJECTED")}
          className="flex-1"
        >
          <View className="flex-row items-center gap-1">
            <X size={12} color="#ffffff" />
            <Text className="text-white text-xs font-medium">Reject</Text>
          </View>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onPress={() => {
            if (!showComment) setShowComment(true);
            else if (comment.trim()) handleDecision("REVISION_REQUESTED");
          }}
        >
          <RotateCcw size={12} color={colors.foreground} />
        </Button>
      </View>
    </View>
  );
}
