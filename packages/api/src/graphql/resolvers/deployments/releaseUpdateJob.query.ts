import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { releaseUpdateJobs } from "@thinkwork/database-pg/schema";
import { eq } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import {
  appendReleaseUpdateEvent,
  loadReleaseUpdateEvents,
  loadReleaseUpdateJobForTenant,
  requireDeploymentTenantAdmin,
  toReleaseUpdatePayload,
} from "./shared.js";

const s3 = new S3Client({});

interface ReleaseUpdateJobQueryDeps {
  readStatusPointer?: (
    bucket: string,
    key: string,
  ) => Promise<Record<string, unknown> | null>;
}

export async function releaseUpdateJob(
  _parent: unknown,
  args: { jobId: string },
  ctx: GraphQLContext,
  deps: ReleaseUpdateJobQueryDeps = {},
) {
  const { tenantId } = await requireDeploymentTenantAdmin(ctx);
  let job = await loadReleaseUpdateJobForTenant(tenantId, args.jobId);
  if (!job) return null;
  job = await refreshReleaseUpdateJobStatus(tenantId, job, deps);
  const events = await loadReleaseUpdateEvents(tenantId, job.id);
  return toReleaseUpdatePayload(job, events);
}

async function refreshReleaseUpdateJobStatus(
  tenantId: string,
  job: NonNullable<Awaited<ReturnType<typeof loadReleaseUpdateJobForTenant>>>,
  deps: ReleaseUpdateJobQueryDeps,
): Promise<typeof job> {
  if (
    job.status !== "updating" ||
    !job.status_pointer_bucket ||
    !job.status_pointer_key
  ) {
    return job;
  }
  const pointer =
    deps.readStatusPointer !== undefined
      ? await deps.readStatusPointer(
          job.status_pointer_bucket,
          job.status_pointer_key,
        )
      : await readStatusPointer(
          job.status_pointer_bucket,
          job.status_pointer_key,
        );
  if (!pointer) return job;
  const pointerStatus = stringAt(pointer, ["status"]);
  if (pointerStatus !== "succeeded" && pointerStatus !== "failed") {
    return job;
  }
  const release =
    pointerStatus === "succeeded"
      ? objectAt(pointer, ["activeRelease"])
      : objectAt(pointer, ["targetRelease"]);
  if (stringAt(release, ["version"]) !== job.target_release_version) {
    return job;
  }

  const status = pointerStatus === "succeeded" ? "succeeded" : "failed";
  const error = stringAt(pointer, ["error"]);
  const controller = objectAt(pointer, ["controller"]);
  const [updated] = await db
    .update(releaseUpdateJobs)
    .set({
      status,
      final_status: pointer,
      codebuild_build_arn: stringAt(controller, ["codebuildBuildId"]),
      failure_category:
        status === "failed" ? "deployment_controller_failed" : null,
      failure_message:
        status === "failed"
          ? error || "Deployment controller reported a failed update."
          : null,
      recovery_action:
        status === "failed"
          ? "Review the deployment evidence and rerun preflight before retrying."
          : null,
      updated_at: new Date(),
    })
    .where(eq(releaseUpdateJobs.id, job.id))
    .returning();

  await appendReleaseUpdateEvent({
    tenantId,
    jobId: job.id,
    eventType: `release_update_${status}`,
    message:
      status === "succeeded"
        ? `Release update completed for ${job.target_release_version}.`
        : `Release update failed for ${job.target_release_version}.`,
    payload: {
      statusPointer: pointer,
    },
    idempotencyKey: `${job.id}:release-update-${status}:${
      stringAt(pointer, ["recordedAt"]) ?? "terminal"
    }`,
  });

  return updated ?? { ...job, status, final_status: pointer };
}

async function readStatusPointer(
  bucket: string,
  key: string,
): Promise<Record<string, unknown> | null> {
  try {
    const response = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!response.Body) return null;
    return parseJsonObject(await bodyToString(response.Body));
  } catch (error) {
    const name = (error as Error)?.name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw error;
  }
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

async function bodyToString(body: unknown): Promise<string> {
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (
    body &&
    typeof body === "object" &&
    "transformToString" in body &&
    typeof body.transformToString === "function"
  ) {
    return body.transformToString();
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
    chunks.push(
      typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk,
    );
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function objectAt(
  value: Record<string, unknown>,
  path: string[],
): Record<string, unknown> {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return {};
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current && typeof current === "object" && !Array.isArray(current)
    ? (current as Record<string, unknown>)
    : {};
}

function stringAt(
  value: Record<string, unknown>,
  path: string[],
): string | null {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current ? current : null;
}
