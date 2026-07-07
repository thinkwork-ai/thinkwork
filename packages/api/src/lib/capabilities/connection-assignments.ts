/**
 * Connection-sidecar assignment reads (THINK-190).
 *
 * For agents on `capability_folder_dispatch`, the signed
 * `connections/<slug>/.assignment.json` sidecar IS the MCP assignment
 * record — the legacy `mcp/<slug>/.assignment.json` mirror is retired for
 * them (its readers repoint here; the U11 backfill scrubs the folders).
 * Every consumer only ever needed three fields — `config.registryServerId`,
 * `permissions.operations` (the tool allowlist), and `enabled` — with all
 * display/auth data joined from the `tenant_mcp_servers` registry row, so
 * the sidecar already carries the whole record.
 *
 * Reads are RAW sidecar reads, deliberately not the compiled manifest:
 * list surfaces must show attached-but-disabled and attached-but-withheld
 * (drift/unsigned) servers, which the manifest excludes by design.
 *
 * Fail-soft contract mirrors `../mcp/assignment-state.ts`: null = the
 * store is unavailable (no bucket / list error), [] = simply no records.
 */

import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { getConfig } from "@thinkwork/runtime-config";
import { parseCapabilitySidecar } from "./definition-schemas.js";

const LOG_PREFIX = "[connection-assignments]";

/** The assignment-record view of one MCP-type connection sidecar. */
export interface ConnectionAssignmentRecord {
  /** The `connections/<slug>/` folder name. */
  slug: string;
  /** `tenant_mcp_servers.id` reference from `config.registryServerId`. */
  registryServerId: string;
  /** Absent/true = enabled (sidecar `enabled` semantics). */
  enabled: boolean;
  /** `permissions.operations` — the tool allowlist ([] = all tools). */
  operations: string[];
  updated_at: string | null;
}

export interface ConnectionAssignmentDeps {
  s3?: Pick<S3Client, "send">;
  bucket?: string;
}

let sharedClient: S3Client | null = null;
function s3Client(): Pick<S3Client, "send"> {
  sharedClient ??= new S3Client({
    region:
      process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
  });
  return sharedClient;
}

function workspaceBucket(): string | null {
  try {
    return getConfig("WORKSPACE_BUCKET") || null;
  } catch {
    return null;
  }
}

const CONNECTION_SIDECAR_RE = /^connections\/([^/]+)\/\.assignment\.json$/;

function recordFromSidecar(
  slug: string,
  sidecar: {
    enabled?: boolean;
    permissions?: { operations?: string[] };
    config?: Record<string, unknown>;
    updated_at?: string;
  },
): ConnectionAssignmentRecord | null {
  const registryServerId = sidecar.config?.registryServerId;
  // Only MCP-type connections carry a registry reference; API-type or
  // agent-drafted connections without one are not MCP assignment records.
  if (typeof registryServerId !== "string" || registryServerId === "") {
    return null;
  }
  const operations = Array.isArray(sidecar.permissions?.operations)
    ? sidecar.permissions.operations.filter(
        (operation): operation is string => typeof operation === "string",
      )
    : [];
  return {
    slug,
    registryServerId,
    enabled: sidecar.enabled !== false,
    operations,
    updated_at: sidecar.updated_at ?? null,
  };
}

/** Read ONE connection sidecar as an assignment record; null when absent,
 * unreadable, or not an MCP-type (no registryServerId) connection. */
export async function readConnectionAssignment(
  targetPrefix: string,
  slug: string,
  deps: ConnectionAssignmentDeps = {},
): Promise<ConnectionAssignmentRecord | null> {
  const bucket = deps.bucket ?? workspaceBucket();
  if (!bucket) return null;
  const key = `${targetPrefix}connections/${slug}/.assignment.json`;
  try {
    const resp = await (deps.s3 ?? s3Client()).send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    const raw = (await resp.Body?.transformToString()) ?? "";
    const parsed = parseCapabilitySidecar(raw, key);
    if (!parsed.valid) return null;
    return recordFromSidecar(slug, parsed.parsed);
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name !== "NoSuchKey" && name !== "NotFound") {
      console.warn(
        `${LOG_PREFIX} read failed for ${slug}:`,
        err instanceof Error ? err.message : err,
      );
    }
    return null;
  }
}

/**
 * List every MCP-type connection assignment record under an agent
 * workspace prefix. Null = store unavailable (callers fall back
 * conservatively, mirroring `listWorkspaceMcpSlugs`); [] = none.
 * Unreadable/invalid sidecars and non-MCP connections are skipped.
 */
export async function listConnectionAssignments(
  targetPrefix: string,
  deps: ConnectionAssignmentDeps = {},
): Promise<ConnectionAssignmentRecord[] | null> {
  const bucket = deps.bucket ?? workspaceBucket();
  if (!bucket) return null;
  const client = deps.s3 ?? s3Client();
  const prefix = `${targetPrefix}connections/`;
  const slugs: string[] = [];
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
        const match = rel.match(CONNECTION_SIDECAR_RE);
        if (match?.[1]) slugs.push(match[1]);
      }
      continuationToken = resp.IsTruncated
        ? resp.NextContinuationToken
        : undefined;
    } while (continuationToken);
  } catch (err) {
    console.warn(
      `${LOG_PREFIX} list failed under ${prefix}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
  const records: ConnectionAssignmentRecord[] = [];
  for (const slug of slugs.sort()) {
    const record = await readConnectionAssignment(targetPrefix, slug, {
      ...deps,
      bucket,
    });
    if (record) records.push(record);
  }
  return records;
}
