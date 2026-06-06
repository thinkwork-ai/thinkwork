import {
  dataImpactFor,
  evidencePointer,
  manifestDigestMatches,
  parseRunnerInput,
  type DeploymentSummary,
} from "./shared.js";

export function buildApplySummary(args: {
  input: unknown;
  evidenceBucket: string;
  verifiedManifestDigest: string;
}): DeploymentSummary {
  const input = parseRunnerInput(args.input);
  if (input.phase !== "apply") {
    throw new Error("Apply summary requires phase=apply");
  }
  if (
    !manifestDigestMatches({
      expectedDigest: input.manifestDigest,
      actualDigest: args.verifiedManifestDigest,
    })
  ) {
    throw new Error(
      "Verified manifest digest does not match job manifest digest",
    );
  }
  return {
    jobId: input.jobId,
    appKey: input.appKey,
    operation: input.operation,
    releaseVersion: input.releaseVersion,
    manifestDigest: input.manifestDigest,
    desiredConfigVersion: input.desiredConfigVersion,
    planDigest: input.planDigest!,
    dataImpact: dataImpactFor(input.appKey, input.operation),
    evidence: evidencePointer({
      bucket: args.evidenceBucket,
      tenantId: input.tenantId,
      appKey: input.appKey,
      jobId: input.jobId,
      phase: "apply",
    }),
  };
}
