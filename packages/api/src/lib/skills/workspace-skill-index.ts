/**
 * Workspace-backed skill index (capability-mapping plan U10, KTD-8).
 *
 * With `agent_skills` retired as a mirror store, presence/enabled readers
 * resolve an agent's installed skills from the workspace tree itself:
 *
 *   - presence  = a `skills/<slug>/SKILL.md` marker under the agent's
 *     workspace prefix (the same rule the runtime composer applies via
 *     `discoverWorkspaceSkillsFromPaths`);
 *   - state     = the per-assignment `skills/<slug>/.assignment.json`
 *     file (U9); a missing file means enabled with no per-assignment
 *     config, mirroring the old `agent_skills.enabled` default.
 *
 * Built-in tool slugs are excluded for parity with the retired
 * derive-agent-skills sync, which never mirrored them into the table.
 *
 * All reads fail soft: an unresolvable bucket/prefix returns null so the
 * caller can pick its own degraded behavior (empty inventory, "unknown"
 * fingerprint, …) instead of this module guessing for it.
 */

import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { getConfig } from "@thinkwork/runtime-config";
import { isBuiltinToolSlug } from "../builtin-tool-slugs.js";
import {
  readSkillAssignmentStates,
  resolveAgentWorkspacePrefix,
  type SkillAssignmentState,
} from "./assignment-state.js";

export interface AgentWorkspaceSkill {
  slug: string;
  /** `.assignment.json` enabled flag; absent file/flag = enabled. */
  enabled: boolean;
  /** OAuth wiring + skill refs from the assignment file (never secrets). */
  config: Record<string, unknown> | null;
  permissions: Record<string, unknown> | null;
  rateLimitRpm: number | null;
  modelOverride: string | null;
}

export interface WorkspaceSkillIndexDeps {
  s3?: S3Client;
  bucket?: string;
}

const SKILL_MARKER_RE = /^skills\/([^/]+)\/SKILL\.md$/;

let sharedClient: S3Client | null = null;
function s3Client(): S3Client {
  sharedClient ??= new S3Client({
    region:
      process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
  });
  return sharedClient;
}

function workspaceBucket(): string | null {
  // getConfig can throw before the runtime config document loads —
  // treat that exactly like "no bucket configured" (fail soft).
  try {
    return getConfig("WORKSPACE_BUCKET") || null;
  } catch {
    return null;
  }
}

/**
 * List installed skill slugs (SKILL.md markers) under a workspace prefix.
 * Returns null when no bucket is resolvable; throws on live S3 errors so
 * callers with retry semantics see them.
 */
export async function listWorkspaceSkillSlugs(
  targetPrefix: string,
  deps: WorkspaceSkillIndexDeps = {},
): Promise<string[] | null> {
  const bucket = deps.bucket ?? workspaceBucket();
  if (!bucket) return null;
  const client = deps.s3 ?? s3Client();
  const prefix = `${targetPrefix}skills/`;
  const slugs = new Set<string>();
  let continuationToken: string | undefined;
  do {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of resp.Contents ?? []) {
      if (!obj.Key?.startsWith(targetPrefix)) continue;
      const rel = obj.Key.slice(targetPrefix.length);
      const match = rel.match(SKILL_MARKER_RE);
      const slug = match?.[1];
      if (slug && !isBuiltinToolSlug(slug)) slugs.add(slug);
    }
    continuationToken = resp.IsTruncated
      ? resp.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return [...slugs].sort();
}

function toWorkspaceSkill(
  slug: string,
  state: SkillAssignmentState | undefined,
): AgentWorkspaceSkill {
  return {
    slug,
    enabled: state?.enabled ?? true,
    config: state?.config ?? null,
    permissions: state?.permissions ?? null,
    rateLimitRpm: state?.rate_limit_rpm ?? null,
    modelOverride: state?.model_override ?? null,
  };
}

/**
 * Resolve an agent's installed skills (presence + assignment state) from
 * its workspace. Null when the agent has no resolvable workspace prefix
 * or no bucket is configured — callers fail soft.
 */
export async function listAgentWorkspaceSkills(
  agentId: string,
  deps: WorkspaceSkillIndexDeps = {},
): Promise<AgentWorkspaceSkill[] | null> {
  const bucket = deps.bucket ?? workspaceBucket();
  if (!bucket) return null;
  const targetPrefix = await resolveAgentWorkspacePrefix(agentId);
  if (!targetPrefix) return null;
  const slugs = await listWorkspaceSkillSlugs(targetPrefix, {
    ...deps,
    bucket,
  });
  if (!slugs) return null;
  const states = await readSkillAssignmentStates(targetPrefix, slugs, {
    ...deps,
    bucket,
  });
  return slugs.map((slug) => toWorkspaceSkill(slug, states.get(slug)));
}

/**
 * Enabled installed skill slugs for an agent — the common
 * presence/enabled read the retired `agent_skills` queries performed.
 * Null when the workspace is unresolvable.
 */
export async function listEnabledAgentWorkspaceSkillSlugs(
  agentId: string,
  deps: WorkspaceSkillIndexDeps = {},
): Promise<string[] | null> {
  const skills = await listAgentWorkspaceSkills(agentId, deps);
  if (!skills) return null;
  return skills.filter((skill) => skill.enabled).map((skill) => skill.slug);
}
