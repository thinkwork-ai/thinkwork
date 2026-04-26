export function normalizeFolderPath(path: string): string {
  return path.split("/").filter(Boolean).join("/");
}

export function pathIsWithinFolder(path: string, folderPath: string): boolean {
  const folder = normalizeFolderPath(folderPath);
  if (!folder) return false;
  return path === folder || path.startsWith(`${folder}/`);
}

export function filesForFolderDelete(
  files: string[],
  folderPath: string,
): string[] {
  const folder = normalizeFolderPath(folderPath);
  if (!folder) return [];
  return files
    .filter((path) => path.startsWith(`${folder}/`))
    .sort((a, b) => a.localeCompare(b));
}

const RESERVED_SUB_AGENT_SLUGS = new Set(["memory", "skills"]);
const SUB_AGENT_SLUG_RE = /^[a-z][a-z0-9-]{0,31}$/;

export interface SubAgentSlugValidationResult {
  valid: boolean;
  slug: string;
  error?: string;
}

export function topLevelFolders(files: string[]): Set<string> {
  return new Set(
    files
      .filter((path) => path.includes("/"))
      .map((path) => path.split("/")[0])
      .filter((segment): segment is string => Boolean(segment)),
  );
}

export function validateSubAgentSlug(
  value: string,
  files: string[],
): SubAgentSlugValidationResult {
  const slug = value.trim();
  if (!slug) {
    return { valid: false, slug, error: "Enter a slug." };
  }
  if (!SUB_AGENT_SLUG_RE.test(slug)) {
    return {
      valid: false,
      slug,
      error:
        "Slug must start with lowercase letter and contain only a-z, 0-9, and hyphens.",
    };
  }
  if (RESERVED_SUB_AGENT_SLUGS.has(slug)) {
    return {
      valid: false,
      slug,
      error: `\`${slug}\` is a reserved folder name.`,
    };
  }
  if (topLevelFolders(files).has(slug)) {
    return {
      valid: false,
      slug,
      error: `A folder named \`${slug}\` already exists at this agent's root.`,
    };
  }
  return { valid: true, slug };
}
