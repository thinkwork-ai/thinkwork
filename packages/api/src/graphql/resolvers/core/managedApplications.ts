import { getConfig } from "@thinkwork/runtime-config";
import { and, desc, eq } from "drizzle-orm";
import {
  managedApplicationDeploymentJobs,
  managedApplications as managedApplicationsTable,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../../utils.js";

export type ManagedApplicationKey = "cognee" | "twenty";

export type CogneeStatus = {
  enabled: boolean;
  endpoint: string | null;
  backendMode: string | null;
};

export type TwentyStatus = {
  provisioned: boolean;
  runtimeEnabled: boolean;
  url: string | null;
  clusterArn: string | null;
  serverServiceName: string | null;
  workerServiceName: string | null;
  serverLogGroupName: string | null;
  workerLogGroupName: string | null;
  albArn: string | null;
  targetGroupArn: string | null;
};

export type ManagedApplicationStatus = {
  key: ManagedApplicationKey;
  displayName: string;
  description: string;
  status: "disabled" | "parked" | "running" | "unknown";
  enabled: boolean;
  provisioned: boolean;
  runtimeEnabled: boolean;
  url: string | null;
  endpoint: string | null;
  backendMode: string | null;
  logGroupName: string | null;
  logGroupNames: string[];
  clusterArn: string | null;
  serviceName: string | null;
  serviceNames: string[];
  albArn: string | null;
  targetGroupArn: string | null;
  storageBucketName: string | null;
  databaseName: string | null;
  message: string | null;
  managedMcpServerId: string | null;
  managedMcpStatus: string;
  managedMcpInstalled: boolean;
  managedMcpInstallAvailable: boolean;
  managedMcpMessage: string | null;
};

export function normalizeManagedApplicationKey(
  raw: unknown,
): ManagedApplicationKey | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  if (
    key === "cognee" ||
    key === "knowledgegraph" ||
    key === "knowledge-graph"
  ) {
    return "cognee";
  }
  if (key === "twenty" || key === "crm" || key === "twenty-crm") {
    return "twenty";
  }
  return null;
}

export function readCogneeStatus(): CogneeStatus {
  const legacyEndpoint = process.env.COGNEE_ENDPOINT || null;
  const legacyBackendMode = process.env.COGNEE_BACKEND_MODE || null;
  const raw = getConfig("COGNEE") || process.env.COGNEE_STATUS;

  if (!raw) {
    return {
      enabled: Boolean(
        legacyEndpoint ||
        process.env.COGNEE_SERVICE_NAME ||
        process.env.COGNEE_LOG_GROUP_NAME,
      ),
      endpoint: legacyEndpoint,
      backendMode: legacyBackendMode,
    };
  }

  const separatorIndex = raw.indexOf("|");
  if (separatorIndex >= 0) {
    const backend = raw.slice(0, separatorIndex).trim();
    const endpoint = raw.slice(separatorIndex + 1).trim();
    return {
      enabled: true,
      endpoint: endpoint || legacyEndpoint,
      backendMode: backend || legacyBackendMode,
    };
  }

  try {
    const parsed = JSON.parse(raw) as {
      endpoint?: unknown;
      backend?: unknown;
    };
    const endpoint =
      typeof parsed.endpoint === "string" && parsed.endpoint.trim()
        ? parsed.endpoint
        : legacyEndpoint;
    const backendMode =
      typeof parsed.backend === "string" && parsed.backend.trim()
        ? parsed.backend
        : legacyBackendMode;
    return {
      enabled: true,
      endpoint,
      backendMode,
    };
  } catch {
    return {
      enabled: raw === "true" || Boolean(legacyEndpoint),
      endpoint: legacyEndpoint,
      backendMode: legacyBackendMode,
    };
  }
}

/**
 * Injectable DB reads behind the Twenty status projection — unit tests
 * fake these two lookups instead of a Drizzle handle.
 */
export interface TwentyStatusReaderDeps {
  getManagedApplicationRow(
    tenantId: string,
  ): Promise<{ desiredConfig: Record<string, unknown> } | null>;
  /** Latest SUCCEEDED deployment job for (tenant, 'twenty'), if any. */
  getLatestSucceededJobOperation(tenantId: string): Promise<string | null>;
}

