import { useState, useEffect } from "react";
import { View, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import { DetailLayout } from "@/components/layout/detail-layout";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { getWorkspaceFile, putWorkspaceFile } from "@/lib/workspace-api";

export default function WorkspaceFileEditor() {
  const { file, assistantId } = useLocalSearchParams<{
    file: string;
    assistantId: string;
  }>();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const router = useRouter();
  const { height: windowHeight } = useWindowDimensions();

  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fileName = decodeURIComponent(file ?? "");
  const hasChanges = content !== original;

  useEffect(() => {
    if (!assistantId || !fileName) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getWorkspaceFile({ agentId: assistantId }, fileName)
      .then((data) => {
        if (!cancelled) {
          const text = data.content ?? "";
          setContent(text);
          setOriginal(text);
        }
      })
      .catch((err) => {
        console.error("Failed to load workspace file:", err);
        if (!cancelled) {
          setContent("");
          setOriginal("");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [assistantId, fileName]);

  const handleSave = async () => {
    if (!assistantId || !fileName || saving) return;
    setSaving(true);
    try {
      await putWorkspaceFile({ agentId: assistantId }, fileName, content);
      setOriginal(content);
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      if (Platform.OS !== "web") {
        Alert.alert("Error", msg);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    router.back();
  };

  const headerRight = (
    <View className="flex-row items-center gap-4">
      <Pressable onPress={handleCancel} className="active:opacity-70">
        <Text className="font-semibold text-base text-neutral-400 dark:text-neutral-500">Cancel</Text>
      </Pressable>
      <Pressable
        onPress={handleSave}
        disabled={saving || !hasChanges}
        className="active:opacity-70"
        style={{ opacity: hasChanges ? 1 : 0.4 }}
      >
        <Text style={{ color: colors.primary }} className="font-semibold text-base">
          {saving ? "Saving..." : "Save"}
        </Text>
      </Pressable>
    </View>
  );

  return (
    <DetailLayout title={`Edit ${fileName}`} headerRight={!loading ? headerRight : undefined}>
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ minHeight: windowHeight - 120 }}
        >
          <TextInput
            value={content}
            onChangeText={setContent}
            multiline
            scrollEnabled={false}
            textAlignVertical="top"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            style={{
              padding: 16,
              fontSize: 14,
              lineHeight: 22,
              fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
              color: colors.foreground,
              backgroundColor: colorScheme === "dark" ? "#0a0a0a" : "#fafafa",
              borderTopWidth: 2,
              borderTopColor: colors.primary,
            }}
            placeholderTextColor={colors.mutedForeground}
            placeholder={`Start typing to create ${fileName}...`}
          />
        </ScrollView>
      )}
    </DetailLayout>
  );
}
