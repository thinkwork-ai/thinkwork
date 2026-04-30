import React from "react";
import { View } from "react-native";
import { Muted, Text } from "@/components/ui/typography";
import type { BrainEnrichmentProposal } from "@thinkwork/react-native-sdk";
import type { COLORS } from "@/lib/theme";

interface BrainEnrichmentCandidateListProps {
  proposal: BrainEnrichmentProposal | null;
  colors: (typeof COLORS)["dark"];
}

export function BrainEnrichmentCandidateList({
  proposal,
  colors,
}: BrainEnrichmentCandidateListProps) {
  if (!proposal) return null;
  if (proposal.candidates.length === 0) {
    return <Muted>No candidate additions found.</Muted>;
  }

  return (
    <View style={{ gap: 10 }}>
      {proposal.candidates.map((candidate) => (
        <View
          key={candidate.id}
          style={{
            gap: 6,
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Text
              style={{
                color: colors.primary,
                fontSize: 11,
                fontWeight: "700",
              }}
            >
              {candidate.sourceFamily.replace("_", " ")}
            </Text>
            <Muted style={{ fontSize: 11 }}>{candidate.providerId}</Muted>
          </View>
          <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600" }}>
            {candidate.title}
          </Text>
          <Muted style={{ fontSize: 14, lineHeight: 20 }}>
            {candidate.summary}
          </Muted>
          {candidate.citation?.label || candidate.citation?.uri ? (
            <Muted style={{ fontSize: 12 }} numberOfLines={1}>
              {candidate.citation.label ?? candidate.citation.uri}
            </Muted>
          ) : null}
        </View>
      ))}
    </View>
  );
}
