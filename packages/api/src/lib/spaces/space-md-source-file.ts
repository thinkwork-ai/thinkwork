import {
  HeadObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { loadDefaults } from "@thinkwork/workspace-defaults";

import { spaceSourcePrefix } from "./template-migration.js";

export interface EnsureSpaceMdSourceFileInput {
  bucket: string;
  tenantSlug: string;
  spaceSlug: string;
  spaceName: string;
  description?: string | null;
  overwrite?: boolean;
  s3Client: Pick<S3Client, "send">;
}

export interface EnsureSpaceMdSourceFileResult {
  key: string;
  written: boolean;
}

function isNotFound(err: unknown): boolean {
  if (err instanceof NoSuchKey) return true;
  const name = (err as { name?: string } | null)?.name;
  if (name === "NoSuchKey" || name === "NotFound") return true;
  const status = (err as { $metadata?: { httpStatusCode?: number } } | null)
    ?.$metadata?.httpStatusCode;
  return status === 404;
}

async function sourceFileExists(
  input: EnsureSpaceMdSourceFileInput,
  key: string,
): Promise<boolean> {
  try {
    await input.s3Client.send(
      new HeadObjectCommand({ Bucket: input.bucket, Key: key }),
    );
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

export async function ensureSpaceMdSourceFile(
  input: EnsureSpaceMdSourceFileInput,
): Promise<EnsureSpaceMdSourceFileResult> {
  if (!input.bucket.trim()) throw new Error("bucket is required");
  if (!input.tenantSlug.trim()) throw new Error("tenantSlug is required");
  if (!input.spaceSlug.trim()) throw new Error("spaceSlug is required");
  if (!input.spaceName.trim()) throw new Error("spaceName is required");

  const key = `${spaceSourcePrefix(input.tenantSlug, input.spaceSlug)}SPACE.md`;
  if (!input.overwrite && (await sourceFileExists(input, key))) {
    return { key, written: false };
  }

  await input.s3Client.send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: key,
      Body: defaultSpaceMdContent(input),
      ContentType: "text/markdown; charset=utf-8",
    }),
  );
  return { key, written: true };
}

function defaultSpaceMdContent(input: EnsureSpaceMdSourceFileInput): string {
  const description = input.description?.trim();
  const canonical = loadDefaults()["SPACE.md"];
  const lines = canonical.split("\n");
  lines[0] = `# ${input.spaceName.trim()}`;
  if (description) {
    lines.splice(2, 0, description, "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
