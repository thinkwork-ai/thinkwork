import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { MessageSquare, X } from "lucide-react-native";
import {
  acceptBrainEnrichmentReview,
  cancelBrainEnrichmentReview,
  useBrainEnrichment,
  type BrainEnrichmentSourceFamily,
} from "@thinkwork/react-native-sdk";
import { Muted, Text } from "@/components/ui/typography";
import { toast } from "@/components/ui/toast";
import type { COLORS } from "@/lib/theme";
import { BrainSourcePicker } from "./BrainSourcePicker";
import { BrainEnrichmentReviewPanel } from "./BrainEnrichmentReviewPanel";
import { serializeBrainEnrichmentSelection } from "@/lib/brain-enrichment-review";

interface BrainEnrichmentSheetProps {
  visible: boolean;
  onClose: () => void;
  graphqlUrl: string;
  tenantId: string;
  pageId: string;
  pageTitle: string;
  colors: (typeof COLORS)["dark"];
  onOpenThread?: (threadId: string) => void;
}

export function BrainEnrichmentSheet({
  visible,
  onClose,
  graphqlUrl,
  tenantId,
  pageId,
  pageTitle,
  colors,
  onOpenThread,
}: BrainEnrichmentSheetProps) {
  const [sources, setSources] = useState<BrainEnrichmentSourceFamily[]>([
    "BRAIN",
    "KNOWLEDGE_BASE",
  ]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>(
    [],
  );
  const [note, setNote] = useState("");
  const [deciding, setDeciding] = useState<"accept" | "cancel" | null>(null);
  const enrichment = useBrainEnrichment({ graphqlUrl });

  useEffect(() => {
    if (!visible) return;
    void enrichment
      .loadSources({
        tenantId,
        pageTable: "wiki_pages",
        pageId,
      })
      .then((available) => {
        setSources(
          available
            .filter((source) => source.selectedByDefault)
            .map((source) => source.family),
        );
      })
      .catch((err) => {
        const message =
          err instanceof Error ? err.message : "Try again in a moment.";
        toast.show({
          tone: "error",
          message: `Sources failed: ${message}`,
        });
      });
  }, [enrichment.loadSources, pageId, tenantId, visible]);

  const run = async () => {
    try {
      const proposal = await enrichment.run({
        tenantId,
        pageTable: "wiki_pages",
        pageId,
        query: pageTitle,
        sourceFamilies: sources,
        limit: 12,
      });
      // U6 of plan 2026-05-01-002: status='QUEUED' means the agentic
      // draft compile is running async. Close the sheet immediately and
      // surface a confirmation; the user gets a thread message when the
      // draft is ready to review.
      if (proposal.status === "QUEUED") {
        toast.show({
          message:
            "We're preparing your draft. You'll get a thread message when it's ready.",
        });
        enrichment.reset();
        setSelectedCandidateIds([]);
        setNote("");
        onClose();
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Try again in a moment.";
      toast.show({ tone: "error", message: `Enrichment failed: ${message}` });
    }
  };

  const decide = async (decision: "accept" | "cancel") => {
    if (!enrichment.proposal) return;
    // QUEUED proposals don't have a reviewRunId yet — the writeback will
    // create one when the async compile finishes. The decide buttons should
    // not be reachable in this state (the sheet closes on QUEUED), but guard
    // anyway in case of a subscription update or stale state.
    const reviewRunId = enrichment.proposal.reviewRunId;
    if (!reviewRunId) {
      toast.show({
        tone: "error",
        message: "This draft is still preparing — try again in a moment.",
      });
      return;
    }
    setDeciding(decision);
    try {
      const responseMarkdown = serializeBrainEnrichmentSelection({
        selectedCandidateIds,
        note,
      });
      if (decision === "accept") {
        await acceptBrainEnrichmentReview({
          graphqlUrl,
          reviewRunId,
          responseMarkdown,
          notes: note,
        });
        toast.show({ message: "Enrichment applied" });
      } else {
        await cancelBrainEnrichmentReview({
          graphqlUrl,
          reviewRunId,
          responseMarkdown,
          notes: note,
        });
        toast.show({ message: "Enrichment rejected" });
      }
      enrichment.reset();
      setSelectedCandidateIds([]);
      setNote("");
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Try again in a moment.";
      toast.show({ tone: "error", message: `Review failed: ${message}` });
    } finally {
      setDeciding(null);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View
          className="flex-row items-center justify-between px-4 py-3"
          style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: colors.foreground,
                fontSize: 17,
                fontWeight: "700",
              }}
            >
              Enrich page
            </Text>
            <Muted numberOfLines={1}>{pageTitle}</Muted>
          </View>
          <Pressable
            onPress={onClose}
            className="p-2"
            accessibilityLabel="Close"
          >
            <X size={22} color={colors.foreground} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 16,
            paddingBottom: 32,
            gap: 16,
          }}
        >
          <BrainSourcePicker
            sources={enrichment.sources}
            selected={sources}
            onChange={setSources}
            colors={colors}
          />

          <Pressable
            onPress={run}
            disabled={
              enrichment.loading ||
              enrichment.sourcesLoading ||
              sources.length === 0
            }
            className="items-center justify-center rounded-md px-4 py-3"
            style={{
              backgroundColor:
                enrichment.loading ||
                enrichment.sourcesLoading ||
                sources.length === 0
                  ? colors.secondary
                  : colors.primary,
            }}
          >
            {enrichment.loading || enrichment.sourcesLoading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text
                style={{ color: "#ffffff", fontSize: 15, fontWeight: "700" }}
              >
                Run enrichment
              </Text>
            )}
          </Pressable>

          {enrichment.error ? (
            <Muted style={{ color: colors.destructive }}>
              {enrichment.error.message}
            </Muted>
          ) : null}

          <BrainEnrichmentReviewPanel
            proposal={enrichment.proposal}
            colors={colors}
            note={note}
            onNoteChange={setNote}
            selectedCandidateIds={selectedCandidateIds}
            onSelectedCandidateIdsChange={setSelectedCandidateIds}
            footer={
              enrichment.proposal ? (
                <View style={{ gap: 10 }}>
                  <View className="flex-row" style={{ gap: 10 }}>
                    <Pressable
                      onPress={() => decide("cancel")}
                      disabled={!!deciding}
                      className="flex-1 items-center justify-center rounded-md px-3 py-3"
                      style={{
                        backgroundColor: colors.secondary,
                        borderWidth: 1,
                        borderColor: colors.border,
                      }}
                    >
                      <Text
                        style={{ color: colors.foreground, fontWeight: "700" }}
                      >
                        Reject
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => decide("accept")}
                      disabled={!!deciding}
                      className="flex-1 items-center justify-center rounded-md px-3 py-3"
                      style={{ backgroundColor: colors.primary }}
                    >
                      {deciding === "accept" ? (
                        <ActivityIndicator color="#ffffff" />
                      ) : (
                        <Text style={{ color: "#ffffff", fontWeight: "700" }}>
                          Approve selected
                        </Text>
                      )}
                    </Pressable>
                  </View>
                  {onOpenThread && enrichment.proposal!.threadId ? (
                    <Pressable
                      onPress={() => {
                        const tid = enrichment.proposal!.threadId;
                        if (!tid) return;
                        onOpenThread(tid);
                        onClose();
                      }}
                      className="flex-row items-center justify-center rounded-md px-3 py-2"
                      style={{ backgroundColor: colors.secondary, gap: 8 }}
                    >
                      <MessageSquare size={16} color={colors.foreground} />
                      <Text
                        style={{ color: colors.foreground, fontWeight: "700" }}
                      >
                        Open review thread
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null
            }
          />
        </ScrollView>
      </View>
    </Modal>
  );
}
