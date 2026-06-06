import { cogneeAdapter } from "./cognee.js";
import { twentyAdapter } from "./twenty.js";
import type { ManagedAppOperation } from "../shared.js";

export type { ManagedAppOperation } from "../shared.js";

export type ManagedAppKey = "cognee" | "twenty";

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

export const managedAppRegistry = [cogneeAdapter, twentyAdapter] as const;

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
}): ManagedAppPlan {
  const adapter = getManagedAppAdapter(args.appKey);
  return {
    terraformVariables: adapter.buildTerraformVariables({
      operation: args.operation,
      desiredConfig: args.desiredConfig,
    }),
    dataImpact: adapter.dataImpact(args.operation),
    preDestroySteps: adapter.preDestroySteps(args.operation),
    smokeContracts: adapter.smokeContracts,
    statusOutputs: adapter.statusOutputs,
  };
}

export function dataImpactForManagedApp(
  appKey: ManagedAppKey,
  operation: ManagedAppOperation,
): ManagedAppDataImpact {
  return getManagedAppAdapter(appKey).dataImpact(operation);
}
