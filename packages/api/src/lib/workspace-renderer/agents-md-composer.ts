import type { MentionableWorkspaces } from "./space-md-parser.js";

export const ACTIVE_SPACE_MARKER = "<!-- RENDERED:ACTIVE_SPACE -->";

const RESERVED_TOP_LEVEL_FOLDERS = new Set([
  "events",
  "memory",
  "review",
  "skills",
  "space",
  "spaces",
  "workspaces",
]);

export interface ComposeAgentsMdInput {
  baseline: string;
  mentionableWorkspaces?: MentionableWorkspaces;
  spaceSlug: string;
  spaceName: string;
  isDefaultSpace: boolean;
  renderedAt: Date;
  topLevelSpaceMdPath: string;
  activeSpaceMdPath: string;
  provenanceSpaceMdPath: string;
  userMdPath?: string | null;
}

function workspaceIsMentionable(
  slug: string | null,
  mentionable: MentionableWorkspaces,
): boolean {
  if (mentionable.mode === "all") return true;
  if (!slug) return false;
  if (mentionable.mode === "none") return false;
  return mentionable.slugs.includes(slug);
}

function workspaceSlugFromPath(path: string): string | null {
  const trimmed = path
    .replace(/[`*_]/g, "")
    .trim()
    .replace(/^\.?\//, "")
    .replace(/\/$/, "");
  if (!trimmed) return null;
  const segments = trimmed.split("/").filter(Boolean);
  if (segments[0] === "workspaces") return segments[1] ?? null;
  const candidate = segments[0] ?? null;
  return candidate && !RESERVED_TOP_LEVEL_FOLDERS.has(candidate)
    ? candidate
    : null;
}

function splitMarkdownTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function isMarkdownTableSeparator(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function filterRoutingTable(
  markdown: string,
  mentionable: MentionableWorkspaces,
): string {
  const lines = markdown.split("\n");
  const routingHeadingIndex = lines.findIndex((line) =>
    /^##\s+Routing(\s+Table)?\s*$/i.test(line.trim()),
  );
  if (routingHeadingIndex === -1) return markdown;

  let tableStart = -1;
  for (let index = routingHeadingIndex + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index]?.trim() ?? "")) break;
    if ((lines[index]?.trim() ?? "").startsWith("|")) {
      tableStart = index;
      break;
    }
  }
  if (tableStart === -1) return markdown;

  let tableEnd = tableStart;
  while (
    tableEnd < lines.length &&
    (lines[tableEnd]?.trim() ?? "").startsWith("|")
  ) {
    tableEnd += 1;
  }

  const tableLines = lines.slice(tableStart, tableEnd);
  const filtered = tableLines.filter((line, index) => {
    const cells = splitMarkdownTableRow(line);
    if (!cells) return true;
    if (index === 0 || isMarkdownTableSeparator(cells)) return true;
    return workspaceIsMentionable(
      workspaceSlugFromPath(cells[1] ?? ""),
      mentionable,
    );
  });

  return [...lines.slice(0, tableStart), ...filtered, ...lines.slice(tableEnd)]
    .join("\n")
    .trimEnd();
}

function workspaceSlugFromFolderLine(line: string): string | null {
  const direct = line.match(/(?:^|[\s`])workspaces\/([a-z0-9][a-z0-9-]*)\//i);
  if (direct?.[1]) return direct[1].toLowerCase();
  if (!/[├└│]/.test(line)) return null;

  const tree = line.match(/(?:^|[├└│\s-])(?:──\s*)?([a-z0-9][a-z0-9-]*)\//i);
  const candidate = tree?.[1]?.toLowerCase() ?? null;
  return candidate && !RESERVED_TOP_LEVEL_FOLDERS.has(candidate)
    ? candidate
    : null;
}

function filterFolderStructure(
  markdown: string,
  mentionable: MentionableWorkspaces,
): string {
  const lines = markdown.split("\n");
  const headingIndex = lines.findIndex((line) =>
    /^##\s+Folder\s+Structure\s*$/i.test(line.trim()),
  );
  if (headingIndex === -1) return markdown;

  const nextHeadingIndex = lines.findIndex(
    (line, index) => index > headingIndex && /^##\s+/.test(line.trim()),
  );
  const endIndex = nextHeadingIndex === -1 ? lines.length : nextHeadingIndex;
  const filteredSection = lines
    .slice(headingIndex, endIndex)
    .filter((line) =>
      workspaceIsMentionable(workspaceSlugFromFolderLine(line), mentionable),
    );

  return [
    ...lines.slice(0, headingIndex),
    ...filteredSection,
    ...lines.slice(endIndex),
  ]
    .join("\n")
    .trimEnd();
}

export function filterAgentsMdMentionableWorkspaces(
  markdown: string,
  mentionable: MentionableWorkspaces = { mode: "all", slugs: [] },
): string {
  if (mentionable.mode === "all") return markdown.trimEnd();
  return filterFolderStructure(
    filterRoutingTable(markdown, mentionable),
    mentionable,
  );
}

export function composeAgentsMd(input: ComposeAgentsMdInput): string {
  const baseline = filterAgentsMdMentionableWorkspaces(
    input.baseline,
    input.mentionableWorkspaces,
  );
  const section = [
    ACTIVE_SPACE_MARKER,
    "",
    "## Active Space",
    "",
    `- **Name:** ${input.spaceName}`,
    `- **Slug:** ${input.spaceSlug}`,
    `- **Rendered at:** ${input.renderedAt.toISOString()}`,
    `- **Space file:** ${input.topLevelSpaceMdPath}`,
    `- **Active Space folder:** ${input.activeSpaceMdPath}`,
    `- **Provenance source:** ${input.provenanceSpaceMdPath}`,
    input.userMdPath ? `- **User file:** ${input.userMdPath}` : null,
    input.isDefaultSpace
      ? "- **Default Space:** yes; use user-scoped context as the primary long-term memory boundary."
      : "- **Default Space:** no; prefer Space-scoped context for this turn unless a tool explicitly requests user scope.",
    "",
    "Read the top-level SPACE.md before relying on Space-specific assumptions. Active Space files live under space/; the spaces/<slug>/ copy preserves authored-source provenance during the transition.",
  ].filter((line): line is string => line !== null);

  const renderedSection = `${section.join("\n")}\n`;
  if (baseline.includes(ACTIVE_SPACE_MARKER)) {
    return `${baseline.slice(0, baseline.indexOf(ACTIVE_SPACE_MARKER)).trimEnd()}\n\n${renderedSection}`;
  }
  return `${baseline.trimEnd()}\n\n${renderedSection}`;
}
