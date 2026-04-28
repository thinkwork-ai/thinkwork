/**
 * derive-agent-skills (Plan §008 U11).
 *
 * Recompute the `agent_skills` set for an agent from its composed workspace
 * tree. The composed-tree AGENTS.md routing rows are the source of truth for
 * which skills the agent can use; this function unions every folder's
 * `Skills` cells, dedups by slug, and reconciles the `agent_skills` table to
 * match.
 *
 * **Direction inversion.** Today `agent_skills` is written by the
 * `setAgentSkills` GraphQL mutation and `regenerateWorkspaceMap` reads it to
 * render root AGENTS.md. The Fat-folder world (master plan §008) inverts
 * this: AGENTS.md is the canonical authoring surface and `agent_skills`
 * becomes a fast lookup derived from it. This module is the file → DB
 * direction.
 *
 * **What derive owns.** Set membership only — which slugs have rows. The
 * non-skill columns (`config`, `permissions`, `rate_limit_rpm`,
 * `model_override`, `enabled`) continue to be authored exclusively by
 * `setAgentSkills` until U21 reroutes them onto AGENTS.md row metadata.
 * Derive uses `onConflictDoNothing` to preserve those fields on rows that
 * already exist; it inserts new rows with schema defaults and deletes rows
 * whose slug no longer appears in any composed AGENTS.md.
 *
 * **Trigger.** `workspace-files.ts` `handlePut` (agent branch) calls this
 * function whenever the written path is `AGENTS.md` or
 * `<folder>/AGENTS.md`. The composer cache is invalidated immediately
 * before this call so the composed-tree read sees the just-written content.
 *
 * **No-op detection.** When the derived set already matches the existing
 * set (slugs only — column metadata is out of scope), this function returns
 * `{ changed: false, ... }` without opening a transaction. This breaks the
 * `setAgentSkills` → `regenerateWorkspaceMap` → AGENTS.md put → derive
 * loop: the second derive sees no membership change and exits cleanly.
 *
 * **Failure surface.** Parser errors are re-thrown with the file path
 * prefixed; the caller (handlePut) returns 500 to the client. The S3 put
 * has already succeeded at that point — that's intentional. We don't have
 * S3 versioning + atomic-rename to undo the file write, so the contract is
 * "AGENTS.md is on disk; agent_skills is stale; the next AGENTS.md write
 * retries derive." The handler error message communicates this.
 */

import { and, agents, agentSkills, db, eq, inArray } from "../graphql/utils.js";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { tenants } from "@thinkwork/database-pg/schema";
import { parseAgentsMd } from "./agents-md-parser.js";

// Replaces the workspace-overlay composer's read-time list+read.
// Per docs/plans/2026-04-27-003: the agent prefix is the source of
// truth; we list it and GET the files we need directly.
export interface ComposeContext {
  tenantId: string;
}

interface AgentPrefixFile {
  path: string;
  content: string;
}

const _s3 = new S3Client({
  region:
    process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
});

async function _readAgentPrefixFiles(
  tenantId: string,
  agentId: string,
  matcher: (relPath: string) => boolean,
): Promise<AgentPrefixFile[]> {
  const bucket = process.env.WORKSPACE_BUCKET;
  if (!bucket) throw new Error("WORKSPACE_BUCKET not configured");

  const [agent] = await db
    .select({ slug: agents.slug, tenant_id: agents.tenant_id })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.tenant_id, tenantId)));
  if (!agent?.slug) {
    throw new Error(`Agent ${agentId} not found in tenant ${tenantId}`);
  }
  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, agent.tenant_id));
  if (!tenant?.slug) throw new Error(`Tenant ${agent.tenant_id} has no slug`);

  const prefix = `tenants/${tenant.slug}/agents/${agent.slug}/workspace/`;
  const out: AgentPrefixFile[] = [];
  let continuationToken: string | undefined;
  do {
    const resp = await _s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of resp.Contents ?? []) {
      if (!obj.Key) continue;
      const rel = obj.Key.slice(prefix.length);
      if (!rel || rel === "manifest.json" || rel === "_defaults_version") {
        continue;
      }
      if (!matcher(rel)) continue;
      const get = await _s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: obj.Key }),
      );
      const content = (await get.Body?.transformToString("utf-8")) ?? "";
      out.push({ path: rel, content });
    }
    continuationToken = resp.IsTruncated
      ? resp.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return out;
}