export function createDrizzleTwentyStatusReaderDeps(
  db: typeof defaultDb = defaultDb,
): TwentyStatusReaderDeps {
  return {
    async getManagedApplicationRow(tenantId) {
      const [row] = await db
        .select({ desired_config: managedApplicationsTable.desired_config })
        .from(managedApplicationsTable)
        .where(
          and(
            eq(managedApplicationsTable.tenant_id, tenantId),
            eq(managedApplicationsTable.key, "twenty"),
          ),
        )
        .limit(1);
      if (!row) return null;
      return {
        desiredConfig: (row.desired_config ?? {}) as Record<string, unknown>,
      };
    },
    async getLatestSucceededJobOperation(tenantId) {
      const [job] = await db
        .select({ operation: managedApplicationDeploymentJobs.operation })
        .from(managedApplicationDeploymentJobs)
        .where(
          and(
            eq(managedApplicationDeploymentJobs.tenant_id, tenantId),
            eq(managedApplicationDeploymentJobs.app_key, "twenty"),
            eq(managedApplicationDeploymentJobs.status, "succeeded"),
          ),
        )
        .orderBy(desc(managedApplicationDeploymentJobs.updated_at))
        .limit(1);
      return job?.operation ?? null;
    },
  };
}

const DISABLED_TWENTY_STATUS: TwentyStatus = {
  provisioned: false,
  runtimeEnabled: false,
  url: null,
  clusterArn: null,
  serverServiceName: null,
  workerServiceName: null,
  serverLogGroupName: null,
  workerLogGroupName: null,
  albArn: null,
  targetGroupArn: null,
};

/**
 * Twenty status served from Aurora (plan 2026-06-12-001 U10) — the
 * managed_applications row + its deployment-job history are the canonical
 * plugin-engine infrastructure state. The TWENTY env/SSM projection is
 * retired (Cognee's env-var path is intentionally UNCHANGED).
 *
 * Applied reality = the LATEST SUCCEEDED deployment job's operation:
 * ENABLE/UPGRADE → running, PARK → parked, DESTROY (or no succeeded job /
 * no row) → disabled. An in-flight or failed job never flips the reported
 * state — the previous applied operation keeps reporting until a new
 * apply succeeds. The public URL comes from the row's desired_config
 * (`publicUrl`, echoed verbatim by Terraform as `twenty_url`); ECS
 * service/log identifiers are stage-derived stable names, as before.
 */
export async function readTwentyStatus(
  tenantId: string | null,
  deps: TwentyStatusReaderDeps = createDrizzleTwentyStatusReaderDeps(),
): Promise<TwentyStatus> {
  if (!tenantId) return DISABLED_TWENTY_STATUS;
  const row = await deps.getManagedApplicationRow(tenantId);
  if (!row) return DISABLED_TWENTY_STATUS;
  const operation = await deps.getLatestSucceededJobOperation(tenantId);
  if (!operation || operation === "DESTROY") return DISABLED_TWENTY_STATUS;

  const provisioned = true;
  const runtimeEnabled = operation !== "PARK";
  const publicUrl = row.desiredConfig.publicUrl;
  const defaults = deriveTwentyDefaults(provisioned);
  return {
    provisioned,
    runtimeEnabled,
    url: typeof publicUrl === "string" && publicUrl.trim() ? publicUrl : null,
    clusterArn: defaults.clusterArn,
    serverServiceName: defaults.serverServiceName,
    workerServiceName: defaults.workerServiceName,
    serverLogGroupName: defaults.serverLogGroupName,
    workerLogGroupName: defaults.workerLogGroupName,
    albArn: null,
    targetGroupArn: null,
  };
}

export async function readManagedApplications(
  tenantId: string | null,
  deps?: TwentyStatusReaderDeps,
): Promise<ManagedApplicationStatus[]> {
  return [
    cogneeManagedApplication(),
    await twentyManagedApplication(tenantId, deps),
  ];
}

export async function readManagedApplication(
  key: ManagedApplicationKey,
  tenantId: string | null,
  deps?: TwentyStatusReaderDeps,
): Promise<ManagedApplicationStatus> {
  if (key === "cognee") return cogneeManagedApplication();
  return twentyManagedApplication(tenantId, deps);
}

