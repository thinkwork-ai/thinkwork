import { cogneeAdapter } from "./cognee.js";
import { planeAdapter } from "./plane.js";
import { twentyAdapter } from "./twenty.js";
import type { ManagedAppOperation } from "../shared.js";

export type { ManagedAppOperation } from "../shared.js";

export type ManagedAppKey = "cognee" | "plane" | "twenty";

export interface SmokeContract {
  id: string;
  command: string;
  required: boolean;
}

export interface RequiredManagedAppInput {
  key: string;
  description: string;
  terraformVariable: string;
  secret?: boolean;
}

export interface ManagedAppDataImpact {
  destructive: boolean;
  summary: string;
  resources: string[];
}

export interface PreDestroyStep {
  id: string;
  description: string;
  evidenceKey: string;
}

export interface ManagedAppStatus {
  provisioned: boolean;
  runtimeEnabled: boolean;
  endpoint: string | null;
  status: "disabled" | "parked" | "running";
  evidence: Record<string, string | boolean | number | null>;
}

export interface ManagedAppPlan {
  terraformVariables: Record<string, unknown>;
  dataImpact: ManagedAppDataImpact;
  preDestroySteps: PreDestroyStep[];
  smokeContracts: readonly SmokeContract[];
  statusOutputs: string[];
}

export interface ManagedAppAdapter {
  appKey: ManagedAppKey;
  displayName: string;
  description: string;
  catalogVisible: boolean;
  terraformModulePath: string;
  requiredInputs(operation: ManagedAppOperation): RequiredManagedAppInput[];
  buildTerraformVariables(args: {
    operation: ManagedAppOperation;
    desiredConfig?: Record<string, unknown>;
  }): Record<string, unknown>;
  dataImpact(operation: ManagedAppOperation): ManagedAppDataImpact;
  preDestroySteps(operation: ManagedAppOperation): PreDestroyStep[];
  smokeContracts: readonly SmokeContract[];
  statusOutputs: string[];
  extractStatus(terraformOutputs: Record<string, unknown>): ManagedAppStatus;
}

export const managedAppRegistry = [
  cogneeAdapter,
  planeAdapter,
  twentyAdapter,
] as const;

export function getManagedAppAdapter(appKey: ManagedAppKey): ManagedAppAdapter {
  const adapter = managedAppRegistry.find((candidate) => {
    return candidate.appKey === appKey;
  });
  if (!adapter) {
    throw new Error(`Unknown managed application adapter: ${appKey}`);
  }
  return adapter;
}

export function buildManagedAppPlan(args: {
  appKey: ManagedAppKey;
  operation: ManagedAppOperation;
  desiredConfig?: Record<string, unknown>;
  manifestImages?: Record<string, string>;
}): ManagedAppPlan {
  const adapter = getManagedAppAdapter(args.appKey);
  const desiredConfig = resolveManagedAppDesiredConfig(args);
  return {
    terraformVariables: adapter.buildTerraformVariables({
      operation: args.operation,
      desiredConfig,
    }),
    dataImpact: adapter.dataImpact(args.operation),
    preDestroySteps: adapter.preDestroySteps(args.operation),
    smokeContracts: adapter.smokeContracts,
    statusOutputs: adapter.statusOutputs,
  };
}

export function resolveManagedAppDesiredConfig(args: {
  appKey: ManagedAppKey;
  operation: ManagedAppOperation;
  desiredConfig?: Record<string, unknown>;
  manifestImages?: Record<string, string>;
}): Record<string, unknown> | undefined {
  if (args.operation === "DESTROY") return args.desiredConfig;
  if (args.appKey === "plane") {
    return resolvePlaneDesiredConfig(args.desiredConfig, args.manifestImages);
  }
  if (
    typeof args.desiredConfig?.imageUri === "string" &&
    args.desiredConfig.imageUri.trim()
  ) {
    return args.desiredConfig;
  }

  const imageUri = manifestImageForApp(args.appKey, args.manifestImages);
  if (!imageUri) {
    return args.desiredConfig;
  }
  return {
    ...(args.desiredConfig ?? {}),
    imageUri,
  };
}

export function dataImpactForManagedApp(
  appKey: ManagedAppKey,
  operation: ManagedAppOperation,
): ManagedAppDataImpact {
  return getManagedAppAdapter(appKey).dataImpact(operation);
}

function manifestImageForApp(
  appKey: ManagedAppKey,
  manifestImages: Record<string, string> | undefined,
): string | null {
  if (!manifestImages) return null;
  const candidates =
    appKey === "twenty"
      ? ["twenty", "twenty-crm", "managed-app-twenty"]
      : appKey === "plane"
        ? ["plane", "plane-app", "managed-app-plane"]
        : [appKey, `managed-app-${appKey}`, `${appKey}-runtime`];
  for (const candidate of candidates) {
    const value = manifestImages[candidate];
    if (value) return value;
  }
  return null;
}

function resolvePlaneDesiredConfig(
  desiredConfig: Record<string, unknown> | undefined,
  manifestImages: Record<string, string> | undefined,
): Record<string, unknown> | undefined {
  const next = { ...(desiredConfig ?? {}) };
  const imageKeys: Array<[string, string[]]> = [
    ["frontendImageUri", ["plane-frontend", "plane-web"]],
    ["backendImageUri", ["plane-backend", "plane-api"]],
    ["spaceImageUri", ["plane-space"]],
    ["adminImageUri", ["plane-admin"]],
    ["liveImageUri", ["plane-live"]],
    ["mcpImageUri", ["plane-mcp-server", "plane-mcp"]],
  ];
  for (const [configKey, candidates] of imageKeys) {
    if (typeof next[configKey] === "string" && next[configKey]) continue;
    const image = firstManifestImage(candidates, manifestImages);
    if (image) next[configKey] = image;
  }
  return Object.keys(next).length > 0 ? next : desiredConfig;
}

function firstManifestImage(
  candidates: string[],
  manifestImages: Record<string, string> | undefined,
): string | null {
  if (!manifestImages) return null;
  for (const candidate of candidates) {
    const value = manifestImages[candidate];
    if (value) return value;
  }
  return null;
}
