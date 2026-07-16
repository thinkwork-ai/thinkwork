/**
 * Per-assignment skill state in the agent workspace (capability-mapping
 * plan U9, KTD-8 — decided destination: workspace file).
 *
 * `agent_skills` is being retired (R13). Its per-assignment payload —
 * OAuth wiring in `config` (connectionId / skillType / tokenEnvVar /
 * secretRef — references, never secret values) and the
 * `permissions.operations` authz allowlist — moves to a server-managed
 * state file at `skills/<slug>/.assignment.json` in the agent workspace,
 * beside the `.catalog-ref.json` install marker it parallels. The
 * filesystem IS the agent: assignment state lives with the assignment.
 *
 * Migration posture (this unit): writers DUAL-WRITE (DB row + state
 * file); the authz and runtime-config readers prefer the file and fall
 * back to the DB row when no file exists, so behavior is byte-identical
 * for agents that predate the file. U10 retires the DB side.
 *
 * File writes are best-effort against the DB write they shadow: a failed
 * S3 put logs loudly and returns false — it must never fail the OAuth
 * callback or snapshot restore that triggered it while the DB fallback
 * still serves readers.
 */

import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getConfig } from "@thinkwork/runtime-config";
import { db, eq, and } from "../../graphql/utils.js";
import { agents, tenants } from "../../graphql/utils.js";
import type { MarkerConfigMerge } from "../capabilities/marker-frontmatter.js";
import type { RegistryBindingContext } from "../capabilities/registry-trust-flag.js";

export const SKILL_ASSIGNMENT_STATE_FILE = ".assignment.json";

export interface SkillAssignmentState {
  slug: string;
  /** Absent = enabled (mirrors agent_skills.enabled default true). */
  enabled?: boolean;
  /** OAuth wiring + skill refs — references only, never token values. */
  config?: Record<string, unknown>;
  /** { operations?: string[] } — the admin-skill authz allowlist. */
  permissions?: Record<string, unknown>;
  rate_limit_rpm?: number | null;
  model_override?: string | null;
  updated_at: string;
}

export function assignmentStateKey(targetPrefix: string, slug: string): string {
  return `${targetPrefix}skills/${slug}/${SKILL_ASSIGNMENT_STATE_FILE}`;
}

let sharedClient: S3Client | null = null;
function s3Client(): S3Client {
  sharedClient ??= new S3Client({
    region:
      process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
  });
  return sharedClient;
}

/**
 * Resolve `tenants/<tenant-slug>/agents/<folder>/` for an agent. Null when
 * the agent/tenant is missing a slug — callers fail soft (DB fallback).
 */
export async function resolveAgentWorkspacePrefix(
  agentId: string,
): Promise<string | null> {
  const [agent] = await db
    .select({
      slug: agents.slug,
      workspace_folder_name: agents.workspace_folder_name,
      tenant_id: agents.tenant_id,
    })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!agent?.slug || !agent.tenant_id) return null;
  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, agent.tenant_id))
    .limit(1);
  if (!tenant?.slug) return null;
  const folder = agent.workspace_folder_name ?? agent.slug;
  return `tenants/${tenant.slug}/agents/${folder}/`;
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

/** Read one skill's assignment state; null when absent or unreadable. */
export async function readSkillAssignmentState(
  targetPrefix: string,
  slug: string,
  deps: { s3?: S3Client; bucket?: string } = {},
): Promise<SkillAssignmentState | null> {
  const bucket = deps.bucket ?? workspaceBucket();
  if (!bucket) return null;
  try {
    const resp = await (deps.s3 ?? s3Client()).send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: assignmentStateKey(targetPrefix, slug),
      }),
    );
    const raw = (await resp.Body?.transformToString()) ?? "";
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as SkillAssignmentState;
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name !== "NoSuchKey" && name !== "NotFound") {
      console.warn(
        `[skill-assignment-state] read failed for ${slug}:`,
        err instanceof Error ? err.message : err,
      );
    }
    return null;
  }
}

/** Read assignment states for a set of slugs (parallel, absent → omitted). */
export async function readSkillAssignmentStates(
  targetPrefix: string,
  slugs: readonly string[],
  deps: { s3?: S3Client; bucket?: string } = {},
): Promise<Map<string, SkillAssignmentState>> {
  const entries = await Promise.all(
    slugs.map(async (slug) => {
      const state = await readSkillAssignmentState(targetPrefix, slug, deps);
      return state ? ([slug, state] as const) : null;
    }),
  );
  return new Map(entries.filter((entry) => entry !== null));
}

export interface SkillAssignmentPatch {
  /** Merged over the existing config (agent_skills merge semantics). */
  configMerge?: Record<string, unknown>;
  /** Full replacement when present. */
  permissions?: Record<string, unknown> | null;
  enabled?: boolean;
  rate_limit_rpm?: number | null;
  model_override?: string | null;
  /** Replace the whole file instead of merging (snapshot restore). */
  replace?: boolean;
}

/**
 * Read-merge-write a skill's assignment state. Best-effort by contract:
 * returns false (after a loud log) on failure, never throws.
 */
