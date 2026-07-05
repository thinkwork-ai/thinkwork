/**
 * Capability folder write path (THINK-173 plan U7 — R3, R4, R18).
 *
 * The single S3 write shape for `connections/<slug>/` and `tools/<slug>/`
 * folders in the agent workspace SOURCE prefix. Three authorized callers
 * (KTD-3): the grant/detach resolvers (operator), the U11 backfill, and
 * the plugin-cutover reconciler — each passes its `signedBy` provenance.
 *
 * Grant-as-approve closes the review-then-swap race: signing reads the
 * definition bytes AT approval moment and pins their sha into the
 * sidecar, so a rewrite between review and sign yields `definition_drift`
 * at the next render, never a blessed unreviewed capability.
 *
 * Mirrors `skills/assignment-state.ts` S3 conventions (shared client,
 * WORKSPACE_BUCKET config, best-effort semantics decided by CALLERS —
 * these functions return typed results and never throw for expected
 * failure shapes).
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getConfig } from "@thinkwork/runtime-config";
import { stringify as stringifyYaml } from "yaml";
import {
  CAPABILITY_SIDECAR_FILE,
  CONNECTION_DEFINITION_FILE,
  TOOL_DEFINITION_FILE,
  type ApprovalPolicy,
} from "./definition-schemas.js";
import {
  resolveConfiguredCapabilitySigner,
  signCapabilitySidecar,
  type CapabilitySignedBy,
  type CapabilitySigner,
} from "./sidecar-signing.js";

export type CapabilityFolderClass = "connection" | "tool";

export interface CapabilityFolderWriteDeps {
  s3?: Pick<S3Client, "send">;
  bucket?: string;
  signer?: CapabilitySigner | null;
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

export function capabilityDefinitionKey(
  targetPrefix: string,
  klass: CapabilityFolderClass,
  slug: string,
): string {
  const file =
    klass === "connection" ? CONNECTION_DEFINITION_FILE : TOOL_DEFINITION_FILE;
  return `${targetPrefix}${klass}s/${slug}/${file}`;
}

export function capabilitySidecarKey(
  targetPrefix: string,
  klass: CapabilityFolderClass,
  slug: string,
): string {
  return `${targetPrefix}${klass}s/${slug}/${CAPABILITY_SIDECAR_FILE}`;
}

export interface CapabilitySidecarFields {
  enabled?: boolean;
  permissions?: { operations?: string[] } & Record<string, unknown>;
  approval?: ApprovalPolicy;
  /** Credential/OAuth wiring — references only, never values (R2). */
  config?: Record<string, unknown>;
  /** Script trust verdict (U8) — signed with the rest of the sidecar. */
  trust?: Record<string, unknown>;
}

export type FolderWriteResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "bucket_unconfigured"
        | "signing_unavailable"
        | "definition_missing"
        | "write_failed";
      detail?: string;
    };

/**
 * Sign the sidecar for an EXISTING definition folder (grant-as-approve,
 * F1/F3): reads the definition bytes currently in the workspace, pins
 * their sha, writes the signed sidecar beside them. An absent definition
 * is `definition_missing` — grant never conjures a folder the operator
 * has not seen.
 */
export async function signExistingCapabilityFolder(input: {
  targetPrefix: string;
  klass: CapabilityFolderClass;
  slug: string;
  sidecar: CapabilitySidecarFields;
  signedBy: CapabilitySignedBy;
  deps?: CapabilityFolderWriteDeps;
}): Promise<FolderWriteResult> {
  const deps = input.deps ?? {};
  const bucket = deps.bucket ?? workspaceBucket();
  if (!bucket) return { ok: false, reason: "bucket_unconfigured" };
  const s3 = deps.s3 ?? s3Client();

  let definitionBytes: string | null = null;
  try {
    const resp = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: capabilityDefinitionKey(
          input.targetPrefix,
          input.klass,
          input.slug,
        ),
      }),
    );
    definitionBytes = (await resp.Body?.transformToString()) ?? null;
  } catch {
    definitionBytes = null;
  }
  if (definitionBytes === null) {
    return { ok: false, reason: "definition_missing" };
  }
  return writeSignedSidecar({ ...input, definitionBytes, bucket, s3, deps });
}

/**
 * Write a full capability folder — definition AND signed sidecar — for
 * platform-generated definitions (mcp dual-write, U11 backfill, plugin
 * reconciler). The definition is platform-authored, so signing over the
 * exact bytes being written is review-equivalent.
 */
export async function putCapabilityFolder(input: {
  targetPrefix: string;
  klass: CapabilityFolderClass;
  slug: string;
  definition: string;
  sidecar: CapabilitySidecarFields;
  signedBy: CapabilitySignedBy;
  deps?: CapabilityFolderWriteDeps;
}): Promise<FolderWriteResult> {
  const deps = input.deps ?? {};
  const bucket = deps.bucket ?? workspaceBucket();
  if (!bucket) return { ok: false, reason: "bucket_unconfigured" };
  const s3 = deps.s3 ?? s3Client();
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: capabilityDefinitionKey(
          input.targetPrefix,
          input.klass,
          input.slug,
        ),
        Body: input.definition,
        ContentType: "text/markdown; charset=utf-8",
      }),
    );
  } catch (err) {
    return {
      ok: false,
      reason: "write_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  return writeSignedSidecar({
    ...input,
    definitionBytes: input.definition,
    bucket,
    s3,
    deps,
  });
}

