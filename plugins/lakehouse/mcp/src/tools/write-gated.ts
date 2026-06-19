import { buildMeltanoRunCommand } from "../../../runner/src/meltano-executor";
import type {
  LakeHouseBundleManifest,
  LakeHouseRunnerPolicy,
} from "../../../src/edge-integration";
import { createAuditEvent } from "../audit";
import type { AuditEvent, McpEnvelope } from "../types";

export function runJob(input: {
  actor: string;
  jobName: string;
  approved: boolean;
  policy: LakeHouseRunnerPolicy;
  manifest: LakeHouseBundleManifest;
  now: string;
}): { response: McpEnvelope; audit: AuditEvent } {
  try {
    const command = buildMeltanoRunCommand({
      jobName: input.jobName,
      bundleDigest: input.manifest.signature.digest,
      approved: input.approved,
      policy: input.policy,
    });
    const audit = createAuditEvent({
      actor: input.actor,
      tool: "run_job",
      integrationKey: input.manifest.integrationKey,
      bundleVersion: input.manifest.bundleVersion,
      policyDecision: "Policy allows run",
      result: "allowed",
      createdAt: input.now,
    });
    return {
      audit,
      response: {
        ok: true,
        data: command,
        meta: { tool: "run_job", auditId: audit.auditId },
      },
    };
  } catch (error) {
    const audit = createAuditEvent({
      actor: input.actor,
      tool: "run_job",
      integrationKey: input.manifest.integrationKey,
      bundleVersion: input.manifest.bundleVersion,
      policyDecision: error instanceof Error ? error.message : "Denied",
      result: "denied",
      createdAt: input.now,
    });
    return {
      audit,
      response: {
        ok: false,
        error: {
          code: "POLICY_DENIED",
          message: audit.policyDecision,
        },
        meta: { tool: "run_job", auditId: audit.auditId },
      },
    };
  }
}
