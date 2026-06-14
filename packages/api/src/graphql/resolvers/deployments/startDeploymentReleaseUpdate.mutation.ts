import { GraphQLError } from "graphql";
import { releaseUpdateJobs } from "@thinkwork/database-pg/schema";
import { eq } from "drizzle-orm";
import { buildReleaseUpdateControllerPayload } from "../../../lib/deployments/release-update-payload.js";
import type { ReleaseUpdateJobRow } from "../../../lib/deployments/release-preflight.js";
import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import {
  appendReleaseUpdateEvent,
  defaultStartExecution,
  deploymentEvidenceBucket,
  loadReleaseUpdateEvents,
  loadReleaseUpdateJobForTenant,
  requireDeploymentTenantAdmin,
  resolveDeploymentControllerConfig,
  toReleaseUpdatePayload,
  type DeploymentDeps,
} from "./shared.js";

const READY_STATUSES = new Set(["preflight_ready", "runner_remediated"]);
const DISPATCHED_STATUSES = new Set(["updating", "succeeded", "failed"]);

export async function startDeploymentReleaseUpdate(
  _parent: unknown,
  args: {
    input?: {
      jobId?: unknown;
      idempotencyKey?: unknown;
    } | null;
  },
  ctx: GraphQLContext,
  deps: DeploymentDeps = {},
) {
  const { tenantId } = await requireDeploymentTenantAdmin(ctx);
  const input = normalizeInput(args.input);
  const job = await loadReleaseUpdateJobForTenant(tenantId, input.jobId);
  if (!job) {
    throw new GraphQLError("Release update job was not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  if (DISPATCHED_STATUSES.has(job.status) && job.execution_arn) {
    return toReleaseUpdatePayload(
      job,
      await loadReleaseUpdateEvents(tenantId, job.id),
    );
  }
  assertDispatchable(job);

  const controllerConfig = await (
    deps.resolveDeploymentControllerConfig ?? resolveDeploymentControllerConfig
  )();
  const stateMachineArn =
    controllerConfig.stateMachineArn ?? job.state_machine_arn;
  if (!stateMachineArn) {
    throw new GraphQLError("Deployment controller is not configured", {
      extensions: { code: "FAILED_PRECONDITION" },
    });
  }

  const evidenceBucket =
    controllerConfig.evidenceBucket ??
    job.evidence_bucket ??
    deploymentEvidenceBucket();
  const evidencePrefix = `release-updates/${job.id}/update`;
  const payload = buildReleaseUpdateControllerPayload({
    tenantId,
    job,
    evidenceBucket,
    evidencePrefix,
  });
  const startExecution = deps.startExecution ?? defaultStartExecution;
  const execution = await startExecution({
    stateMachineArn,
    name: executionName(job.id),
    payload,
  });
  const executionArn = execution.executionArn;
  const [updated] = await db
    .update(releaseUpdateJobs)
    .set({
      status: "updating",
      state_machine_arn: stateMachineArn,
      execution_arn: executionArn,
      evidence_bucket: evidenceBucket,
      evidence_prefix: evidencePrefix,
      failure_category: null,
      failure_message: null,
      recovery_action: null,
      updated_at: new Date(),
    })
    .where(eq(releaseUpdateJobs.id, job.id))
    .returning();

  await appendReleaseUpdateEvent({
    tenantId,
    jobId: job.id,
    eventType: "release_update_dispatched",
    message: `Release update dispatched for ${job.target_release_version}.`,
    payload: {
      stateMachineArn,
      executionArn,
      evidenceBucket,
      evidencePrefix,
    },
    idempotencyKey:
      input.idempotencyKey ?? `${job.id}:release-update-dispatched`,
  });

  const current = updated ?? {
    ...job,
    status: "updating",
    state_machine_arn: stateMachineArn,
    execution_arn: executionArn,
    evidence_bucket: evidenceBucket,
    evidence_prefix: evidencePrefix,
  };
  return toReleaseUpdatePayload(
    current,
    await loadReleaseUpdateEvents(tenantId, job.id),
  );
}

function normalizeInput(input: unknown): {
  jobId: string;
  idempotencyKey: string | null;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new GraphQLError("Release update input is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  const record = input as Record<string, unknown>;
  const jobId = stringField(record, "jobId");
  if (!jobId) {
    throw new GraphQLError(
      "Release update job ID is required. Run preflight before dispatch.",
      {
        extensions: { code: "BAD_USER_INPUT" },
      },
    );
  }
  return {
    jobId,
    idempotencyKey: stringField(record, "idempotencyKey") || null,
  };
}

function assertDispatchable(job: ReleaseUpdateJobRow) {
  if (!READY_STATUSES.has(job.status)) {
    throw new GraphQLError("Release update preflight is not ready", {
      extensions: {
        code: "FAILED_PRECONDITION",
        status: job.status,
        recoveryAction: job.recovery_action,
      },
    });
  }
  const preflight = objectValue(job.preflight_summary);
  const blockers = Array.isArray(preflight.blockers) ? preflight.blockers : [];
  if (preflight.blocked === true || blockers.length > 0) {
    throw new GraphQLError("Release update preflight still has blockers", {
      extensions: {
        code: "FAILED_PRECONDITION",
        blockers,
        recoveryAction: job.recovery_action,
      },
    });
  }
  const preservedConfig = objectValue(job.preserved_config_summary);
  if (preservedConfig.available === false) {
    throw new GraphQLError(
      "Preserved deployment configuration is unavailable",
      {
        extensions: {
          code: "FAILED_PRECONDITION",
          recoveryAction:
            job.recovery_action ??
            "Rerun preflight after repairing deployment evidence.",
        },
      },
    );
  }
}

function executionName(jobId: string) {
  return `tw-update-${jobId.replace(/-/g, "").slice(0, 48)}`;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  return typeof value === "string" ? value.trim() : "";
}
