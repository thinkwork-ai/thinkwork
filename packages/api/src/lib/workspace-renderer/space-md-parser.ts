export type MentionableWorkspaces =
  | { mode: "all"; slugs: string[] }
  | { mode: "none"; slugs: string[] }
  | { mode: "allowlist"; slugs: string[] };

const MENTIONABLE_WORKSPACES_HEADING = /^##\s+Mentionable\s+Workspaces\s*$/i;

function normalizeSlug(line: string): string | null {
  const stripped = line.replace(/<!--.*?-->/g, "").trim();
  if (!stripped || stripped.startsWith("#")) return null;
  const normalized = stripped
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || null;
}

export function parseMentionableWorkspaces(
  spaceMdContent: string,
): MentionableWorkspaces {
  const lines = spaceMdContent.replace(/\r\n?/g, "\n").split("\n");
  const headingIndex = lines.findIndex((line) =>
    MENTIONABLE_WORKSPACES_HEADING.test(line.trim()),
  );
  if (headingIndex === -1) return { mode: "all", slugs: [] };

  const sectionEnd = lines.findIndex(
    (line, index) => index > headingIndex && /^##\s+/.test(line.trim()),
  );
  const sectionLines = lines.slice(
    headingIndex + 1,
    sectionEnd === -1 ? undefined : sectionEnd,
  );
  const fenceStart = sectionLines.findIndex((line) => /^```/.test(line.trim()));
  if (fenceStart === -1) return { mode: "none", slugs: [] };

  const fenceEnd = sectionLines.findIndex(
    (line, index) => index > fenceStart && /^```/.test(line.trim()),
  );
  const fencedLines = sectionLines.slice(
    fenceStart + 1,
    fenceEnd === -1 ? undefined : fenceEnd,
  );
  const slugs = Array.from(
    new Set(
      fencedLines
        .map(normalizeSlug)
        .filter((slug): slug is string => Boolean(slug)),
    ),
  ).sort();

  return slugs.length > 0
    ? { mode: "allowlist", slugs }
    : { mode: "none", slugs: [] };
}
