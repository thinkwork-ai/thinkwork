import { useMemo, useState } from "react";
import { View, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "urql";
import { useColorScheme } from "nativewind";
import { WebView } from "react-native-webview";
import { DetailLayout } from "@/components/layout/detail-layout";
import { MarkdownMessage } from "@/components/chat/MarkdownMessage";
import { stripLeadingFrontmatter } from "../../lib/markdown-frontmatter";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { ArtifactDetailQuery } from "@/lib/graphql-queries";
import {
  isDocumentArtifactMetadata,
  withDocumentFrameEnvelope,
} from "@/lib/document-frame";

const TYPE_LABELS: Record<string, string> = {
  DATA_VIEW: "Data View",
  NOTE: "Note",
  REPORT: "Report",
  PLAN: "Plan",
  DRAFT: "Draft",
  DIGEST: "Digest",
};

export default function ArtifactViewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const [{ data, fetching }] = useQuery({
    query: ArtifactDetailQuery,
    variables: { id: id! },
    pause: !id,
  });

  const [plateReady, setPlateReady] = useState(false);

  const artifact = (data as any)?.artifact;
  const title = artifact?.title ?? "Artifact";
  const typeLabel = TYPE_LABELS[artifact?.type] ?? artifact?.type ?? "";

  // Document-kind artifacts (compiled HTML plates) render the server-built
  // house-style HTML in a scriptless WebView — the RN analog of web's
  // sandboxed DocumentFrame iframe — instead of the markdown digest.
  const isDark = colorScheme === "dark";
  const plateHtml = useMemo(
    () =>
      artifact?.renderHtml && isDocumentArtifactMetadata(artifact.metadata)
        ? withDocumentFrameEnvelope(
            artifact.renderHtml,
            isDark ? "dark" : "light",
          )
        : null,
    [artifact, isDark],
  );

  return (
    <DetailLayout title={title}>
      {fetching ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : !artifact ? (
        <View className="flex-1 items-center justify-center">
          <Muted>Artifact not found.</Muted>
        </View>
      ) : plateHtml ? (
        <View
          style={{ flex: 1, backgroundColor: isDark ? "#0a0a0a" : "#ffffff" }}
        >
          {!plateReady && (
            <View className="absolute inset-0 items-center justify-center z-10">
              <ActivityIndicator size="small" color={colors.mutedForeground} />
            </View>
          )}
          {/* Hidden until onLoadEnd: WKWebView's first paint reflows once
              layout settles (title flashes at the top, then jumps into
              place) — only show the settled document. */}
          <WebView
            source={{ html: plateHtml }}
            style={{
              flex: 1,
              backgroundColor: isDark ? "#0a0a0a" : "#ffffff",
              opacity: plateReady ? 1 : 0,
            }}
            onLoadEnd={() => setPlateReady(true)}
            javaScriptEnabled={false}
            originWhitelist={["about:*"]}
            onShouldStartLoadWithRequest={(req) => req.url.startsWith("about:")}
            setSupportMultipleWindows={false}
            allowsLinkPreview={false}
          />
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-4 pt-3 pb-8"
        >
          <View className="flex-row items-center gap-2 mb-3">
            {typeLabel ? (
              <View className="bg-neutral-200 dark:bg-neutral-700 rounded px-2 py-0.5">
                <Text className="text-xs text-neutral-600 dark:text-neutral-300">
                  {typeLabel}
                </Text>
              </View>
            ) : null}
            {artifact.status?.toLowerCase() === "draft" && (
              <View className="bg-amber-100 dark:bg-amber-900/30 rounded px-2 py-0.5">
                <Text className="text-xs text-amber-700 dark:text-amber-400">
                  Draft
                </Text>
              </View>
            )}
          </View>
          <MarkdownMessage
            content={stripLeadingFrontmatter(
              artifact.content || artifact.summary || "No content available.",
            )}
            isUser={false}
          />
        </ScrollView>
      )}
    </DetailLayout>
  );
}
