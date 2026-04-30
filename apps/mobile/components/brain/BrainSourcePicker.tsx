import React from "react";
import { Pressable, View } from "react-native";
import { Check, Database, Globe2, Search } from "lucide-react-native";
import { Text } from "@/components/ui/typography";
import type { BrainEnrichmentSourceFamily } from "@thinkwork/react-native-sdk";
import type { COLORS } from "@/lib/theme";

const SOURCES: Array<{
  family: BrainEnrichmentSourceFamily;
  label: string;
  icon: typeof Database;
}> = [
  { family: "BRAIN", label: "Brain", icon: Database },
  { family: "WEB", label: "Web", icon: Globe2 },
  { family: "KNOWLEDGE_BASE", label: "KB", icon: Search },
];

interface BrainSourcePickerProps {
  selected: BrainEnrichmentSourceFamily[];
  onChange: (selected: BrainEnrichmentSourceFamily[]) => void;
  colors: (typeof COLORS)["dark"];
}

export function BrainSourcePicker({
  selected,
  onChange,
  colors,
}: BrainSourcePickerProps) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {SOURCES.map((source) => {
        const enabled = selected.includes(source.family);
        const Icon = source.icon;
        return (
          <Pressable
            key={source.family}
            onPress={() => {
              onChange(
                enabled
                  ? selected.filter((family) => family !== source.family)
                  : [...selected, source.family],
              );
            }}
            className="flex-row items-center rounded-full px-3 py-2"
            style={{
              gap: 6,
              backgroundColor: enabled ? colors.primary : colors.secondary,
              borderWidth: 1,
              borderColor: enabled ? colors.primary : colors.border,
            }}
          >
            {enabled ? (
              <Check size={15} color="#ffffff" />
            ) : (
              <Icon size={15} color={colors.mutedForeground} />
            )}
            <Text
              style={{
                color: enabled ? "#ffffff" : colors.foreground,
                fontSize: 13,
                fontWeight: "700",
              }}
            >
              {source.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
