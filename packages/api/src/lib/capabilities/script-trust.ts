/**
 * Script-tool trust gate (THINK-173 plan U8 — R8, F4).
 *
 * `script`-kind tools are the only capability class whose folder carries
 * executable tenant content, so registration requires a SkillSpector-
 * class pass over the ENTIRE tool folder (definition, entry script,
 * support files) — the same scanner and blocking-severity rules the
 * skill trust pipeline applies. Fail closed: an unconfigured scanner
 * cannot pass a script tool (the skill-creator/SkillSpector precedent).
 *
 * The passing verdict is recorded INSIDE the signed sidecar as `trust`:
 *   - `status`: "passed"
 *   - `content_sha`: sha256 of the definition bytes — must equal the
 *     sidecar's `signed_content_sha`, composing with R18 (a definition
 *     edit drifts both pins at once).
 *   - `files_etag_signature`: sha256 over the sorted (path, etag) pairs
 *     of every folder file at scan time. Render recomputes this from
 *     the listing it already holds (zero extra reads) and withholds on
 *     mismatch — so editing run.sh invalidates the report without the
 *     compiler ever reading script bytes.
 */

import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { getConfig } from "@thinkwork/runtime-config";
import {
  runSkillSpectorForFiles,
  type SkillSpectorRunResult,
} from "../skill-trust/skillspector.js";
import type { SkillTrustInputFile } from "../skill-trust/catalog-report.js";
import { definitionContentSha } from "./sidecar-signing.js";
import { TOOL_DEFINITION_FILE } from "./definition-schemas.js";

const BLOCKING_SEVERITIES = new Set(["critical", "high"]);

export interface ScriptToolTrustField {
  status: "passed";
  content_sha: string;
  files_etag_signature: string;
  scanned_at: string;
  finding_count: number;
}

export type ScriptToolTrustResult =
  | { ok: true; trust: ScriptToolTrustField }
  | {
      ok: false;
      reason:
        | "bucket_unconfigured"
        | "folder_empty"
        | "definition_missing"
        | "scanner_unavailable"
        | "scanner_failed"
        | "blocked";
      detail?: string;
    };

export interface ScriptTrustDeps {
  s3?: Pick<S3Client, "send">;
  bucket?: string;
  spector?: (input: {
    slug: string;
    files: SkillTrustInputFile[];
  }) => Promise<SkillSpectorRunResult>;
}

let sharedClient: S3Client | null = null;
function s3Client(): Pick<S3Client, "send"> {
  sharedClient ??= new S3Client({
    region:
      process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
  });
  return sharedClient;
}

function workspaceBucket(): string | null {
  try {
    return getConfig("WORKSPACE_BUCKET") || null;
  } catch {
    return null;
  }
}

/** Sorted (path, etag) digest — recomputable from a bare S3 listing. */
export function filesEtagSignature(
  files: Array<{ path: string; etag?: string | null }>,
): string {
  const canonical = files
    .map((file) => [file.path, file.etag ?? ""] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}

/**
 * Run the trust gate for `tools/<slug>/` and return the sidecar `trust`
 * field on pass. Callers (the grant mutation) include the field in the
 * sidecar BEFORE signing, so trust state rides the same signature.
 */
export async function runScriptToolTrustGate(input: {
  targetPrefix: string;
  slug: string;
  deps?: ScriptTrustDeps;
}): Promise<ScriptToolTrustResult> {
  const deps = input.deps ?? {};
  const bucket = deps.bucket ?? workspaceBucket();
  if (!bucket) return { ok: false, reason: "bucket_unconfigured" };
  const s3 = deps.s3 ?? s3Client();
  const folderPrefix = `${input.targetPrefix}tools/${input.slug}/`;

  const listed = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: folderPrefix }),
  );
  const objects = (listed.Contents ?? []).filter((object) => object.Key);
  if (objects.length === 0) return { ok: false, reason: "folder_empty" };

  const files: Array<SkillTrustInputFile & { etag?: string | null }> = [];
  for (const object of objects) {
    const key = object.Key!;
    const resp = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    const content = (await resp.Body?.transformToString()) ?? "";
    files.push({
      path: key.slice(folderPrefix.length),
      content: Buffer.from(content, "utf8"),
      etag: object.ETag ?? null,
    });
  }
  const definition = files.find((file) => file.path === TOOL_DEFINITION_FILE);
  if (!definition) return { ok: false, reason: "definition_missing" };

  const spector = deps.spector ?? runSkillSpectorForFiles;
  const scan = await spector({
    slug: input.slug,
    files: files
      .filter((file) => file.path !== ".assignment.json")
      .map(({ path, content }) => ({ path, content })),
  });
  if (scan.scanner.status === "not_configured") {
    return {
      ok: false,
      reason: "scanner_unavailable",
      detail:
        "SkillSpector is not configured — script tools cannot pass the trust gate (fail closed)",
    };
  }
  if (scan.scanner.status !== "completed") {
    return {
      ok: false,
      reason: "scanner_failed",
      detail: scan.scanner.error ?? `scanner status ${scan.scanner.status}`,
    };
  }
  const blocking = scan.findings.filter((finding) =>
    BLOCKING_SEVERITIES.has((finding.severity ?? "").toLowerCase()),
  );
  if (blocking.length > 0) {
    return {
      ok: false,
      reason: "blocked",
      detail: `${blocking.length} blocking finding(s): ${blocking
        .slice(0, 3)
        .map((finding) => finding.message || finding.id)
        .join("; ")}`,
    };
  }

  return {
    ok: true,
    trust: {
      status: "passed",
      content_sha: definitionContentSha(definition.content),
      files_etag_signature: filesEtagSignature(
        files.filter((file) => file.path !== ".assignment.json"),
      ),
      scanned_at: new Date().toISOString(),
      finding_count: scan.findings.length,
    },
  };
}
