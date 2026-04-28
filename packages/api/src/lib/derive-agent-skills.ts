/**
 * derive-agent-skills (Plan §008 U11).
 *
 * Recompute the `agent_skills` set for an agent from first-class workspace
 * skill folders. Presence of any path ending in
 * `skills/<slug>/SKILL.md` is the activation signal; AGENTS.md skill routing
 * rows are documentation only.
 *
 * **Direction inversion.** The Fat-folder world made workspace files the
 * canonical authoring surface and `agent_skills` a derived lookup. Skills are
 * now real workspace folders, so the file → DB direction derives directly
 * from the filesystem rather than from AGENTS.md tables.
 *
 * **What derive owns.** Set membership only — which slugs have rows. The
 * non-skill columns (`config`, `permissions`, `rate_limit_rpm`,
 * `model_override`, `enabled`) continue to be authored exclusively by
 * `setAgentSkills` until U21 reroutes them onto AGENTS.md row metadata.
 * Derive uses `onConflictDoNothing` to preserve those fields on rows that
 * already exist; it inserts new rows with schema defaults and deletes rows
 * whose slug no longer has a `SKILL.md` in the workspace tree.
 *
 * **Trigger.** `workspace-files.ts` `handlePut` / `handleDelete` (agent
 * branch) calls this function whenever a workspace skill `SKILL.md` marker
 * changes. Catalog installs call it directly because they bypass the
 * workspace-files Lambda.
 *
 * **No-op detection.** When the derived set already matches the existing
 * set (slugs only — column metadata is out of scope), this function returns
 * `{ changed: false, ... }` without opening a transaction. This breaks the
 * write → derive loop: the second derive sees no membership change and exits
 * cleanly.
 *
 * **Failure surface.** DB errors are re-thrown; the caller returns 500 to the
 * client. The S3 write has already succeeded at that point — that's
 * intentional. We don't have S3 versioning + atomic-rename to undo the file
 * write, so the contract is "workspace skill file is on disk; agent_skills is
 * stale; the next skill-file write retries derive."
 */

import { and, agents, agentSkills, db, eq, inArray } from "../graphql/utils.js";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { tenants } from "@thinkwork/database-pg/schema";

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
  /** Skill marker paths found in the workspace, in the order scanned. */
  agentsMdPathsScanned: string[];
  /** Per-file parser warnings (skipped reserved/invalid rows). */
  warnings: string[];
}

const SKILL_MD_PATH_RE = /(?:^|\/)skills\/([^/]+)\/SKILL\.md$/;

export interface DeriveOptions {
  /**
   * Override the workspace reader. Defaults to reading skill `SKILL.md` files
   * from the agent's S3 prefix. Tests inject a fake to avoid spinning S3 + DB
   * for the slug lookup.
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
    SKILL_MD_PATH_RE.test(rel),
  );

export async function deriveAgentSkills(
  ctx: ComposeContext,
  agentId: string,
  opts: DeriveOptions = {},
): Promise<DeriveResult> {
  const reader = opts.readAgentsMdFiles ?? _defaultAgentsMdReader;
  // Filter inside derive so an injected reader that returns the full
  // workspace tree (test fixtures often do) still ends up scanning only
  // workspace skill markers. The default reader pre-filters; this is a
  // no-op belt-and-suspenders in production.
  const skillEntries = (await reader(ctx.tenantId, agentId))
    .filter((entry) => SKILL_MD_PATH_RE.test(entry.path))
    .sort((a, b) => a.path.localeCompare(b.path));

  const agentsMdPathsScanned = skillEntries.map((e) => e.path);
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const entry of skillEntries) {
    const match = entry.path.match(SKILL_MD_PATH_RE);
    const slug = match?.[1];
    if (slug) seen.add(slug);
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
