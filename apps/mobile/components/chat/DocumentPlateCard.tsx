import React, { useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, View } from "react-native";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "urql";
import { WebView } from "react-native-webview";
import { ChevronRight, FileText, X } from "lucide-react-native";
import { Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { DocumentArtifactRenderQuery } from "@/lib/graphql-queries";
import { withDocumentFrameEnvelope } from "@/lib/document-frame";
import { stripLeadingFrontmatter } from "../../lib/markdown-frontmatter";
import { MarkdownMessage } from "./MarkdownMessage";

interface DocumentPlateCardProps {
  artifactId: string;
  title: string;
  /** Plate/genre slug ("report", "qbr", …) shown as the type badge. */
  type?: string;
  status?: string;
  /** Markdown digest used as fallback when no compiled render exists. */
  fallbackContent?: string;
}

function plateTypeLabel(type: string | undefined): string {
  if (!type) return "Document";
  return type
    .split(/[-_\s]+/)
    .map((w) =>
      w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1),
    )
    .join(" ");
}

/**
 * In-thread card for document-kind artifacts (compiled HTML plates,
 * THINK-153). Mirrors web's compact ArtifactCard: a link-style row, no
 * inline body. Tapping opens the full-screen reader, which renders the
 * server-compiled house-style HTML in a scriptless WebView — the RN
 * analog of web's `sandbox=""` DocumentFrame iframe. `renderHtml` is an
 * S3-backed lazy field, so it's only fetched once the reader opens.
 */
export function DocumentPlateCard({
  artifactId,
  title,
  type,
  status,
  fallbackContent,
}: DocumentPlateCardProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const insets = useSafeAreaInsets();
  const [fullScreen, setFullScreen] = useState(false);
  const [opened, setOpened] = useState(false);

  const [{ data, fetching }] = useQuery({
    query: DocumentArtifactRenderQuery,
    variables: { id: artifactId },
    pause: !opened,
  });
  const renderHtml: string | null | undefined = (data as any)?.artifact
    ?.renderHtml;

  const srcHtml = useMemo(
    () =>
      renderHtml
        ? withDocumentFrameEnvelope(renderHtml, isDark ? "dark" : "light")
        : null,
    [renderHtml, isDark],
  );

  const webViewBackground = isDark ? "#0a0a0a" : "#ffffff";

  return (
    <>
      <Pressable
        onPress={() => {
          setOpened(true);
          setFullScreen(true);
        }}
        className="flex-row items-center gap-2 px-3 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 active:opacity-70"
      >
        <FileText
          size={14}
          className="text-neutral-500 dark:text-neutral-400"
        />
        <Text
          className="text-sm font-medium text-neutral-900 dark:text-neutral-100 flex-1"
          numberOfLines={1}
        >
          {title}
        </Text>
        <View className="bg-neutral-200 dark:bg-neutral-700 rounded px-1.5 py-0.5">
          <Text className="text-xs text-neutral-600 dark:text-neutral-300">
            {plateTypeLabel(type)}
          </Text>
        </View>
        {status === "draft" && (
          <View className="bg-amber-100 dark:bg-amber-900/30 rounded px-1.5 py-0.5">
            <Text className="text-xs text-amber-700 dark:text-amber-400">
              Draft
            </Text>
          </View>
        )}
        <ChevronRight size={16} color={colors.mutedForeground} />
      </Pressable>

      <Modal
        visible={fullScreen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setFullScreen(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: webViewBackground,
            paddingTop: insets.top,
          }}
        >
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
            <View className="flex-row items-center gap-2 flex-1 mr-2">
              <FileText size={16} color={colors.mutedForeground} />
              <Text
                className="text-sm text-neutral-500 dark:text-neutral-400 flex-1"
                numberOfLines={1}
              >
                {title}
              </Text>
            </View>
            <Pressable
              onPress={() => setFullScreen(false)}
              hitSlop={8}
              className="p-1 active:opacity-70"
            >
              <X size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>
          {srcHtml ? (
            // Scriptless by contract (document tier): JS off, and the frame
            // never navigates — compiled plates are self-contained HTML.
            <WebView
              source={{ html: srcHtml }}
              style={{ flex: 1, backgroundColor: webViewBackground }}
              javaScriptEnabled={false}
              originWhitelist={["about:*"]}
              onShouldStartLoadWithRequest={(req) =>
                req.url.startsWith("about:")
              }
              setSupportMultipleWindows={false}
              allowsLinkPreview={false}
            />
          ) : fetching ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="small" color={colors.mutedForeground} />
            </View>
          ) : fallbackContent ? (
            // No compiled render (older artifacts) — markdown digest fallback.
            <View className="flex-1 px-4 pt-3">
              <MarkdownMessage
                content={stripLeadingFrontmatter(fallbackContent)}
                isUser={false}
              />
            </View>
          ) : (
            <View className="flex-1 items-center justify-center">
              <Text size="sm" variant="muted">
                No preview available
              </Text>
            </View>
          )}
        </View>
      </Modal>
    </>
  );
}
