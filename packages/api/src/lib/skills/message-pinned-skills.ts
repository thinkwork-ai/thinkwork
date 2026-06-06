/**
 * Per-message pinned (force-pinned) skills — resolved from a USER message's
 * `messages.metadata.skills` (plan 2026-06-04-004 U2). The composer slash-command
 * writes `metadata.skills = [{ slug }]`; the dispatch path reads it here and
 * forwards the slugs to chat-agent-invoke, which turns them into an ephemeral
 * `pinned_skills` payload branch for the Pi runtime (U3/U4).
 *
 * Pins are additive (the agent keeps its normal skills) and per-message — there
 * is no persistence beyond the single turn. Slugs are validated and capped here;
 * the authoritative blocklist guardrail (`filterBlockedSkills`) is applied at the
 * runtime-dispatch boundary where the agent's resolved `blocked_tools` is known.
 *
 * Mirrors the message-attachment resolution in
 * `thread-attachments/message-attachment-refs.ts`.
 */

import { and, eq } from "drizzle-orm";
import { messages } from "@thinkwork/database-pg/schema";

/** Hard cap on pinned skills per message — bounds payload + system-prompt growth. */
export const MAX_PINNED_SKILLS = 10;

/** Skill slug shape (folder name under skill-catalog/). Case-insensitive. */
const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/i;

function parseJsonRecord(value: unknown): Record<string, unknown> {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return {};
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return v as Record<string, unknown>;
}

/**
 * Parse pinned skill slugs from a message's `metadata.skills`, tolerating both
 * jsonb (object) and text (stringified JSON) column shapes and both entry
 * shapes (`"slug"` or `{ slug }`). Deduped, validated, and capped at
 * MAX_PINNED_SKILLS. Slug case is preserved — the catalog s3Key is built from
 * the exact slug downstream.
 */
export function parsePinnedSkillSlugs(metadata: unknown): string[] {
  const record = parseJsonRecord(metadata);
  const raw = Array.isArray(record.skills) ? record.skills : [];
  const seen = new Set<string>();
  const slugs: string[] = [];
  for (const entry of raw) {
    const candidate =
      typeof entry === "string"
        ? entry
        : typeof (entry as { slug?: unknown })?.slug === "string"
          ? (entry as { slug: string }).slug
          : null;
    if (!candidate) continue;
    const slug = candidate.trim();
    if (!slug || !SLUG_RE.test(slug)) continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
    if (slugs.length >= MAX_PINNED_SKILLS) break;
  }
  return slugs;
}

/**
 * Resolve pinned skill slugs a USER message references via
 * `messages.metadata.skills`, for the direct chat-agent-invoke dispatch path.
 * Returns an empty array when the message has no pins.
 */
export async function resolveDispatchPinnedSkills(input: {
  db: any;
  tenantId: string;
  threadId: string;
  messageId: string;
}): Promise<string[]> {
  const [message] = await input.db
    .select({ metadata: messages.metadata })
    .from(messages)
    .where(
      and(
        eq(messages.tenant_id, input.tenantId),
        eq(messages.thread_id, input.threadId),
        eq(messages.id, input.messageId),
      ),
    )
    .limit(1);
  return parsePinnedSkillSlugs(message?.metadata);
}

/**
 * Drop pinned slugs the agent's admin has blocked (KD4 — operator pin does not
 * override an admin guardrail). The authoritative enforcement point: applied
 * where the resolved `blocked_tools` list is available (chat-agent-invoke and
 * the wakeup processor), so bypassing the picker cannot pin a blocked skill.
 */
export function filterBlockedSkills(
  slugs: string[],
  blockedTools: string[] | null | undefined,
): string[] {
  if (!blockedTools || blockedTools.length === 0) return slugs;
  const blocked = new Set(blockedTools);
  return slugs.filter((slug) => !blocked.has(slug));
}

/** Ephemeral pinned-skill config branch forwarded to the runtime as `pinned_skills`. */
export interface PinnedSkillConfig {
  skillId: string;
  s3Key: string;
}

/**
 * Build the ephemeral `pinned_skills` config branch (plan 2026-06-04-004 U3):
 * map each pinned slug to its tenant catalog s3Key, dedupe, and drop any the
 * tool policy disallows. `isAllowed` is the SAME guardrail installed skills
 * pass through, so an operator pin can never override an admin blocklist (KD4).
 * Returns [] when the tenant slug is missing (no catalog path can be built).
 */
export function buildPinnedSkillConfigs(input: {
  slugs: string[];
  tenantSlug: string;
  catalogS3Key: (tenantSlug: string, slug: string) => string;
  isAllowed?: (config: PinnedSkillConfig) => boolean;
}): PinnedSkillConfig[] {
  if (!input.tenantSlug) return [];
  const seen = new Set<string>();
  const configs: PinnedSkillConfig[] = [];
  for (const slug of input.slugs) {
    if (seen.has(slug)) continue;
    seen.add(slug);
    const config: PinnedSkillConfig = {
      skillId: slug,
      s3Key: input.catalogS3Key(input.tenantSlug, slug),
    };
    if (input.isAllowed && !input.isAllowed(config)) continue;
    configs.push(config);
  }
  return configs;
}
