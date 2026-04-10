import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { View, Pressable } from "react-native";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X, Check } from "lucide-react-native";
import BottomSheet, { BottomSheetBackdrop, BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";

export interface SaveRecipeData {
  title: string;
  summary: string;
}

export interface SaveRecipeSheetRef {
  present: (prefill: { title: string; summary?: string }) => void;
  dismiss: () => void;
}

interface SaveRecipeSheetProps {
  onSave: (data: SaveRecipeData) => void;
}

export const SaveRecipeSheet = forwardRef<SaveRecipeSheetRef, SaveRecipeSheetProps>(
  ({ onSave }, ref) => {
    const bottomSheetRef = useRef<BottomSheet>(null);
    const { colorScheme } = useColorScheme();
    const isDark = colorScheme === "dark";
    const colors = isDark ? COLORS.dark : COLORS.light;
    const insets = useSafeAreaInsets();
    const snapPoints = useMemo(() => ["45%"], []);

    const [title, setTitle] = useState("");
    const [summary, setSummary] = useState("");

    useImperativeHandle(ref, () => ({
      present: (prefill) => {
        setTitle(prefill.title || "");
        setSummary(prefill.summary || "");
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

    const handleSave = () => {
      if (!title.trim()) return;
      onSave({ title: title.trim(), summary: summary.trim() });
      bottomSheetRef.current?.close();
    };

    const isValid = title.trim().length > 0;

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
        }}
        handleIndicatorStyle={{
          backgroundColor: isDark ? "#636366" : "#c7c7cc",
        }}
      >
        <View style={{ flex: 1, paddingHorizontal: 20, paddingBottom: insets.bottom + 16 }}>
          {/* Header */}
          <View className="flex-row items-center justify-between mb-6">
            <Pressable hitSlop={12} onPress={() => bottomSheetRef.current?.close()}>
              <X size={22} color={colors.foreground} />
            </Pressable>
            <Text className="text-base font-semibold">Save as Recipe</Text>
            <Pressable hitSlop={12} onPress={handleSave} disabled={!isValid}>
              <Check size={22} color={isValid ? colors.primary : colors.mutedForeground} />
            </Pressable>
          </View>

          {/* Title field */}
          <Muted className="text-xs uppercase tracking-wider mb-1.5">Name</Muted>
          <BottomSheetTextInput
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Top 5 Opportunities"
            placeholderTextColor={colors.mutedForeground}
            style={{
              fontSize: 16,
              color: colors.foreground,
              backgroundColor: isDark ? "#2c2c2e" : "#f2f2f7",
              borderRadius: 10,
              paddingHorizontal: 14,
              paddingVertical: 12,
              marginBottom: 16,
            }}
          />

          {/* Summary field */}
          <Muted className="text-xs uppercase tracking-wider mb-1.5">Description (optional)</Muted>
          <BottomSheetTextInput
            value={summary}
            onChangeText={setSummary}
            placeholder="What does this recipe show?"
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={3}
            style={{
              fontSize: 16,
              color: colors.foreground,
              backgroundColor: isDark ? "#2c2c2e" : "#f2f2f7",
              borderRadius: 10,
              paddingHorizontal: 14,
              paddingVertical: 12,
              minHeight: 80,
              textAlignVertical: "top",
            }}
          />
        </View>
      </BottomSheet>
    );
  },
);
