import React from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";

export interface MentionCandidate {
  id: string;
  name: string;
  type: "member" | "assistant";
}

interface MentionAutocompleteProps {
  query: string;
  candidates: MentionCandidate[];
  onSelect: (candidate: MentionCandidate) => void;
  visible: boolean;
}

export function MentionAutocomplete({ query, candidates, onSelect, visible }: MentionAutocompleteProps) {
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
        bottom: "100%",
        left: 8,
        right: 8,
        backgroundColor: dark ? "#1c1c1e" : "#ffffff",
        borderRadius: 12,
        borderWidth: 1,
        borderColor: dark ? "#333" : "#e0e0e0",
        marginBottom: 4,
        overflow: "hidden",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 4,
        maxHeight: 340,
      }}
    >
      <ScrollView keyboardShouldPersistTaps="always">
        {filtered.map((candidate, i) => {
          const isAssistant = candidate.type === "assistant";
          const badgeBg = isAssistant
            ? (dark ? "rgba(249,115,22,0.15)" : "rgba(249,115,22,0.1)")
            : (dark ? "rgba(99,102,241,0.15)" : "rgba(99,102,241,0.1)");
          const badgeText = isAssistant
            ? (dark ? "#38bdf8" : "#0284c7")
            : (dark ? "#818cf8" : "#4f46e5");

          return (
            <Pressable
              key={candidate.id}
              onPress={() => onSelect(candidate)}
            >
              {({ pressed }) => (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    borderBottomWidth: i < filtered.length - 1 ? 1 : 0,
                    borderBottomColor: dark ? "#2a2a2a" : "#f0f0f0",
                    backgroundColor: pressed ? (dark ? "#2a2a2a" : "#f5f5f5") : "transparent",
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
                  <View
                    style={{
                      marginLeft: 12,
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: 6,
                      backgroundColor: badgeBg,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: "600", color: badgeText }}>
                      {isAssistant ? "Agent" : "Member"}
                    </Text>
                  </View>
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
