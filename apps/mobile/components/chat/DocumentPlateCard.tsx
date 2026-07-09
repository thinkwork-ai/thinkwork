import React from "react";
import { Pressable, View } from "react-native";
import { useColorScheme } from "nativewind";
import { useRouter } from "expo-router";
import { ChevronRight, FileText } from "lucide-react-native";
import { Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";

interface DocumentPlateCardProps {
  artifactId: string;
  title: string;
  /** Plate/genre slug ("report", "qbr", …) shown as the type badge. */
  type?: string;
  status?: string;
}

function plateTypeLabel(type: string | undefined): string {
  if (!type) return "Document";
  return type
    .split(/[-_\s]+/)
    .map((w) =>
      w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1),
    )
    .join(" ");
}

/**
 * In-thread card for document-kind artifacts (compiled HTML plates,
 * THINK-153). Mirrors web's compact ArtifactCard: a link-style row, no
 * inline body. Tapping navigates to the artifact reader route, which
 * renders the server-compiled plate HTML in a scriptless WebView.
 */
export function DocumentPlateCard({
  artifactId,
  title,
  type,
  status,
}: DocumentPlateCardProps) {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push(`/artifacts/${artifactId}`)}
      className="flex-row items-center gap-2 px-3 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 active:opacity-70"
    >
      <FileText size={14} color={colors.mutedForeground} />
      <Text
        className="text-sm font-medium text-neutral-900 dark:text-neutral-100 flex-1"
        numberOfLines={1}
      >
        {title}
      </Text>
      <View className="bg-neutral-200 dark:bg-neutral-700 rounded px-1.5 py-0.5">
        <Text className="text-xs text-neutral-600 dark:text-neutral-300">
          {plateTypeLabel(type)}
        </Text>
      </View>
      {status === "draft" && (
        <View className="bg-amber-100 dark:bg-amber-900/30 rounded px-1.5 py-0.5">
          <Text className="text-xs text-amber-700 dark:text-amber-400">
            Draft
          </Text>
        </View>
      )}
      <ChevronRight size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}
