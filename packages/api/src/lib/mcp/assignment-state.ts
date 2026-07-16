/**
 * Per-assignment MCP-server state in the agent workspace (Composer plan
 * U9a). MCP server attachment mirrors skills: an `mcp/<server-slug>/`
 * folder in the AGENT workspace source = attached, with a server-managed
 * `mcp/<slug>/.assignment.json` manifest beside it — the exact parallel of
 * `skills/<slug>/.assignment.json` (`packages/api/src/lib/skills/`).
 *
 * The manifest carries REFERENCES ONLY — server name/slug, the registry
 * row id as the endpoint reference, the auth pattern name, a Secrets
 * Manager `secretRef` ARN (a reference, never the value), and the enabled
 * tool names. Nothing token-like is ever copied in: `buildMcpAssignmentState`
 * extracts an explicit allowlist of keys from the registry row's
 * `auth_config` rather than spreading it, so an inline credential (should
 * one ever appear) cannot leak into S3.
 *
 * Migration posture (THINK-173 retirement): the workspace file IS the
 * assignment state. The `agent_mcp_servers` table is retired — no code
 * writes new rows or reads them at runtime; the sole remaining reader is
 * the U11 backfill (`../capabilities/backfill.ts`), which materializes
 * pre-retirement rows into folders on stages that have not cut over yet
 * (customer stages). Teardown paths still DELETE rows so the frozen
 * migration snapshot stays hygienic until the table is dropped.
 */

import { createHash } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getConfig } from "@thinkwork/runtime-config";
import { mcpAssignmentRe } from "../workspace-constants.js";
import {
  db,
  eq,
  and,
  agents,
  tenants,
  tenantMcpServers,
} from "../../graphql/utils.js";
import { serializeMcpDefinition } from "../capabilities/marker-frontmatter.js";
import {
  computeFolderAttestation,
  recordBinding,
} from "../capabilities/approval-registry.js";
import { capabilityRegistryTrustEnabled } from "../capabilities/registry-trust-flag.js";
import type { RegistryBindingContext } from "../capabilities/registry-trust-flag.js";

export const MCP_ASSIGNMENT_STATE_FILE = ".assignment.json";

export interface McpAssignmentState {
  /** URL-safe server identifier (the `mcp/<slug>/` folder name). */
  slug: string;
  /** Display name from the tenant registry. */
  name: string;
  /**
   * Registry row id (`tenant_mcp_servers.id`) — the endpoint REFERENCE.
   * U9b resolves the live URL/transport from the registry via this id; the
   * raw endpoint URL is intentionally not persisted here.
   */
  registryServerId: string;
  /** Transport hint from the registry (non-secret), e.g. "streamable-http". */
  transport?: string | null;
  /** Auth pattern name (none|oauth|tenant_api_key|service_credential) — never a token. */
  authType?: string | null;
  /**
   * Secrets Manager reference (ARN) when the server uses a stored
   * credential — a REFERENCE, never the secret value. Absent for
   * `none`/`oauth` servers (per-user OAuth stays render/turn-time).
   */
  secretRef?: string | null;
  /** Enabled tool names (the agent-level allowlist). Absent/empty = all tools. */
  enabledTools?: string[];
  /** Absent = enabled (mirrors agent_mcp_servers.enabled default true). */
  enabled?: boolean;
  updated_at: string;
}

/** Registry columns the manifest is allowed to reference. */
export interface McpRegistryRef {
  id: string;
  slug: string | null;
  name: string;
  transport?: string | null;
  auth_type?: string | null;
  auth_config?: unknown;
}

export function mcpAssignmentStateKey(
  targetPrefix: string,
  slug: string,
): string {
  return `${targetPrefix}mcp/${slug}/${MCP_ASSIGNMENT_STATE_FILE}`;
}

export function mcpFolderPrefix(targetPrefix: string, slug: string): string {
  return `${targetPrefix}mcp/${slug}/`;
}

/** `mcp/<slug>/.assignment.json` marker — the attached-server presence rule. */
const MCP_ASSIGNMENT_RE = mcpAssignmentRe();

