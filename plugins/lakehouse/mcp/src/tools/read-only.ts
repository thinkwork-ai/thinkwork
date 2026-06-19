import type {
  LakeHouseBundleManifest,
  LakeHouseRunEvidence,
} from "../../../src/edge-integration";
import { redactObject } from "../redaction";
import type { McpEnvelope } from "../types";

export function projectSummary(input: {
  manifest: LakeHouseBundleManifest;
  latestEvidence?: LakeHouseRunEvidence;
}): McpEnvelope {
  return {
    ok: true,
    data: redactObject({
      integrationKey: input.manifest.integrationKey,
      bundleVersion: input.manifest.bundleVersion,
      bundleDigest: input.manifest.signature.digest,
      jobs: input.manifest.meltanoProject.jobs.map((job) => job.name),
      streams: input.manifest.extracts.map((extract) => extract.streamName),
      latestRun: input.latestEvidence
        ? {
            runId: input.latestEvidence.runId,
            status: input.latestEvidence.status,
          }
        : null,
    }),
    meta: { tool: "project_summary" },
  };
}

export function selectedStreams(input: {
  manifest: LakeHouseBundleManifest;
}): McpEnvelope {
  return {
    ok: true,
    data: input.manifest.extracts.map((extract) =>
      redactObject({
        streamName: extract.streamName,
        sourceObject: extract.sourceObject,
        businessKeys: extract.businessKeys,
        cursorField: extract.cursorField,
        reconciliation: extract.reconciliation,
        deleteReversalStrategy: extract.deleteReversalStrategy,
      }),
    ),
    meta: { tool: "selected_streams" },
  };
}

export function runEvidence(input: {
  evidence: LakeHouseRunEvidence;
}): McpEnvelope {
  return {
    ok: true,
    data: redactObject(input.evidence),
    meta: { tool: "run_evidence" },
  };
}
