import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { View, Pressable, Dimensions } from "react-native";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X, Check } from "lucide-react-native";
import { IconPlanet } from "@tabler/icons-react-native";
import BottomSheet, {
  BottomSheetScrollView,
  BottomSheetBackdrop,
} from "@gorhom/bottom-sheet";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";

export interface SpaceOption {
  id: string;
  name: string;
  slug?: string | null;
  icon?: string | null;
}

export interface SpacePickerSheetRef {
  present: () => void;
  dismiss: () => void;
}

interface SpacePickerSheetProps {
  spaces: SpaceOption[];
  selectedId: string | null;
  onSelect: (space: SpaceOption | null) => void;
}

function canRenderSpaceIcon(icon?: string | null): icon is string {
  if (!icon) return false;
  return !/^[a-z0-9_-]+$/i.test(icon);
}

export const SpacePickerSheet = forwardRef<
  SpacePickerSheetRef,
  SpacePickerSheetProps
>(({ spaces, selectedId, onSelect }, ref) => {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const insets = useSafeAreaInsets();
  const screenHeight = Dimensions.get("window").height;
  const maxHeight = screenHeight - insets.top;
  const snapPoints = useMemo(() => [maxHeight], [maxHeight]);
  const selectableSpaces = useMemo(
    () => spaces.filter((space) => space.slug !== "default"),
    [spaces],
  );

  useImperativeHandle(ref, () => ({
    present: () => bottomSheetRef.current?.snapToIndex(0),
    dismiss: () => bottomSheetRef.current?.close(),
  }));

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
      />
    ),
    [],
  );

  const handleSelect = useCallback(
    (space: SpaceOption | null) => {
      onSelect(space);
      bottomSheetRef.current?.close();
    },
    [onSelect],
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
      <View className="flex-row items-center justify-between px-4 pb-3">
        <Text className="text-base font-semibold">Space</Text>
        <Pressable
          onPress={() => bottomSheetRef.current?.close()}
          className="p-1 active:opacity-70"
        >
          <X size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <BottomSheetScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 16,
        }}
      >
        <Pressable
          onPress={() => handleSelect(null)}
          className="flex-row items-center py-3 active:opacity-70"
          style={{
            borderBottomWidth: 0.5,
            borderBottomColor: isDark
              ? "rgba(255,255,255,0.08)"
              : "rgba(0,0,0,0.06)",
          }}
        >
          <View
            className="mr-3 items-center justify-center rounded-full"
            style={{
              width: 34,
              height: 34,
              backgroundColor: isDark
                ? "rgba(255,255,255,0.06)"
                : "rgba(0,0,0,0.05)",
            }}
          >
            <IconPlanet size={17} color={colors.mutedForeground} />
          </View>
          <View className="flex-1">
            <Text className="text-sm font-medium">Default</Text>
            <Muted className="text-xs mt-0.5">
              Use the default thread space
            </Muted>
          </View>
          {!selectedId && <Check size={18} color={colors.primary} />}
        </Pressable>

        {selectableSpaces.map((space, i) => {
          const isSelected = selectedId === space.id;
          return (
            <Pressable
              key={space.id}
              onPress={() => handleSelect(space)}
              className="flex-row items-center py-3 active:opacity-70"
              style={
                i < selectableSpaces.length - 1
                  ? {
                      borderBottomWidth: 0.5,
                      borderBottomColor: isDark
                        ? "rgba(255,255,255,0.08)"
                        : "rgba(0,0,0,0.06)",
                    }
                  : undefined
              }
            >
              <View
                className="mr-3 items-center justify-center rounded-full"
                style={{
                  width: 34,
                  height: 34,
                  backgroundColor: isDark
                    ? "rgba(56,189,248,0.14)"
                    : "rgba(14,165,233,0.12)",
                }}
              >
                {canRenderSpaceIcon(space.icon) ? (
                  <Text className="text-sm">{space.icon}</Text>
                ) : space.icon ? (
                  <IconPlanet size={17} color={colors.mutedForeground} />
                ) : (
                  <Text className="text-sm">
                    {space.name.charAt(0).toUpperCase()}
                  </Text>
                )}
              </View>
              <View className="flex-1">
                <Text className="text-sm font-medium">{space.name}</Text>
                {space.slug && (
                  <Muted className="text-xs mt-0.5">{space.slug}</Muted>
                )}
              </View>
              {isSelected && <Check size={18} color={colors.primary} />}
            </Pressable>
          );
        })}
      </BottomSheetScrollView>
    </BottomSheet>
  );
});
