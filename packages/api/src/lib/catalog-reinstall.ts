import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { isBuiltinToolSlug } from "./builtin-tool-slugs.js";
import { extractBundledEvalCases } from "./catalog-install.js";
import { computeCatalogSkillSha } from "./catalog-skill-sha.js";
import {
  isCatalogRef,
  isCatalogSlug,
  type CatalogRef,
} from "../types/catalog-skill.js";

export type CatalogReinstallOptions = {
  s3: S3Client;
  bucket: string;
  tenantSlug: string;
  targetPrefix: string;
  slug: string;
  /**
   * Read-only staging (Skill Tests & Evals U6). When true, computes
   * `source_sha256`, reads the bundled `eval_cases`, and determines
   * noop-vs-update (candidate sha === installed ref sha) but performs NO
   * delete/copy/ref-write — the workspace swap is NOT applied. The gated
   * update path uses this to read the candidate's cases and detect an
   * update WITHOUT swapping; the swap happens later via applySkillUpdate.
   * `reinstalled_paths` is always `[]` on a dry run.
   */
  dryRun?: boolean;
};

export type CatalogReinstallResult = {
  ok: true;
  reinstalled_paths: string[];
  source_sha256: string;
  noop?: true;
  /**
   * Bundled eval case files (`evals/*.json`) from the (post-reinstall)
   * catalog folder, surfaced for the caller to re-sync the per-skill eval
   * dataset (Skill Tests & Evals U2). Present on both the changed and
   * no-op paths so the dataset heals even if it was never created.
   */
  eval_cases: { fileName: string; content: string }[];
};

export class CatalogReinstallError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CatalogReinstallError";
  }
}

type CatalogFile = {
  relativePath: string;
  key: string;
  content: string;
};

type ExistingFile = {
  key: string;
  content: string;
};

export async function reinstallCatalogSkill(
  options: CatalogReinstallOptions,
): Promise<CatalogReinstallResult> {
  const slug = options.slug.trim();
  validateReinstallInput(slug);

  const installPrefix = `${options.targetPrefix}skills/${slug}/`;
  const refKey = `${installPrefix}.catalog-ref.json`;
  const { ref: catalogRef, raw: catalogRefRaw } = await readCatalogRef(
    options,
    refKey,
  );
  if (catalogRef.slug !== slug) {
    throw new CatalogReinstallError(
      400,
      "catalog_ref_slug_mismatch",
      "Installed skill catalog reference does not match the requested skill.",
    );
  }

  const catalogSkillPrefix = `tenants/${options.tenantSlug}/skill-catalog/${slug}/`;
  const catalogKeys = await listObjectKeys(options, catalogSkillPrefix);
  if (catalogKeys.length === 0) {
    throw new CatalogReinstallError(
      404,
      "catalog_skill_not_found",
      `Catalog skill '${slug}' was not found.`,
    );
  }

  const catalogFiles = await Promise.all(
    catalogKeys.map(async (key) => ({
      key,
      relativePath: key.slice(catalogSkillPrefix.length),
      content: await readTextObject(options, key),
    })),
  );
  const sourceSha256 = computeCatalogSkillSha(catalogFiles);
  const evalCases = extractBundledEvalCases(catalogFiles);
  if (sourceSha256 === catalogRef.source_sha256) {
    return {
      ok: true,
      noop: true,
      reinstalled_paths: [],
      source_sha256: sourceSha256,
      eval_cases: evalCases,
    };
  }

  // Dry run (Skill Tests & Evals U6): the candidate differs from the
  // installed version, but the gated path reads the candidate cases and
  // detects the update WITHOUT swapping — no delete/copy/ref-write. The
  // swap is deferred to applySkillUpdate once the gate passes.
  if (options.dryRun) {
    return {
      ok: true,
      reinstalled_paths: [],
      source_sha256: sourceSha256,
      eval_cases: evalCases,
    };
  }

  const installedKeys = await listObjectKeys(options, installPrefix);
  const installedFileKeys = installedKeys.filter((key) => key !== refKey);
  const existingFiles = await Promise.all(
    installedFileKeys.map(async (key) => ({
      key,
      content: await readTextObject(options, key),
    })),
  );
  const copiedKeys: string[] = [];

  try {
    for (const key of installedFileKeys) {
      await options.s3.send(
        new DeleteObjectCommand({ Bucket: options.bucket, Key: key }),
      );
    }

    for (const file of catalogFiles) {
      const destKey = `${installPrefix}${file.relativePath}`;
      await options.s3.send(
        new CopyObjectCommand({
          Bucket: options.bucket,
          CopySource: s3CopySource(options.bucket, file.key),
          Key: destKey,
        }),
      );
      copiedKeys.push(destKey);
    }

    await options.s3.send(
      new PutObjectCommand({
        Bucket: options.bucket,
        Key: refKey,
        Body: `${JSON.stringify(
          { ...catalogRef, source_sha256: sourceSha256 },
          null,
          2,
        )}\n`,
        ContentType: "application/json; charset=utf-8",
      }),
    );
  } catch (err) {
    await rollbackReinstall(options, {
      copiedKeys,
      existingFiles,
      refKey,
      catalogRefRaw,
    });
    throw new CatalogReinstallError(
      500,
      "reinstall_failed",
      `Catalog skill reinstall failed after rollback: ${errorMessage(err)}`,
    );
  }

  return {
    ok: true,
    reinstalled_paths: [
      ...catalogFiles.map((file) => `skills/${slug}/${file.relativePath}`),
      `skills/${slug}/.catalog-ref.json`,
    ].sort(),
    source_sha256: sourceSha256,
    eval_cases: evalCases,
  };
}

