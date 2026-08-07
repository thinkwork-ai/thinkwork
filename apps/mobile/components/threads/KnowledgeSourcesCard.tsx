import React, { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useColorScheme } from "nativewind";
import { BookOpen, ChevronDown, FileText, X } from "lucide-react-native";
import { Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import {
  citationLabel,
  knowledgeDocumentFileName,
  type KnowledgeCitation,
  type KnowledgeSource,
} from "@/lib/knowledge-citations";

/**
 * Mobile port of the web app's KB answer chrome
 * (apps/web/src/components/ai-elements/sources.tsx + inline-citation.tsx):
 *
 * - `KnowledgeSourcesCard` — "Used N sources" collapsible under an agent
 *   reply, one tappable row per distinct cited document.
 * - `CitationDetailSheet` — the mobile stand-in for the web hover card:
 *   a bottom modal naming each passage's document, quoting it, and offering
 *   "Open document at page N".
 *
 * Opening is the caller's job (the thread screen owns the WebViewSheet).
 */

export function KnowledgeSourcesCard({
  sources,
  onOpenSource,
}: {
  sources: KnowledgeSource[];
  onOpenSource: (source: KnowledgeSource) => void;
}) {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const [open, setOpen] = useState(false);

  const rows = useMemo(
    () =>
      sources.map((source) => ({
        ...source,
        name: knowledgeDocumentFileName(source.key),
      })),
    [sources],
  );

  if (sources.length === 0) return null;

  return (
    <View className="mt-1.5">
      <Pressable
        onPress={() => setOpen((prev) => !prev)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        className="flex-row items-center gap-1 py-1 active:opacity-70"
      >
        <Text className="text-xs font-medium text-sky-600 dark:text-sky-400">
          Used {sources.length} {sources.length === 1 ? "source" : "sources"}
        </Text>
        <ChevronDown
          size={14}
          color={colors.mutedForeground}
          style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}
        />
      </Pressable>
      {open ? (
        <View className="gap-1">
          {rows.map((row) => (
            <Pressable
              key={row.key}
              onPress={() => onOpenSource(row)}
              accessibilityRole="button"
              className="flex-row items-center gap-1.5 py-1 active:opacity-70"
            >
              <BookOpen size={14} color={colors.mutedForeground} />
              <Text
                className="text-xs text-sky-600 dark:text-sky-400 shrink"
                numberOfLines={1}
              >
                {row.name}
              </Text>
              {row.page ? (
                <Text className="text-xs text-neutral-500 dark:text-neutral-400">
                  p.{row.page}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function CitationDetailSheet({
  citations,
  onClose,
  onOpenDocument,
}: {
  /** Citations to show, or null when the sheet is hidden. */
  citations: KnowledgeCitation[] | null;
  onClose: () => void;
  onOpenDocument: (citation: KnowledgeCitation) => void;
}) {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  // A floating dialog, not a bottom sheet: the citation is anchored to a
  // sentence mid-screen, so a centered card reads as "about that sentence"
  // while a slide-up sheet reads as a new surface. Fade, no slide.
  return (
    <Modal
      visible={!!citations && citations.length > 0}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        className="flex-1 items-center justify-center bg-black/60 px-6"
        onPress={onClose}
      >
        <Pressable
          onPress={() => {}}
          className="w-full max-w-md rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-5 py-4"
          style={{ maxHeight: "70%" }}
        >
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
              {citations && citations.length === 1 ? "Source" : "Sources"}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
              className="active:opacity-70"
            >
              <X size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <ScrollView>
            <View className="gap-5">
              {(citations ?? []).map((citation) => (
                <View key={citation.n} className="gap-1.5">
                  <View className="flex-row items-start gap-1.5">
                    <FileText size={14} color={colors.mutedForeground} />
                    <Text className="text-sm font-medium text-neutral-900 dark:text-neutral-100 shrink">
                      {citationLabel(citation)}
                    </Text>
                  </View>
                  {citation.quote ? (
                    <View className="border-l-2 border-neutral-300 dark:border-neutral-700 pl-2.5">
                      <Text className="text-sm text-neutral-600 dark:text-neutral-400">
                        {citation.quote}
                      </Text>
                    </View>
                  ) : null}
                  {citation.documentUrl ? (
                    <Pressable
                      onPress={() => onOpenDocument(citation)}
                      accessibilityRole="button"
                      className="active:opacity-70"
                    >
                      <Text className="text-sm font-medium text-sky-600 dark:text-sky-400">
                        Open document
                        {citation.page ? ` at page ${citation.page}` : ""}
                      </Text>
                    </Pressable>
                  ) : (
                    <Text className="text-xs text-neutral-500 dark:text-neutral-500">
                      Document not viewable from this citation
                    </Text>
                  )}
                </View>
              ))}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
