export type RunnerMode = "read_only" | "approved_writes" | "maintenance";

export interface LakeHouseRunnerPolicy {
  mode: RunnerMode;
  allowedJobs: string[];
  allowedBundleDigests: string[];
  allowStateRecovery: boolean;
  requireApprovalForRuns: boolean;
}

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
}

export function decideRunAllowed(args: {
  policy: LakeHouseRunnerPolicy;
  jobName: string;
  bundleDigest: string;
  approved: boolean;
}): PolicyDecision {
  if (args.policy.mode === "read_only") {
    return { allowed: false, reason: "Runner mode is read-only" };
  }
  if (!args.policy.allowedJobs.includes(args.jobName)) {
    return { allowed: false, reason: "Job is not allowlisted" };
  }
  if (!args.policy.allowedBundleDigests.includes(args.bundleDigest)) {
    return { allowed: false, reason: "Bundle digest is not allowlisted" };
  }
  if (args.policy.requireApprovalForRuns && !args.approved) {
    return { allowed: false, reason: "Run approval is required" };
  }
  return { allowed: true, reason: "Policy allows run" };
}

export function decideStateRecoveryAllowed(args: {
  policy: LakeHouseRunnerPolicy;
  approved: boolean;
}): PolicyDecision {
  if (!args.policy.allowStateRecovery) {
    return { allowed: false, reason: "State recovery is disabled by policy" };
  }
  if (args.policy.mode !== "maintenance") {
    return {
      allowed: false,
      reason: "State recovery requires maintenance runner mode",
    };
  }
  if (!args.approved) {
    return { allowed: false, reason: "State recovery requires approval" };
  }
  return { allowed: true, reason: "Policy allows state recovery" };
}
