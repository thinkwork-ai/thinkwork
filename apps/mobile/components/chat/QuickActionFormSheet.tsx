import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState, useEffect } from "react";
import { View, Pressable } from "react-native";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X, Check, ChevronDown, Trash2 } from "lucide-react-native";
import { Alert } from "react-native";
import BottomSheet, { BottomSheetBackdrop, BottomSheetScrollView, BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import type { SubAgent } from "@/components/input/WorkspacePickerSheet";

export interface QuickActionFormData {
  id?: string;
  title: string;
  prompt: string;
  workspaceAgentId: string | null;
}

export interface QuickActionFormSheetRef {
  present: (data?: QuickActionFormData) => void;
  dismiss: () => void;
}

interface QuickActionFormSheetProps {
  subAgents: SubAgent[];
  onSave: (data: QuickActionFormData) => void;
  onDelete?: (id: string) => void;
}

export const QuickActionFormSheet = forwardRef<QuickActionFormSheetRef, QuickActionFormSheetProps>(
  ({ subAgents, onSave, onDelete }, ref) => {
    const bottomSheetRef = useRef<BottomSheet>(null);
    const { colorScheme } = useColorScheme();
    const isDark = colorScheme === "dark";
    const colors = isDark ? COLORS.dark : COLORS.light;
    const insets = useSafeAreaInsets();
    const snapPoints = useMemo(() => ["60%"], []);

    const [formData, setFormData] = useState<QuickActionFormData>({
      title: "",
      prompt: "",
      workspaceAgentId: null,
    });
    const [showPicker, setShowPicker] = useState(false);

    const isEditing = !!formData.id;
    const isValid = formData.title.trim().length > 0 && formData.prompt.trim().length > 0;

    useImperativeHandle(ref, () => ({
      present: (data) => {
        setFormData(data ?? { title: "", prompt: "", workspaceAgentId: null });
        setShowPicker(false);
        bottomSheetRef.current?.snapToIndex(0);
      },
      dismiss: () => bottomSheetRef.current?.close(),
    }));

    const renderBackdrop = useCallback(
      (props: any) => (
        <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
      ),
      [],
    );

    const selectedAgentName = formData.workspaceAgentId
      ? subAgents.find((a) => (a.agentId ?? a.id) === formData.workspaceAgentId)?.name ?? "Unknown"
      : "None";

    return (
      <BottomSheet
        ref={bottomSheetRef}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
        backdropComponent={renderBackdrop}
        backgroundStyle={{
          backgroundColor: isDark ? "#1c1c1e" : "#ffffff",
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
        }}
        handleIndicatorStyle={{
          backgroundColor: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)",
          width: 36,
        }}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 pb-3">
          <Text className="text-base font-semibold">{isEditing ? "Edit Quick Action" : "New Quick Action"}</Text>
          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={() => {
                if (isValid) {
                  onSave(formData);
                  bottomSheetRef.current?.close();
                }
              }}
              disabled={!isValid}
              className="p-1 active:opacity-70"
            >
              <Check size={22} color={isValid ? colors.primary : colors.mutedForeground} />
            </Pressable>
            <Pressable onPress={() => bottomSheetRef.current?.close()} className="p-1 active:opacity-70">
              <X size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>
        </View>

        <BottomSheetScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16 }}>
          {/* Title */}
          <View className="mb-4">
            <Muted className="text-xs mb-1.5 font-medium uppercase tracking-wide">Title</Muted>
            <BottomSheetTextInput
              value={formData.title}
              onChangeText={(t) => setFormData((prev) => ({ ...prev, title: t }))}
              placeholder="e.g. Check my emails"
              placeholderTextColor={colors.mutedForeground}
              style={{
                color: colors.foreground,
                fontSize: 16,
                borderWidth: 1,
                borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)",
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
            />
          </View>

          {/* Prompt */}
          <View className="mb-4">
            <Muted className="text-xs mb-1.5 font-medium uppercase tracking-wide">Prompt</Muted>
            <BottomSheetTextInput
              value={formData.prompt}
              onChangeText={(t) => setFormData((prev) => ({ ...prev, prompt: t }))}
              placeholder="What should the agent do?"
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={4}
              style={{
                color: colors.foreground,
                fontSize: 16,
                borderWidth: 1,
                borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)",
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 10,
                minHeight: 100,
                textAlignVertical: "top",
              }}
            />
          </View>

          {/* Delete (edit mode only) */}
          {isEditing && onDelete && (
            <Pressable
              onPress={() => {
                Alert.alert("Delete Quick Action", `Remove "${formData.title}"?`, [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: () => {
                      onDelete(formData.id!);
                      bottomSheetRef.current?.close();
                    },
                  },
                ]);
              }}
              className="mb-4 py-3 items-center rounded-lg active:opacity-70"
              style={{ backgroundColor: isDark ? "rgba(239,68,68,0.12)" : "rgba(239,68,68,0.08)" }}
            >
              <View className="flex-row items-center gap-2">
                <Trash2 size={16} color="#ef4444" />
                <Text className="text-sm font-medium" style={{ color: "#ef4444" }}>Delete Quick Action</Text>
              </View>
            </Pressable>
          )}

          {/* Workspace selector */}
          {subAgents.length > 0 && (
            <View className="mb-4">
              <Muted className="text-xs mb-1.5 font-medium uppercase tracking-wide">Workspace (optional)</Muted>
              <Pressable
                onPress={() => setShowPicker((p) => !p)}
                className="active:opacity-70"
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderWidth: 1,
                  borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)",
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                }}
              >
                <Text className="text-base">{selectedAgentName}</Text>
                <ChevronDown size={18} color={colors.mutedForeground} />
              </Pressable>

              {showPicker && (
                <View
                  className="mt-1 rounded-lg overflow-hidden"
                  style={{
                    borderWidth: 1,
                    borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)",
                  }}
                >
                  {/* None option */}
                  <Pressable
                    onPress={() => {
                      setFormData((prev) => ({ ...prev, workspaceAgentId: null }));
                      setShowPicker(false);
                    }}
                    className="px-3 py-2.5 active:opacity-70"
                    style={{
                      borderBottomWidth: 0.5,
                      borderBottomColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                      backgroundColor: formData.workspaceAgentId === null
                        ? (isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.03)")
                        : "transparent",
                    }}
                  >
                    <Text className="text-sm">None</Text>
                  </Pressable>
                  {subAgents.map((agent) => (
                    <Pressable
                      key={agent.id}
                      onPress={() => {
                        setFormData((prev) => ({ ...prev, workspaceAgentId: agent.agentId ?? agent.id }));
                        setShowPicker(false);
                      }}
                      className="px-3 py-2.5 active:opacity-70"
                      style={{
                        backgroundColor: formData.workspaceAgentId === (agent.agentId ?? agent.id)
                          ? (isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.03)")
                          : "transparent",
                      }}
                    >
                      <Text className="text-sm">{agent.name}</Text>
                      {agent.role && <Muted className="text-xs">{agent.role}</Muted>}
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          )}
        </BottomSheetScrollView>
      </BottomSheet>
    );
  },
);
