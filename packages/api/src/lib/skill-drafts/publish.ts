import type { CatalogSkillArchiveError } from "../catalog-skill-archive.js";
import {
  computeSkillDraftContentHash,
  type SkillDraftFile,
  validateSkillDraftFiles,
} from "./files.js";

export type SkillDraftPublishReadiness =
  | { ok: true; slug: string; contentHash: string; files: SkillDraftFile[] }
  | {
      ok: false;
      code:
        | "invalid_skill_draft"
        | "trust_not_ready"
        | "stale_trust_result"
        | "skill_exists";
      message: string;
      errors?: CatalogSkillArchiveError[];
      slug?: string;
      contentHash?: string;
    };

export interface PrepareSkillDraftPublishInput {
  files: SkillDraftFile[];
  trustContentHash?: string | null;
  trustReady?: boolean;
  existingCatalogSlug?: string | null;
  confirmReplace?: boolean;
}

export function prepareSkillDraftPublish(
  input: PrepareSkillDraftPublishInput,
): SkillDraftPublishReadiness {
  const validated = validateSkillDraftFiles(input.files);
  if (!validated.ok) {
    return {
      ok: false,
      code: "invalid_skill_draft",
      message: "Skill draft files are not a valid Agent Skills directory.",
      errors: validated.errors,
    };
  }

  const contentHash = computeSkillDraftContentHash(validated.files);
  if (!input.trustReady) {
    return {
      ok: false,
      code: "trust_not_ready",
      message: "Skill draft cannot be published until trust checks pass.",
      slug: validated.slug,
      contentHash,
    };
  }
  if (input.trustContentHash && input.trustContentHash !== contentHash) {
    return {
      ok: false,
      code: "stale_trust_result",
      message:
        "Skill draft content changed after trust checks ran; rerun trust checks before publishing.",
      slug: validated.slug,
      contentHash,
    };
  }
  if (
    input.existingCatalogSlug === validated.slug &&
    input.confirmReplace !== true
  ) {
    return {
      ok: false,
      code: "skill_exists",
      message: `Catalog skill '${validated.slug}' already exists.`,
      slug: validated.slug,
      contentHash,
    };
  }

  return {
    ok: true,
    slug: validated.slug,
    contentHash,
    files: validated.files,
  };
}
