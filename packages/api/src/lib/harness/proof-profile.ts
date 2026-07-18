import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

export type HarnessProofReadinessState =
  | "disabled"
  | "provisioning"
  | "ready"
  | "drifted"
  | "misconfigured";

export interface HarnessProofProfile {
  tenantSlug: string;
  harnessArn: string;
  endpointName: string;
  expectedVersion: string;
  liveVersion: string;
  modelId: string;
  status: string;
  configurationFingerprint: string;
  sessionStrategy: string;
}

export interface HarnessProofReadiness {
  state: HarnessProofReadinessState;
  ready: boolean;
  reasonCode: string;
  tenantSlug: string | null;
  harnessArn: string | null;
  endpointName: string | null;
  expectedVersion: string | null;
  liveVersion: string | null;
  modelId: string | null;
  configurationFingerprint: string | null;
  sessionStrategy: string | null;
  checkedAt: string;
}

interface ProfileLoaderDeps {
  getParameter(name: string): Promise<string | null>;
  stage: string;
}

const region =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const ssm = new SSMClient({ region });

function requiredProfileString(
  value: unknown,
  field: keyof HarnessProofProfile,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Harness proof profile is missing ${field}`);
  }
  return value.trim();
}

export function parseHarnessProofProfile(value: string): HarnessProofProfile {
  let candidate: Record<string, unknown>;
  try {
    candidate = JSON.parse(value) as Record<string, unknown>;
  } catch {
    throw new Error("Harness proof profile is not valid JSON");
  }
  return {
    tenantSlug: requiredProfileString(candidate.tenantSlug, "tenantSlug"),
    harnessArn: requiredProfileString(candidate.harnessArn, "harnessArn"),
    endpointName: requiredProfileString(candidate.endpointName, "endpointName"),
    expectedVersion: requiredProfileString(
      candidate.expectedVersion,
      "expectedVersion",
    ),
    liveVersion: requiredProfileString(candidate.liveVersion, "liveVersion"),
    modelId: requiredProfileString(candidate.modelId, "modelId"),
    status: requiredProfileString(candidate.status, "status"),
    configurationFingerprint: requiredProfileString(
      candidate.configurationFingerprint,
      "configurationFingerprint",
    ),
    sessionStrategy: requiredProfileString(
      candidate.sessionStrategy,
      "sessionStrategy",
    ),
  };
}

export function harnessProofProfileParameterName(stage: string): string {
  const explicit = process.env.HARNESS_PROOF_PROFILE_PARAMETER_NAME?.trim();
  return explicit || `/thinkwork/${stage}/agentcore-harness-proof-profile`;
}

function defaultDeps(): ProfileLoaderDeps {
  return {
    stage: process.env.STAGE || process.env.STACK_NAME || "unknown",
    async getParameter(name) {
      try {
        const response = await ssm.send(
          new GetParameterCommand({ Name: name }),
        );
        return response.Parameter?.Value ?? null;
      } catch (error) {
        if ((error as { name?: string })?.name === "ParameterNotFound") {
          return null;
        }
        throw error;
      }
    },
  };
}

export async function readHarnessProofReadiness(
  tenantSlug?: string | null,
  deps: ProfileLoaderDeps = defaultDeps(),
): Promise<HarnessProofReadiness> {
  const checkedAt = new Date().toISOString();
  if (deps.stage === "prod" || deps.stage === "production") {
    return emptyReadiness("disabled", "production_disabled", checkedAt);
  }
  let raw: string | null;
  try {
    raw = await deps.getParameter(harnessProofProfileParameterName(deps.stage));
  } catch {
    return emptyReadiness("misconfigured", "profile_read_failed", checkedAt);
  }
  if (!raw) return emptyReadiness("disabled", "profile_missing", checkedAt);

  let profile: HarnessProofProfile;
  try {
    profile = parseHarnessProofProfile(raw);
  } catch {
    return emptyReadiness("misconfigured", "profile_invalid", checkedAt);
  }
  const base = {
    tenantSlug: profile.tenantSlug,
    harnessArn: profile.harnessArn,
    endpointName: profile.endpointName,
    expectedVersion: profile.expectedVersion,
    liveVersion: profile.liveVersion,
    modelId: profile.modelId,
    configurationFingerprint: profile.configurationFingerprint,
    sessionStrategy: profile.sessionStrategy,
    checkedAt,
  };
  if (tenantSlug && profile.tenantSlug !== tenantSlug) {
    return {
      ...base,
      state: "disabled",
      ready: false,
      reasonCode: "tenant_not_enrolled",
    };
  }
  if (profile.status === "provisioning") {
    return {
      ...base,
      state: "provisioning",
      ready: false,
      reasonCode: "endpoint_provisioning",
    };
  }
  if (profile.status !== "ready") {
    return {
      ...base,
      state: "misconfigured",
      ready: false,
      reasonCode: "profile_not_ready",
    };
  }
  if (profile.expectedVersion !== profile.liveVersion) {
    return {
      ...base,
      state: "drifted",
      ready: false,
      reasonCode: "endpoint_version_drift",
    };
  }
  if (profile.sessionStrategy !== "fresh") {
    return {
      ...base,
      state: "misconfigured",
      ready: false,
      reasonCode: "session_strategy_unsupported",
    };
  }
  return {
    ...base,
    state: "ready",
    ready: true,
    reasonCode: "ready",
  };
}

export async function requireHarnessProofProfile(
  tenantSlug: string,
  deps?: ProfileLoaderDeps,
): Promise<HarnessProofProfile> {
  const readiness = await readHarnessProofReadiness(tenantSlug, deps);
  if (!readiness.ready) {
    throw new Error(`Harness proof is unavailable (${readiness.reasonCode})`);
  }
  return {
    tenantSlug: readiness.tenantSlug!,
    harnessArn: readiness.harnessArn!,
    endpointName: readiness.endpointName!,
    expectedVersion: readiness.expectedVersion!,
    liveVersion: readiness.liveVersion!,
    modelId: readiness.modelId!,
    status: "ready",
    configurationFingerprint: readiness.configurationFingerprint!,
    sessionStrategy: readiness.sessionStrategy!,
  };
}

function emptyReadiness(
  state: HarnessProofReadinessState,
  reasonCode: string,
  checkedAt: string,
): HarnessProofReadiness {
  return {
    state,
    ready: false,
    reasonCode,
    tenantSlug: null,
    harnessArn: null,
    endpointName: null,
    expectedVersion: null,
    liveVersion: null,
    modelId: null,
    configurationFingerprint: null,
    sessionStrategy: null,
    checkedAt,
  };
}
