import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { HarnessTool } from "@aws-sdk/client-bedrock-agentcore";
import { createHash } from "node:crypto";

export type HarnessInvocationTool = HarnessTool & {
  type: NonNullable<HarnessTool["type"]>;
  name: string;
  config: NonNullable<HarnessTool["config"]>;
};

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
  gatewayArn?: string;
  gatewayUrl: string;
  gatewayTargetName: string;
  identityWorkloadName: string;
  identityCredentialProviderName: string;
  identityCredentialProviderArn?: string;
  invocationToolsFingerprint?: string;
  invocationTools?: HarnessInvocationTool[];
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
  gatewayArn: string | null;
  gatewayUrl: string | null;
  gatewayTargetName: string | null;
  identityWorkloadName: string | null;
  identityCredentialProviderName: string | null;
  identityCredentialProviderArn: string | null;
  invocationToolsFingerprint: string | null;
  invocationTools: HarnessInvocationTool[] | null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordProperty(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function fingerprintHarnessInvocationTools(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

const REQUIRED_INVOCATION_TOOLS: ReadonlyMap<string, string> = new Map([
  ["thinkwork_gateway", "agentcore_gateway"],
  ["browser", "agentcore_browser"],
  ["emit_document", "inline_function"],
  ["goal_complete", "inline_function"],
  ["submit_skill_draft", "inline_function"],
] as const);

function invalidInvocationTool(index: number): never {
  throw new Error(
    `AgentCore Harness profile has invalid invocationTools[${index}]`,
  );
}

function validateInvocationToolConfig(
  tool: Record<string, unknown>,
  index: number,
): void {
  if (!isRecord(tool.config) || Object.keys(tool.config).length !== 1) {
    invalidInvocationTool(index);
  }
  if (tool.type === "agentcore_gateway") {
    const gateway = tool.config.agentCoreGateway;
    if (
      !isRecord(gateway) ||
      Object.keys(gateway).some(
        (key) => !["gatewayArn", "outboundAuth"].includes(key),
      ) ||
      typeof gateway.gatewayArn !== "string" ||
      !/^arn:aws[^:]*:bedrock-agentcore:[^:]+:\d+:gateway\/.+/.test(
        gateway.gatewayArn,
      )
    ) {
      invalidInvocationTool(index);
    }
    if (gateway.outboundAuth === undefined) invalidInvocationTool(index);
    if (gateway.outboundAuth !== undefined) {
      const outboundAuth = gateway.outboundAuth;
      const oauth = isRecord(outboundAuth) ? outboundAuth.oauth : undefined;
      if (
        !isRecord(outboundAuth) ||
        Object.keys(outboundAuth).length !== 1 ||
        !isRecord(oauth) ||
        Object.keys(oauth).some(
          (key) =>
            ![
              "providerArn",
              "scopes",
              "customParameters",
              "grantType",
            ].includes(key),
        ) ||
        typeof oauth.providerArn !== "string" ||
        !/^arn:aws[^:]*:bedrock-agentcore:[^:]+:\d+:token-vault\/.+\/oauth2credentialprovider\/.+/.test(
          oauth.providerArn,
        ) ||
        !Array.isArray(oauth.scopes) ||
        oauth.scopes.length !== 1 ||
        oauth.scopes[0] !== "gateway:invoke" ||
        oauth.grantType !== "TOKEN_EXCHANGE"
      ) {
        invalidInvocationTool(index);
      }
      if (
        oauth.customParameters !== undefined &&
        (!isRecord(oauth.customParameters) ||
          Object.keys(oauth.customParameters).length !== 1 ||
          oauth.customParameters.subject_token_type !==
            "urn:ietf:params:oauth:token-type:jwt")
      ) {
        invalidInvocationTool(index);
      }
    }
    return;
  }
  if (tool.type === "agentcore_browser") {
    const browser = tool.config.agentCoreBrowser;
    if (!isRecord(browser) || Object.keys(browser).length !== 0) {
      invalidInvocationTool(index);
    }
    return;
  }
  if (tool.type === "inline_function") {
    const inlineFunction = tool.config.inlineFunction;
    if (
      !isRecord(inlineFunction) ||
      typeof inlineFunction.description !== "string" ||
      !inlineFunction.description.trim() ||
      !isRecord(inlineFunction.inputSchema) ||
      inlineFunction.inputSchema.type !== "object" ||
      inlineFunction.inputSchema.additionalProperties !== false
    ) {
      invalidInvocationTool(index);
    }
    return;
  }
  invalidInvocationTool(index);
}

function requiredInvocationTools(value: unknown): HarnessInvocationTool[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("AgentCore Harness profile is missing invocationTools");
  }
  if (value.length !== REQUIRED_INVOCATION_TOOLS.size) {
    throw new Error(
      "AgentCore Harness profile has unexpected invocation tools",
    );
  }
  const tools = value.map((candidate, index) => {
    if (!isRecord(candidate)) invalidInvocationTool(index);
    const tool = candidate;
    if (
      typeof tool.type !== "string" ||
      !tool.type.trim() ||
      typeof tool.name !== "string" ||
      !tool.name.trim() ||
      Object.keys(tool).some(
        (key) => !["type", "name", "config"].includes(key),
      ) ||
      REQUIRED_INVOCATION_TOOLS.get(tool.name) !== tool.type
    ) {
      invalidInvocationTool(index);
    }
    validateInvocationToolConfig(tool, index);
    return {
      type: tool.type as HarnessInvocationTool["type"],
      name: tool.name,
      config: tool.config as HarnessInvocationTool["config"],
    };
  });
  const uniqueNames = new Set(tools.map((tool) => tool.name));
  if (uniqueNames.size !== tools.length) {
    throw new Error("AgentCore Harness profile has duplicate invocation tools");
  }
  for (const name of REQUIRED_INVOCATION_TOOLS.keys()) {
    if (!uniqueNames.has(name)) {
      throw new Error(
        `AgentCore Harness profile is missing required invocation tool ${name}`,
      );
    }
  }
  return tools;
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
  const tenantSlug = requiredProfileString(candidate.tenantSlug, "tenantSlug");
  const endpointName = requiredProfileString(
    candidate.endpointName,
    "endpointName",
  );
  const attestationFields = [
    "gatewayArn",
    "identityCredentialProviderArn",
    "invocationToolsContract",
    "invocationToolsFingerprint",
    "invocationTools",
  ];
  const hasAttestedTools = attestationFields.some(
    (field) => candidate[field] !== undefined,
  );
  if (!hasAttestedTools && endpointName !== "ThinkworkProof") {
    throw new Error(
      "AgentCore Harness profile cannot use legacy tools on a versioned endpoint",
    );
  }
  let gatewayArn: string | undefined;
  let identityCredentialProviderArn: string | undefined;
  let invocationToolsFingerprint: string | undefined;
  let invocationTools: HarnessInvocationTool[] | undefined;
  if (hasAttestedTools) {
    if (
      candidate.invocationToolsContract !==
      "control-plane-attested-full-override-v1"
    ) {
      throw new Error(
        "AgentCore Harness profile has unsupported invocationToolsContract",
      );
    }
    gatewayArn = requiredProfileString(candidate.gatewayArn, "gatewayArn");
    identityCredentialProviderArn = requiredProfileString(
      candidate.identityCredentialProviderArn,
      "identityCredentialProviderArn",
    );
    invocationTools = requiredInvocationTools(candidate.invocationTools);
    const gatewayTool = invocationTools.find(
      (tool) => tool.name === "thinkwork_gateway",
    );
    const gatewayConfig = recordProperty(
      gatewayTool?.config,
      "agentCoreGateway",
    );
    const outboundAuth = recordProperty(gatewayConfig, "outboundAuth");
    const oauth = recordProperty(outboundAuth, "oauth");
    if (
      !isRecord(gatewayConfig) ||
      gatewayConfig.gatewayArn !== gatewayArn ||
      !isRecord(oauth) ||
      oauth.providerArn !== identityCredentialProviderArn
    ) {
      throw new Error(
        "AgentCore Harness profile invocation tools do not match governed resources",
      );
    }
    invocationToolsFingerprint = requiredProfileString(
      candidate.invocationToolsFingerprint,
      "invocationToolsFingerprint",
    );
    if (
      invocationToolsFingerprint !==
      fingerprintHarnessInvocationTools(invocationTools)
    ) {
      throw new Error(
        "AgentCore Harness profile invocation tools fingerprint mismatch",
      );
    }
  }
  return {
    tenantSlug,
    harnessArn: requiredProfileString(candidate.harnessArn, "harnessArn"),
    endpointName,
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
    ...(gatewayArn ? { gatewayArn } : {}),
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
    ...(identityCredentialProviderArn ? { identityCredentialProviderArn } : {}),
    ...(invocationToolsFingerprint ? { invocationToolsFingerprint } : {}),
    ...(invocationTools ? { invocationTools } : {}),
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
    gatewayArn: profile.gatewayArn ?? null,
    gatewayUrl: profile.gatewayUrl,
    gatewayTargetName: profile.gatewayTargetName,
    identityWorkloadName: profile.identityWorkloadName,
    identityCredentialProviderName: profile.identityCredentialProviderName,
    identityCredentialProviderArn:
      profile.identityCredentialProviderArn ?? null,
    invocationToolsFingerprint: profile.invocationToolsFingerprint ?? null,
    invocationTools: profile.invocationTools ?? null,
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
    ...(readiness.gatewayArn ? { gatewayArn: readiness.gatewayArn } : {}),
    gatewayUrl: readiness.gatewayUrl!,
    gatewayTargetName: readiness.gatewayTargetName!,
    identityWorkloadName: readiness.identityWorkloadName!,
    identityCredentialProviderName: readiness.identityCredentialProviderName!,
    ...(readiness.identityCredentialProviderArn
      ? {
          identityCredentialProviderArn:
            readiness.identityCredentialProviderArn,
        }
      : {}),
    ...(readiness.invocationToolsFingerprint
      ? { invocationToolsFingerprint: readiness.invocationToolsFingerprint }
      : {}),
    ...(readiness.invocationTools
      ? { invocationTools: readiness.invocationTools }
      : {}),
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
    gatewayArn: null,
    gatewayUrl: null,
    gatewayTargetName: null,
    identityWorkloadName: null,
    identityCredentialProviderName: null,
    identityCredentialProviderArn: null,
    invocationToolsFingerprint: null,
    invocationTools: null,
    checkedAt,
  };
}
