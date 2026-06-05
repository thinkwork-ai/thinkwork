/**
 * Ephemeral force-pinned skills (plan 2026-06-04-004 U4).
 *
 * The composer slash-command lets an operator pin a skill onto a single message
 * — including a tenant-catalog skill the agent does not have installed. The Pi
 * runtime discovers installed skills ONLY from the synced workspace tree
 * (`workspace/skills/<slug>/SKILL.md`) and never consumed the invoke payload's
 * skills field. This module is that missing consumer: it reads the
 * `pinned_skills` payload branch, fetches each skill's SKILL.md straight from
 * the tenant catalog in S3 for THIS turn, and produces WorkspaceSkill records
 * that merge into the discovered set.
 *
 * Fetch-per-turn (never materialized to disk) makes pins ephemeral by
 * construction — no permanent install, no `derive-agent-skills` pollution, and
 * immune to the durable per-thread session workspace freeze.
 */

import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import {
  buildWorkspaceSkillFromContent,
  type WorkspaceSkill,
} from "./workspace-skills.js";

export interface PinnedSkillRef {
  skillId: string;
  /** Catalog folder key, e.g. `tenants/<slug>/skill-catalog/<skillId>`. */
  s3Key: string;
}

type PinnedSkillLog = (event: string, fields: Record<string, unknown>) => void;

/** Slug shape guard — rejects path traversal / unexpected keys defensively. */
const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * Parse the `pinned_skills` payload field into validated refs. Tolerates a
 * missing/invalid value (returns []). Drops entries with a malformed slug or a
 * catalog key that does not match the slug — defense in depth against a forged
 * payload pointing the fetch at an arbitrary object.
 */
export function parsePinnedSkillRefs(value: unknown): PinnedSkillRef[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const refs: PinnedSkillRef[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const skillId = (entry as { skillId?: unknown }).skillId;
    const s3Key = (entry as { s3Key?: unknown }).s3Key;
    if (typeof skillId !== "string" || typeof s3Key !== "string") continue;
    const slug = skillId.trim();
    if (!slug || !SLUG_RE.test(slug)) continue;
    // The catalog key must end at the skill's own folder — never trust a key
    // that points somewhere other than this slug's catalog directory.
    if (!s3Key.endsWith(`/skill-catalog/${slug}`)) continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    refs.push({ skillId: slug, s3Key });
  }
  return refs;
}

async function fetchSkillMd(
  s3: S3Client,
  bucket: string,
  s3Key: string,
): Promise<string> {
  const resp = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: `${s3Key}/SKILL.md` }),
  );
  const text = await resp.Body?.transformToString();
  return text ?? "";
}

/**
 * Fetch each pinned skill's SKILL.md from the tenant catalog and build
 * WorkspaceSkill records. A fetch failure for one pin is logged and skipped —
 * one missing catalog skill must not fail the whole turn.
 */
export async function loadPinnedSkills(input: {
  refs: PinnedSkillRef[];
  bucket: string;
  s3: S3Client;
  log?: PinnedSkillLog;
}): Promise<WorkspaceSkill[]> {
  const out: WorkspaceSkill[] = [];
  for (const ref of input.refs) {
    try {
      const content = await fetchSkillMd(input.s3, input.bucket, ref.s3Key);
      if (!content.trim()) {
        input.log?.("pinned_skill_empty", { skillId: ref.skillId });
        continue;
      }
      out.push(buildWorkspaceSkillFromContent(ref.skillId, content));
    } catch (err) {
      input.log?.("pinned_skill_fetch_failed", {
        skillId: ref.skillId,
        s3Key: ref.s3Key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

/**
 * Merge discovered workspace skills with pinned skills. Discovered (installed)
 * skills win on slug collision — their workspace copy is authoritative — but the
 * pinned slug is still returned in `emphasizedSlugs` so the system prompt
 * emphasizes it regardless of installed state.
 */
export function mergeWorkspaceSkills(
  discovered: WorkspaceSkill[],
  pinned: WorkspaceSkill[],
): { skills: WorkspaceSkill[]; emphasizedSlugs: Set<string> } {
  const emphasizedSlugs = new Set(pinned.map((s) => s.slug));
  const present = new Set(discovered.map((s) => s.slug));
  const merged = [
    ...discovered,
    ...pinned.filter((p) => !present.has(p.slug)),
  ].sort((a, b) => a.slug.localeCompare(b.slug));
  return { skills: merged, emphasizedSlugs };
}
