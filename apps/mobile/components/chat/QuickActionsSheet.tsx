import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { View, Pressable } from "react-native";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X, Pencil, Plus } from "lucide-react-native";
import BottomSheet, { BottomSheetScrollView, BottomSheetBackdrop } from "@gorhom/bottom-sheet";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import type { QuickAction } from "@/lib/hooks/use-quick-actions";

export interface QuickActionsSheetRef {
  present: () => void;
  dismiss: () => void;
}

interface QuickActionsSheetProps {
  actions: QuickAction[];
  onSelect: (action: QuickAction) => void;
  onLongPress: (action: QuickAction) => void;
  onAdd?: () => void;
  onEdit?: (action: QuickAction) => void;
  subAgentNames?: Record<string, string>;
}

export const QuickActionsSheet = forwardRef<QuickActionsSheetRef, QuickActionsSheetProps>(
  ({ actions, onSelect, onLongPress, onAdd, onEdit, subAgentNames }, ref) => {
    const bottomSheetRef = useRef<BottomSheet>(null);
    const { colorScheme } = useColorScheme();
    const isDark = colorScheme === "dark";
    const colors = isDark ? COLORS.dark : COLORS.light;
    const insets = useSafeAreaInsets();
    const maxHeight = useMemo(() => {
      // Full screen height minus top safe area inset = exact available area
      const { Dimensions } = require("react-native");
      const screenHeight = Dimensions.get("window").height;
      return screenHeight - insets.top;
    }, [insets.top]);
    const snapPoints = useMemo(() => ["50%", maxHeight], [maxHeight]);
    const [editMode, setEditMode] = useState(false);

    useImperativeHandle(ref, () => ({
      present: () => {
        setEditMode(false);
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
          <Text className="text-base font-semibold">Quick Actions</Text>
          <View className="flex-row items-center gap-2">
            {onAdd && (
              <Pressable onPress={onAdd} className="p-1 active:opacity-70">
                <Plus size={20} color={colors.primary} />
              </Pressable>
            )}
            {onEdit && (
              <Pressable
                onPress={() => setEditMode((prev) => !prev)}
                className="p-1 active:opacity-70"
              >
                <Pencil size={18} color={editMode ? colors.primary : colors.mutedForeground} />
              </Pressable>
            )}
            <Pressable onPress={() => bottomSheetRef.current?.close()} className="p-1 active:opacity-70">
              <X size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>
        </View>

        {/* Action list */}
        <BottomSheetScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16 }}>
          {actions.map((action, i) => (
            <View
              key={action.id}
              className="flex-row items-center"
              style={i < actions.length - 1 ? {
                borderBottomWidth: 0.5,
                borderBottomColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
              } : undefined}
            >
              <Pressable
                onPress={() => {
                  if (editMode) {
                    onEdit?.(action);
                  } else {
                    onSelect(action);
                  }
                }}
                onLongPress={() => !editMode && onLongPress(action)}
                className="flex-1 py-3 active:opacity-70"
                delayLongPress={400}
              >
                <View className="flex-row items-center gap-2">
                  <Text className="text-sm font-medium">{action.title}</Text>
                  {action.workspaceAgentId && subAgentNames?.[action.workspaceAgentId] && (
                    <View
                      className="px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)" }}
                    >
                      <Text className="text-[10px] text-muted-foreground">
                        {subAgentNames[action.workspaceAgentId]}
                      </Text>
                    </View>
                  )}
                </View>
                <Muted className="text-xs mt-0.5" numberOfLines={2}>{action.prompt}</Muted>
              </Pressable>
              {editMode && (
                <Pressable onPress={() => onEdit?.(action)} className="pl-2 py-3 active:opacity-70">
                  <Pencil size={16} color={colors.mutedForeground} />
                </Pressable>
              )}
            </View>
          ))}

          {actions.length === 0 && (
            <View className="py-8 items-center">
              <Muted className="text-sm">No quick actions yet</Muted>
              {onAdd && (
                <Pressable onPress={onAdd} className="mt-3 active:opacity-70">
                  <Text className="text-sm" style={{ color: colors.primary }}>Add your first action</Text>
                </Pressable>
              )}
            </View>
          )}
        </BottomSheetScrollView>
      </BottomSheet>
    );
  },
);
