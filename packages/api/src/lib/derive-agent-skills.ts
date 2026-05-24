/**
 * derive-agent-skills compatibility sync.
 *
 * Runtime activation now walks `skills/<slug>/SKILL.md` directly from the
 * workspace tree, so `agent_skills` is no longer the invocation source of truth.
 * Keep this table synchronized during the transition because admin/config/auth
 * surfaces still use it for metadata and permissions.
 */

import { and, agents, agentSkills, db, eq, inArray } from "../graphql/utils.js";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { tenants } from "@thinkwork/database-pg/schema";
import { isBuiltinToolSlug } from "./builtin-tool-slugs.js";

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
  changed: boolean;
  addedSlugs: string[];
  removedSlugs: string[];
  agentsMdPathsScanned: string[];
  warnings: string[];
}

const SKILL_MD_PATH_RE = /(?:^|\/)skills\/([^/]+)\/SKILL\.md$/;

export interface DeriveOptions {
  readAgentsMdFiles?: (
    tenantId: string,
    agentId: string,
  ) => Promise<AgentPrefixFile[]>;
}

const _defaultAgentsMdReader = (
  tenantId: string,
  agentId: string,
): Promise<AgentPrefixFile[]> =>
  _readAgentPrefixFiles(tenantId, agentId, (rel) => SKILL_MD_PATH_RE.test(rel));

export async function deriveAgentSkills(
  ctx: ComposeContext,
  agentId: string,
  opts: DeriveOptions = {},
): Promise<DeriveResult> {
  const reader = opts.readAgentsMdFiles ?? _defaultAgentsMdReader;
  const skillEntries = (await reader(ctx.tenantId, agentId))
    .filter((entry) => SKILL_MD_PATH_RE.test(entry.path))
    .sort((a, b) => a.path.localeCompare(b.path));

  const agentsMdPathsScanned = skillEntries.map((e) => e.path);
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const entry of skillEntries) {
    const match = entry.path.match(SKILL_MD_PATH_RE);
    const slug = match?.[1];
    if (slug && !isBuiltinToolSlug(slug)) seen.add(slug);
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
