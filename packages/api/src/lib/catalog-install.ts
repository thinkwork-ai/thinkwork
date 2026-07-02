import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import type { CatalogRef } from "../types/catalog-skill.js";
import { isCatalogSlug } from "../types/catalog-skill.js";
import { isBuiltinToolSlug } from "./builtin-tool-slugs.js";
import { parseWiringMd } from "./wiring-md.js";

export type CatalogInstallOptions = {
  s3: S3Client;
  bucket: string;
  tenantSlug: string;
  targetPrefix: string;
  slug: string;
  wiringChoice: string;
  now?: Date;
};

export type CatalogInstallResult = {
  ok: true;
  installed_paths: string[];
  source_sha256: string;
  /**
   * Bundled eval case files (`evals/*.json`) read from the catalog folder
   * during this install, surfaced for the caller to seed the per-skill
   * eval dataset (Skill Tests & Evals U2). Empty when the skill bundles
   * no cases — an "unrated" skill, never an error.
   */
  eval_cases: { fileName: string; content: string }[];
};

/**
 * Extract bundled eval case files from a catalog file listing. Convention:
 * `evals/<name>.json`, one case per file (the seeder validates content).
 * Nested dirs and non-json files are ignored.
 */
export function extractBundledEvalCases(
  files: { relativePath: string; content: string }[],
): { fileName: string; content: string }[] {
  return files
    .filter((file) => /^evals\/[^/]+\.json$/i.test(file.relativePath))
    .map((file) => ({
      fileName: file.relativePath.slice("evals/".length),
      content: file.content,
    }));
}

export class CatalogInstallError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CatalogInstallError";
  }
}

type CatalogFile = {
  relativePath: string;
  key: string;
  content: string;
};

export async function installCatalogSkill(
  options: CatalogInstallOptions,
): Promise<CatalogInstallResult> {
  const slug = options.slug.trim();
  const wiringChoice = options.wiringChoice.trim();
  validateInstallInput(slug, wiringChoice);

  const catalogSkillPrefix = `tenants/${options.tenantSlug}/skill-catalog/${slug}/`;
  const installPrefix = `${options.targetPrefix}skills/${slug}/`;
  const catalogKeys = await listObjectKeys(options, catalogSkillPrefix);
  if (catalogKeys.length === 0) {
    throw new CatalogInstallError(
      404,
      "catalog_skill_not_found",
      `Catalog skill '${slug}' was not found.`,
    );
  }

  const existingInstalled = await listObjectKeys(options, installPrefix);
  if (existingInstalled.length > 0) {
    throw new CatalogInstallError(
      409,
      "already_installed",
      `Skill '${slug}' is already installed in this workspace.`,
    );
  }

  const files = await Promise.all(
    catalogKeys.map(async (key) => ({
      key,
      relativePath: key.slice(catalogSkillPrefix.length),
      content: await readTextObject(options, key),
    })),
  );
  const wiring = files.find((file) => file.relativePath === "WIRING.md");
  if (!wiring) {
    throw new CatalogInstallError(
      400,
      "wiring_md_missing",
      `Catalog skill '${slug}' does not have a WIRING.md file.`,
    );
  }

  const parsed = parseWiringMd(wiring.content);
  const suggestion = parsed.suggestions.find(
    (candidate) => candidate.id === wiringChoice,
  );
  if (!suggestion) {
    throw new CatalogInstallError(
      400,
      "wiring_choice_not_found",
      `Wiring choice '${wiringChoice}' was not found for catalog skill '${slug}'.`,
    );
  }

  // Composer plan U5 (R8, KTD-4): install NEVER touches CONTEXT.md.
  // Routing wiring is computed into the rendered CONTEXT.md `## Routing`
  // managed section at render time. The wiring snippet is still recorded
  // in `.catalog-ref.json` — it carries the install's wiring choice and
  // powers the legacy-snippet migration's exact-match strip.
  const sourceSha256 = sourceSha256ForFiles(files);
  const catalogRef: CatalogRef = {
    slug,
    source_sha256: sourceSha256,
    installed_at: (options.now ?? new Date()).toISOString(),
    wiring_choice: wiringChoice,
    snippet: suggestion.snippet,
  };
  const copiedKeys: string[] = [];
  let refKey: string | null = null;

  try {
    for (const file of files) {
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

    refKey = `${installPrefix}.catalog-ref.json`;
    await options.s3.send(
      new PutObjectCommand({
        Bucket: options.bucket,
        Key: refKey,
        Body: `${JSON.stringify(catalogRef, null, 2)}\n`,
        ContentType: "application/json; charset=utf-8",
      }),
    );
  } catch (err) {
    await rollbackInstall(options, { copiedKeys, refKey });
    throw new CatalogInstallError(
      500,
      "install_failed",
      `Catalog skill install failed after rollback: ${errorMessage(err)}`,
    );
  }

  return {
    ok: true,
    installed_paths: [
      ...files.map((file) => `skills/${slug}/${file.relativePath}`),
      `skills/${slug}/.catalog-ref.json`,
    ].sort(),
    source_sha256: sourceSha256,
    eval_cases: extractBundledEvalCases(files),
  };
}

function validateInstallInput(slug: string, wiringChoice: string): void {
  if (!isCatalogSlug(slug)) {
    throw new CatalogInstallError(
      400,
      "invalid_slug",
      "Skill slug must be a catalog slug.",
    );
  }
  if (isBuiltinToolSlug(slug)) {
    throw new CatalogInstallError(
      400,
      "builtin_tool_slug",
      `Catalog skill slug '${slug}' conflicts with a built-in tool slug.`,
    );
  }
  if (!isCatalogSlug(wiringChoice)) {
    throw new CatalogInstallError(
      400,
      "invalid_wiring_choice",
      "Wiring choice must be a catalog slug.",
    );
  }
}

async function listObjectKeys(
  options: Pick<CatalogInstallOptions, "s3" | "bucket">,
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
  options: Pick<CatalogInstallOptions, "s3" | "bucket">,
  key: string,
): Promise<string> {
  const response = await options.s3.send(
    new GetObjectCommand({ Bucket: options.bucket, Key: key }),
  );
  return (await response.Body?.transformToString("utf-8")) ?? "";
}

function sourceSha256ForFiles(files: CatalogFile[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath),
  )) {
    const fileHash = createHash("sha256").update(file.content).digest("hex");
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(fileHash);
    hash.update("\n");
  }
  return hash.digest("hex");
}

async function rollbackInstall(
  options: Pick<CatalogInstallOptions, "s3" | "bucket">,
  args: {
    copiedKeys: string[];
    refKey: string | null;
  },
): Promise<void> {
  for (const key of [...args.copiedKeys, args.refKey].filter(
    (key): key is string => Boolean(key),
  )) {
    await options.s3
      .send(new DeleteObjectCommand({ Bucket: options.bucket, Key: key }))
      .catch((err) => {
        console.error(
          `[catalog-install] rollback delete failed for ${key}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  }
}

function s3CopySource(bucket: string, key: string): string {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${bucket}/${encoded}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