/**
 * Build the manifest state from a registry row + the agent-level config.
 *
 * Secrets rule (hard): only an explicit allowlist of keys is read from
 * `auth_config` — never a spread — so a token-like field cannot land in
 * the file. Today that allowlist is `{ secretRef }` (an ARN reference).
 */
export function buildMcpAssignmentState(input: {
  registry: McpRegistryRef;
  agentConfig?: { toolAllowlist?: unknown } | null;
  enabled?: boolean;
  now?: Date;
}): McpAssignmentState {
  const { registry } = input;
  const slug = registry.slug ?? registry.name;

  const authConfig =
    registry.auth_config && typeof registry.auth_config === "object"
      ? (registry.auth_config as Record<string, unknown>)
      : null;
  const secretRef =
    authConfig && typeof authConfig.secretRef === "string"
      ? authConfig.secretRef
      : null;

  const allowlist = input.agentConfig?.toolAllowlist;
  const enabledTools = Array.isArray(allowlist)
    ? allowlist.filter((tool): tool is string => typeof tool === "string")
    : undefined;

  const state: McpAssignmentState = {
    slug,
    name: registry.name,
    registryServerId: registry.id,
    updated_at: (input.now ?? new Date()).toISOString(),
  };
  if (registry.transport != null) state.transport = registry.transport;
  if (registry.auth_type != null) state.authType = registry.auth_type;
  if (secretRef != null) state.secretRef = secretRef;
  if (enabledTools && enabledTools.length > 0)
    state.enabledTools = enabledTools;
  if (input.enabled === false) state.enabled = false;
  return state;
}

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

export interface McpAssignmentStateDeps {
  s3?: Pick<S3Client, "send">;
  bucket?: string;
  /**
   * Registry-trust (flag-ON) branch: when present, the server attachment is
   * written as an `mcp/<slug>/MCP.md` marker with a scope-qualified
   * `capability_approvals` binding — NO `.assignment.json`. Absent = legacy
   * `.assignment.json` mirror, byte-identical to pre-THINK-302.
   */
  registry?: RegistryBindingContext;
}

/** MCP.md marker path for a server slug. */
function mcpMarkerKey(targetPrefix: string, slug: string): string {
  return `${targetPrefix}mcp/${slug}/MCP.md`;
}

/**
 * Registry-trust (flag-ON) MCP grant: write the `mcp/<slug>/MCP.md` marker
 * (references only — server = registry id, secrets stay platform-side) and
 * record a scope-qualified binding. Returns false (loud log) on failure.
 */
