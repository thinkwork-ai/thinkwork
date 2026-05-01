import React, { useEffect, useMemo, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { CheckCircle2, Circle, ExternalLink } from "lucide-react-native";
import type { BrainEnrichmentProposal } from "@thinkwork/react-native-sdk";
import { Muted, Text } from "@/components/ui/typography";
import type { COLORS } from "@/lib/theme";
import {
  candidatesForBrainEnrichmentReview,
  defaultSelectedCandidateIds,
  providerStatusLabel,
  sourceLabel,
} from "@/lib/brain-enrichment-review";

interface BrainEnrichmentReviewPanelProps {
  proposal: Pick<
    BrainEnrichmentProposal,
    "candidates" | "providerStatuses" | "reviewRunId"
  > | null;
  colors: (typeof COLORS)["dark"];
  note: string;
  onNoteChange: (note: string) => void;
  selectedCandidateIds: string[];
  onSelectedCandidateIdsChange: (ids: string[]) => void;
  showNote?: boolean;
  footer?: React.ReactNode;
}

export function BrainEnrichmentReviewPanel({
  proposal,
  colors,
  note,
  onNoteChange,
  selectedCandidateIds,
  onSelectedCandidateIdsChange,
  showNote = true,
  footer,
}: BrainEnrichmentReviewPanelProps) {
  const candidates = useMemo(
    () => candidatesForBrainEnrichmentReview(proposal),
    [proposal],
  );
  const [initializedForRun, setInitializedForRun] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!proposal || initializedForRun === proposal.reviewRunId) return;
    onSelectedCandidateIdsChange(defaultSelectedCandidateIds(candidates));
    setInitializedForRun(proposal.reviewRunId);
  }, [candidates, initializedForRun, onSelectedCandidateIdsChange, proposal]);

  if (!proposal) return null;

  const selected = new Set(selectedCandidateIds);

  return (
    <View style={{ gap: 14 }}>
      {proposal.providerStatuses.length > 0 ? (
        <View style={{ gap: 8 }}>
          {proposal.providerStatuses.map((status) => (
            <View
              key={status.providerId}
              className="flex-row items-center justify-between rounded-md px-3 py-2"
              style={{
                backgroundColor: colors.secondary,
                borderWidth: 1,
                borderColor: colors.border,
                gap: 10,
              }}
            >
              <Text
                numberOfLines={1}
                style={{ flex: 1, color: colors.foreground, fontSize: 13 }}
              >
                {providerStatusLabel(status)}
              </Text>
              {status.error || status.reason ? (
                <Muted numberOfLines={1} style={{ flex: 1, fontSize: 12 }}>
                  {status.error ?? status.reason}
                </Muted>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {candidates.length === 0 ? (
        <Muted>No candidate additions found.</Muted>
      ) : (
        <View style={{ gap: 10 }}>
          {candidates.map((candidate) => {
            const checked = selected.has(candidate.id);
            return (
              <Pressable
                key={candidate.id}
                onPress={() => {
                  const next = new Set(selected);
                  if (checked) next.delete(candidate.id);
                  else next.add(candidate.id);
                  onSelectedCandidateIdsChange([...next]);
                }}
                className="rounded-md p-3"
                style={{
                  borderWidth: 1,
                  borderColor: checked ? colors.primary : colors.border,
                  backgroundColor: colors.background,
                  gap: 8,
                }}
              >
                <View className="flex-row items-center" style={{ gap: 8 }}>
                  {checked ? (
                    <CheckCircle2 size={18} color={colors.primary} />
                  ) : (
                    <Circle size={18} color={colors.mutedForeground} />
                  )}
                  <Text
                    style={{
                      flex: 1,
                      color: colors.foreground,
                      fontSize: 15,
                      fontWeight: "700",
                    }}
                  >
                    {candidate.title}
                  </Text>
                </View>
                <Muted style={{ lineHeight: 20 }}>{candidate.summary}</Muted>
                <View className="flex-row items-center" style={{ gap: 8 }}>
                  <Text
                    style={{
                      color:
                        candidate.sourceFamily === "WEB"
                          ? "#f59e0b"
                          : colors.primary,
                      fontSize: 11,
                      fontWeight: "700",
                    }}
                  >
                    {sourceLabel(candidate.sourceFamily)}
                  </Text>
                  {candidate.citation?.uri ? (
                    <View
                      className="flex-row items-center"
                      style={{ gap: 4, flex: 1 }}
                    >
                      <ExternalLink size={12} color={colors.mutedForeground} />
                      <Muted
                        numberOfLines={1}
                        style={{ flex: 1, fontSize: 12 }}
                      >
                        {candidate.citation.label ?? candidate.citation.uri}
                      </Muted>
                    </View>
                  ) : candidate.citation?.label ? (
                    <Muted numberOfLines={1} style={{ flex: 1, fontSize: 12 }}>
                      {candidate.citation.label}
                    </Muted>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {showNote ? (
        <TextInput
          value={note}
          onChangeText={onNoteChange}
          placeholder="Review note"
          placeholderTextColor={colors.mutedForeground}
          multiline
          textAlignVertical="top"
          style={{
            minHeight: 84,
            color: colors.foreground,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 10,
            backgroundColor: colors.secondary,
          }}
        />
      ) : null}

      {footer}
    </View>
  );
}
