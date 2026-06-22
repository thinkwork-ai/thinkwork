import { getConfig } from "@thinkwork/runtime-config";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3Client as S3ClientType,
} from "@aws-sdk/client-s3";
import { extractBundledEvalCases } from "../catalog-install.js";
import { reindexCatalogSkill } from "../catalog-index.js";
import {
  CATALOG_SKILL_ARCHIVE_LIMITS,
  textFromCatalogArchiveFile,
  validateCatalogSkillFiles,
  type CatalogSkillArchiveFile,
} from "../catalog-skill-archive.js";
import { ensureSkillDatasetSeeded } from "../evals/skill-dataset.js";
import { launchSkillEvalRun } from "../evals/skill-eval-run.js";
import {
  buildCatalogSkillTrustReport,
  type SkillTrustPipelineReport,
} from "../skill-trust/catalog-report.js";
import { runSkillSpectorForFiles } from "../skill-trust/skillspector.js";

export interface DraftPublishRow {
  id: string;
  slug: string;
  status: string;
  draft_s3_prefix: string;
  current_content_hash: string | null;
}

export interface SkillDraftPublishResult {
  slug: string;
  contentHash: string;
  replaced: boolean;
  generatedWiring: boolean;
  trustReport: SkillTrustPipelineReport;
  indexWarning?: string;
  evalDataset?: { slug: string; cases: number; skipped: number };
  evalDatasetWarning?: string;
  evalRun?: { status: string };
}

export type SkillDraftPublishReadinessErrorCode =
  | "draft_not_submitted"
  | "draft_empty"
  | "invalid_skill_draft"
  | "slug_mismatch"
  | "skillspector_required"
  | "trust_failed"
  | "trust_blocked"
  | "skill_exists";

export class SkillDraftPublishError extends Error {
  constructor(
    public readonly code: SkillDraftPublishReadinessErrorCode,
    message: string,
    public readonly status = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SkillDraftPublishError";
  }
}

