import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { isBuiltinToolSlug } from "./builtin-tool-slugs.js";
import {
  isCatalogRef,
  isCatalogSlug,
  type CatalogRef,
} from "../types/catalog-skill.js";

export type CatalogUninstallOptions = {
  s3: S3Client;
  bucket: string;
  targetPrefix: string;
  slug: string;
};

export type CatalogUninstallResult = {
  ok: true;
  deleted_paths: string[];
  context_md_strip:
    | "removed"
    | "catalog_ref_missing"
    | "context_md_missing"
    | "snippet_not_found";
  context_md_changed_path?: "CONTEXT.md";
};

export class CatalogUninstallError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CatalogUninstallError";
  }
}

export async function uninstallCatalogSkill(
  options: CatalogUninstallOptions,
): Promise<CatalogUninstallResult> {
  const slug = options.slug.trim();
  validateUninstallInput(slug);

  const installPrefix = `${options.targetPrefix}skills/${slug}/`;
  const installedKeys = await listObjectKeys(options, installPrefix);
  const refKey = `${installPrefix}.catalog-ref.json`;
  const catalogRef = await readCatalogRefIfPresent(options, refKey);
  let contextMdStrip: CatalogUninstallResult["context_md_strip"] =
    catalogRef === null ? "catalog_ref_missing" : "snippet_not_found";
  let contextChanged = false;

  if (catalogRef) {
    const contextKey = `${options.targetPrefix}CONTEXT.md`;
    let contextContent: string | null;
    try {
      contextContent = await readTextObject(options, contextKey);
    } catch (err) {
      if (!isNoSuchKey(err)) throw err;
      contextContent = null;
    }

    if (contextContent === null) {
      contextMdStrip = "context_md_missing";
    } else {
      const stripped = stripExactSnippet(contextContent, catalogRef.snippet);
      if (stripped.changed) {
        await options.s3.send(
          new PutObjectCommand({
            Bucket: options.bucket,
            Key: contextKey,
            Body: stripped.content,
            ContentType: "text/markdown; charset=utf-8",
          }),
        );
        contextMdStrip = "removed";
        contextChanged = true;
      }
    }
  }

  for (const key of installedKeys) {
    await options.s3.send(
      new DeleteObjectCommand({ Bucket: options.bucket, Key: key }),
    );
  }

  return {
    ok: true,
    deleted_paths: installedKeys.map((key) =>
      key.slice(options.targetPrefix.length),
    ),
    context_md_strip: contextMdStrip,
    ...(contextChanged
      ? { context_md_changed_path: "CONTEXT.md" as const }
      : {}),
  };
}

function validateUninstallInput(slug: string): void {
  if (!isCatalogSlug(slug)) {
    throw new CatalogUninstallError(
      400,
      "invalid_slug",
      "Skill slug must be a catalog slug.",
    );
  }
  if (isBuiltinToolSlug(slug)) {
    throw new CatalogUninstallError(
      400,
      "builtin_tool_slug",
      `Catalog skill slug '${slug}' conflicts with a built-in tool slug.`,
    );
  }
}

async function readCatalogRefIfPresent(
  options: Pick<CatalogUninstallOptions, "s3" | "bucket">,
  key: string,
): Promise<CatalogRef | null> {
  let raw: string;
  try {
    raw = await readTextObject(options, key);
  } catch (err) {
    if (isNoSuchKey(err)) return null;
    throw err;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!isCatalogRef(parsed)) {
    throw new CatalogUninstallError(
      400,
      "invalid_catalog_ref",
      "Installed skill catalog reference is invalid.",
    );
  }
  return parsed;
}

async function listObjectKeys(
  options: Pick<CatalogUninstallOptions, "s3" | "bucket">,
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
  options: Pick<CatalogUninstallOptions, "s3" | "bucket">,
  key: string,
): Promise<string> {
  const response = await options.s3.send(
    new GetObjectCommand({ Bucket: options.bucket, Key: key }),
  );
  return (await response.Body?.transformToString("utf-8")) ?? "";
}

function stripExactSnippet(
  context: string,
  snippet: string,
): { content: string; changed: boolean } {
  const cleanSnippet = snippet.replace(/\r\n?/g, "\n").trimEnd();
  const normalizedContext = context.replace(/\r\n?/g, "\n");
  if (!cleanSnippet || !normalizedContext.includes(cleanSnippet)) {
    return { content: normalizedContext, changed: false };
  }
  const next = normalizedContext
    .replace(cleanSnippet, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n");
  return { content: next, changed: true };
}

function isNoSuchKey(err: unknown): boolean {
  if (err instanceof NoSuchKey) return true;
  const name = (err as { name?: string } | null)?.name;
  const status = (err as { $metadata?: { httpStatusCode?: number } } | null)
    ?.$metadata?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}
