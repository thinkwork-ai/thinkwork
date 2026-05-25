import {
  HeadObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

import { CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES } from "./customer-onboarding-seed.js";
import { spaceSourcePrefix } from "./template-migration.js";

export interface EnsureCustomerOnboardingSourceFilesInput {
  bucket: string;
  tenantSlug: string;
  spaceSlug: string;
  overwrite?: boolean;
  s3Client: Pick<S3Client, "send">;
}

export interface EnsureCustomerOnboardingSourceFilesResult {
  targetPrefix: string;
  total: number;
  written: string[];
  skipped: string[];
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
  input: EnsureCustomerOnboardingSourceFilesInput,
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

export async function ensureCustomerOnboardingSourceFiles(
  input: EnsureCustomerOnboardingSourceFilesInput,
): Promise<EnsureCustomerOnboardingSourceFilesResult> {
  if (!input.bucket.trim()) throw new Error("bucket is required");
  if (!input.tenantSlug.trim()) throw new Error("tenantSlug is required");
  if (!input.spaceSlug.trim()) throw new Error("spaceSlug is required");

  const targetPrefix = spaceSourcePrefix(input.tenantSlug, input.spaceSlug);
  const written: string[] = [];
  const skipped: string[] = [];

  for (const file of CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES) {
    const key = `${targetPrefix}${file.path}`;
    if (!input.overwrite && (await sourceFileExists(input, key))) {
      skipped.push(file.path);
      continue;
    }

    await input.s3Client.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: key,
        Body: file.content,
        ContentType: "text/markdown; charset=utf-8",
      }),
    );
    written.push(file.path);
  }

  return {
    targetPrefix,
    total: CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES.length,
    written,
    skipped,
  };
}
