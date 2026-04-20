import { useEffect, useRef } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import Markdown from "react-native-markdown-display";
import { useRouter } from "expo-router";
import { useWikiPage, type WikiPageType } from "@thinkwork/react-native-sdk";
import { COLORS } from "@/lib/theme";

/**
 * Minimal node descriptor the detail sheet needs. The richer page body
 * (sections, summary) comes from `useWikiPage` once a node is selected;
 * this prop only carries what's needed to fire that fetch + render the
 * header label/badge.
 */
export interface NodeDetailSheetTarget {
  id: string;
  type: WikiPageType;
  slug: string;
  title: string;
}

interface NodeDetailSheetProps {
  tenantId: string | null;
  ownerId: string | null;
  node: NodeDetailSheetTarget | null;
  onClose: () => void;
  onFocusHere: (pageId: string) => void;
}

const SNAP_POINTS = ["55%", "90%"];

export function NodeDetailSheet({
  tenantId,
  ownerId,
  node,
  onClose,
  onFocusHere,
}: NodeDetailSheetProps) {
  const sheetRef = useRef<BottomSheetModal>(null);
  const router = useRouter();

  useEffect(() => {
    if (node) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [node]);

  const { page, loading } = useWikiPage({
    tenantId,
    ownerId,
    type: (node?.type as WikiPageType | undefined) ?? null,
    slug: node?.slug ?? null,
  });

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={SNAP_POINTS}
      onDismiss={onClose}
      backgroundStyle={styles.bg}
      handleIndicatorStyle={styles.handle}
      backdropComponent={(props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop
          {...props}
          appearsOnIndex={0}
          disappearsOnIndex={-1}
          opacity={0.6}
        />
      )}
    >
      <BottomSheetScrollView contentContainerStyle={styles.body}>
        {node ? (
          <>
            <View style={styles.headerRow}>
              <View style={styles.titleColumn}>
                <Text style={styles.kind}>{node.type}</Text>
                <Text style={styles.title}>{node.title}</Text>
              </View>
            </View>

            {loading && !page ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={COLORS.dark.mutedForeground} />
              </View>
            ) : null}

            {page?.summary ? (
              <Text style={styles.summary}>{page.summary}</Text>
            ) : null}

            {page?.sections?.length
              ? page.sections.map((section) => (
                  <View key={section.id} style={styles.section}>
                    <Text style={styles.sectionHeading}>{section.heading}</Text>
                    <Markdown style={markdownStyles}>{section.bodyMd}</Markdown>
                  </View>
                ))
              : null}

            <View style={styles.actionsRow}>
              <Pressable
                onPress={() => onFocusHere(node.id)}
                style={({ pressed }) => [
                  styles.actionBtn,
                  pressed && styles.actionBtnPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Focus graph here"
              >
                <Text style={styles.actionBtnText}>Focus here</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const lower = node.type.toLowerCase();
                  router.push(
                    ownerId
                      ? `/wiki/${lower}/${node.slug}?agentId=${encodeURIComponent(ownerId)}`
                      : `/wiki/${lower}/${node.slug}`,
                  );
                }}
                style={({ pressed }) => [
                  styles.actionBtn,
                  styles.actionBtnPrimary,
                  pressed && styles.actionBtnPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="View full page"
              >
                <Text
                  style={[styles.actionBtnText, styles.actionBtnTextPrimary]}
                >
                  View full page
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  bg: { backgroundColor: COLORS.dark.card },
  handle: { backgroundColor: COLORS.dark.mutedForeground },
  body: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  titleColumn: { flex: 1, minWidth: 0 },
  kind: {
    color: COLORS.dark.mutedForeground,
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  title: {
    color: COLORS.dark.foreground,
    fontSize: 20,
    fontWeight: "700",
    marginTop: 2,
  },
  summary: {
    color: COLORS.dark.foreground,
    fontSize: 14,
    marginTop: 12,
    lineHeight: 20,
  },
  loadingRow: { paddingVertical: 16, alignItems: "center" },
  section: { marginTop: 16 },
  sectionHeading: {
    color: COLORS.dark.foreground,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  actionsRow: { flexDirection: "row", gap: 12, marginTop: 24 },
  actionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: COLORS.dark.secondary,
  },
  actionBtnPrimary: { backgroundColor: COLORS.dark.primary },
  actionBtnPressed: { opacity: 0.7 },
  actionBtnText: {
    color: COLORS.dark.foreground,
    fontSize: 14,
    fontWeight: "600",
  },
  actionBtnTextPrimary: { color: COLORS.dark.primaryForeground },
});

const markdownStyles = {
  body: { color: COLORS.dark.foreground, fontSize: 14, lineHeight: 20 },
  paragraph: { color: COLORS.dark.foreground, fontSize: 14, marginVertical: 4 },
  heading1: { color: COLORS.dark.foreground, fontSize: 18, fontWeight: "700" as const, marginTop: 8 },
  heading2: { color: COLORS.dark.foreground, fontSize: 16, fontWeight: "700" as const, marginTop: 8 },
  heading3: { color: COLORS.dark.foreground, fontSize: 14, fontWeight: "600" as const, marginTop: 8 },
  link: { color: COLORS.dark.primary },
  code_inline: { color: COLORS.dark.foreground, backgroundColor: COLORS.dark.secondary, borderRadius: 4, paddingHorizontal: 4 },
};
