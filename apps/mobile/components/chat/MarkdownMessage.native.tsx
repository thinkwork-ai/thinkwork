import React from "react";
import { Linking } from "react-native";
import { useColorScheme } from "nativewind";
import Markdown from "react-native-markdown-display";

type MarkdownMessageProps = {
  content: string;
  isUser: boolean;
  onLinkPress?: (url: string) => void;
};

const baseTextColor = "#171717";
const baseTextColorDark = "#d4d4d4";

export function MarkdownMessage({ content, isUser, onLinkPress: onLinkPressProp }: MarkdownMessageProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const textColor = isUser ? (isDark ? "#171717" : "#ffffff") : isDark ? baseTextColorDark : baseTextColor;
  const mutedTextColor = isUser ? (isDark ? "#374151" : "#f3f4f6") : isDark ? "#d1d5db" : "#1f2937";
  const codeBg = isUser
    ? "rgba(255,255,255,0.12)"
    : isDark
      ? "rgba(255,255,255,0.10)"
      : "#cfd4dc";
  // Guard: never use pure white backgrounds in dark mode markdown surfaces.
  const blockCodeBg = isUser ? "rgba(255,255,255,0.12)" : isDark ? "rgba(255,255,255,0.08)" : "#f5f5f5";
  const blockquoteBg = isUser ? "rgba(255,255,255,0.12)" : isDark ? "rgba(255,255,255,0.08)" : "#f3f4f6";
  const blockquoteBorder = isUser ? "rgba(255,255,255,0.32)" : isDark ? "rgba(255,255,255,0.24)" : "#d1d5db";

  return (
    <Markdown
      onLinkPress={(url) => {
        if (onLinkPressProp) {
          onLinkPressProp(url);
        } else {
          Linking.openURL(url).catch(() => null);
        }
        return false;
      }}

      style={{
        body: {
          color: textColor,
          fontSize: 15,
          lineHeight: 20,
        },
        heading1: { color: textColor, fontSize: 24, lineHeight: 30, marginTop: 2, marginBottom: 8, fontWeight: "700" },
        heading2: { color: textColor, fontSize: 20, lineHeight: 26, marginTop: 2, marginBottom: 8, fontWeight: "700" },
        heading3: { color: textColor, fontSize: 18, lineHeight: 24, marginTop: 2, marginBottom: 6, fontWeight: "600" },
        heading4: { color: textColor, fontSize: 16, lineHeight: 22, marginTop: 2, marginBottom: 6, fontWeight: "600" },
        heading5: { color: textColor, fontSize: 15, lineHeight: 22, marginTop: 2, marginBottom: 6, fontWeight: "600" },
        heading6: { color: textColor, fontSize: 14, lineHeight: 20, marginTop: 2, marginBottom: 6, fontWeight: "600" },
        paragraph: { color: textColor, fontSize: 16, lineHeight: 21, marginTop: 0, marginBottom: 0 },
        strong: { color: textColor, fontWeight: "700" },
        em: { color: textColor, fontStyle: "italic" },
        bullet_list: { marginTop: 0, marginBottom: 4 },
        ordered_list: { marginTop: 0, marginBottom: 4 },
        list_item: { color: textColor, marginBottom: 2 },
        link: { color: isUser ? "#fed7aa" : "#2563eb", textDecorationLine: "underline" },
        code_inline: {
          color: mutedTextColor,
          backgroundColor: codeBg,
          fontFamily: "Menlo",
          fontSize: 13,
        },
        fence: {
          color: textColor,
          backgroundColor: blockCodeBg,
          borderRadius: 8,
          padding: 10,
          marginTop: 2,
          marginBottom: 6,
          fontFamily: "Menlo",
          fontSize: 13,
          lineHeight: 18,
        },
        code_block: {
          color: textColor,
          backgroundColor: blockCodeBg,
          borderRadius: 8,
          padding: 10,
          marginTop: 2,
          marginBottom: 6,
          fontFamily: "Menlo",
          fontSize: 13,
          lineHeight: 18,
        },
        blockquote: {
          backgroundColor: blockquoteBg,
          borderLeftColor: blockquoteBorder,
          borderLeftWidth: 3,
          borderRadius: 8,
          paddingVertical: 8,
          paddingHorizontal: 12,
          marginTop: 4,
          marginBottom: 8,
        },
        blockquote_content: {
          color: textColor,
          fontSize: 15,
          lineHeight: 20,
        },
        table: {
          borderWidth: 1,
          borderColor: isDark ? "rgba(255,255,255,0.12)" : "#e5e5e5",
          borderRadius: 6,
          marginTop: 4,
          marginBottom: 8,
        },
        thead: {
          backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#f5f5f5",
        },
        th: {
          color: textColor,
          fontSize: 12,
          fontWeight: "600",
          padding: 6,
          borderBottomWidth: 1,
          borderColor: isDark ? "rgba(255,255,255,0.12)" : "#e5e5e5",
        },
        td: {
          color: textColor,
          fontSize: 13,
          padding: 6,
          borderBottomWidth: 0.5,
          borderColor: isDark ? "rgba(255,255,255,0.08)" : "#f0f0f0",
        },
        tr: {
          borderBottomWidth: 0.5,
          borderColor: isDark ? "rgba(255,255,255,0.08)" : "#f0f0f0",
        },
      }}
    >
      {content}
    </Markdown>
  );
}