async function writeMcpRegistryBinding(
  targetPrefix: string,
  state: McpAssignmentState,
  registry: RegistryBindingContext,
  bucket: string,
  s3: Pick<S3Client, "send">,
): Promise<boolean> {
  const config: Record<string, string> = {};
  if (state.transport) config.transport = state.transport;
  if (state.authType) config.authType = state.authType;
  if (state.secretRef) config.secretRef = state.secretRef;
  const markerBytes = serializeMcpDefinition({
    name: state.slug,
    description: `${state.name} — MCP connection (platform-managed).`,
    server: state.registryServerId,
    enabledTools: state.enabledTools,
    ...(Object.keys(config).length > 0 ? { config } : {}),
  });
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: mcpMarkerKey(targetPrefix, state.slug),
        Body: markerBytes,
        ContentType: "text/markdown; charset=utf-8",
      }),
    );
    await recordBinding(registry.db, {
      tenantId: registry.tenantId,
      scopeRef: registry.scopeRef,
      class: "mcp",
      slug: state.slug,
      markerSha: createHash("sha256").update(markerBytes).digest("hex"),
      folderAttestationSha: computeFolderAttestation([
        { path: "MCP.md", content: markerBytes },
      ]),
      signedBy: registry.signedBy,
    });
    return true;
  } catch (err) {
    console.error(
      `[mcp-assignment-state] registry grant write failed for ${state.slug}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * THINK-190 fork probe: a `capability_folder_dispatch` agent's MCP
 * assignment record is the signed `connections/<slug>/.assignment.json`
 * sidecar (`../capabilities/connection-assignments.ts`) — its legacy
 * `mcp/<slug>/` mirror is retired: readers repoint, writers skip it, and
 * the U11 backfill scrubs the folders. Un-flipped agents (customer stages
 * pre-cutover) still live entirely on the `mcp/` files.
 */
export async function agentUsesFolderDispatch(
  agentId: string,
): Promise<boolean> {
  const [agent] = await db
    .select({ capability_folder_dispatch: agents.capability_folder_dispatch })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  return agent?.capability_folder_dispatch === true;
}

/**
 * Resolve `tenants/<tenant-slug>/agents/<folder>/` for an agent. Null when
 * the agent/tenant is missing a slug — callers fail soft (DB stays
 * authoritative).
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

/** Read one server's assignment state; null when absent or unreadable. */
export async function readMcpAssignmentState(
  targetPrefix: string,
  slug: string,
  deps: McpAssignmentStateDeps = {},
): Promise<McpAssignmentState | null> {
  const bucket = deps.bucket ?? workspaceBucket();
  if (!bucket) return null;
  try {
    const resp = await (deps.s3 ?? s3Client()).send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: mcpAssignmentStateKey(targetPrefix, slug),
      }),
    );
    const raw = (await resp.Body?.transformToString()) ?? "";
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as McpAssignmentState;
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name !== "NoSuchKey" && name !== "NotFound") {
      console.warn(
        `[mcp-assignment-state] read failed for ${slug}:`,
        err instanceof Error ? err.message : err,
      );
    }
    return null;
  }
}

/**
 * List attached MCP server slugs (`.assignment.json` markers) under a
 * workspace prefix. Null when no bucket is resolvable; empty array when the
 * folder is simply absent.
 */
export async function listWorkspaceMcpSlugs(
  targetPrefix: string,
  deps: McpAssignmentStateDeps = {},
): Promise<string[] | null> {
  const bucket = deps.bucket ?? workspaceBucket();
  if (!bucket) return null;
  const client = deps.s3 ?? s3Client();
  const prefix = `${targetPrefix}mcp/`;
  const slugs = new Set<string>();
  let continuationToken: string | undefined;
  try {
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
        const match = rel.match(MCP_ASSIGNMENT_RE);
        if (match?.[1]) slugs.add(match[1]);
      }
      continuationToken = resp.IsTruncated
        ? resp.NextContinuationToken
        : undefined;
    } while (continuationToken);
  } catch (err) {
    console.warn(
      `[mcp-assignment-state] list failed under ${prefix}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
  return [...slugs].sort();
}

/**
 * Write a server's `.assignment.json`. Best-effort by contract: returns
 * false (after a loud log) on failure, never throws — the DB row remains
 * authoritative.
 */
export async function writeMcpAssignmentState(
  targetPrefix: string,
  state: McpAssignmentState,
  deps: McpAssignmentStateDeps = {},
): Promise<boolean> {
  const bucket = deps.bucket ?? workspaceBucket();
  if (!bucket) return false;
  const s3 = deps.s3 ?? s3Client();
  if (deps.registry) {
    return writeMcpRegistryBinding(
      targetPrefix,
      state,
      deps.registry,
      bucket,
      s3,
    );
  }
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: mcpAssignmentStateKey(targetPrefix, state.slug),
        Body: `${JSON.stringify(state, null, 2)}\n`,
        ContentType: "application/json; charset=utf-8",
      }),
    );
    return true;
  } catch (err) {
    console.error(
      `[mcp-assignment-state] write failed for ${state.slug} (DB row remains authoritative):`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * Remove an attached server's `mcp/<slug>/` folder. Best-effort: logs and
 * returns false on failure, never throws.
 */
export async function removeMcpAssignmentFolder(
  targetPrefix: string,
  slug: string,
  deps: McpAssignmentStateDeps = {},
): Promise<boolean> {
  const bucket = deps.bucket ?? workspaceBucket();
  if (!bucket) return false;
  const client = deps.s3 ?? s3Client();
  const prefix = mcpFolderPrefix(targetPrefix, slug);
  try {
    const keys: string[] = [];
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
        if (obj.Key && obj.Key !== prefix) keys.push(obj.Key);
      }
      continuationToken = resp.IsTruncated
        ? resp.NextContinuationToken
        : undefined;
    } while (continuationToken);
    for (const key of keys) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    }
    return true;
  } catch (err) {
    console.error(
      `[mcp-assignment-state] folder removal failed for ${slug} (DB row remains authoritative):`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * Materialize the target server's `mcp/<slug>/.assignment.json` for a grant.
 * Reads the full registry row so the manifest carries the auth pattern +
 * secretRef reference. Best-effort — returns false on any soft failure.
 */
export async function materializeMcpAssignmentFolder(
  input: {
    targetPrefix: string;
    registryServerId: string;
    tenantId: string;
    agentConfig?: { toolAllowlist?: unknown } | null;
    now?: Date;
  },
  deps: McpAssignmentStateDeps = {},
): Promise<boolean> {
  const [registry] = await db
    .select({
      id: tenantMcpServers.id,
      slug: tenantMcpServers.slug,
      name: tenantMcpServers.name,
      transport: tenantMcpServers.transport,
      auth_type: tenantMcpServers.auth_type,
      auth_config: tenantMcpServers.auth_config,
    })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.id, input.registryServerId),
        eq(tenantMcpServers.tenant_id, input.tenantId),
      ),
    )
    .limit(1);
  if (!registry) return false;
  const state = buildMcpAssignmentState({
    registry,
    agentConfig: input.agentConfig,
    now: input.now,
  });
  return writeMcpAssignmentState(input.targetPrefix, state, deps);
}

