import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

export type HarnessReadinessState =
  | "disabled"
  | "provisioning"
  | "ready"
  | "drifted"
  | "misconfigured";

export interface HarnessManagedProfile {
  tenantSlug: string;
  harnessArn: string;
  endpointName: string;
  expectedVersion: string;
  liveVersion: string;
  modelId: string;
  status: string;
  configurationFingerprint: string;
  sessionStrategy: string;
  gatewayUrl: string;
  gatewayTargetName: string;
  identityWorkloadName: string;
  identityCredentialProviderName: string;
}

export interface HarnessReadiness {
  state: HarnessReadinessState;
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
  gatewayUrl: string | null;
  gatewayTargetName: string | null;
  identityWorkloadName: string | null;
  identityCredentialProviderName: string | null;
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
  field: keyof HarnessManagedProfile,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`AgentCore Harness profile is missing ${field}`);
  }
  return value.trim();
}

export function parseHarnessManagedProfile(
  value: string,
): HarnessManagedProfile {
  let candidate: Record<string, unknown>;
  try {
    candidate = JSON.parse(value) as Record<string, unknown>;
  } catch {
    throw new Error("AgentCore Harness profile is not valid JSON");
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
    gatewayUrl: requiredProfileString(candidate.gatewayUrl, "gatewayUrl"),
    gatewayTargetName: requiredProfileString(
      candidate.gatewayTargetName,
      "gatewayTargetName",
    ),
    identityWorkloadName: requiredProfileString(
      candidate.identityWorkloadName,
      "identityWorkloadName",
    ),
    identityCredentialProviderName: requiredProfileString(
      candidate.identityCredentialProviderName,
      "identityCredentialProviderName",
    ),
  };
}

export function harnessManagedProfileParameterName(
  stage: string,
  tenantSlug: string,
): string {
  // HARNESS_PROOF_PROFILE_PARAMETER_NAME remains a rollout-only compatibility
  // alias for stacks deployed before the managed tenant-scoped profile path.
  const explicit =
    process.env.AGENTCORE_HARNESS_PROFILE_PARAMETER_NAME?.trim() ||
    process.env.HARNESS_PROOF_PROFILE_PARAMETER_NAME?.trim();
  return (
    explicit || `/thinkwork/${stage}/agentcore-harness-profiles/${tenantSlug}`
  );
}

function legacySingleTenantProfileParameterName(stage: string): string {
  return `/thinkwork/${stage}/agentcore-harness-proof-profile`;
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

export async function readHarnessReadiness(
  tenantSlug?: string | null,
  deps: ProfileLoaderDeps = defaultDeps(),
): Promise<HarnessReadiness> {
  const checkedAt = new Date().toISOString();
  if (!tenantSlug?.trim()) {
    return emptyReadiness(
      "misconfigured",
      "tenant_identity_missing",
      checkedAt,
    );
  }
  let raw: string | null;
  try {
    raw = await deps.getParameter(
      harnessManagedProfileParameterName(deps.stage, tenantSlug),
    );
    // Rollout compatibility for the already-deployed single-tenant profile.
    // New tenant profiles use the scoped path above; the legacy value is only
    // eligible when its embedded tenant identity matches the caller below.
    if (
      !raw &&
      !process.env.AGENTCORE_HARNESS_PROFILE_PARAMETER_NAME?.trim() &&
      !process.env.HARNESS_PROOF_PROFILE_PARAMETER_NAME?.trim()
    ) {
      raw = await deps.getParameter(
        legacySingleTenantProfileParameterName(deps.stage),
      );
    }
  } catch {
    return emptyReadiness("misconfigured", "profile_read_failed", checkedAt);
  }
  if (!raw) return emptyReadiness("disabled", "profile_missing", checkedAt);

  let profile: HarnessManagedProfile;
  try {
    profile = parseHarnessManagedProfile(raw);
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
    gatewayUrl: profile.gatewayUrl,
    gatewayTargetName: profile.gatewayTargetName,
    identityWorkloadName: profile.identityWorkloadName,
    identityCredentialProviderName: profile.identityCredentialProviderName,
    checkedAt,
  };
  if (profile.tenantSlug !== tenantSlug) {
    return {
      ...base,
      state: "disabled",
      ready: false,
      reasonCode: "profile_tenant_mismatch",
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

export async function requireHarnessManagedProfile(
  tenantSlug: string,
  deps?: ProfileLoaderDeps,
): Promise<HarnessManagedProfile> {
  const readiness = await readHarnessReadiness(tenantSlug, deps);
  if (!readiness.ready) {
    throw new Error(
      `AgentCore Harness is unavailable (${readiness.reasonCode})`,
    );
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
    gatewayUrl: readiness.gatewayUrl!,
    gatewayTargetName: readiness.gatewayTargetName!,
    identityWorkloadName: readiness.identityWorkloadName!,
    identityCredentialProviderName: readiness.identityCredentialProviderName!,
  };
}

function emptyReadiness(
  state: HarnessReadinessState,
  reasonCode: string,
  checkedAt: string,
): HarnessReadiness {
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
    gatewayUrl: null,
    gatewayTargetName: null,
    identityWorkloadName: null,
    identityCredentialProviderName: null,
    checkedAt,
  };
}
