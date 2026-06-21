import { createHash } from "node:crypto";
import { isBuiltinToolSlug } from "../builtin-tool-slugs.js";
import {
  CATALOG_SKILL_ARCHIVE_LIMITS,
  type CatalogSkillArchiveError,
  type CatalogSkillArchiveFile,
  type ParseCatalogSkillArchiveResult,
  validateCatalogSkillFiles,
} from "../catalog-skill-archive.js";

export type SkillDraftFile = CatalogSkillArchiveFile;

export type ValidateSkillDraftFilesResult =
  | (Extract<ParseCatalogSkillArchiveResult, { ok: true }> & {
      currentContentHash: string;
    })
  | { ok: false; errors: CatalogSkillArchiveError[] };

const EDITABLE_DRAFT_STATUSES = new Set([
  "draft",
  "failed",
  "changes_requested",
]);

export function skillDraftPrefix(tenantSlug: string, draftId: string): string {
  return `tenants/${tenantSlug}/skill-drafts/${draftId}/`;
}

export function validateSkillDraftPath(
  path: string,
): { ok: true; path: string } | { ok: false; error: CatalogSkillArchiveError } {
  const clean = path.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = clean.split("/");
  if (
    !clean ||
    clean.length > CATALOG_SKILL_ARCHIVE_LIMITS.maxPathLength ||
    path.includes("\0") ||
    path.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    segments.some((segment) => segment.length === 0 || segment === "..") ||
    clean === ".DS_Store" ||
    clean.endsWith("/.DS_Store") ||
    clean === "__MACOSX" ||
    clean.startsWith("__MACOSX/")
  ) {
    return {
      ok: false,
      error: {
        code: "unsafe_path",
        message: `Invalid skill draft path '${path}'.`,
        path,
      },
    };
  }
  return { ok: true, path: clean };
}

export function isSkillDraftEditableStatus(status: string): boolean {
  return EDITABLE_DRAFT_STATUSES.has(status);
}

export function contentTypeForSkillDraftPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

export function computeSkillDraftContentHash(files: SkillDraftFile[]): string {
  const hash = createHash("sha256");
  for (const file of files
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path, "utf8");
    hash.update("\0");
    hash.update(createHash("sha256").update(file.content).digest("hex"));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

export function validateSkillDraftFiles(
  files: SkillDraftFile[],
): ValidateSkillDraftFilesResult {
  const parsed = validateCatalogSkillFiles(files);
  if (!parsed.ok) return parsed;
  if (isBuiltinToolSlug(parsed.slug)) {
    return {
      ok: false,
      errors: [
        {
          code: "invalid_slug",
          message: `Skill draft slug '${parsed.slug}' conflicts with a built-in tool slug.`,
          path: "SKILL.md",
          details: { slug: parsed.slug },
        },
      ],
    };
  }
  return {
    ...parsed,
    currentContentHash: computeSkillDraftContentHash(parsed.files),
  };
}
