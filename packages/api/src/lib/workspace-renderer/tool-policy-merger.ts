export interface ParsedPolicyFile {
  body: string;
  adds: string[];
  restricts: string[];
}

export interface MergePolicyFileInput {
  baseline?: string | null;
  space?: string | null;
  spaceSlug: string;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  ).sort();
}

function parseInlineList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
  return trimmed
    .slice(1, -1)
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function parseFrontmatterList(frontmatter: string, key: string): string[] {
  const lines = frontmatter.split("\n");
  const values: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const inline = line.match(new RegExp(`^${key}:\\s*(.*)$`));
    if (!inline) continue;
    const remainder = inline[1]?.trim() ?? "";
    values.push(...parseInlineList(remainder));
    if (remainder) continue;
    for (let child = index + 1; child < lines.length; child += 1) {
      const childLine = lines[child] ?? "";
      if (/^\S/.test(childLine)) break;
      const item = childLine.match(/^\s*-\s*(.+)$/);
      if (item?.[1]) values.push(item[1].trim().replace(/^["']|["']$/g, ""));
    }
  }
  return uniqueSorted(values);
}

export function parsePolicyFile(markdown?: string | null): ParsedPolicyFile {
  if (!markdown) return { body: "", adds: [], restricts: [] };
  if (!markdown.startsWith("---\n")) {
    return { body: markdown.trimEnd(), adds: [], restricts: [] };
  }
  const end = markdown.indexOf("\n---", 4);
  if (end < 0) return { body: markdown.trimEnd(), adds: [], restricts: [] };
  const frontmatter = markdown.slice(4, end);
  const body = markdown
    .slice(end + 4)
    .replace(/^\n/, "")
    .trimEnd();
  return {
    body,
    adds: parseFrontmatterList(frontmatter, "adds"),
    restricts: parseFrontmatterList(frontmatter, "restricts"),
  };
}

export function mergePolicyFile(input: MergePolicyFileInput): string | null {
  const baseline = parsePolicyFile(input.baseline);
  const space = parsePolicyFile(input.space);
  if (
    !baseline.body &&
    !space.body &&
    space.adds.length === 0 &&
    space.restricts.length === 0
  ) {
    return null;
  }

  const lines: string[] = [];
  if (baseline.body) {
    lines.push(baseline.body);
  }
  if (space.body) {
    if (lines.length > 0) lines.push("");
    lines.push(`<!-- from: space:${input.spaceSlug} -->`);
    lines.push(space.body);
  }

  const adds = uniqueSorted([...baseline.adds, ...space.adds]);
  const restricts = uniqueSorted([...baseline.restricts, ...space.restricts]);
  if (adds.length > 0 || restricts.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("## Rendered Tool Policy");
    if (adds.length > 0) {
      lines.push("");
      lines.push("### Added");
      for (const tool of adds) lines.push(`- ${tool}`);
    }
    if (restricts.length > 0) {
      lines.push("");
      lines.push("### Restricted");
      for (const tool of restricts) lines.push(`- ${tool}`);
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
