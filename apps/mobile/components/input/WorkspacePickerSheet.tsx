import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { View, Pressable, Dimensions } from "react-native";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X, Check } from "lucide-react-native";
import BottomSheet, { BottomSheetScrollView, BottomSheetBackdrop } from "@gorhom/bottom-sheet";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";

export interface SubAgent {
  id: string;
  agentId?: string;
  name: string;
  role?: string;
  type?: string;
  status?: string;
}

export interface WorkspacePickerSheetRef {
  present: () => void;
  dismiss: () => void;
}

interface WorkspacePickerSheetProps {
  subAgents: SubAgent[];
  selectedIds: string[];
  onToggle: (agent: SubAgent) => void;
}

export const WorkspacePickerSheet = forwardRef<WorkspacePickerSheetRef, WorkspacePickerSheetProps>(
  ({ subAgents, selectedIds, onToggle }, ref) => {
    const bottomSheetRef = useRef<BottomSheet>(null);
    const { colorScheme } = useColorScheme();
    const isDark = colorScheme === "dark";
    const colors = isDark ? COLORS.dark : COLORS.light;
    const insets = useSafeAreaInsets();
    const screenHeight = Dimensions.get("window").height;
    const maxHeight = screenHeight - insets.top;
    const snapPoints = useMemo(() => [maxHeight], [maxHeight]);

    useImperativeHandle(ref, () => ({
      present: () => bottomSheetRef.current?.snapToIndex(0),
      dismiss: () => bottomSheetRef.current?.close(),
    }));

    const renderBackdrop = useCallback(
      (props: any) => (
        <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
      ),
      [],
    );

    // Local optimistic state so checkmarks toggle instantly
    const [localIds, setLocalIds] = useState<Set<string>>(() => new Set(selectedIds));
    useEffect(() => { setLocalIds(new Set(selectedIds)); }, [selectedIds]);

    const handleToggle = useCallback((agent: SubAgent) => {
      setLocalIds((prev) => {
        const next = new Set(prev);
        if (next.has(agent.id)) next.delete(agent.id);
        else next.add(agent.id);
        return next;
      });
      onToggle(agent);
    }, [onToggle]);

    return (
      <BottomSheet
        ref={bottomSheetRef}
        index={-1}
        snapPoints={snapPoints}
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
          <Text className="text-base font-semibold">Add Capability</Text>
          <Pressable onPress={() => bottomSheetRef.current?.close()} className="p-1 active:opacity-70">
            <X size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {/* Sub-agent list */}
        <BottomSheetScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16 }}>
          {subAgents.length === 0 && (
            <View className="py-8 items-center">
              <Muted className="text-sm">No workspaces available</Muted>
            </View>
          )}
          {subAgents.map((agent, i) => {
            const isSelected = localIds.has(agent.id);
            return (
              <Pressable
                key={agent.id}
                onPress={() => handleToggle(agent)}
                className="flex-row items-center py-3 active:opacity-70"
                style={i < subAgents.length - 1 ? {
                  borderBottomWidth: 0.5,
                  borderBottomColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                } : undefined}
              >
                <View className="flex-1">
                  <Text className="text-sm font-medium">{agent.name}</Text>
                  {agent.role && <Muted className="text-xs mt-0.5">{agent.role}</Muted>}
                </View>
                {isSelected && <Check size={18} color={colors.primary} />}
              </Pressable>
            );
          })}
        </BottomSheetScrollView>
      </BottomSheet>
    );
  },
);
