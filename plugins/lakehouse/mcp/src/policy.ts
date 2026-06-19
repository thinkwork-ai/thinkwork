import type { LakeHouseRunnerPolicy } from "../../src/edge-integration";
import {
  decideRunAllowed,
  decideStateRecoveryAllowed,
} from "../../src/edge-integration";

export function requireRunPolicy(input: {
  policy: LakeHouseRunnerPolicy;
  jobName: string;
  bundleDigest: string;
  approved: boolean;
}): string {
  const decision = decideRunAllowed(input);
  if (!decision.allowed) throw new Error(decision.reason);
  return decision.reason;
}

export function requireStateRecoveryPolicy(input: {
  policy: LakeHouseRunnerPolicy;
  approved: boolean;
}): string {
  const decision = decideStateRecoveryAllowed(input);
  if (!decision.allowed) throw new Error(decision.reason);
  return decision.reason;
}
