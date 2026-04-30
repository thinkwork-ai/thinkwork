import React, { useMemo } from "react";
import { ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import Markdown from "react-native-markdown-display";
import { useColorScheme } from "nativewind";
import { DetailLayout } from "@/components/layout/detail-layout";
import { Muted, Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { getRememberedBrainMemoryHit } from "@/lib/brain-memory-detail-store";
import {
  buildBrainMarkdownStyles,
  displayBrainResultSnippet,
  looksLikeMarkdown,
} from "@/components/brain/resultDisplay";

export default function BrainMemoryDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const decodedId = id ? decodeURIComponent(id) : "";
  const hit = decodedId ? getRememberedBrainMemoryHit(decodedId) : undefined;
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const markdownStyles = useMemo(() => buildBrainMarkdownStyles(colors), [colors]);
  const content = hit ? displayBrainResultSnippet(hit, "MEMORY") : null;
  const sourceId = hit?.provenance.sourceId;

  return (
    <DetailLayout title={hit?.title || "Memory"}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 18, paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >
        {!hit || !content ? (
          <View className="items-center justify-center py-16 px-6">
            <Muted className="text-center">
              This memory result is no longer available. Run the Brain search again to reopen it.
            </Muted>
          </View>
        ) : (
          <View style={{ gap: 16 }}>
            <View style={{ gap: 6 }}>
              <Muted
                style={{
                  color: "#0ea5e9",
                  fontSize: 11,
                  fontWeight: "700",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                }}
              >
                Memory
              </Muted>
              {sourceId ? (
                <Muted style={{ fontSize: 12 }} selectable>
                  {sourceId}
                </Muted>
              ) : null}
            </View>

            {looksLikeMarkdown(content) ? (
              <Markdown style={markdownStyles}>{content}</Markdown>
            ) : (
              <Text
                style={{
                  color: colors.foreground,
                  fontSize: 15,
                  lineHeight: 22,
                }}
                selectable
              >
                {content}
              </Text>
            )}
          </View>
        )}
      </ScrollView>
    </DetailLayout>
  );
}
