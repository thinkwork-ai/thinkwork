import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from "react";
import { View, Pressable } from "react-native";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import BottomSheet, { BottomSheetScrollView, BottomSheetBackdrop } from "@gorhom/bottom-sheet";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";

export interface PromptTemplateSheetRef {
  present: () => void;
  dismiss: () => void;
}

interface PromptTemplateSheetProps {
  templates: { title: string; prompt: string }[];
  onSelect: (prompt: string) => void;
}

export const PromptTemplateSheet = forwardRef<PromptTemplateSheetRef, PromptTemplateSheetProps>(
  ({ templates, onSelect }, ref) => {
    const bottomSheetRef = useRef<BottomSheet>(null);
    const { colorScheme } = useColorScheme();
    const isDark = colorScheme === "dark";
    const colors = isDark ? COLORS.dark : COLORS.light;
    const insets = useSafeAreaInsets();
    const snapPoints = useMemo(() => ["50%"], []);

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
          <Text className="text-base font-semibold">Prompt Templates</Text>
          <Pressable onPress={() => bottomSheetRef.current?.close()} className="p-1 active:opacity-70">
            <X size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {/* Template list */}
        <BottomSheetScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16 }}>
          {templates.map((template, i) => (
            <Pressable
              key={i}
              onPress={() => onSelect(template.prompt)}
              className="py-3 active:opacity-70"
              style={i < templates.length - 1 ? {
                borderBottomWidth: 0.5,
                borderBottomColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
              } : undefined}
            >
              <Text className="text-sm font-medium">{template.title}</Text>
              <Muted className="text-xs mt-0.5" numberOfLines={2}>{template.prompt}</Muted>
            </Pressable>
          ))}
        </BottomSheetScrollView>
      </BottomSheet>
    );
  },
);
