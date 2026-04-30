import React from "react";
import { Pressable, View } from "react-native";
import Markdown from "react-native-markdown-display";
import {
  Bot,
  BookOpen,
  ChevronRight,
  Database,
  FileSearch,
  Globe2,
  Search,
  type LucideIcon,
} from "lucide-react-native";
import { Muted, Text } from "@/components/ui/typography";
import type {
  ContextEngineHit,
  ContextProviderFamily,
  ContextSourceFamily,
} from "@thinkwork/react-native-sdk";
import type { COLORS } from "@/lib/theme";
import {
  displayBrainResultSnippet,
  isBrainMemoryHit,
  looksLikeMarkdown,
} from "./resultDisplay";

const FAMILY_CONFIG: Record<
  ContextProviderFamily | ContextSourceFamily,
  { label: string; icon: LucideIcon; bg: string; fg: string }
> = {
  brain: {
    label: "BRAIN",
    icon: Database,
    bg: "rgba(14,165,233,0.15)",
    fg: "#0ea5e9",
  },
  pages: {
    label: "PAGES",
    icon: BookOpen,
    bg: "rgba(139,92,246,0.15)",
    fg: "#8b5cf6",
  },
  web: {
    label: "WEB",
    icon: Globe2,
    bg: "rgba(20,184,166,0.15)",
    fg: "#14b8a6",
  },
  "source-agent": {
    label: "AGENT",
    icon: Bot,
    bg: "rgba(236,72,153,0.15)",
    fg: "#ec4899",
  },
  memory: {
    label: "MEMORY",
    icon: Database,
    bg: "rgba(14,165,233,0.15)",
    fg: "#0ea5e9",
  },
  wiki: {
    label: "BRAIN",
    icon: BookOpen,
    bg: "rgba(139,92,246,0.15)",
    fg: "#8b5cf6",
  },
  workspace: {
    label: "WORKSPACE",
    icon: FileSearch,
    bg: "rgba(34,197,94,0.15)",
    fg: "#22c55e",
  },
  "knowledge-base": {
    label: "KB",
    icon: Search,
    bg: "rgba(245,158,11,0.15)",
    fg: "#f59e0b",
  },
  mcp: {
    label: "SOURCE",
    icon: Globe2,
    bg: "rgba(20,184,166,0.15)",
    fg: "#14b8a6",
  },
  "sub-agent": {
    label: "AGENT",
    icon: Bot,
    bg: "rgba(236,72,153,0.15)",
    fg: "#ec4899",
  },
};

interface BrainResultRowProps {
  hit: ContextEngineHit;
  colors: (typeof COLORS)["dark"];
  onPress?: (hit: ContextEngineHit) => void;
}

function displayProvenance(hit: ContextEngineHit): string {
  const label = hit.provenance.label || hit.providerId;
  if (label.startsWith("Wiki ")) {
    return `Page ${label.slice("Wiki ".length)}`;
  }
  if (label === "Wiki") {
    return "Page";
  }
  return label;
}

export function BrainResultRow({ hit, colors, onPress }: BrainResultRowProps) {
  const isMemory = isBrainMemoryHit(hit);
  const type = isMemory
    ? FAMILY_CONFIG.memory
    : FAMILY_CONFIG[hit.sourceFamily ?? hit.family];
  const Icon = type.icon;
  const provenance = displayProvenance(hit);
  const snippet = displayBrainResultSnippet(hit, type.label);
  const renderSnippetAsMarkdown =
    snippet && isMemory && looksLikeMarkdown(snippet);

  return (
    <Pressable
      onPress={onPress ? () => onPress(hit) : undefined}
      className="flex-row items-start py-2 pr-4 active:bg-neutral-50 dark:active:bg-neutral-900"
      style={{ backgroundColor: colors.background }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", width: 56 }}>
        <View style={{ width: 16 }} />
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: type.bg,
            borderWidth: 0.25,
            borderColor: type.fg,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon size={20} color={type.fg} />
        </View>
      </View>

      <View className="flex-1 ml-3">
        <View className="flex-row items-center justify-between">
          <Text
            className="text-xs font-mono"
            style={{ lineHeight: 14, color: type.fg }}
          >
            {type.label}
          </Text>
          <View className="flex-row items-center gap-1">
            <Muted className="text-xs" numberOfLines={1}>
              {provenance}
            </Muted>
            {onPress ? (
              <ChevronRight size={14} color={colors.mutedForeground} />
            ) : null}
          </View>
        </View>
        <Text
          className="text-base"
          style={{ lineHeight: 20, marginTop: -1, marginBottom: 2 }}
          numberOfLines={1}
        >
          {hit.title}
        </Text>
        {snippet ? (
          renderSnippetAsMarkdown ? (
            <View style={{ maxHeight: 40, overflow: "hidden", marginTop: 1 }}>
              <Markdown
                style={{
                  body: {
                    color: colors.mutedForeground,
                    fontSize: 14,
                    lineHeight: 18,
                  },
                  heading1: {
                    color: colors.mutedForeground,
                    fontSize: 14,
                    lineHeight: 18,
                    marginTop: 0,
                    marginBottom: 0,
                    fontWeight: "600",
                  },
                  heading2: {
                    color: colors.mutedForeground,
                    fontSize: 14,
                    lineHeight: 18,
                    marginTop: 0,
                    marginBottom: 0,
                    fontWeight: "600",
                  },
                  heading3: {
                    color: colors.mutedForeground,
                    fontSize: 14,
                    lineHeight: 18,
                    marginTop: 0,
                    marginBottom: 0,
                    fontWeight: "600",
                  },
                  paragraph: {
                    color: colors.mutedForeground,
                    fontSize: 14,
                    lineHeight: 18,
                    marginTop: 0,
                    marginBottom: 0,
                  },
                  strong: {
                    color: colors.mutedForeground,
                    fontWeight: "700",
                  },
                  em: {
                    color: colors.mutedForeground,
                    fontStyle: "italic",
                  },
                  bullet_list: {
                    marginTop: 0,
                    marginBottom: 0,
                  },
                  ordered_list: {
                    marginTop: 0,
                    marginBottom: 0,
                  },
                  list_item: {
                    color: colors.mutedForeground,
                    marginTop: 0,
                    marginBottom: 0,
                  },
                  bullet_list_icon: {
                    color: colors.mutedForeground,
                  },
                  code_inline: {
                    color: colors.mutedForeground,
                    backgroundColor: "transparent",
                    fontSize: 13,
                  },
                }}
              >
                {snippet}
              </Markdown>
            </View>
          ) : (
            <Muted style={{ fontSize: 14, lineHeight: 18 }} numberOfLines={2}>
              {snippet}
            </Muted>
          )
        ) : null}
      </View>
    </Pressable>
  );
}
