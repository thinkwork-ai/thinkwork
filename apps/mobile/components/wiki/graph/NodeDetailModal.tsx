import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Markdown from "react-native-markdown-display";
import { IconExternalLink, IconX } from "@tabler/icons-react-native";
import { useWikiPage, type WikiPageType } from "@thinkwork/react-native-sdk";
import { COLORS } from "@/lib/theme";

export interface NodeDetailModalTarget {
  id: string;
  type: WikiPageType;
  slug: string;
  title: string;
}

interface NodeDetailModalProps {
  tenantId: string | null;
  ownerId: string | null;
  node: NodeDetailModalTarget | null;
  onClose: () => void;
  onOpenFullPage: (node: NodeDetailModalTarget) => void;
}

/**
 * Center-screen modal that shows the tapped node's wiki body in a
 * scrollable card. Nodes in the graph have no labels, so this is the
 * fast preview before a user commits to the full detail page via the
 * external-link icon in the header.
 */
export function NodeDetailModal({
  tenantId,
  ownerId,
  node,
  onClose,
  onOpenFullPage,
}: NodeDetailModalProps) {
  const { page, loading } = useWikiPage({
    tenantId,
    ownerId,
    type: (node?.type as WikiPageType | undefined) ?? null,
    slug: node?.slug ?? null,
  });

  return (
    <Modal
      visible={!!node}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close detail"
        />
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.titleColumn}>
              {node ? <Text style={styles.kind}>{node.type}</Text> : null}
              {node ? (
                <Text style={styles.title} numberOfLines={2}>
                  {node.title}
                </Text>
              ) : null}
            </View>
            <View style={styles.headerActions}>
              <Pressable
                onPress={() => {
                  if (node) onOpenFullPage(node);
                }}
                style={styles.iconBtn}
                accessibilityRole="button"
                accessibilityLabel="Open full page"
                hitSlop={8}
              >
                <IconExternalLink
                  size={20}
                  color={COLORS.dark.foreground}
                  strokeWidth={2}
                />
              </Pressable>
              <Pressable
                onPress={onClose}
                style={styles.iconBtn}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={8}
              >
                <IconX size={20} color={COLORS.dark.foreground} strokeWidth={2} />
              </Pressable>
            </View>
          </View>
          <View style={styles.bodyWrap}>
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            {loading && !page ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={COLORS.dark.mutedForeground} />
              </View>
            ) : null}
            {page?.summary ? (
              <Text style={styles.summary}>{page.summary}</Text>
            ) : null}
            {page?.sections?.map((section) => (
              <View key={section.id} style={styles.section}>
                <Text style={styles.sectionHeading}>{section.heading}</Text>
                <Markdown style={markdownStyles}>{section.bodyMd}</Markdown>
              </View>
            ))}
            {!loading && page && !page.summary && !page.sections?.length ? (
              <Text style={styles.empty}>This page has no content yet.</Text>
            ) : null}
            {!loading && !page ? (
              <Text style={styles.empty}>
                Couldn't load this page. Tap the open-page icon for the full view.
              </Text>
            ) : null}
          </ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  card: {
    width: "100%",
    height: "50%",
    backgroundColor: COLORS.dark.card,
    borderRadius: 16,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.dark.border,
  },
  titleColumn: { flex: 1, minWidth: 0, gap: 4 },
  headerActions: { flexDirection: "row", gap: 4 },
  iconBtn: { padding: 6 },
  kind: {
    color: COLORS.dark.mutedForeground,
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  title: {
    color: COLORS.dark.foreground,
    fontSize: 18,
    fontWeight: "700",
  },
  bodyWrap: { flex: 1, minHeight: 0 },
  body: { flex: 1 },
  bodyContent: { padding: 20, paddingBottom: 28 },
  loadingRow: { paddingVertical: 8, alignItems: "center" },
  summary: {
    color: COLORS.dark.foreground,
    fontSize: 14,
    lineHeight: 20,
  },
  section: { marginTop: 16, gap: 6 },
  sectionHeading: {
    color: COLORS.dark.foreground,
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  empty: {
    color: COLORS.dark.mutedForeground,
    fontSize: 13,
    fontStyle: "italic",
  },
});

const markdownStyles = {
  body: { color: COLORS.dark.foreground, fontSize: 14, lineHeight: 20 },
  paragraph: { color: COLORS.dark.foreground, fontSize: 14, marginVertical: 4 },
  heading1: { color: COLORS.dark.foreground, fontSize: 18, fontWeight: "700" as const, marginTop: 8 },
  heading2: { color: COLORS.dark.foreground, fontSize: 16, fontWeight: "700" as const, marginTop: 8 },
  heading3: { color: COLORS.dark.foreground, fontSize: 14, fontWeight: "600" as const, marginTop: 8 },
  link: { color: COLORS.dark.primary },
  code_inline: {
    color: COLORS.dark.foreground,
    backgroundColor: COLORS.dark.secondary,
    borderRadius: 4,
    paddingHorizontal: 4,
  },
  bullet_list: { marginVertical: 4 },
  list_item: { color: COLORS.dark.foreground, fontSize: 14, lineHeight: 20 },
};
