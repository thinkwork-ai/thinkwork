/**
 * kb-source-reconciler Lambda (external S3 KB source U6).
 *
 * One handler, two scheduled modes:
 *
 *   {mode: "probe"}  — hourly. Re-verifies bucket access for every
 *     s3-connect source AS the KB service role (the identity Bedrock
 *     ingests with). A failing probe flips the source to `access_revoked`
 *     (fail closed — R10/F4); a passing probe restores a revoked source to
 *     `healthy` (AE7). Flips are CAS-guarded on the observed status so a
 *     concurrent sync can't interleave into a stale final state.
 *
 *   {mode: "sync"}   — daily. Dispatches the kb-manager's `sync` action
 *     (fire-and-forget, status rows + DLQ per KTD7) for every KB that has
 *     at least one non-revoked s3-connect source. The manager owns
 *     ingestion, canary retrieval, and degraded/healthy stamping (R11).
 *
 * retry-0 + DLQ (async-retry idempotency doctrine): the next tick IS the
 * retry; scheduler retries would only stack redundant probes.
 */

import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@thinkwork/database-pg";

const { knowledgeBaseSources } = schema;

const AWS_REGION = process.env.AWS_REGION || "us-east-1";

function kbServiceRoleArn(): string {
  return process.env.KB_SERVICE_ROLE_ARN || "";
}

export interface KbSourceReconcilerEvent {
  mode?: "probe" | "sync";
}

type SourceRow = typeof knowledgeBaseSources.$inferSelect;

/** Injectable so the handler is unit-testable without live AWS. */
export interface KbSourceReconcilerDeps {
  /** Probe one source as the KB service role. Default: STS assume +
   * ListObjectsV2/GetObject against the source's bucket. */
  probeSource?: (
    source: SourceRow,
  ) => Promise<{ ok: boolean; reason?: string }>;
  /** Dispatch a kb-manager sync for one KB. Default: async Lambda invoke
   * via the SSM-published function ARN. */
  dispatchSync?: (knowledgeBaseId: string) => Promise<void>;
}