export interface SkillDraftPublishStorage {
  list(prefix: string): Promise<string[]>;
  read(key: string): Promise<Buffer>;
  write(
    key: string,
    content: Buffer,
    contentType: string,
    options?: { ifNoneMatch?: string },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface PublishSkillDraftToCatalogInput {
  tenantId: string;
  tenantSlug: string;
  draft: DraftPublishRow;
  confirmReplace?: boolean;
  storage?: SkillDraftPublishStorage;
  now?: Date;
}

export async function publishSkillDraftToCatalog(
  input: PublishSkillDraftToCatalogInput,
): Promise<SkillDraftPublishResult> {
  if (input.draft.status !== "submitted") {
    throw new SkillDraftPublishError(
      "draft_not_submitted",
      "Only submitted skill drafts can be published.",
      409,
    );
  }

  const storage = input.storage ?? createS3SkillDraftPublishStorage();
  const draftFiles = await readDraftFiles(storage, input.draft.draft_s3_prefix);
  if (draftFiles.length === 0) {
    throw new SkillDraftPublishError(
      "draft_empty",
      "Skill draft has no files to publish.",
      422,
    );
  }

  const validated = validateCatalogSkillFiles(draftFiles);
  if (!validated.ok) {
    throw new SkillDraftPublishError(
      "invalid_skill_draft",
      "Skill draft files are not a valid Agent Skills directory.",
      422,
      { errors: validated.errors },
    );
  }
  if (validated.slug !== input.draft.slug) {
    throw new SkillDraftPublishError(
      "slug_mismatch",
      `Draft slug '${input.draft.slug}' does not match SKILL.md name '${validated.slug}'.`,
      422,
      { slug: validated.slug },
    );
  }

  const scan = await runSkillSpectorForFiles({
    slug: validated.slug,
    files: validated.files,
  });
  const trustReport = buildCatalogSkillTrustReport({
    slug: validated.slug,
    files: validated.files,
    scanner: scan.scanner,
    scannerFindings: scan.findings,
    now: input.now,
  });
  assertPublishTrustReady(trustReport);

  const catalogPrefix = `tenants/${input.tenantSlug}/skill-catalog/${validated.slug}/`;
  const existingRelativePaths = await storage.list(catalogPrefix);
  const existingKeys = existingRelativePaths.map(
    (relativePath) => `${catalogPrefix}${relativePath}`,
  );
  const replaced = existingKeys.length > 0;
  if (replaced && !input.confirmReplace) {
    throw new SkillDraftPublishError(
      "skill_exists",
      `Catalog skill '${validated.slug}' already exists.`,
      409,
      { slug: validated.slug },
    );
  }

  const priorObjects = replaced
    ? await Promise.all(
        existingKeys.map(async (key) => ({
          key,
          content: await storage.read(key),
          contentType: contentTypeForCatalogSkillPath(key),
        })),
      )
    : [];
  const writtenKeys: string[] = [];

  try {
    if (replaced) {
      for (const key of existingKeys) await storage.delete(key);
    }
    for (const file of validated.files) {
      const key = `${catalogPrefix}${file.path}`;
      await storage.write(
        key,
        file.content,
        contentTypeForCatalogSkillPath(file.path),
        {
          ...(!replaced && !input.confirmReplace ? { ifNoneMatch: "*" } : {}),
        },
      );
      writtenKeys.push(key);
    }
  } catch (err) {
    await rollbackCatalogWrite(storage, writtenKeys, priorObjects);
    throw err;
  }

  const indexWarning = await reindexAfterPublish({
    tenantId: input.tenantId,
    tenantSlug: input.tenantSlug,
    slug: validated.slug,
  });
  const evalOutcome = await syncBundledEvals(
    input.tenantId,
    validated.slug,
    validated.files,
  );

  return {
    slug: validated.slug,
    contentHash: trustReport.contentHash,
    replaced,
    generatedWiring: validated.generatedWiring,
    trustReport,
    ...(indexWarning ? { indexWarning } : {}),
    ...evalOutcome,
  };
}

function assertPublishTrustReady(report: SkillTrustPipelineReport): void {
  if (report.scanner.status === "not_configured") {
    throw new SkillDraftPublishError(
      "skillspector_required",
      "Skill draft cannot be published until SkillSpector is configured and completes.",
      409,
      { trustReport: report },
    );
  }
  if (report.status === "failed" || report.scanner.status === "failed") {
    throw new SkillDraftPublishError(
      "trust_failed",
      "Skill draft trust checks failed.",
      409,
      { trustReport: report },
    );
  }
  if (report.status === "blocked") {
    throw new SkillDraftPublishError(
      "trust_blocked",
      "Skill draft has critical or high SkillSpector findings.",
      409,
      { trustReport: report },
    );
  }
  if (report.status !== "passed") {
    throw new SkillDraftPublishError(
      "trust_failed",
      "Skill draft trust checks are not publish-ready.",
      409,
      { trustReport: report },
    );
  }
}

async function readDraftFiles(
  storage: SkillDraftPublishStorage,
  prefix: string,
): Promise<CatalogSkillArchiveFile[]> {
  const relativePaths = await storage.list(prefix);
  if (relativePaths.length > CATALOG_SKILL_ARCHIVE_LIMITS.maxEntries) {
    throw new SkillDraftPublishError(
      "invalid_skill_draft",
      `Skill draft has ${relativePaths.length} files; max is ${CATALOG_SKILL_ARCHIVE_LIMITS.maxEntries}.`,
      422,
    );
  }
  let totalBytes = 0;
  const files: CatalogSkillArchiveFile[] = [];
  for (const relativePath of relativePaths) {
    const content = await storage.read(`${prefix}${relativePath}`);
    totalBytes += content.byteLength;
    if (
      content.byteLength > CATALOG_SKILL_ARCHIVE_LIMITS.maxFileBytes ||
      totalBytes > CATALOG_SKILL_ARCHIVE_LIMITS.maxTotalUncompressedBytes
    ) {
      throw new SkillDraftPublishError(
        "invalid_skill_draft",
        `Skill draft file '${relativePath}' exceeds size limits.`,
        422,
      );
    }
    files.push({ path: relativePath, content });
  }
  return files;
}

async function rollbackCatalogWrite(
  storage: SkillDraftPublishStorage,
  writtenKeys: string[],
  priorObjects: { key: string; content: Buffer; contentType: string }[],
) {
  await Promise.allSettled(writtenKeys.map((key) => storage.delete(key)));
  await Promise.allSettled(
    priorObjects.map((object) =>
      storage.write(object.key, object.content, object.contentType),
    ),
  );
}

async function reindexAfterPublish(args: {
  tenantId: string;
  tenantSlug: string;
  slug: string;
}): Promise<string | undefined> {
  const s3 = new S3Client({});
  try {
    await reindexCatalogSkill({
      tenantId: args.tenantId,
      tenantSlug: args.tenantSlug,
      slug: args.slug,
      client: s3,
      bucket: workspaceBucket(),
    });
    return undefined;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Skill catalog index not updated for '${args.slug}'; run 'thinkwork skill catalog rebuild' to reconcile. ${message}`;
  }
}

async function syncBundledEvals(
  tenantId: string,
  slug: string,
  files: CatalogSkillArchiveFile[],
): Promise<{
  evalDataset?: { slug: string; cases: number; skipped: number };
  evalDatasetWarning?: string;
  evalRun?: { status: string };
}> {
  const evalCases = extractBundledEvalCases(
    files.map((file) => ({
      relativePath: file.path,
      content: textFromCatalogArchiveFile(file),
    })),
  );
  if (evalCases.length === 0) return {};
  try {
    const seeded = await ensureSkillDatasetSeeded(tenantId, slug, evalCases);
    const launch = await launchSkillEvalRun({ tenantId, skillSlug: slug });
    return {
      evalDataset: {
        slug: seeded.datasetSlug,
        cases: seeded.bundledCaseCount,
        skipped: seeded.skipped.length,
      },
      evalRun: { status: launch.status },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      evalDatasetWarning: `Skill published but eval dataset sync failed: ${message}`,
    };
  }
}

export function createS3SkillDraftPublishStorage(
  client: S3ClientType = new S3Client({}),
  bucket = workspaceBucket(),
): SkillDraftPublishStorage {
  return {
    async list(prefix) {
      const paths: string[] = [];
      let continuationToken: string | undefined;
      do {
        const resp = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );
        for (const object of resp.Contents ?? []) {
          if (!object.Key || !object.Key.startsWith(prefix)) continue;
          const relativePath = object.Key.slice(prefix.length);
          if (!relativePath || relativePath.endsWith("/")) continue;
          paths.push(relativePath);
        }
        continuationToken = resp.IsTruncated
          ? resp.NextContinuationToken
          : undefined;
      } while (continuationToken);
      return paths.sort();
    },
    async read(key) {
      const resp = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      const bytes = await resp.Body?.transformToByteArray();
      return Buffer.from(bytes ?? []);
    },
    async write(key, content, contentType, options) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: content,
          ContentType: contentType,
          ...(options?.ifNoneMatch ? { IfNoneMatch: options.ifNoneMatch } : {}),
        }),
      );
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

function workspaceBucket(): string {
  const bucket = getConfig("WORKSPACE_BUCKET") || "";
  if (!bucket) throw new Error("WORKSPACE_BUCKET not configured");
  return bucket;
}

function contentTypeForCatalogSkillPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".py")) return "text/x-python; charset=utf-8";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".html")) return "text/html; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".js") || lower.endsWith(".mjs")) {
    return "text/javascript; charset=utf-8";
  }
  return "application/octet-stream";
}
