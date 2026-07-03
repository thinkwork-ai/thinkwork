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
 * Migration posture (U9a): this is a DUAL-WRITE that ships INERT. The
 * `agent_mcp_servers` row stays authoritative for the runtime; the file is
 * visibility-only until U9b repoints the runtime and demotes the DB row.
 * Every write is best-effort against the DB write it shadows: a failed S3
 * put logs loudly and returns false — it must never fail the grant/detach
 * mutation the DB row already committed.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getConfig } from "@thinkwork/runtime-config";
import {
  db,
  eq,
  and,
  agents,
  tenants,
  tenantMcpServers,
} from "../../graphql/utils.js";
import { agentMcpServers } from "@thinkwork/database-pg/schema";

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
const MCP_ASSIGNMENT_RE = /^mcp\/([^/]+)\/\.assignment\.json$/;

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
  s3?: S3Client;
  bucket?: string;
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
  try {
    await (deps.s3 ?? s3Client()).send(
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

/**
 * Backfill reconcile (U9a): materialize `mcp/<slug>/.assignment.json` for
 * every currently-attached MCP server of an agent that does not yet have
 * one. Idempotent — write-if-absent, so a second run is a pure no-op.
 *
 * Wired into the MCP grant/detach mutation (the least-new-machinery hook —
 * it runs on the same config change that already touches the workspace), so
 * the first MCP mutation on a pre-existing agent materializes its whole set.
 * Also exported so an operator/ops path can backfill without a mutation.
 *
 * Returns the count of files written (0 when everything already present or
 * the workspace is unresolvable).
 */
export async function reconcileMcpAssignmentFolders(
  input: { agentId: string; tenantId: string; targetPrefix?: string },
  deps: McpAssignmentStateDeps = {},
): Promise<number> {
  const bucket = deps.bucket ?? workspaceBucket();
  if (!bucket) return 0;
  const targetPrefix =
    input.targetPrefix ?? (await resolveAgentWorkspacePrefix(input.agentId));
  if (!targetPrefix) return 0;

  const attached = await db
    .select({
      registryId: tenantMcpServers.id,
      slug: tenantMcpServers.slug,
      name: tenantMcpServers.name,
      transport: tenantMcpServers.transport,
      auth_type: tenantMcpServers.auth_type,
      auth_config: tenantMcpServers.auth_config,
      config: agentMcpServers.config,
      enabled: agentMcpServers.enabled,
    })
    .from(agentMcpServers)
    .innerJoin(
      tenantMcpServers,
      eq(agentMcpServers.mcp_server_id, tenantMcpServers.id),
    )
    .where(eq(agentMcpServers.agent_id, input.agentId));

  const present = await listWorkspaceMcpSlugs(targetPrefix, {
    ...deps,
    bucket,
  });
  const presentSet = new Set(present ?? []);

  let written = 0;
  for (const row of attached) {
    const slug = row.slug ?? row.name;
    if (presentSet.has(slug)) continue;
    const state = buildMcpAssignmentState({
      registry: {
        id: row.registryId,
        slug: row.slug,
        name: row.name,
        transport: row.transport,
        auth_type: row.auth_type,
        auth_config: row.auth_config,
      },
      agentConfig: row.config as { toolAllowlist?: unknown } | null,
      enabled: row.enabled,
    });
    if (
      await writeMcpAssignmentState(targetPrefix, state, { ...deps, bucket })
    ) {
      written += 1;
    }
  }
  return written;
}
