import React, { useCallback, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { BookOpenText, Mic } from "lucide-react-native";
import { IconLetterCase, IconTopologyStar3 } from "@tabler/icons-react-native";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS } from "@/lib/theme";
import {
  VoiceDictationBar,
  type VoiceDictationBarRef,
} from "@/components/input/VoiceDictationBar";
import { WikiList } from "@/components/wiki/WikiList";
import { WikiGraphView } from "@/components/wiki/graph/WikiGraphView";

type WikiViewMode = "list" | "graph";

interface WikiSegmentProps {
  tenantId: string | null | undefined;
  userId: string | null | undefined;
}

export function WikiSegment({ tenantId, userId }: WikiSegmentProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const insets = useSafeAreaInsets();
  const [viewMode, setViewMode] = useState<WikiViewMode>("list");
  const [showLabels, setShowLabels] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [dictating, setDictating] = useState(false);
  const dictationRef = useRef<VoiceDictationBarRef>(null);
  const dictationBaseRef = useRef("");

  const applyDictationText = useCallback((text: string) => {
    const base = dictationBaseRef.current.trimEnd();
    const suffix = text.trim();
    setSearchQuery([base, suffix].filter(Boolean).join(" "));
  }, []);

  const startDictation = useCallback(async () => {
    dictationBaseRef.current = searchQuery;
    const started = await dictationRef.current?.start();
    if (started) setDictating(true);
  }, [searchQuery]);

  const stopDictation = useCallback(() => {
    dictationRef.current?.stop();
  }, []);

  return (
    <View className="flex-1">
      <View className="flex-1">
        {viewMode === "list" ? (
          <WikiList userId={userId} colors={colors} searchQuery={searchQuery} />
        ) : tenantId && userId ? (
          <View className="flex-1">
            <View className="flex-row justify-end px-4 py-2">
              <Pressable
                onPress={() => setShowLabels((s) => !s)}
                className="p-2"
                accessibilityRole="button"
                accessibilityLabel={showLabels ? "Hide labels" : "Show labels"}
              >
                <IconLetterCase
                  size={22}
                  color={showLabels ? colors.primary : colors.foreground}
                  strokeWidth={2}
                />
              </Pressable>
            </View>
            <WikiGraphView
              tenantId={tenantId}
              userId={userId}
              searchQuery={searchQuery}
              showLabels={showLabels}
            />
          </View>
        ) : (
          <WikiList userId={userId} colors={colors} searchQuery={searchQuery} />
        )}
      </View>

      <View
        className="border-t border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900"
        style={{
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          overflow: "hidden",
          paddingBottom: insets.bottom || 4,
        }}
      >
        <View className="flex-row items-center gap-3 px-4 py-3">
          <View className="flex-row items-center gap-2">
            <WikiModeButton
              label="Show wiki list"
              selected={viewMode === "list"}
              onPress={() => setViewMode("list")}
            >
              <BookOpenText
                size={20}
                color={
                  viewMode === "list" ? colors.primary : colors.mutedForeground
                }
              />
            </WikiModeButton>
            <WikiModeButton
              label="Show wiki graph"
              selected={viewMode === "graph"}
              onPress={() => setViewMode("graph")}
            >
              <IconTopologyStar3
                size={20}
                color={
                  viewMode === "graph" ? colors.primary : colors.mutedForeground
                }
                strokeWidth={2}
              />
            </WikiModeButton>
          </View>

          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={
              viewMode === "list" ? "Search Pages…" : "Search Graph…"
            }
            placeholderTextColor={colors.mutedForeground}
            returnKeyType="search"
            className="min-w-0 flex-1"
            style={{
              color: colors.foreground,
              fontSize: 17,
              lineHeight: 22,
              paddingVertical: 2,
            }}
          />

          <Pressable
            onPress={dictating ? stopDictation : startDictation}
            className="items-center justify-center active:opacity-70"
            accessibilityRole="button"
            accessibilityLabel={
              dictating ? "Stop dictation" : "Start dictation"
            }
            accessibilityState={{ selected: dictating }}
            style={{ width: 34, height: 34, borderRadius: 17 }}
          >
            <Mic
              size={22}
              color={dictating ? colors.primary : colors.mutedForeground}
            />
          </Pressable>
        </View>
        <View className="px-4 pb-2">
          <VoiceDictationBar
            ref={dictationRef}
            colors={colors}
            isDark={isDark}
            onListeningChange={setDictating}
            onInterim={applyDictationText}
            onTranscript={(text) => {
              applyDictationText(text);
              setDictating(false);
            }}
            onCancel={() => setDictating(false)}
          />
        </View>
      </View>
    </View>
  );
}

function WikiModeButton({
  label,
  selected,
  onPress,
  children,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="items-center justify-center active:opacity-70"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={{ width: 34, height: 34, borderRadius: 17 }}
    >
      {children}
    </Pressable>
  );
}