function cogneeManagedApplication(): ManagedApplicationStatus {
  const stage = process.env.STAGE || "unknown";
  const region = process.env.AWS_REGION || "us-east-1";
  const accountId = process.env.AWS_ACCOUNT_ID || null;
  const cognee = readCogneeStatus();
  const serviceName =
    process.env.COGNEE_SERVICE_NAME ||
    (cognee.enabled ? `thinkwork-${stage}-cognee` : null);
  const clusterArn =
    process.env.COGNEE_CLUSTER_ARN ||
    (cognee.enabled && accountId
      ? `arn:aws:ecs:${region}:${accountId}:cluster/thinkwork-${stage}-cognee-cluster`
      : null);
  const logGroupName =
    process.env.COGNEE_LOG_GROUP_NAME ||
    (cognee.enabled ? `/thinkwork/${stage}/cognee` : null);

  return {
    key: "cognee",
    displayName: "Cognee",
    description: "Knowledge Graph service for ontology and graph retrieval.",
    status: cognee.enabled ? "running" : "disabled",
    enabled: cognee.enabled,
    provisioned: cognee.enabled,
    runtimeEnabled: cognee.enabled,
    url: null,
    endpoint: cognee.endpoint,
    backendMode: cognee.backendMode,
    logGroupName,
    logGroupNames: logGroupName ? [logGroupName] : [],
    clusterArn,
    serviceName,
    serviceNames: serviceName ? [serviceName] : [],
    albArn: null,
    targetGroupArn: null,
    storageBucketName: null,
    databaseName: null,
    message: cognee.enabled
      ? null
      : "Cognee is not provisioned for this stage.",
    managedMcpServerId: null,
    managedMcpStatus: "not_applicable",
    managedMcpInstalled: false,
    managedMcpInstallAvailable: false,
    managedMcpMessage: null,
  };
}

async function twentyManagedApplication(
  tenantId: string | null,
  deps?: TwentyStatusReaderDeps,
): Promise<ManagedApplicationStatus> {
  const twenty = await readTwentyStatus(tenantId, deps);
  const status = twenty.runtimeEnabled
    ? "running"
    : twenty.provisioned
      ? "parked"
      : "disabled";
  const logGroupNames = [
    twenty.serverLogGroupName,
    twenty.workerLogGroupName,
  ].filter((value): value is string => Boolean(value));
  const serviceNames = [
    twenty.serverServiceName,
    twenty.workerServiceName,
  ].filter((value): value is string => Boolean(value));

  return {
    key: "twenty",
    displayName: "Twenty CRM",
    description: "Self-hosted CRM runtime managed by ThinkWork.",
    status,
    enabled: twenty.runtimeEnabled,
    provisioned: twenty.provisioned,
    runtimeEnabled: twenty.runtimeEnabled,
    url: twenty.url,
    endpoint: twenty.url,
    backendMode: null,
    logGroupName: twenty.serverLogGroupName,
    logGroupNames,
    clusterArn: twenty.clusterArn,
    serviceName: twenty.serverServiceName,
    serviceNames,
    albArn: twenty.albArn,
    targetGroupArn: twenty.targetGroupArn,
    storageBucketName: null,
    databaseName: null,
    message: twentyStatusMessage(status),
    managedMcpServerId: null,
    managedMcpStatus: "missing",
    managedMcpInstalled: false,
    managedMcpInstallAvailable:
      status === "running" && twenty.provisioned && Boolean(twenty.url),
    managedMcpMessage:
      status === "running" && twenty.url
        ? "Twenty CRM MCP server has not been registered yet."
        : null,
  };
}

function twentyStatusMessage(
  status: ManagedApplicationStatus["status"],
): string | null {
  if (status === "parked") {
    return "Twenty CRM runtime is parked; CRM data and app secrets are retained.";
  }
  if (status === "disabled") {
    return "Twenty CRM has not been provisioned for this stage.";
  }
  if (status === "unknown") {
    return "Twenty CRM deployment status could not be parsed.";
  }
  return null;
}

function deriveTwentyDefaults(
  provisioned: boolean,
): Pick<
  TwentyStatus,
  | "clusterArn"
  | "serverServiceName"
  | "workerServiceName"
  | "serverLogGroupName"
  | "workerLogGroupName"
> {
  if (!provisioned) {
    return {
      clusterArn: null,
      serverServiceName: null,
      workerServiceName: null,
      serverLogGroupName: null,
      workerLogGroupName: null,
    };
  }

  const stage = process.env.STAGE || "unknown";
  const region = process.env.AWS_REGION || "us-east-1";
  const accountId = process.env.AWS_ACCOUNT_ID || null;

  return {
    clusterArn: accountId
      ? `arn:aws:ecs:${region}:${accountId}:cluster/thinkwork-${stage}-twenty-cluster`
      : null,
    serverServiceName: `thinkwork-${stage}-twenty-server`,
    workerServiceName: `thinkwork-${stage}-twenty-worker`,
    serverLogGroupName: `/thinkwork/${stage}/twenty/server`,
    workerLogGroupName: `/thinkwork/${stage}/twenty/worker`,
  };
}