// ── Attach/teardown helpers for the non-Composer writers ───────────────────
//
// Post-retirement, the plugin/managed provisioners and the direct REST
// assign write the workspace file DIRECTLY as the assignment record — there
// is no DB row behind it. Teardown removes the per-agent `mcp/<slug>/`
// folder(s). All are bucket-gated at the top: with no workspace bucket they
// return early BEFORE any DB read, so DB-mocked unit tests are unaffected.

/**
 * Materialize one server's `mcp/<slug>/.assignment.json` for several agents
 * (plugin/managed default-agent assignment). Registry-read only. Returns the
 * count of files written. THINK-190: flipped agents are skipped — their
 * assignment record is the signed connection folder the same provisioners
 * already write; the mirror must never be resurrected for them.
 */
export async function materializeMcpAssignmentFoldersForAgents(
  input: {
    agentIds: readonly string[];
    tenantId: string;
    registryServerId: string;
  },
  deps: McpAssignmentStateDeps = {},
): Promise<number> {
  const bucket = deps.bucket ?? workspaceBucket();
  if (!bucket) return 0;
  // Registry-trust (flag-ON): the provisioner is the reconciler authority, so
  // each per-agent grant records an `agent:<id>`-scoped binding + MCP.md marker
  // instead of the legacy `.assignment.json` mirror. Off = unchanged.
  const registryTrust =
    deps.registry !== undefined
      ? true
      : await capabilityRegistryTrustEnabled(db, input.tenantId);
  let written = 0;
  for (const agentId of input.agentIds) {
    if (await agentUsesFolderDispatch(agentId)) continue;
    const targetPrefix = await resolveAgentWorkspacePrefix(agentId);
    if (!targetPrefix) continue;
    const perAgentDeps: McpAssignmentStateDeps = registryTrust
      ? {
          ...deps,
          bucket,
          registry: deps.registry ?? {
            db,
            tenantId: input.tenantId,
            scopeRef: `agent:${agentId}`,
            signedBy: "plugin-reconciler",
          },
        }
      : { ...deps, bucket };
    if (
      await materializeMcpAssignmentFolder(
        {
          targetPrefix,
          registryServerId: input.registryServerId,
          tenantId: input.tenantId,
        },
        perAgentDeps,
      )
    ) {
      written += 1;
    }
  }
  return written;
}