export interface DeriveResult {
  /**
   * True iff the derived skill *set membership* differed from the existing
   * set and the DB was written. `addedSlugs` reflects set-membership
   * changes — not row creation count: derive uses `onConflictDoNothing`,
   * so a slug that already had a row keeps its existing metadata and is
   * NOT counted as added on subsequent calls.
   */
  changed: boolean;
  /** Slugs newly added to the membership set (sorted alphabetically). */
  addedSlugs: string[];
  /** Slugs removed from the membership set (sorted alphabetically). */
  removedSlugs: string[];
  /** AGENTS.md paths the composer surfaced, in the order they were scanned. */
  agentsMdPathsScanned: string[];
  /** Per-file parser warnings (skipped reserved/invalid rows). */
  warnings: string[];
}

const AGENTS_MD_PATH_RE = /(?:^|\/)AGENTS\.md$/;

export interface DeriveOptions {
  /**
   * Override the AGENTS.md reader. Defaults to reading from the agent's
   * S3 prefix per docs/plans/2026-04-27-003. Tests inject a fake to
   * avoid spinning S3 + DB for the slug lookup.
   */
  readAgentsMdFiles?: (
    tenantId: string,
    agentId: string,
  ) => Promise<AgentPrefixFile[]>;
}

const _defaultAgentsMdReader = (
  tenantId: string,
  agentId: string,
): Promise<AgentPrefixFile[]> =>
  _readAgentPrefixFiles(tenantId, agentId, (rel) =>
    AGENTS_MD_PATH_RE.test(rel),
  );

export async function deriveAgentSkills(
  ctx: ComposeContext,
  agentId: string,
  opts: DeriveOptions = {},
): Promise<DeriveResult> {
  const reader = opts.readAgentsMdFiles ?? _defaultAgentsMdReader;
  // Filter inside derive so an injected reader that returns the full
  // workspace tree (test fixtures often do) still ends up scanning only
  // AGENTS.md files. The default reader pre-filters; this is a no-op
  // belt-and-suspenders in production.
  const agentsMdEntries = (await reader(ctx.tenantId, agentId))
    .filter((entry) => AGENTS_MD_PATH_RE.test(entry.path))
    .sort((a, b) => a.path.localeCompare(b.path));

  const agentsMdPathsScanned = agentsMdEntries.map((e) => e.path);
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const entry of agentsMdEntries) {
    let parsed;
    try {
      parsed = parseAgentsMd(entry.content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`AGENTS.md parse failed at ${entry.path}: ${msg}`);
    }

    for (const w of parsed.warnings) {
      warnings.push(`${entry.path}: ${w}`);
    }

    for (const row of parsed.routing) {
      for (const slug of row.skills) {
        if (slug.length === 0) continue;
        seen.add(slug);
      }
    }
  }

  const derivedSlugs = Array.from(seen).sort();

  const existingRows = await db
    .select({ skill_id: agentSkills.skill_id })
    .from(agentSkills)
    .where(eq(agentSkills.agent_id, agentId));
  const existingSlugs = existingRows.map((r) => r.skill_id).sort();

  const derivedSet = new Set(derivedSlugs);
  const existingSet = new Set(existingSlugs);
  const addedSlugs = derivedSlugs.filter((s) => !existingSet.has(s));
  const removedSlugs = existingSlugs.filter((s) => !derivedSet.has(s));

  if (addedSlugs.length === 0 && removedSlugs.length === 0) {
    return {
      changed: false,
      addedSlugs: [],
      removedSlugs: [],
      agentsMdPathsScanned,
      warnings,
    };
  }

  const [agent] = await db
    .select({ tenant_id: agents.tenant_id })
    .from(agents)
    .where(eq(agents.id, agentId));
  if (!agent) {
    throw new Error(`Agent ${agentId} not found`);
  }

  await db.transaction(async (tx) => {
    // Insert new slugs only — onConflictDoNothing preserves the
    // permissions/config/rate_limit_rpm/model_override/enabled columns
    // on rows that already exist (those rows are owned by
    // setAgentSkills until U21).
    if (addedSlugs.length > 0) {
      await tx
        .insert(agentSkills)
        .values(
          addedSlugs.map((slug) => ({
            agent_id: agentId,
            tenant_id: agent.tenant_id,
            skill_id: slug,
          })),
        )
        .onConflictDoNothing({
          target: [agentSkills.agent_id, agentSkills.skill_id],
        });
    }

    if (removedSlugs.length > 0) {
      await tx
        .delete(agentSkills)
        .where(
          and(
            eq(agentSkills.agent_id, agentId),
            inArray(agentSkills.skill_id, removedSlugs),
          ),
        );
    }
  });

  return {
    changed: true,
    addedSlugs,
    removedSlugs,
    agentsMdPathsScanned,
    warnings,
  };
}
