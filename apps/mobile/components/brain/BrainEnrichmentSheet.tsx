import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { MessageSquare, X } from "lucide-react-native";
import {
  useBrainEnrichment,
  type BrainEnrichmentSourceFamily,
} from "@thinkwork/react-native-sdk";
import { Muted, Text } from "@/components/ui/typography";
import { toast } from "@/components/ui/toast";
import type { COLORS } from "@/lib/theme";
import { BrainSourcePicker } from "./BrainSourcePicker";
import { BrainEnrichmentCandidateList } from "./BrainEnrichmentCandidateList";

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
    "WEB",
    "KNOWLEDGE_BASE",
  ]);
  const enrichment = useBrainEnrichment({ graphqlUrl });

  const run = async () => {
    try {
      await enrichment.run({
        tenantId,
        pageTable: "wiki_pages",
        pageId,
        query: pageTitle,
        sourceFamilies: sources,
        limit: 12,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Try again in a moment.";
      toast.show({ tone: "error", message: `Enrichment failed: ${message}` });
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View
          className="flex-row items-center justify-between px-4 py-3"
          style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "700" }}>
              Enrich page
            </Text>
            <Muted numberOfLines={1}>{pageTitle}</Muted>
          </View>
          <Pressable onPress={onClose} className="p-2" accessibilityLabel="Close">
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
            selected={sources}
            onChange={setSources}
            colors={colors}
          />

          <Pressable
            onPress={run}
            disabled={enrichment.loading || sources.length === 0}
            className="items-center justify-center rounded-md px-4 py-3"
            style={{
              backgroundColor:
                enrichment.loading || sources.length === 0
                  ? colors.secondary
                  : colors.primary,
            }}
          >
            {enrichment.loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={{ color: "#ffffff", fontSize: 15, fontWeight: "700" }}>
                Run enrichment
              </Text>
            )}
          </Pressable>

          {enrichment.error ? (
            <Muted style={{ color: colors.destructive }}>
              {enrichment.error.message}
            </Muted>
          ) : null}

          {enrichment.proposal ? (
            <View
              className="rounded-md p-3 gap-3"
              style={{
                backgroundColor: colors.secondary,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <View>
                <Text style={{ color: colors.foreground, fontWeight: "700" }}>
                  Review thread ready
                </Text>
                <Muted style={{ marginTop: 2 }}>
                  {enrichment.proposal.candidates.length} suggestions were added
                  to a pending review thread.
                </Muted>
              </View>
              {onOpenThread ? (
                <Pressable
                  onPress={() => {
                    onOpenThread(enrichment.proposal!.threadId);
                    onClose();
                  }}
                  className="flex-row items-center justify-center rounded-md px-3 py-2"
                  style={{ backgroundColor: colors.primary, gap: 8 }}
                >
                  <MessageSquare size={16} color="#ffffff" />
                  <Text style={{ color: "#ffffff", fontWeight: "700" }}>
                    Open review thread
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <BrainEnrichmentCandidateList
            proposal={enrichment.proposal}
            colors={colors}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}
