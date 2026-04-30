import React from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  X,
  type LucideIcon,
} from "lucide-react-native";
import { Muted, Text } from "@/components/ui/typography";
import type { ContextProviderStatus } from "@thinkwork/react-native-sdk";
import type { COLORS } from "@/lib/theme";

interface BrainProviderStatusSheetProps {
  visible: boolean;
  providers: ContextProviderStatus[];
  colors: (typeof COLORS)["dark"];
  onClose: () => void;
}

function statusMeta(
  state: ContextProviderStatus["state"],
): { label: string; color: string; icon: LucideIcon } {
  switch (state) {
    case "ok":
      return { label: "Available", color: "#22c55e", icon: CheckCircle2 };
    case "stale":
      return { label: "Stale", color: "#f59e0b", icon: Clock3 };
    case "timeout":
      return { label: "Timed out", color: "#f97316", icon: Clock3 };
    case "error":
      return { label: "Error", color: "#ef4444", icon: AlertCircle };
    case "skipped":
      return { label: "Skipped", color: "#737373", icon: AlertCircle };
  }
}

function sourceLabel(provider: ContextProviderStatus): string {
  if (provider.sourceFamily === "pages" || provider.family === "wiki") {
    return "Pages";
  }
  if (provider.sourceFamily === "knowledge-base") return "Knowledge base";
  if (provider.sourceFamily === "web") return "Web";
  if (provider.sourceFamily === "brain" || provider.family === "memory") {
    return "Brain";
  }
  if (provider.sourceFamily === "workspace") return "Workspace";
  if (provider.sourceFamily === "source-agent") return "Source agent";
  return provider.family;
}

export function BrainProviderStatusSheet({
  visible,
  providers,
  colors,
  onClose,
}: BrainProviderStatusSheetProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View
          className="flex-row items-center justify-between px-4 py-3"
          style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
        >
          <View>
            <Text
              style={{
                color: colors.foreground,
                fontSize: 17,
                fontWeight: "700",
              }}
            >
              Providers
            </Text>
            <Muted>{providers.length} sources checked</Muted>
          </View>
          <Pressable onPress={onClose} className="p-2" accessibilityLabel="Close">
            <X size={22} color={colors.foreground} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: 32,
          }}
        >
          {providers.map((provider) => {
            const meta = statusMeta(provider.state);
            const Icon = meta.icon;
            return (
              <View
                key={provider.providerId}
                className="flex-row items-start py-3"
                style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
              >
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: `${meta.color}20`,
                  }}
                >
                  <Icon size={18} color={meta.color} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <View className="flex-row items-center justify-between gap-3">
                    <Text
                      numberOfLines={1}
                      style={{
                        flex: 1,
                        color: colors.foreground,
                        fontSize: 15,
                        fontWeight: "700",
                      }}
                    >
                      {provider.displayName}
                    </Text>
                    <Muted style={{ fontSize: 12 }}>
                      {provider.hitCount ?? 0} hits
                    </Muted>
                  </View>
                  <Muted style={{ fontSize: 13, marginTop: 2 }}>
                    {sourceLabel(provider)} · {meta.label}
                    {provider.durationMs ? ` · ${provider.durationMs}ms` : ""}
                  </Muted>
                  {provider.reason || provider.error ? (
                    <Muted
                      style={{
                        color:
                          provider.state === "error"
                            ? colors.destructive
                            : colors.mutedForeground,
                        fontSize: 12,
                        marginTop: 4,
                      }}
                    >
                      {provider.error ?? provider.reason}
                    </Muted>
                  ) : null}
                </View>
              </View>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}
