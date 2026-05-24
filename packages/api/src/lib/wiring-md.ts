import type { WiringSuggestion } from "../types/catalog-skill.js";

export type WiringMdWarning = {
  code: "missing_context_md" | "multiple_context_md" | "duplicate_id";
  message: string;
  title: string;
};

export type WiringMdParseResult = {
  suggestions: WiringSuggestion[];
  warnings: WiringMdWarning[];
};

export type RenderWiringMdOptions = {
  heading?: string;
};

type HeadingSection = {
  title: string;
  body: string;
};

type FenceBlock = {
  info: string;
  content: string;
  index: number;
};

const H2_RE = /^##(?!#)[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;
const FENCE_RE = /^```([^\n`]*)\n([\s\S]*?)^```[ \t]*$/gm;

export function parseWiringMd(markdown: string): WiringMdParseResult {
  const sections = splitH2Sections(markdown.replace(/\r\n?/g, "\n"));
  const suggestions: WiringSuggestion[] = [];
  const warnings: WiringMdWarning[] = [];
  const usedIds = new Map<string, number>();

  for (const section of sections) {
    const fences = findFenceBlocks(section.body);
    const contextFences = fences.filter(
      (fence) => fence.info.trim() === "context-md",
    );
    if (contextFences.length === 0) {
      warnings.push({
        code: "missing_context_md",
        title: section.title,
        message: `WIRING.md section "${section.title}" has no context-md fenced block.`,
      });
      continue;
    }
    if (contextFences.length > 1) {
      warnings.push({
        code: "multiple_context_md",
        title: section.title,
        message:
          `WIRING.md section "${section.title}" has multiple context-md ` +
          "fenced blocks; using the first.",
      });
    }

    const fence = contextFences[0]!;
    const baseId = slugifyWiringTitle(section.title);
    const id = nextUniqueId(baseId, usedIds);
    if (id !== baseId) {
      warnings.push({
        code: "duplicate_id",
        title: section.title,
        message:
          `WIRING.md section "${section.title}" produced duplicate id ` +
          `"${baseId}"; using "${id}".`,
      });
    }

    suggestions.push({
      id,
      title: section.title,
      description: section.body.slice(0, fence.index).trim(),
      snippet: fence.content,
    });
  }

  return { suggestions, warnings };
}

export function renderWiringMd(
  suggestions: WiringSuggestion[],
  options: RenderWiringMdOptions = {},
): string {
  const heading = options.heading ?? "Wiring suggestions";
  const blocks = suggestions.map((suggestion) => {
    const description = suggestion.description.trim();
    const descriptionBlock = description ? `${description}\n\n` : "";
    return `## ${suggestion.title}
${descriptionBlock}\`\`\`context-md
${ensureTrailingNewline(suggestion.snippet)}\`\`\``;
  });
  return `# ${heading}\n\n${blocks.join("\n\n")}\n`;
}

export function slugifyWiringTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug || "suggestion";
}

function splitH2Sections(markdown: string): HeadingSection[] {
  const matches = [...markdown.matchAll(H2_RE)];
  return matches.map((match, index) => {
    const title = match[1]!.trim();
    const bodyStart = match.index! + match[0].length;
    const bodyEnd =
      index + 1 < matches.length ? matches[index + 1]!.index! : markdown.length;
    return {
      title,
      body: markdown.slice(bodyStart, bodyEnd).replace(/^\n/, ""),
    };
  });
}

function findFenceBlocks(body: string): FenceBlock[] {
  return [...body.matchAll(FENCE_RE)].map((match) => ({
    info: match[1] ?? "",
    content: match[2] ?? "",
    index: match.index ?? 0,
  }));
}

function nextUniqueId(baseId: string, usedIds: Map<string, number>): string {
  const count = usedIds.get(baseId) ?? 0;
  usedIds.set(baseId, count + 1);
  return count === 0 ? baseId : `${baseId}-${count + 1}`;
}

function ensureTrailingNewline(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n");
  if (!normalized) return "";
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}
