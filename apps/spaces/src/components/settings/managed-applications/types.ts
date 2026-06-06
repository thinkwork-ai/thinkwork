import type {
  SettingsDeploymentStatusQuery,
  SettingsManagedApplicationDeploymentQuery,
  SettingsManagedApplicationsQuery,
} from "@/gql/graphql";

export type ManagedAppKey = "cognee" | "twenty";

export type ManagedApplication =
  SettingsManagedApplicationsQuery["managedApplications"][number];

export type RuntimeDeployment =
  SettingsDeploymentStatusQuery["deploymentStatus"]["managedApplications"][number];

export type ManagedApplicationJob = NonNullable<
  SettingsManagedApplicationDeploymentQuery["managedApplicationDeployment"]
>;

export interface DataImpact {
  destructive: boolean;
  summary?: string;
  resources?: string[];
}

export function asManagedAppKey(value: string): ManagedAppKey {
  return value === "twenty" ? "twenty" : "cognee";
}

export function parseDataImpact(value: unknown): DataImpact {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { destructive: false, resources: [] };
  }
  const record = value as Record<string, unknown>;
  return {
    destructive: record.destructive === true,
    summary: typeof record.summary === "string" ? record.summary : undefined,
    resources: Array.isArray(record.resources)
      ? record.resources.filter((entry): entry is string => {
          return typeof entry === "string" && entry.trim() !== "";
        })
      : [],
  };
}

export function terminalJobStatus(status: string): boolean {
  return ["succeeded", "failed", "rejected"].includes(status);
}

export function appDisplayName(key: ManagedAppKey): string {
  return key === "twenty" ? "Twenty CRM" : "Cognee";
}

export function destructiveConfirmationFor(key: ManagedAppKey): string {
  return key === "twenty" ? "DESTROY TWENTY" : "DESTROY COGNEE";
}
