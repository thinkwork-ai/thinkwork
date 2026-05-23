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

/**
 * Decide whether a move-completion event warrants a "lost template
 * inheritance" toast. The carve-out: single-file moves are silent (per
 * R20), but a folder move that detached one or more pinned files
 * surfaces the bulk consequence so the operator isn't surprised.
 *
 * Returns the toast string when both `movedCount > 1` and
 * `detachedPinnedCount > 0`; otherwise `null` (no toast).
 */
export function shouldEmitDetachToast(result: {
  movedCount: number;
  detachedPinnedCount: number;
}): string | null {
  if (result.movedCount <= 1) return null;
  if (result.detachedPinnedCount <= 0) return null;
  const fileWord = result.detachedPinnedCount === 1 ? "file" : "files";
  return `Moved ${result.movedCount} files. ${result.detachedPinnedCount} ${fileWord} lost template inheritance.`;
}

/**
 * Folder path of a file or folder. For files, returns the containing
 * folder ("notes/foo.md" → "notes"). For folders, returns the parent
 * folder ("notes/sub" → "notes"). Returns "" (root) when at top level.
 */
export function parentFolderOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}
