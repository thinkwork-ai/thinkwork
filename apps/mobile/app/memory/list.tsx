import { useState, useCallback } from "react";
import { View, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import { Trash2, Check, X, RefreshCw } from "lucide-react-native";
import { DetailLayout } from "@/components/layout/detail-layout";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { useMemoryRecords, useDeleteMemoryRecord, useUpdateMemoryRecord } from "@/lib/hooks/use-memory";

type WikiPageChip = {
  id: string;
  type: "ENTITY" | "TOPIC" | "DECISION";
  slug: string;
  title: string;
};

type MemoryRecord = {
  memoryRecordId: string;
  content?: { text?: string | null } | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  expiresAt?: string | null;
  namespace?: string | null;
  strategyId?: string | null;
  wikiPages?: WikiPageChip[] | null;
};

function formatDate(iso?: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function timeUntil(iso?: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = d.getTime() - now;
    if (diff <= 0) return "expired";
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    if (days > 0) return `${days}d ${hours}h`;
    return `${hours}h`;
  } catch {
    return null;
  }
}

const STRATEGY_META: Record<string, { title: string; emptyMessage: string }> = {
  semantic: {
    title: "Memory",
    emptyMessage: "No memory records yet. Facts are extracted over time from conversations across all threads.",
  },
};

function MemoryCard({
  record,
  assistantId,
  onDelete,
  onUpdate,
  colors,
}: {
  record: MemoryRecord;
  assistantId: string | undefined;
  onDelete: () => void;
  onUpdate: (content: string) => void;
  colors: typeof COLORS.light;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(record.content?.text ?? "");
  const router = useRouter();

  const text = record.content?.text ?? "";

  const handleSave = () => {
    onUpdate(editText);
    setEditing(false);
  };

  const handleCancel = () => {
    setEditText(record.content?.text ?? "");
    setEditing(false);
  };

  const confirmDelete = () => {
    if (Platform.OS !== "web") {
      Alert.alert("Delete Memory", "Remove this memory record?", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: onDelete },
      ]);
    } else {
      onDelete();
    }
  };

  return (
    <View className="mb-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
      <Pressable
        onPress={() => {
          if (!editing) {
            setEditText(text);
            setEditing(true);
          }
        }}
        className="p-3"
      >
        {editing ? (
          <TextInput
            value={editText}
            onChangeText={setEditText}
            multiline
            autoFocus
            style={{
              fontSize: 14,
              lineHeight: 20,
              color: colors.foreground,
              minHeight: 60,
              fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
            }}
          />
        ) : (
          <Text className="text-sm text-neutral-700 dark:text-neutral-300 leading-5">
            {text}
          </Text>
        )}

        {/* "Contributes to:" chips — Unit 8 read surface. Tap navigates to
            the wiki page. Only rendered when not editing so the chips don't
            fight for vertical space with the edit controls. */}
        {!editing && record.wikiPages && record.wikiPages.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            <Muted style={{ fontSize: 11, marginRight: 2 }}>Contributes to:</Muted>
            {record.wikiPages.map((page) => (
              <Pressable
                key={page.id}
                onPress={(event) => {
                  event.stopPropagation?.();
                  const path = `/wiki/${encodeURIComponent(page.type)}/${encodeURIComponent(page.slug)}`;
                  router.push(
                    assistantId
                      ? `${path}?agentId=${encodeURIComponent(assistantId)}`
                      : path,
                  );
                }}
                style={({ pressed }) => ({
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 999,
                  backgroundColor: pressed ? colors.primary : colors.secondary,
                })}
              >
                <Text style={{ fontSize: 11, color: colors.foreground }}>
                  {page.title}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* Metadata row */}
        <View className="flex-row items-center justify-between mt-2.5 pt-2 border-t border-neutral-100 dark:border-neutral-800">
          <View className="flex-row items-center gap-3 flex-1">
            <Muted className="text-xs">
              {formatDate(record.updatedAt || record.createdAt)}
            </Muted>
            {editing && (
              <Pressable onPress={confirmDelete} hitSlop={8}>
                <Trash2 size={16} color="#ef4444" />
              </Pressable>
            )}
          </View>
          {editing && (
            <View className="flex-row items-center gap-3">
              <Pressable onPress={handleCancel} hitSlop={8}>
                <X size={16} color={colors.mutedForeground} />
              </Pressable>
              <Pressable onPress={handleSave} hitSlop={8}>
                <Check size={16} color="#22c55e" />
              </Pressable>
            </View>
          )}
        </View>
      </Pressable>
    </View>
  );
}

export default function MemoryListScreen() {
  const { strategy, assistantId, sessionId } = useLocalSearchParams<{
    strategy: "semantic" | "summary";
    assistantId: string;
    sessionId?: string;
  }>();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const namespace = strategy === "summary"
    ? (sessionId ? `session_${sessionId}` : undefined)
    : (assistantId ? `assistant_${assistantId}` : undefined);

  const [{ data, fetching, error }, reexecute] = useMemoryRecords(assistantId, namespace);
  const [, executeDelete] = useDeleteMemoryRecord();
  const [, executeUpdate] = useUpdateMemoryRecord();

  // Local state for optimistic updates
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [localUpdates, setLocalUpdates] = useState<Record<string, string>>({});

  const records: MemoryRecord[] = (data?.memoryRecords ?? [])
    .filter((r) => !deletedIds.has(r.memoryRecordId))
    .map((r) => localUpdates[r.memoryRecordId]
      ? { ...r, content: { text: localUpdates[r.memoryRecordId] }, updatedAt: new Date().toISOString() }
      : r,
    )
    .sort((a, b) => {
      const da = a.updatedAt || a.createdAt || "";
      const db = b.updatedAt || b.createdAt || "";
      return db.localeCompare(da);
    });

  const meta = STRATEGY_META[strategy ?? "semantic"] ?? STRATEGY_META.semantic;

  const handleRefresh = useCallback(() => {
    setDeletedIds(new Set());
    setLocalUpdates({});
    reexecute({ requestPolicy: "network-only" });
  }, [reexecute]);

  const handleDelete = async (recordId: string) => {
    setDeletedIds((prev) => new Set(prev).add(recordId));
    try {
      const result = await executeDelete({ memoryRecordId: recordId });
      if (result.error) {
        console.warn("Failed to delete memory record:", result.error);
        setDeletedIds((prev) => { const next = new Set(prev); next.delete(recordId); return next; });
      }
    } catch (e) {
      console.warn("Failed to delete memory record:", e);
      setDeletedIds((prev) => { const next = new Set(prev); next.delete(recordId); return next; });
    }
  };

  const handleUpdate = async (recordId: string, content: string) => {
    setLocalUpdates((prev) => ({ ...prev, [recordId]: content }));
    try {
      const result = await executeUpdate({ memoryRecordId: recordId, content });
      if (result.error) {
        console.warn("Failed to update memory record:", result.error);
        setLocalUpdates((prev) => { const { [recordId]: _, ...rest } = prev; return rest; });
      }
    } catch (e) {
      console.warn("Failed to update memory record:", e);
      setLocalUpdates((prev) => { const { [recordId]: _, ...rest } = prev; return rest; });
    }
  };

  const refreshButton = (
    <Pressable
      onPress={handleRefresh}
      disabled={fetching}
      className="p-2 active:opacity-70"
    >
      <RefreshCw size={18} color={fetching ? colors.mutedForeground : "#0ea5e9"} />
    </Pressable>
  );

  return (
    <DetailLayout title={meta.title} headerRight={refreshButton}>
      {fetching && !data ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-6">
          <Muted className="text-center">Failed to load memory records.</Muted>
        </View>
      ) : records.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Muted className="text-center">{meta.emptyMessage}</Muted>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        >
          {records.map((record) => (
            <MemoryCard
              key={record.memoryRecordId}
              record={record}
              assistantId={assistantId}
              onDelete={() => handleDelete(record.memoryRecordId)}
              onUpdate={(content) => handleUpdate(record.memoryRecordId, content)}
              colors={colors}
            />
          ))}
        </ScrollView>
      )}
    </DetailLayout>
  );
}
