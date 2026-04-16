import { useState } from "react";
import { View, Pressable, TextInput } from "react-native";
import { useColorScheme } from "nativewind";
import { Check, X, RotateCcw, ChevronDown, ChevronUp, MessageSquare } from "lucide-react-native";
import { Text, Muted } from "@/components/ui/typography";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { COLORS } from "@/lib/theme";

interface InboxItemCardProps {
  item: {
    id: string;
    type: string;
    status: string;
    title?: string | null;
    description?: string | null;
    requesterType?: string | null;
    requesterId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    config?: string | null;
    revision: number;
    reviewNotes?: string | null;
    expiresAt?: string | null;
    linkedThreads?: Array<{
      id: string;
      identifier?: string | null;
      title: string;
      status: string;
    }>;
    createdAt: string;
  };
  agentName?: string;
  onApprove: (id: string, comment?: string) => void;
  onReject: (id: string, comment?: string) => void;
  onRequestRevision: (id: string, comment: string) => void;
  onThreadPress?: (threadId: string) => void;
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function typeLabel(type: string): string {
  switch (type) {
    case "hire_agent": return "Hire Agent";
    case "approve_ceo_strategy": return "Strategy";
    case "action": return "Action";
    case "create_task": return "Create task";
    default: return type.replace(/_/g, " ");
  }
}

export function InboxItemCard({
  item,
  agentName,
  onApprove,
  onReject,
  onRequestRevision,
  onThreadPress,
}: InboxItemCardProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const [expanded, setExpanded] = useState(false);
  const [comment, setComment] = useState("");
  const [showComment, setShowComment] = useState(false);

  const isPending = item.status === "PENDING";

  return (
    <View className="border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
      {/* Header row */}
      <Pressable
        onPress={() => setExpanded(!expanded)}
        className="flex-row items-center justify-between p-3 active:opacity-70"
      >
        <View className="flex-1 gap-1">
          <View className="flex-row items-center gap-2">
            <Badge variant="outline">
              <Text className="text-xs">{typeLabel(item.type)}</Text>
            </Badge>
            {agentName && (
              <Muted className="text-xs">{agentName}</Muted>
            )}
          </View>
          <Text className="text-sm font-medium" numberOfLines={expanded ? undefined : 1}>
            {item.title || "Untitled request"}
          </Text>
        </View>
        <View className="flex-row items-center gap-2 ml-2">
          <Muted className="text-xs">{formatRelativeTime(item.createdAt)}</Muted>
          {expanded ? (
            <ChevronUp size={16} color={colors.mutedForeground} />
          ) : (
            <ChevronDown size={16} color={colors.mutedForeground} />
          )}
        </View>
      </Pressable>

      {/* Expanded content */}
      {expanded && (
        <View className="px-3 pb-3 gap-3 border-t border-neutral-200 dark:border-neutral-800 pt-3">
          {/* Description */}
          {item.description && (
            <Text className="text-sm text-neutral-600 dark:text-neutral-400">
              {item.description}
            </Text>
          )}

          {/* Linked threads */}
          {item.linkedThreads && item.linkedThreads.length > 0 && (
            <View className="gap-1">
              <Muted className="text-xs font-medium">Linked Threads</Muted>
              {item.linkedThreads.map((linkedThread) => (
                <Pressable
                  key={linkedThread.id}
                  onPress={() => onThreadPress?.(linkedThread.id)}
                  className="flex-row items-center gap-2 py-1 active:opacity-70"
                >
                  <Text className="text-xs font-mono text-primary">
                    {linkedThread.identifier || linkedThread.id.slice(0, 8)}
                  </Text>
                  <Text className="text-xs flex-1" numberOfLines={1}>
                    {linkedThread.title}
                  </Text>
                  <Badge variant="outline">
                    <Text className="text-xs">{linkedThread.status}</Text>
                  </Badge>
                </Pressable>
              ))}
            </View>
          )}

          {/* Review notes from previous decision */}
          {item.reviewNotes && (
            <View className="bg-neutral-100 dark:bg-neutral-800 rounded-md p-2">
              <Muted className="text-xs font-medium mb-1">Review Notes</Muted>
              <Text className="text-xs">{item.reviewNotes}</Text>
            </View>
          )}

          {/* Comment input */}
          {showComment && (
            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder="Add a comment..."
              placeholderTextColor={colors.mutedForeground}
              multiline
              className="border border-neutral-300 dark:border-neutral-700 rounded-md p-2 text-sm text-neutral-900 dark:text-neutral-100 min-h-[60px]"
              style={{ backgroundColor: isDark ? "#1a1a1a" : "#ffffff" }}
            />
          )}

          {/* Actions */}
          {isPending && (
            <View className="flex-row items-center gap-2">
              <Button
                size="sm"
                onPress={() => onApprove(item.id, comment || undefined)}
                className="flex-1 bg-green-600 active:bg-green-700"
              >
                <View className="flex-row items-center gap-1.5">
                  <Check size={14} color="#ffffff" />
                  <Text className="text-white text-sm font-medium">Approve</Text>
                </View>
              </Button>
              <Button
                size="sm"
                onPress={() => onReject(item.id, comment || undefined)}
                className="flex-1 bg-red-600 active:bg-red-700"
              >
                <View className="flex-row items-center gap-1.5">
                  <X size={14} color="#ffffff" />
                  <Text className="text-white text-sm font-medium">Reject</Text>
                </View>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onPress={() => {
                  if (!showComment) {
                    setShowComment(true);
                  } else if (comment.trim()) {
                    onRequestRevision(item.id, comment);
                  }
                }}
              >
                <View className="flex-row items-center gap-1.5">
                  <RotateCcw size={14} color={colors.foreground} />
                  <Text className="text-sm">Revise</Text>
                </View>
              </Button>
              {!showComment && (
                <Pressable onPress={() => setShowComment(true)} className="p-2">
                  <MessageSquare size={16} color={colors.mutedForeground} />
                </Pressable>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}
