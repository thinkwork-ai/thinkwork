import React from "react";
import { ScrollView, View } from "react-native";
import { Text } from "@/components/ui/typography";
import type { ContextProviderStatus } from "@thinkwork/react-native-sdk";
import type { COLORS } from "@/lib/theme";

interface BrainProviderStatusStripProps {
  providers: ContextProviderStatus[];
  colors: (typeof COLORS)["dark"];
}

function statusColor(state: ContextProviderStatus["state"]): string {
  switch (state) {
    case "ok":
      return "#22c55e";
    case "stale":
      return "#f59e0b";
    case "timeout":
      return "#f97316";
    case "error":
      return "#ef4444";
    case "skipped":
      return "#737373";
  }
}

function statusLabel(provider: ContextProviderStatus): string {
  if (provider.state === "ok") {
    return `${provider.displayName} ${provider.hitCount ?? 0}`;
  }
  return `${provider.displayName} ${provider.state}`;
}

export function BrainProviderStatusStrip({
  providers,
  colors,
}: BrainProviderStatusStripProps) {
  if (providers.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingVertical: 6,
        gap: 8,
        alignItems: "center",
      }}
      style={{
        height: 40,
        maxHeight: 40,
        flexGrow: 0,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      {providers.map((provider) => (
        <View
          key={provider.providerId}
          className="flex-row items-center rounded-full px-2.5"
          style={{
            backgroundColor: colors.secondary,
            borderWidth: 1,
            borderColor: colors.border,
            gap: 6,
            height: 28,
            maxWidth: 190,
          }}
        >
          <View
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              backgroundColor: statusColor(provider.state),
            }}
          />
          <Text
            numberOfLines={1}
            style={{
              color: colors.foreground,
              fontSize: 12,
              fontWeight: "600",
              lineHeight: 16,
            }}
          >
            {statusLabel(provider)}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}
