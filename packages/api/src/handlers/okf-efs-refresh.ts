import { S3Client } from "@aws-sdk/client-s3";
import {
  discoverOkfCurrentTenantSlugs,
  refreshOkfEfsCurrentView,
  type OkfEfsRefreshS3Client,
} from "../lib/okf/efs-refresh.js";

export interface OkfEfsRefreshEvent {
  tenantSlug?: string;
  tenantSlugs?: string[];
  currentManifestKey?: string;
  dryRun?: boolean;
}

export interface OkfEfsRefreshResult {
  ok: boolean;
  dryRun: boolean;
  tenants_processed: number;
  tenants_refreshed: number;
  files_written: number;
  bytes_written: number;
  results: Array<{
    tenantSlug: string;
    bundleId: string;
    currentPath: string;
    bundlePath: string;
    fileCount: number;
  }>;
  errors: Array<{ tenantSlug: string; message: string }>;
}

const REGION = process.env.AWS_REGION || "us-east-1";
const DEFAULT_EFS_ROOT = "/mnt/thinkwork-okf";

export function createOkfEfsRefreshHandler(
  args: {
    s3?: OkfEfsRefreshS3Client;
  } = {},
) {
  return async function okfEfsRefreshHandler(
    event: OkfEfsRefreshEvent = {},
  ): Promise<OkfEfsRefreshResult> {
    return runOkfEfsRefresh(event, args.s3);
  };
}

export async function handler(
  event: OkfEfsRefreshEvent = {},
): Promise<OkfEfsRefreshResult> {
  return runOkfEfsRefresh(event);
}

async function runOkfEfsRefresh(
  event: OkfEfsRefreshEvent = {},
  injectedS3?: OkfEfsRefreshS3Client,
): Promise<OkfEfsRefreshResult> {
  const dryRun = event.dryRun === true;
  const result: OkfEfsRefreshResult = {
    ok: true,
    dryRun,
    tenants_processed: 0,
    tenants_refreshed: 0,
    files_written: 0,
    bytes_written: 0,
    results: [],
    errors: [],
  };

  const bucket = process.env.BRAIN_ARTIFACTS_BUCKET;
  if (!bucket) {
    return {
      ...result,
      ok: false,
      errors: [
        { tenantSlug: "*", message: "BRAIN_ARTIFACTS_BUCKET env var not set" },
      ],
    };
  }

  const efsRoot = process.env.OKF_EFS_ROOT || DEFAULT_EFS_ROOT;
  const s3 = injectedS3 ?? new S3Client({ region: REGION });
  let tenantSlugs: string[];
  try {
    tenantSlugs = await resolveTenantSlugs({ s3, bucket, event });
  } catch (error) {
    return {
      ...result,
      ok: false,
      errors: [
        {
          tenantSlug: "*",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
  if (tenantSlugs.length === 0) {
    console.log("[okf-efs-refresh] no OKF current manifests found");
    return result;
  }

  for (const tenantSlug of tenantSlugs) {
    result.tenants_processed += 1;
    try {
      const refresh = await refreshOkfEfsCurrentView({
        s3,
        bucket,
        efsRoot,
        tenantSlug,
        currentManifestKey: event.currentManifestKey ?? null,
        dryRun,
      });
      result.tenants_refreshed += 1;
      result.files_written += dryRun ? 0 : refresh.files.length;
      result.bytes_written += dryRun ? 0 : refresh.bytesWritten;
      result.results.push({
        tenantSlug: refresh.tenantSlug,
        bundleId: refresh.bundleId,
        currentPath: refresh.currentPath,
        bundlePath: refresh.bundlePath,
        fileCount: refresh.files.length,
      });
    } catch (error) {
      result.ok = false;
      result.errors.push({
        tenantSlug,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(`[okf-efs-refresh] ${JSON.stringify(result)}`);
  return result;
}

async function resolveTenantSlugs(args: {
  s3: OkfEfsRefreshS3Client;
  bucket: string;
  event: OkfEfsRefreshEvent;
}): Promise<string[]> {
  if (args.event.tenantSlug) return [args.event.tenantSlug];
  if (args.event.tenantSlugs?.length) {
    return [...new Set(args.event.tenantSlugs)];
  }
  if (args.event.currentManifestKey) {
    const match = args.event.currentManifestKey.match(
      /^okf-current-manifests\/([^/]+)\/current\.json$/,
    );
    return match?.[1] ? [match[1]] : [];
  }
  return discoverOkfCurrentTenantSlugs({
    s3: args.s3,
    bucket: args.bucket,
  });
}
