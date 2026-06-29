import type {
  SettingsDeploymentStatusQuery,
  SettingsManagedApplicationDeploymentQuery,
  SettingsManagedApplicationsQuery,
} from "@/gql/graphql";

export type ManagedAppKey = "cognee" | "n8n" | "twenty";

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
  if (value === "twenty") return "twenty";
  if (value === "n8n") return "n8n";
  return "cognee";
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

// Key-agnostic (accepts any app key string): plugin-created deployment jobs
// flow through the same plan dialog, so these no longer assume the closed
// ManagedAppKey union. Known keys keep their curated names; unknown keys
// fall back to the key itself / DESTROY <KEY>.
export function appDisplayName(key: string): string {
  if (key === "twenty") return "Twenty CRM";
  if (key === "cognee") return "ThinkWork Brain substrate";
  if (key === "n8n") return "n8n";
  return key;
}

export function destructiveConfirmationFor(key: string): string {
  return `DESTROY ${key.toUpperCase()}`;
}
