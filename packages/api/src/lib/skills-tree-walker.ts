export interface WorkspaceSkillInfo {
  slug: string;
  name: string;
  description: string;
  skillPath: string;
  scopePath: string | null;
  scopeLabel: string;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function frontmatterValue(source: string, key: string): string | undefined {
  if (!source.startsWith("---\n")) return undefined;
  const end = source.indexOf("\n---", 4);
  if (end === -1) return undefined;
  const frontmatter = source.slice(4, end);
  const lines = frontmatter.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match?.[1] !== key) continue;
    const raw = match[2] ?? "";
    const trimmed = raw.trim();
    if (trimmed.startsWith(">") || trimmed.startsWith("|")) {
      const blockLines: string[] = [];
      for (
        let blockIndex = index + 1;
        blockIndex < lines.length;
        blockIndex += 1
      ) {
        const blockLine = lines[blockIndex] ?? "";
        if (blockLine.trim() !== "" && !/^\s/.test(blockLine)) break;
        blockLines.push(blockLine.replace(/^\s{1,}/, ""));
      }
      return trimmed.startsWith("|")
        ? blockLines.join("\n").trim()
        : blockLines
            .map((blockLine) => blockLine.trim())
            .filter(Boolean)
            .join(" ");
    }
    return unquote(raw);
  }
  return undefined;
}

function titleizeSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseSkillPath(path: string): {
  slug: string;
  scopePath: string | null;
  scopeLabel: string;
} | null {
  const match = path.match(/^(?:(.+)\/)?skills\/([^/]+)\/SKILL\.md$/);
  if (!match) return null;
  const scopePath = match[1] ?? null;
  const slug = match[2] ?? "";
  if (!slug) return null;
  return {
    slug,
    scopePath,
    scopeLabel: scopePath ? `${scopePath}/` : "baseline",
  };
}

export async function discoverWorkspaceSkillsFromPaths(
  workspaceObjectPaths: string[],
  readText: (path: string) => Promise<string | null>,
): Promise<WorkspaceSkillInfo[]> {
  const skillPaths = workspaceObjectPaths
    .filter((path) => parseSkillPath(path) !== null)
    .sort((a, b) => a.localeCompare(b));
  const byPath = new Map<string, WorkspaceSkillInfo>();

  for (const skillPath of skillPaths) {
    const parsed = parseSkillPath(skillPath);
    if (!parsed || byPath.has(skillPath)) continue;
    const content = await readText(skillPath);
    if (!content) continue;
    byPath.set(skillPath, {
      slug: parsed.slug,
      name:
        frontmatterValue(content, "display_name") ??
        frontmatterValue(content, "name") ??
        titleizeSlug(parsed.slug),
      description: frontmatterValue(content, "description") ?? "",
      skillPath,
      scopePath: parsed.scopePath,
      scopeLabel: parsed.scopeLabel,
    });
  }

  return [...byPath.values()].sort((a, b) => {
    const scopeCompare = a.scopeLabel.localeCompare(b.scopeLabel);
    if (scopeCompare !== 0) return scopeCompare;
    return a.slug.localeCompare(b.slug);
  });
}
