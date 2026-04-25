/**
 * Vendor folder-bundle path normalization (Plan 2026-04-24-008 U14).
 *
 * ThinkWork stores Fat sub-agents at FOG-pure folder paths. Imports from
 * ecosystem-specific layouts are normalized at the boundary:
 *
 *   .claude/agents/expenses/CONTEXT.md -> expenses/CONTEXT.md
 *   .claude/skills/foo/SKILL.md        -> skills/foo/SKILL.md
 *   .codex/agents/expenses/CONTEXT.md  -> expenses/CONTEXT.md
 *   .gemini/agents/expenses/CONTEXT.md -> expenses/CONTEXT.md
 *
 * Unknown vendor prefixes pass through unchanged.
 */

export type FileTree = Record<string, string>;

export interface NormalizedPath {
  originalPath: string;
  normalizedPath: string;
  vendorPrefixed: boolean;
}

export interface PathCollision {
  normalizedPath: string;
  sourcePaths: string[];
}

interface Rule {
  from: RegExp;
  to: (match: RegExpMatchArray) => string;
}

const RULES: Rule[] = [
  {
    from: /^\.claude\/agents\/(.+)$/,
    to: (match) => match[1] ?? "",
  },
  {
    from: /^\.claude\/skills\/(.+)$/,
    to: (match) => `skills/${match[1] ?? ""}`,
  },
  {
    from: /^\.codex\/agents\/(.+)$/,
    to: (match) => match[1] ?? "",
  },
  {
    from: /^\.gemini\/agents\/(.+)$/,
    to: (match) => match[1] ?? "",
  },
];

export function normalizePath(path: string): string {
  return normalizePathWithMetadata(path).normalizedPath;
}

export function normalizePathWithMetadata(path: string): NormalizedPath {
  const canonical = canonicalizePath(path);
  for (const rule of RULES) {
    const match = canonical.match(rule.from);
    if (match) {
      return {
        originalPath: path,
        normalizedPath: canonicalizePath(rule.to(match)),
        vendorPrefixed: true,
      };
    }
  }
  return {
    originalPath: path,
    normalizedPath: canonical,
    vendorPrefixed: false,
  };
}

export function normalizeTree(tree: FileTree): FileTree {
  const out: FileTree = {};
  const metadataByTarget = new Map<string, NormalizedPath>();

  for (const [path, content] of Object.entries(tree)) {
    const normalized = normalizePathWithMetadata(path);
    const existing = metadataByTarget.get(normalized.normalizedPath);
    if (!existing) {
      metadataByTarget.set(normalized.normalizedPath, normalized);
      out[normalized.normalizedPath] = content;
      continue;
    }

    // If a vendor-prefixed path and a plain path collide, the explicit
    // vendor path wins per the plan's FITA compatibility decision.
    if (normalized.vendorPrefixed && !existing.vendorPrefixed) {
      metadataByTarget.set(normalized.normalizedPath, normalized);
      out[normalized.normalizedPath] = content;
    }
  }

  return out;
}

export function collisionCheck(tree: FileTree): PathCollision[] {
  const sourcesByTarget = new Map<string, string[]>();
  for (const path of Object.keys(tree)) {
    const normalized = normalizePath(path);
    const paths = sourcesByTarget.get(normalized) ?? [];
    paths.push(path);
    sourcesByTarget.set(normalized, paths);
  }
  return Array.from(sourcesByTarget.entries())
    .filter(([, sourcePaths]) => sourcePaths.length > 1)
    .map(([normalizedPath, sourcePaths]) => ({
      normalizedPath,
      sourcePaths,
    }));
}

function canonicalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}