export async function patchSkillAssignmentState(
  input: {
    agentId: string;
    slug: string;
    patch: SkillAssignmentPatch;
    /** Skip the agent lookup when the caller already has the prefix. */
    targetPrefix?: string;
    /**
     * Registry-trust (flag-ON) branch: when present, the per-grant config is
     * merged into `skills/<slug>/SKILL.md` frontmatter and a scope-qualified
     * `capability_approvals` binding is recorded — NO `.assignment.json` is
     * written. Absent = legacy sidecar path, byte-identical to pre-THINK-302.
     */
    registry?: RegistryBindingContext;
  },
  deps: { s3?: S3Client; bucket?: string } = {},
): Promise<boolean> {
  try {
    const bucket = deps.bucket ?? workspaceBucket();
    if (!bucket) return false;
    const targetPrefix =
      input.targetPrefix ?? (await resolveAgentWorkspacePrefix(input.agentId));
    if (!targetPrefix) return false;

    if (input.registry) {
      return await writeSkillRegistryBinding(input, targetPrefix, bucket, deps);
    }

    const existing = input.patch.replace
      ? null
      : await readSkillAssignmentState(targetPrefix, input.slug, {
          ...deps,
          bucket,
        });
    const next: SkillAssignmentState = {
      slug: input.slug,
      ...(existing ?? {}),
      updated_at: new Date().toISOString(),
    };
    if (input.patch.configMerge) {
      next.config = { ...(next.config ?? {}), ...input.patch.configMerge };
    }
    if (input.patch.permissions !== undefined) {
      next.permissions = input.patch.permissions ?? undefined;
    }
    if (input.patch.enabled !== undefined) next.enabled = input.patch.enabled;
    if (input.patch.rate_limit_rpm !== undefined) {
      next.rate_limit_rpm = input.patch.rate_limit_rpm;
    }
    if (input.patch.model_override !== undefined) {
      next.model_override = input.patch.model_override;
    }

    await (deps.s3 ?? s3Client()).send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: assignmentStateKey(targetPrefix, input.slug),
        Body: JSON.stringify(next, null, 2),
        ContentType: "application/json",
      }),
    );
    return true;
  } catch (err) {
    console.error(
      `[skill-assignment-state] write failed for ${input.slug} (DB row remains authoritative):`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/** `skills/<slug>/SKILL.md` marker path (the installed-skill definition). */
function skillMarkerKey(targetPrefix: string, slug: string): string {
  return `${targetPrefix}skills/${slug}/SKILL.md`;
}

/** Build the marker config merge from a skill assignment patch. */
function skillMergeFromPatch(patch: SkillAssignmentPatch): MarkerConfigMerge {
  const config: Record<string, string> = {};
  if (patch.configMerge) {
    for (const [key, value] of Object.entries(patch.configMerge)) {
      if (typeof value === "string") config[key] = value;
    }
  }
  const ops =
    patch.permissions && Array.isArray(patch.permissions.operations)
      ? (patch.permissions.operations as unknown[]).filter(
          (op): op is string => typeof op === "string",
        )
      : undefined;
  return {
    ...(Object.keys(config).length > 0 ? { config } : {}),
    ...(ops && ops.length > 0 ? { operations: ops } : {}),
    ...(patch.rate_limit_rpm != null
      ? { rateLimitRpm: patch.rate_limit_rpm }
      : {}),
    ...(patch.model_override ? { modelOverride: patch.model_override } : {}),
  };
}

/**
 * Registry-trust (flag-ON) skill grant: merge the per-grant config into the
 * installed `skills/<slug>/SKILL.md` frontmatter, record a scope-qualified
 * binding over the marker sha + folder attestation, write NO `.assignment.json`.
 * Best-effort like its legacy sibling: returns false (after a loud log) on any
 * failure, never throws.
 */
async function writeSkillRegistryBinding(
  input: {
    agentId: string;
    slug: string;
    patch: SkillAssignmentPatch;
    registry?: RegistryBindingContext;
  },
  targetPrefix: string,
  bucket: string,
  deps: { s3?: S3Client; bucket?: string },
): Promise<boolean> {
  const registry = input.registry!;
  const client = deps.s3 ?? s3Client();
  const key = skillMarkerKey(targetPrefix, input.slug);
  let existing: string;
  try {
    const resp = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    existing = (await resp.Body?.transformToString()) ?? "";
  } catch (err) {
    console.error(
      `[skill-assignment-state] registry grant: SKILL.md missing for ${input.slug}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
  // Lazy-load the registry deps: this ON branch is inert until a tenant flips
  // the flag, and a static import would pull the drizzle schema barrel into
  // every transitive importer of this widely-used module (tripping suites that
  // globally mock drizzle-orm).
  const [{ mergeMarkerConfig }, { computeFolderAttestation, recordBinding }] =
    await Promise.all([
      import("../capabilities/marker-frontmatter.js"),
      import("../capabilities/approval-registry.js"),
    ]);
  const markerBytes = mergeMarkerConfig(
    existing,
    "skill",
    skillMergeFromPatch(input.patch),
  );
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: markerBytes,
        ContentType: "text/markdown; charset=utf-8",
      }),
    );
    await recordBinding(registry.db, {
      tenantId: registry.tenantId,
      scopeRef: registry.scopeRef,
      class: "skill",
      slug: input.slug,
      markerSha: createHash("sha256").update(markerBytes).digest("hex"),
      folderAttestationSha: computeFolderAttestation([
        { path: "SKILL.md", content: markerBytes },
      ]),
      signedBy: registry.signedBy,
    });
    return true;
  } catch (err) {
    console.error(
      `[skill-assignment-state] registry grant write failed for ${input.slug}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