async function writeSignedSidecar(input: {
  targetPrefix: string;
  klass: CapabilityFolderClass;
  slug: string;
  sidecar: CapabilitySidecarFields;
  signedBy: CapabilitySignedBy;
  definitionBytes: string;
  bucket: string;
  s3: Pick<S3Client, "send">;
  deps: CapabilityFolderWriteDeps;
}): Promise<FolderWriteResult> {
  const signer =
    input.deps.signer !== undefined
      ? input.deps.signer
      : await resolveConfiguredCapabilitySigner();
  if (!signer) return { ok: false, reason: "signing_unavailable" };

  const base: Record<string, unknown> = {
    slug: input.slug,
    class: input.klass,
    updated_at: new Date().toISOString(),
    ...(input.sidecar.enabled !== undefined
      ? { enabled: input.sidecar.enabled }
      : {}),
    ...(input.sidecar.permissions
      ? { permissions: input.sidecar.permissions }
      : {}),
    ...(input.sidecar.approval ? { approval: input.sidecar.approval } : {}),
    ...(input.sidecar.config ? { config: input.sidecar.config } : {}),
    ...(input.sidecar.trust ? { trust: input.sidecar.trust } : {}),
  };
  const { signed_content_sha, signature } = signCapabilitySidecar({
    signer,
    sidecar: base,
    definitionBytes: input.definitionBytes,
    signedBy: input.signedBy,
  });
  try {
    await input.s3.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: capabilitySidecarKey(input.targetPrefix, input.klass, input.slug),
        Body: `${JSON.stringify({ ...base, signed_content_sha, signature }, null, 2)}\n`,
        ContentType: "application/json",
      }),
    );
  } catch (err) {
    return {
      ok: false,
      reason: "write_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  return { ok: true };
}

/**
 * Detach = remove the SIDECAR only: the definition file remains as an
 * inert unsigned proposal (folder presence never activates anything, R3).
 */
export async function removeCapabilitySidecar(input: {
  targetPrefix: string;
  klass: CapabilityFolderClass;
  slug: string;
  deps?: CapabilityFolderWriteDeps;
}): Promise<FolderWriteResult> {
  return deleteKeys(input, [
    capabilitySidecarKey(input.targetPrefix, input.klass, input.slug),
  ]);
}

/** Remove the whole folder (definition + sidecar) — legacy-detach parity. */
export async function removeCapabilityFolder(input: {
  targetPrefix: string;
  klass: CapabilityFolderClass;
  slug: string;
  deps?: CapabilityFolderWriteDeps;
}): Promise<FolderWriteResult> {
  return deleteKeys(input, [
    capabilitySidecarKey(input.targetPrefix, input.klass, input.slug),
    capabilityDefinitionKey(input.targetPrefix, input.klass, input.slug),
  ]);
}

async function deleteKeys(
  input: { deps?: CapabilityFolderWriteDeps },
  keys: string[],
): Promise<FolderWriteResult> {
  const deps = input.deps ?? {};
  const bucket = deps.bucket ?? workspaceBucket();
  if (!bucket) return { ok: false, reason: "bucket_unconfigured" };
  const s3 = deps.s3 ?? s3Client();
  try {
    for (const key of keys) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: "write_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Generate a `connections/<slug>/CONNECTION.md` from a tenant MCP
 * registry row (mcp dual-write + U11 backfill reclassification). Refs
 * only — `auth_config` values never enter the definition; the sidecar
 * carries `credentialRefs.registryServerId` so dispatch keeps resolving
 * the same secrets (R17).
 */
export function connectionDefinitionFromRegistryRow(row: {
  slug: string | null;
  name: string;
  url: string;
  transport?: string | null;
  tools?: unknown;
}): { slug: string; definition: string } {
  const slug = (row.slug ?? row.name)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-");
  const operations = Array.isArray(row.tools)
    ? (row.tools as Array<{ name?: unknown } | string>)
        .map((tool) =>
          typeof tool === "string"
            ? tool
            : typeof tool?.name === "string"
              ? tool.name
              : null,
        )
        .filter((name): name is string => Boolean(name))
    : [];
  const frontmatter = stringifyYaml({
    name: slug,
    description: `${row.name} MCP connection (platform-managed).`,
    type: "mcp",
    url: row.url,
    ...(row.transport ? { transport: row.transport } : {}),
    ...(operations.length > 0 ? { operations } : {}),
  }).trimEnd();
  const definition = `---\n${frontmatter}\n---\n\n${row.name} — MCP connection managed by the ThinkWork platform. Assignment state lives in \`.assignment.json\`; credentials resolve at dispatch from platform stores (never from this folder).\n`;
  return { slug, definition };
}