function validateReinstallInput(slug: string): void {
  if (!isCatalogSlug(slug)) {
    throw new CatalogReinstallError(
      400,
      "invalid_slug",
      "Skill slug must be a catalog slug.",
    );
  }
  if (isBuiltinToolSlug(slug)) {
    throw new CatalogReinstallError(
      400,
      "builtin_tool_slug",
      `Catalog skill slug '${slug}' conflicts with a built-in tool slug.`,
    );
  }
}

async function readCatalogRef(
  options: Pick<CatalogReinstallOptions, "s3" | "bucket">,
  key: string,
): Promise<{ ref: CatalogRef; raw: string }> {
  let raw: string;
  try {
    raw = await readTextObject(options, key);
  } catch (err) {
    if (isNoSuchKey(err)) {
      throw new CatalogReinstallError(
        404,
        "not_installed",
        "Installed skill catalog reference was not found.",
      );
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new CatalogReinstallError(
      400,
      "invalid_catalog_ref",
      "Installed skill catalog reference is invalid.",
    );
  }

  if (!isCatalogRef(parsed)) {
    throw new CatalogReinstallError(
      400,
      "invalid_catalog_ref",
      "Installed skill catalog reference is invalid.",
    );
  }
  return { ref: parsed, raw };
}

async function listObjectKeys(
  options: Pick<CatalogReinstallOptions, "s3" | "bucket">,
  prefix: string,
): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const response = await options.s3.send(
      new ListObjectsV2Command({
        Bucket: options.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const object of response.Contents ?? []) {
      if (object.Key?.startsWith(prefix) && object.Key !== prefix) {
        keys.push(object.Key);
      }
    }
    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return keys.sort();
}

async function readTextObject(
  options: Pick<CatalogReinstallOptions, "s3" | "bucket">,
  key: string,
): Promise<string> {
  const response = await options.s3.send(
    new GetObjectCommand({ Bucket: options.bucket, Key: key }),
  );
  return (await response.Body?.transformToString("utf-8")) ?? "";
}

async function rollbackReinstall(
  options: Pick<CatalogReinstallOptions, "s3" | "bucket">,
  state: {
    copiedKeys: string[];
    existingFiles: ExistingFile[];
    refKey: string;
    catalogRefRaw: string;
  },
): Promise<void> {
  await Promise.allSettled(
    state.copiedKeys.map((key) =>
      options.s3.send(
        new DeleteObjectCommand({ Bucket: options.bucket, Key: key }),
      ),
    ),
  );
  await Promise.allSettled(
    state.existingFiles.map((file) =>
      options.s3.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: file.key,
          Body: file.content,
        }),
      ),
    ),
  );
  await options.s3
    .send(
      new PutObjectCommand({
        Bucket: options.bucket,
        Key: state.refKey,
        Body: state.catalogRefRaw,
        ContentType: "application/json; charset=utf-8",
      }),
    )
    .catch((err) => {
      console.error(
        `[catalog-reinstall] rollback catalog ref restore failed: ${errorMessage(err)}`,
      );
    });
}

function s3CopySource(bucket: string, key: string): string {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${bucket}/${encoded}`;
}

function isNoSuchKey(err: unknown): boolean {
  if (err instanceof NoSuchKey) return true;
  const name = (err as { name?: string } | null)?.name;
  const status = (err as { $metadata?: { httpStatusCode?: number } } | null)
    ?.$metadata?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
