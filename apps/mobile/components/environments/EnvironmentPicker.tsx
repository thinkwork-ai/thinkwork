import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Keyboard,
  Pressable,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Plus,
} from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import {
  getActiveEnvironmentEntry,
  getEnvironmentEntries,
  renameEnvironment,
  subscribeEnvironmentStore,
  type MobileEnvironmentEntry,
} from "@/lib/environments/store";
import {
  removeEnvironmentWithSessionCleanup,
  switchActiveEnvironment,
} from "@/lib/environments/switch";
import { useAuth } from "@/lib/auth-context";

export interface EnvironmentPickerSheetRef {
  present: () => void;
  dismiss: () => void;
}

interface EnvironmentPickerProps {
  presentation?: "screen" | "sheet";
  onRequestClose?: () => void;
}

export function EnvironmentPicker({
  presentation = "screen",
  onRequestClose,
}: EnvironmentPickerProps) {
  const router = useRouter();
  const { rescopeAuthForEnvironmentChange } = useAuth();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const [entries, setEntries] = useState(() => getEnvironmentEntries());
  const [activeId, setActiveId] = useState(
    () => getActiveEnvironmentEntry()?.id ?? null,
  );
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [paneWidth, setPaneWidth] = useState(0);
  // Height of the list pane, applied to the sliding container so opening the
  // detail pane never resizes the sheet.
  const [listHeight, setListHeight] = useState<number | null>(null);
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const unsubscribe = subscribeEnvironmentStore((snapshot) => {
      setEntries(snapshot.entries);
      setActiveId(snapshot.activeEnvironmentId);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const navigateToSetup = () => {
    onRequestClose?.();
    router.push("/environment-setup");
  };

  const openDetail = (entry: MobileEnvironmentEntry) => {
    setDetailId(entry.id);
    setEditingName(entry.displayName);
    Animated.timing(slide, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const closeDetail = () => {
    Keyboard.dismiss();
    Animated.timing(slide, {
      toValue: 0,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setDetailId(null);
    });
  };

  const handleSwitch = async (entry: MobileEnvironmentEntry) => {
    setBusyId(entry.id);
    try {
      await switchActiveEnvironment(entry.id);
      const restored = await rescopeAuthForEnvironmentChange();
      onRequestClose?.();
      router.replace(restored ? "/" : "/sign-in");
    } catch (error) {
      Alert.alert(
        "Switch failed",
        error instanceof Error
          ? error.message
          : "Unable to switch environments.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const saveRename = async (entry: MobileEnvironmentEntry) => {
    try {
      await renameEnvironment(entry.id, editingName);
      closeDetail();
    } catch (error) {
      Alert.alert(
        "Rename failed",
        error instanceof Error
          ? error.message
          : "Unable to rename environment.",
      );
    }
  };

  const confirmRemove = (entry: MobileEnvironmentEntry) => {
    Alert.alert(
      "Remove environment?",
      `Remove ${entry.displayName} and clear its stored session?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => void handleRemove(entry),
        },
      ],
    );
  };

  const handleRemove = async (entry: MobileEnvironmentEntry) => {
    setBusyId(entry.id);
    try {
      const result = await removeEnvironmentWithSessionCleanup(entry.id);
      closeDetail();
      if (result.status === "removed-active-no-fallback") {
        await rescopeAuthForEnvironmentChange();
        onRequestClose?.();
        router.replace("/environment-setup");
      } else if (result.status === "removed-active-fallback-restored") {
        const restored = await rescopeAuthForEnvironmentChange();
        router.replace(restored ? "/" : "/sign-in");
      }
    } catch (error) {
      Alert.alert(
        "Remove failed",
        error instanceof Error
          ? error.message
          : "Unable to remove environment.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const detailEntry = entries.find((entry) => entry.id === detailId) ?? null;

  const listPane = (
    <View>
      <View className="mb-4 flex-row items-center justify-between">
        <View>
          <Text className="text-base font-semibold">Environments</Text>
          <Muted className="text-xs">Choose where ThinkWork connects.</Muted>
        </View>
        <Button size="sm" variant="outline" onPress={navigateToSetup}>
          <Plus size={16} color={colors.foreground} />
          Add
        </Button>
      </View>

      <View className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
        {entries.length === 0 ? (
          <View className="items-center px-4 py-8">
            <Muted className="text-center text-sm">
              Add an environment to sign in.
            </Muted>
          </View>
        ) : (
          entries.map((entry, index) => {
            const isActive = entry.id === activeId;
            const isBusy = entry.id === busyId;
            return (
              <Pressable
                key={entry.id}
                disabled={isBusy}
                onPress={() => openDetail(entry)}
                className={`bg-white px-4 py-3 active:bg-neutral-50 dark:bg-neutral-950 dark:active:bg-neutral-900 ${
                  index === entries.length - 1
                    ? ""
                    : "border-b border-neutral-200 dark:border-neutral-800"
                }`}
              >
                <View className="flex-row items-center gap-3">
                  <Pressable
                    hitSlop={12}
                    disabled={isBusy || isActive}
                    onPress={() => void handleSwitch(entry)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isActive }}
                    accessibilityLabel={`Use ${entry.displayName}`}
                  >
                    {isBusy ? (
                      <ActivityIndicator size="small" />
                    ) : isActive ? (
                      <View className="h-5 w-5 items-center justify-center rounded-full bg-primary">
                        <Check size={13} color="#ffffff" strokeWidth={3} />
                      </View>
                    ) : (
                      <Circle size={20} color={colors.mutedForeground} />
                    )}
                  </Pressable>
                  <View className="flex-1 gap-0.5">
                    <Text className="text-sm font-semibold">
                      {entry.displayName}
                    </Text>
                    <Muted className="text-xs">{entry.host}</Muted>
                    <Muted className="text-xs">
                      {[entry.stage, entry.region].filter(Boolean).join(" · ")}
                    </Muted>
                  </View>
                  <ChevronRight size={16} color={colors.mutedForeground} />
                </View>
              </Pressable>
            );
          })
        )}
      </View>
    </View>
  );

  const detailPane = detailEntry ? (
    <View>
      <View className="mb-4 flex-row items-center gap-2.5">
        <Pressable
          hitSlop={12}
          onPress={closeDetail}
          accessibilityRole="button"
          accessibilityLabel="Back to environments"
        >
          <ChevronLeft size={22} color={colors.foreground} />
        </Pressable>
        <Text className="flex-1 text-sm font-semibold" numberOfLines={1}>
          {detailEntry.host}
        </Text>
      </View>

      <View className="gap-4">
        <Input
          label="Name"
          compact
          value={editingName}
          onChangeText={setEditingName}
          autoCapitalize="words"
          onSubmitEditing={() => void saveRename(detailEntry)}
        />

        <View className="gap-2 rounded-xl border border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <DetailRow label="Stage" value={detailEntry.stage || "—"} />
          <DetailRow label="Region" value={detailEntry.region || "—"} />
        </View>

        <Button
          onPress={() => void saveRename(detailEntry)}
          disabled={busyId === detailEntry.id}
        >
          Save
        </Button>

        <Pressable
          hitSlop={8}
          className="items-center py-2"
          onPress={() => confirmRemove(detailEntry)}
          disabled={busyId === detailEntry.id}
          accessibilityRole="button"
        >
          <Text size="sm" className="font-medium text-destructive">
            Remove environment
          </Text>
        </Pressable>
      </View>
    </View>
  ) : null;

  return (
    <View
      className={presentation === "sheet" ? "pb-4" : "py-4"}
      onLayout={(event) => setPaneWidth(event.nativeEvent.layout.width)}
    >
      {paneWidth > 0 && detailId ? (
        <View
          style={{
            overflow: "hidden",
            height: listHeight ?? undefined,
          }}
        >
          <Animated.View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              width: paneWidth * 2,
              transform: [
                {
                  translateX: slide.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -paneWidth],
                  }),
                },
              ],
            }}
          >
            <View style={{ width: paneWidth }} className="px-4">
              {listPane}
            </View>
            <View style={{ width: paneWidth }} className="px-4">
              {detailPane}
            </View>
          </Animated.View>
        </View>
      ) : (
        <View
          className="px-4"
          onLayout={(event) => setListHeight(event.nativeEvent.layout.height)}
        >
          {listPane}
        </View>
      )}
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between gap-4">
      <Muted className="text-xs">{label}</Muted>
      <Text className="flex-1 text-right text-xs" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export const EnvironmentPickerSheet = forwardRef<EnvironmentPickerSheetRef>(
  function EnvironmentPickerSheet(_props, ref) {
    const bottomSheetRef = useRef<BottomSheet>(null);
    const { colorScheme } = useColorScheme();
    const isDark = colorScheme === "dark";
    const insets = useSafeAreaInsets();
    const snapPoints = useMemo(() => ["70%"], []);

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

    return (
      <BottomSheet
        ref={bottomSheetRef}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        backgroundStyle={{
          backgroundColor: isDark ? "#1c1c1e" : "#ffffff",
        }}
        handleIndicatorStyle={{
          backgroundColor: isDark ? "#636366" : "#c7c7cc",
        }}
      >
        <BottomSheetScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        >
          <EnvironmentPicker
            presentation="sheet"
            onRequestClose={() => bottomSheetRef.current?.close()}
          />
        </BottomSheetScrollView>
      </BottomSheet>
    );
  },
);
