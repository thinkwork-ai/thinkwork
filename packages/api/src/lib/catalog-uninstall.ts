import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  type S3Client,
} from "@aws-sdk/client-s3";
import { isBuiltinToolSlug } from "./builtin-tool-slugs.js";
import { isCatalogSlug } from "../types/catalog-skill.js";

export type CatalogUninstallOptions = {
  s3: S3Client;
  bucket: string;
  targetPrefix: string;
  slug: string;
};

export type CatalogUninstallResult = {
  ok: true;
  deleted_paths: string[];
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

/**
 * Remove an installed catalog skill folder (`skills/<slug>/`, including
 * `.catalog-ref.json`) from a workspace.
 *
 * Composer plan U5 (R8, KTD-4): uninstall NEVER touches CONTEXT.md. The
 * legacy exact-snippet strip is retired — routing wiring lives in the
 * rendered CONTEXT.md `## Routing` managed section, which is recomputed
 * from the installed skill folders on every render, so removing the
 * folder removes the row.
 */
export async function uninstallCatalogSkill(
  options: CatalogUninstallOptions,
): Promise<CatalogUninstallResult> {
  const slug = options.slug.trim();
  validateUninstallInput(slug);

  const installPrefix = `${options.targetPrefix}skills/${slug}/`;
  const installedKeys = await listObjectKeys(options, installPrefix);

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
