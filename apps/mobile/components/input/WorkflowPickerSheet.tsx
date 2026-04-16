import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState, useEffect } from "react";
import { View, Pressable, Dimensions, ActivityIndicator } from "react-native";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X, Check, ListChecks } from "lucide-react-native";
import BottomSheet, { BottomSheetScrollView, BottomSheetBackdrop } from "@gorhom/bottom-sheet";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";

export interface Workflow {
  id: string;
  name: string;
  description?: string | null;
  team_id?: string;
  task_type_id?: string | null;
  is_active?: boolean;
}

export interface WorkflowPickerSheetRef {
  present: () => void;
  dismiss: () => void;
}

interface WorkflowPickerSheetProps {
  workflows: Workflow[];
  loading?: boolean;
  error?: string | null;
  selectedId: string | null;
  onSelect: (workflow: Workflow) => void;
  onRefresh?: () => void;
}

export const WorkflowPickerSheet = forwardRef<WorkflowPickerSheetRef, WorkflowPickerSheetProps>(
  ({ workflows, loading, error, selectedId, onSelect, onRefresh }, ref) => {
    const bottomSheetRef = useRef<BottomSheet>(null);
    const { colorScheme } = useColorScheme();
    const isDark = colorScheme === "dark";
    const colors = isDark ? COLORS.dark : COLORS.light;
    const insets = useSafeAreaInsets();
    const snapPoints = useMemo(() => ["50%"], []);

    useImperativeHandle(ref, () => ({
      present: () => {
        bottomSheetRef.current?.snapToIndex(0);
        if (onRefresh) onRefresh();
      },
      dismiss: () => bottomSheetRef.current?.close(),
    }));

    const renderBackdrop = useCallback(
      (props: any) => (
        <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
      ),
      [],
    );

    const activeWorkflows = useMemo(
      () => workflows.filter((w) => w.is_active !== false),
      [workflows],
    );

    return (
      <BottomSheet
        ref={bottomSheetRef}
        index={-1}
        snapPoints={snapPoints}
        topInset={insets.top}
        enablePanDownToClose
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
          <Text className="text-base font-semibold">Task type</Text>
          <Pressable onPress={() => bottomSheetRef.current?.close()} className="p-1 active:opacity-70">
            <X size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <BottomSheetScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16 }}>
          {loading && (
            <View className="py-8 items-center">
              <ActivityIndicator size="small" color={colors.primary} />
              <Muted className="text-sm mt-2">Loading workflows...</Muted>
            </View>
          )}

          {error && !loading && (
            <View className="py-8 items-center">
              <Muted className="text-sm text-red-400">{error}</Muted>
            </View>
          )}

          {!loading && !error && activeWorkflows.length === 0 && (
            <View className="py-8 items-center">
              <Muted className="text-sm">No workflows available</Muted>
            </View>
          )}

          {!loading && activeWorkflows.map((wf, i) => (
            <Pressable
              key={wf.id}
              onPress={() => {
                onSelect(wf);
                bottomSheetRef.current?.close();
              }}
              className="flex-row items-center py-3 active:opacity-70"
              style={i < activeWorkflows.length - 1 ? {
                borderBottomWidth: 0.5,
                borderBottomColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
              } : undefined}
            >
              <View
                style={{
                  width: 32, height: 32, borderRadius: 8,
                  backgroundColor: isDark ? "rgba(96,165,250,0.15)" : "rgba(37,99,235,0.08)",
                  alignItems: "center", justifyContent: "center",
                }}
              >
                <ListChecks size={16} color={isDark ? "#60a5fa" : "#2563eb"} />
              </View>
              <View className="flex-1 ml-3">
                <Text className="text-sm font-medium">{wf.name}</Text>
                {wf.description ? (
                  <Muted className="text-xs mt-0.5" numberOfLines={1}>{wf.description}</Muted>
                ) : null}
              </View>
              {selectedId === wf.id && (
                <Check size={18} color={colors.primary} />
              )}
            </Pressable>
          ))}
        </BottomSheetScrollView>
      </BottomSheet>
    );
  },
);