/** Resolve a tenant server's folder slug (its `mcp/<slug>/` name). */
async function resolveMcpServerSlug(
  registryServerId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ slug: tenantMcpServers.slug, name: tenantMcpServers.name })
    .from(tenantMcpServers)
    .where(eq(tenantMcpServers.id, registryServerId))
    .limit(1);
  if (!row) return null;
  return row.slug ?? row.name;
}

/**
 * Snapshot the server's folder slug + the tenant's agents BEFORE a
 * server-wide teardown, so the caller can feed the result to
 * {@link removeMcpAssignmentFoldersForAgents} after the DB delete commits.
 * Post-retirement there is no assignment table to enumerate, so this lists
 * ALL tenant agents — folder removal is a cheap no-op for agents that never
 * had the server. Bucket-gated: returns null (no DB read) with no workspace
 * bucket. The registry slug must be resolved BEFORE the registry row is
 * deleted (hence "snapshot").
 */
export async function snapshotMcpServerAttachment(
  input: { tenantId: string; registryServerId: string },
  deps: McpAssignmentStateDeps = {},
): Promise<{ slug: string; agentIds: string[] } | null> {
  const bucket = deps.bucket ?? workspaceBucket();
  if (!bucket) return null;
  const slug = await resolveMcpServerSlug(input.registryServerId);
  if (!slug) return null;
  const rows = (await db
    .select({ agent_id: agents.id })
    .from(agents)
    .where(eq(agents.tenant_id, input.tenantId))) as { agent_id: string }[];
  return { slug, agentIds: rows.map((r) => r.agent_id) };
}

/**
 * Remove `mcp/<slug>/` from each agent's workspace (server-wide teardown).
 * Best-effort per agent. Returns the count of folders removed.
 */
export async function removeMcpAssignmentFoldersForAgents(
  input: { agentIds: readonly string[]; slug: string },
  deps: McpAssignmentStateDeps = {},
): Promise<number> {
  const bucket = deps.bucket ?? workspaceBucket();
  if (!bucket) return 0;
  let removed = 0;
  for (const agentId of input.agentIds) {
    const targetPrefix = await resolveAgentWorkspacePrefix(agentId);
    if (!targetPrefix) continue;
    if (
      await removeMcpAssignmentFolder(targetPrefix, input.slug, {
        ...deps,
        bucket,
      })
    ) {
      removed += 1;
    }
  }
  return removed;
}

/**
 * Remove ONE agent's `mcp/<slug>/` folder for a server (single-agent detach,
 * e.g. the direct REST unassign). Resolves the folder slug from the registry
 * row. Bucket-gated; best-effort.
 */
export async function removeMcpAssignmentForAgentServer(
  input: { agentId: string; registryServerId: string },
  deps: McpAssignmentStateDeps = {},
): Promise<boolean> {
  const bucket = deps.bucket ?? workspaceBucket();
  if (!bucket) return false;
  const slug = await resolveMcpServerSlug(input.registryServerId);
  if (!slug) return false;
  const targetPrefix = await resolveAgentWorkspacePrefix(input.agentId);
  if (!targetPrefix) return false;
  return removeMcpAssignmentFolder(targetPrefix, slug, { ...deps, bucket });
}

/**
 * Remove EVERY legacy `mcp/<slug>/` folder under an agent workspace prefix
 * (THINK-190 migration: for `capability_folder_dispatch` agents the
 * connection sidecar is the single assignment record, so the superseded
 * mirror only duplicate-renders in Composer). Only ever call this for
 * flipped agents. Best-effort per folder; returns the slugs removed.
 */
export async function removeLegacyMcpFolders(
  targetPrefix: string,
  deps: McpAssignmentStateDeps = {},
): Promise<string[]> {
  const bucket = deps.bucket ?? workspaceBucket();
  if (!bucket) return [];
  const slugs = await listWorkspaceMcpSlugs(targetPrefix, { ...deps, bucket });
  if (!slugs || slugs.length === 0) return [];
  const removed: string[] = [];
  for (const slug of slugs) {
    if (
      await removeMcpAssignmentFolder(targetPrefix, slug, { ...deps, bucket })
    ) {
      removed.push(slug);
    }
  }
  return removed;
}
