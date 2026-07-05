/**
 * Lightweight kind probe for a tool definition folder (THINK-173 U8).
 * The grant mutation needs only the `kind` discriminant to decide
 * whether the script trust gate must run — full validation happens at
 * render (U2).
 */

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getConfig } from "@thinkwork/runtime-config";
import {
  parseToolDefinition,
  TOOL_DEFINITION_FILE,
  type ToolKind,
} from "./definition-schemas.js";

let sharedClient: S3Client | null = null;
function s3Client(): Pick<S3Client, "send"> {
  sharedClient ??= new S3Client({
    region:
      process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
  });
  return sharedClient;
}

export async function readCapabilityDefinitionKind(input: {
  targetPrefix: string;
  slug: string;
  deps?: { s3?: Pick<S3Client, "send">; bucket?: string };
}): Promise<ToolKind | null> {
  const deps = input.deps ?? {};
  let bucket = deps.bucket ?? null;
  if (!bucket) {
    try {
      bucket = getConfig("WORKSPACE_BUCKET") || null;
    } catch {
      bucket = null;
    }
  }
  if (!bucket) return null;
  const s3 = deps.s3 ?? s3Client();
  try {
    const resp = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: `${input.targetPrefix}tools/${input.slug}/${TOOL_DEFINITION_FILE}`,
      }),
    );
    const raw = (await resp.Body?.transformToString()) ?? "";
    const parsed = parseToolDefinition(raw, `tools/${input.slug}/TOOL.md`);
    return parsed.valid ? parsed.parsed.kind : null;
  } catch {
    return null;
  }
}
