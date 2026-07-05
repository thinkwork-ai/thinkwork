import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react";
import { Alert, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import {
  Check,
  Circle,
  Pencil,
  Plus,
  Trash2,
  X,
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
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const [entries, setEntries] = useState(() => getEnvironmentEntries());
  const [activeId, setActiveId] = useState(
    () => getActiveEnvironmentEntry()?.id ?? null,
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

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

  const handleSwitch = async (entry: MobileEnvironmentEntry) => {
    setBusyId(entry.id);
    try {
      const result = await switchActiveEnvironment(entry.id);
      onRequestClose?.();
      router.replace(result.status === "restored" ? "/" : "/sign-in");
    } catch (error) {
      Alert.alert(
        "Switch failed",
        error instanceof Error ? error.message : "Unable to switch environments.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleRename = async (entry: MobileEnvironmentEntry) => {
    if (editingId !== entry.id) {
      setEditingId(entry.id);
      setEditingName(entry.displayName);
      return;
    }
    try {
      await renameEnvironment(entry.id, editingName);
      setEditingId(null);
      setEditingName("");
    } catch (error) {
      Alert.alert(
        "Rename failed",
        error instanceof Error ? error.message : "Unable to rename environment.",
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
      if (result.status === "removed-active-no-fallback") {
        onRequestClose?.();
        router.replace("/environment-setup");
      } else if (result.status === "removed-active-fallback-restored") {
        router.replace(
          result.switchResult.status === "restored" ? "/" : "/sign-in",
        );
      }
    } catch (error) {
      Alert.alert(
        "Remove failed",
        error instanceof Error ? error.message : "Unable to remove environment.",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View className={presentation === "sheet" ? "px-4 pb-4" : "px-4 py-4"}>
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
            const isEditing = entry.id === editingId;
            const isBusy = entry.id === busyId;
            return (
              <View
                key={entry.id}
                className={`gap-3 bg-white px-4 py-3 dark:bg-neutral-950 ${
                  index === entries.length - 1
                    ? ""
                    : "border-b border-neutral-200 dark:border-neutral-800"
                }`}
              >
                <View className="flex-row items-start gap-3">
                  <View className="pt-0.5">
                    {isActive ? (
                      <Check size={18} color={colors.primary} />
                    ) : (
                      <Circle size={18} color={colors.mutedForeground} />
                    )}
                  </View>
                  <View className="flex-1 gap-1">
                    {isEditing ? (
                      <Input
                        compact
                        value={editingName}
                        onChangeText={setEditingName}
                        autoCapitalize="words"
                      />
                    ) : (
                      <>
                        <Text className="text-sm font-semibold">
                          {entry.displayName}
                        </Text>
                        <Muted className="text-xs">{entry.host}</Muted>
                        <Muted className="text-xs">
                          {[entry.stage, entry.region].filter(Boolean).join(" · ")}
                        </Muted>
                      </>
                    )}
                  </View>
                </View>

                <View className="flex-row items-center justify-end gap-2">
                  {!isActive && !isEditing && (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={isBusy}
                      onPress={() => void handleSwitch(entry)}
                    >
                      Switch
                    </Button>
                  )}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onPress={() => void handleRename(entry)}
                    disabled={isBusy}
                  >
                    {isEditing ? (
                      <Check size={18} color={colors.foreground} />
                    ) : (
                      <Pencil size={18} color={colors.foreground} />
                    )}
                  </Button>
                  {isEditing ? (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onPress={() => {
                        setEditingId(null);
                        setEditingName("");
                      }}
                    >
                      <X size={18} color={colors.foreground} />
                    </Button>
                  ) : (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onPress={() => confirmRemove(entry)}
                      disabled={isBusy}
                    >
                      <Trash2 size={18} color={colors.destructive} />
                    </Button>
                  )}
                </View>
              </View>
            );
          })
        )}
      </View>
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
