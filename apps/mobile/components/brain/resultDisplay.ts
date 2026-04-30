import type { ContextEngineHit } from "@thinkwork/react-native-sdk";
import type { COLORS } from "@/lib/theme";

export function isBrainMemoryHit(hit: ContextEngineHit): boolean {
  const family = hit.sourceFamily ?? hit.family;
  const providerId = hit.providerId?.toLowerCase() ?? "";
  const provenanceLabel = hit.provenance?.label?.toLowerCase() ?? "";

  return (
    family === "memory" ||
    providerId === "memory" ||
    providerId === "hindsight" ||
    provenanceLabel === "memory" ||
    provenanceLabel.includes("hindsight")
  );
}

export function looksLikeMarkdown(value: string): boolean {
  return (
    /(^|\n)\s{0,3}#{1,6}\s/.test(value) ||
    /(^|\n)\s*[-*]\s+/.test(value) ||
    /\*\*[^*]+\*\*/.test(value)
  );
}

function stringFromRecord(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["answer", "text", "summary", "content"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return null;
}

function decodeJsonStringContent(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\");
}

export function displayBrainResultSnippet(
  hit: ContextEngineHit,
  label: string,
): string | null {
  if (!hit.snippet) {
    return null;
  }

  if (label !== "MEMORY") {
    return hit.snippet;
  }

  const trimmed = hit.snippet.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const parsedText = stringFromRecord(parsed);
    if (parsedText) {
      return parsedText;
    }
  } catch {
    // Some reflected memories arrive as object-shaped text with smart quotes.
  }

  const answerMatch = trimmed.match(
    /[{"“]\s*answer\s*["”]?\s*:\s*["“]([\s\S]*?)["”]\s*[,}]/i,
  );
  if (answerMatch?.[1]) {
    return decodeJsonStringContent(answerMatch[1]);
  }

  return hit.snippet;
}

export function buildBrainMarkdownStyles(colors: (typeof COLORS)["dark"]) {
  return {
    body: { color: colors.foreground, fontSize: 15, lineHeight: 22 },
    heading1: {
      color: colors.foreground,
      fontSize: 22,
      fontWeight: "700",
      marginTop: 8,
    },
    heading2: {
      color: colors.foreground,
      fontSize: 18,
      fontWeight: "600",
      marginTop: 6,
    },
    heading3: {
      color: colors.foreground,
      fontSize: 16,
      fontWeight: "600",
      marginTop: 4,
    },
    paragraph: {
      color: colors.foreground,
      fontSize: 15,
      lineHeight: 22,
      marginTop: 0,
      marginBottom: 8,
    },
    strong: { color: colors.foreground, fontWeight: "600" },
    em: { fontStyle: "italic" },
    link: { color: colors.primary, textDecorationLine: "underline" },
    bullet_list: { marginVertical: 4 },
    ordered_list: { marginVertical: 4 },
    list_item: { color: colors.foreground, fontSize: 15, lineHeight: 22 },
    code_inline: {
      backgroundColor: colors.secondary,
      color: colors.foreground,
      paddingHorizontal: 4,
      borderRadius: 4,
      fontSize: 14,
    },
    fence: {
      backgroundColor: colors.secondary,
      color: colors.foreground,
      padding: 12,
      borderRadius: 8,
      fontSize: 13,
    },
    blockquote: {
      backgroundColor: colors.secondary,
      borderLeftWidth: 3,
      borderLeftColor: colors.border,
      paddingLeft: 12,
      paddingVertical: 6,
      marginVertical: 4,
    },
    hr: { backgroundColor: colors.border, height: 1, marginVertical: 12 },
  } as const;
}