export interface KbSourceReconcilerResult {
  mode: "probe" | "sync";
  probed?: number;
  revoked?: number;
  restored?: number;
  dispatched?: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Default deps
// ---------------------------------------------------------------------------

async function assumeKbRoleS3() {
  const { STSClient, AssumeRoleCommand } = await import("@aws-sdk/client-sts");
  const sts = new STSClient({ region: AWS_REGION });
  const assumed = await sts.send(
    new AssumeRoleCommand({
      RoleArn: kbServiceRoleArn(),
      RoleSessionName: "kb-source-access-probe",
      DurationSeconds: 900,
    }),
  );
  if (!assumed.Credentials?.AccessKeyId) {
    throw new Error(`No credentials assuming ${kbServiceRoleArn()}`);
  }
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({
    region: AWS_REGION,
    credentials: {
      accessKeyId: assumed.Credentials.AccessKeyId,
      secretAccessKey: assumed.Credentials.SecretAccessKey!,
      sessionToken: assumed.Credentials.SessionToken!,
    },
  });
}

function defaultProbeSource(): (
  source: SourceRow,
) => Promise<{ ok: boolean; reason?: string }> {
  // One assumed-role client per invocation, shared across sources.
  let clientPromise: Promise<any> | null = null;
  return async (source) => {
    try {
      clientPromise ??= assumeKbRoleS3();
      const s3 = await clientPromise;
      const { ListObjectsV2Command, GetObjectCommand } =
        await import("@aws-sdk/client-s3");
      const listResp = await s3.send(
        new ListObjectsV2Command({
          Bucket: source.bucket!,
          Prefix: source.prefix ?? undefined,
          MaxKeys: 5,
        }),
      );
      const keys = (listResp.Contents ?? [])
        .map((object: { Key?: string }) => object.Key)
        .filter((key: string | undefined): key is string => !!key);
      // Read-probe the sentinel when it still exists, else any listed key.
      const probeKey = keys.includes(source.sentinel_document_key ?? "")
        ? source.sentinel_document_key!
        : keys[0];
      if (probeKey) {
        const getResp = await s3.send(
          new GetObjectCommand({ Bucket: source.bucket!, Key: probeKey }),
        );
        await getResp.Body?.transformToByteArray().catch(() => undefined);
      }
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  };
}

async function defaultDispatchSync(knowledgeBaseId: string): Promise<void> {
  const stage = process.env.STAGE || "dev";
  const { SSMClient, GetParameterCommand } =
    await import("@aws-sdk/client-ssm");
  const ssm = new SSMClient({ region: AWS_REGION });
  const param = await ssm.send(
    new GetParameterCommand({ Name: `/thinkwork/${stage}/kb-manager-fn-arn` }),
  );
  const arn = param.Parameter?.Value;
  if (!arn) throw new Error("kb-manager-fn-arn SSM parameter not found");
  const { LambdaClient, InvokeCommand } =
    await import("@aws-sdk/client-lambda");
  const lambda = new LambdaClient({ region: AWS_REGION });
  await lambda.send(
    new InvokeCommand({
      FunctionName: arn,
      InvocationType: "Event",
      Payload: JSON.stringify({ action: "sync", knowledgeBaseId }),
    }),
  );
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

async function runProbe(
  deps: KbSourceReconcilerDeps,
): Promise<KbSourceReconcilerResult> {
  const db = getDb();
  const probe = deps.probeSource ?? defaultProbeSource();
  const result: KbSourceReconcilerResult = {
    mode: "probe",
    probed: 0,
    revoked: 0,
    restored: 0,
    errors: [],
  };

  const sources = await db
    .select()
    .from(knowledgeBaseSources)
    .where(eq(knowledgeBaseSources.kind, "s3-connect"));

  for (const source of sources) {
    result.probed! += 1;
    let verdict: { ok: boolean; reason?: string };
    try {
      verdict = await probe(source);
    } catch (err) {
      verdict = {
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    if (!verdict.ok) {
      // Fail closed — but only flip states the probe is authoritative for
      // (CAS): a source the operator just failed at connect stays `failed`.
      await db
        .update(knowledgeBaseSources)
        .set({
          access_status: "access_revoked",
          error_message: (verdict.reason ?? "access probe failed").slice(
            0,
            1000,
          ),
          updated_at: new Date(),
        })
        .where(
          and(
            eq(knowledgeBaseSources.id, source.id),
            inArray(knowledgeBaseSources.access_status, [
              "healthy",
              "degraded",
              "pending",
            ]),
          ),
        );
      if (source.access_status !== "access_revoked") result.revoked! += 1;
      console.log(
        `[kb-source-reconciler] probe FAILED for source ${source.id} (s3://${source.bucket}/${source.prefix}): ${verdict.reason}`,
      );
    } else if (source.access_status === "access_revoked") {
      // Access restored (AE7): back to healthy; the next sync re-verifies
      // retrievability via the canary.
      await db
        .update(knowledgeBaseSources)
        .set({
          access_status: "healthy",
          error_message: null,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(knowledgeBaseSources.id, source.id),
            eq(knowledgeBaseSources.access_status, "access_revoked"),
          ),
        );
      result.restored! += 1;
      console.log(
        `[kb-source-reconciler] access restored for source ${source.id}`,
      );
    }
  }
  return result;
}

async function runSync(
  deps: KbSourceReconcilerDeps,
): Promise<KbSourceReconcilerResult> {
  const db = getDb();
  const dispatch = deps.dispatchSync ?? defaultDispatchSync;
  const result: KbSourceReconcilerResult = {
    mode: "sync",
    dispatched: 0,
    errors: [],
  };

  const sources = await db
    .select()
    .from(knowledgeBaseSources)
    .where(eq(knowledgeBaseSources.kind, "s3-connect"));

  const kbIds = new Set(
    sources
      .filter((source) => source.access_status !== "access_revoked")
      .filter((source) => source.access_status !== "failed")
      .map((source) => source.knowledge_base_id),
  );

  for (const kbId of kbIds) {
    try {
      await dispatch(kbId);
      result.dispatched! += 1;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      result.errors.push(`sync dispatch failed for KB ${kbId}: ${reason}`);
      console.error(
        `[kb-source-reconciler] sync dispatch failed for KB ${kbId}: ${reason}`,
      );
    }
  }
  return result;
}

export async function handler(
  event: KbSourceReconcilerEvent,
  _context?: unknown,
  deps: KbSourceReconcilerDeps = {},
): Promise<KbSourceReconcilerResult> {
  const mode = event?.mode === "sync" ? "sync" : "probe";
  console.log(`[kb-source-reconciler] mode=${mode}`);
  const result = mode === "sync" ? await runSync(deps) : await runProbe(deps);
  console.log(`[kb-source-reconciler] done: ${JSON.stringify(result)}`);
  if (result.errors.length > 0) {
    // Land in the DLQ for operator visibility (retry-0).
    throw new Error(result.errors.join("; "));
  }
  return result;
}
