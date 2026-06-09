import { buildManagedAppPlan, getManagedAppAdapter } from "./apps/registry.js";
import {
  evidencePointerForInput,
  parseRunnerInput,
  stablePlanDigest,
  type DeploymentSummary,
} from "./shared.js";

export function buildPlanSummary(args: {
  input: unknown;
  evidenceBucket: string;
}): DeploymentSummary {
  const input = parseRunnerInput(args.input);
  if (input.phase !== "plan") {
    throw new Error("Plan summary requires phase=plan");
  }
  const adapter = getManagedAppAdapter(input.appKey);
  const appPlan = buildManagedAppPlan({
    appKey: input.appKey,
    operation: input.operation,
    desiredConfig: input.desiredConfig,
    manifestImages: input.manifestImages,
  });
  const body = {
    jobId: input.jobId,
    appKey: input.appKey,
    displayName: adapter.displayName,
    operation: input.operation,
    releaseVersion: input.releaseVersion,
    manifestDigest: input.manifestDigest,
    releaseManifestUrl: input.releaseManifestUrl,
    desiredConfigVersion: input.desiredConfigVersion,
    manifestImages: input.manifestImages,
    dataImpact: appPlan.dataImpact,
    terraformVariables: appPlan.terraformVariables,
    preDestroySteps: appPlan.preDestroySteps,
    smokeContracts: appPlan.smokeContracts,
    statusOutputs: appPlan.statusOutputs,
  };
  return {
    ...body,
    planDigest: stablePlanDigest(body),
    evidence: evidencePointerForInput({
      input,
      fallbackBucket: args.evidenceBucket,
      phase: "plan",
    }),
  };
}
