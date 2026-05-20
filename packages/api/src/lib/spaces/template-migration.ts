import {
  CopyObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  S3Client,
} from "@aws-sdk/client-s3";

const REGION =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const s3 = new S3Client({ region: REGION });

export const TEMPLATE_MIGRATION_VERSION = 1;

export interface TemplateWorkspaceMigrationInput {
  tenantSlug: string;
  spaceSlug: string;
  templateSlug?: string | null;
  bucket?: string;
  mode?: "overwrite" | "preserve-existing";
  includeDefaults?: boolean;
  s3Client?: Pick<S3Client, "send">;
}

export interface TemplateWorkspaceMigrationResult {
  tenantSlug: string;
  spaceSlug: string;
  copied: number;
  skipped: number;
  total: number;
}

export function migratedTemplateSpaceSlug(templateSlug: string): string {
  const normalized = templateSlug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `template-${normalized || "template"}`;
}

export function spaceSourcePrefix(
  tenantSlug: string,
  spaceSlug: string,
): string {
  return `tenants/${tenantSlug}/spaces/${spaceSlug}/source/`;
}

export function legacyTemplateWorkspacePrefix(
  tenantSlug: string,
  templateSlug: string,
): string {
  return `tenants/${tenantSlug}/agents/_catalog/${templateSlug}/workspace/`;
}

export function legacyDefaultsWorkspacePrefix(tenantSlug: string): string {
  return `tenants/${tenantSlug}/agents/_catalog/defaults/workspace/`;
}

function bucket(input?: string): string {
  return input || process.env.WORKSPACE_BUCKET || "";
}

function isNotFound(err: unknown): boolean {
  if (err instanceof NoSuchKey) return true;
  const name = (err as { name?: string } | null)?.name;
  if (name === "NoSuchKey" || name === "NotFound") return true;
  const status = (err as { $metadata?: { httpStatusCode?: number } } | null)
    ?.$metadata?.httpStatusCode;
  return status === 404;
}

function shouldSkipSourcePath(path: string): boolean {
  return !path || path === "manifest.json" || path === "_defaults_version";
}

async function listSourceKeys(
  client: Pick<S3Client, "send">,
  bkt: string,
  prefix: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let continuationToken: string | undefined;
  do {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: bkt,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of resp.Contents ?? []) {
      if (!obj.Key) continue;
      const relPath = obj.Key.slice(prefix.length);
      if (shouldSkipSourcePath(relPath)) continue;
      out.set(relPath, obj.Key);
    }
    continuationToken = resp.IsTruncated
      ? resp.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return out;
}

async function targetExists(
  client: Pick<S3Client, "send">,
  bkt: string,
  key: string,
): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bkt, Key: key }));
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

/**
 * Copy legacy Template/default workspace files into the new Space source
 * prefix. Defaults fill gaps, Template files win on collisions, and
 * preserve-existing mode avoids clobbering operator-authored Space source.
 */
export async function migrateTemplateWorkspaceToSpaceSource(
  input: TemplateWorkspaceMigrationInput,
): Promise<TemplateWorkspaceMigrationResult> {
  const bkt = bucket(input.bucket);
  if (!bkt) throw new Error("WORKSPACE_BUCKET not configured");

  const client = input.s3Client ?? s3;
  const mode = input.mode ?? "preserve-existing";
  const includeDefaults = input.includeDefaults ?? true;
  const targetPrefix = spaceSourcePrefix(input.tenantSlug, input.spaceSlug);

  const sources = new Map<string, string>();
  if (includeDefaults) {
    const defaults = await listSourceKeys(
      client,
      bkt,
      legacyDefaultsWorkspacePrefix(input.tenantSlug),
    );
    for (const [rel, key] of defaults) sources.set(rel, key);
  }

  if (input.templateSlug) {
    const template = await listSourceKeys(
      client,
      bkt,
      legacyTemplateWorkspacePrefix(input.tenantSlug, input.templateSlug),
    );
    for (const [rel, key] of template) sources.set(rel, key);
  }

  let copied = 0;
  let skipped = 0;
  for (const [relPath, sourceKey] of sources) {
    const targetKey = `${targetPrefix}${relPath}`;
    if (mode === "preserve-existing") {
      if (await targetExists(client, bkt, targetKey)) {
        skipped++;
        continue;
      }
    }
    await client.send(
      new CopyObjectCommand({
        Bucket: bkt,
        CopySource: `${bkt}/${sourceKey}`,
        Key: targetKey,
      }),
    );
    copied++;
  }

  return {
    tenantSlug: input.tenantSlug,
    spaceSlug: input.spaceSlug,
    copied,
    skipped,
    total: sources.size,
  };
}
