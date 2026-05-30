import React from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";

export interface MentionCandidate {
  id: string;
  name: string;
  type: "member" | "assistant";
  targetId?: string;
  targetType?: "USER" | "AGENT";
  displayName?: string;
  rawText?: string;
}

interface MentionAutocompleteProps {
  query: string;
  candidates: MentionCandidate[];
  onSelect: (candidate: MentionCandidate) => void;
  visible: boolean;
}

export function MentionAutocomplete({
  query,
  candidates,
  onSelect,
  visible,
}: MentionAutocompleteProps) {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const dark = colorScheme === "dark";

  if (!visible) return null;

  const filtered = candidates
    .filter((c) => c.name.toLowerCase().startsWith(query.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 6);

  if (filtered.length === 0) return null;

  return (
    <View
      style={{
        position: "absolute",
        bottom: 156,
        left: 8,
        right: 8,
        backgroundColor: dark ? "#1c1c1e" : "#ffffff",
        borderRadius: 12,
        borderWidth: 1,
        borderColor: dark ? "#333" : "#e0e0e0",
        overflow: "hidden",
        zIndex: 10,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 4,
        maxHeight: 340,
      }}
    >
      <ScrollView keyboardShouldPersistTaps="always">
        {filtered.map((candidate, i) => (
          <Pressable key={candidate.id} onPress={() => onSelect(candidate)}>
            {({ pressed }) => (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  borderBottomWidth: i < filtered.length - 1 ? 1 : 0,
                  borderBottomColor: dark ? "#2a2a2a" : "#f0f0f0",
                  backgroundColor: pressed
                    ? dark
                      ? "#2a2a2a"
                      : "#f5f5f5"
                    : "transparent",
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    flex: 1,
                    color: colors.foreground,
                    fontSize: 16,
                    fontWeight: "500",
                  }}
                >
                  {candidate.name}
                </Text>
              </View>
            )}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
