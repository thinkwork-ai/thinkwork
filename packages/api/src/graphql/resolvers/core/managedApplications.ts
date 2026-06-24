import { getConfig } from "@thinkwork/runtime-config";
import { and, desc, eq } from "drizzle-orm";
import {
  managedApplicationDeploymentJobs,
  managedApplications as managedApplicationsTable,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../../utils.js";
import { resolveCogneeClusterIdentity } from "@thinkwork/plugin-company-brain/api/cognee-cluster-identity";

export type ManagedApplicationKey = "cognee" | "n8n" | "twenty";
type DbBackedManagedApplicationKey = Exclude<ManagedApplicationKey, "cognee">;

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

export type N8nStatus = {
  provisioned: boolean;
  runtimeEnabled: boolean;
  url: string | null;
  clusterArn: string | null;
  mainServiceName: string | null;
  workerServiceName: string | null;
  mainLogGroupName: string | null;
  workerLogGroupName: string | null;
  albArn: string | null;
  targetGroupArn: string | null;
  storageBucketName: string | null;
  databaseName: string | null;
  packageConfigDigest: string | null;
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
  workflowReadinessState: string;
  workflowReadinessReasons: unknown[];
  workflowCapabilityFlags: Record<string, unknown>;
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
  if (key === "n8n" || key === "workflow-automation") {
    return "n8n";
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
    key?: DbBackedManagedApplicationKey,
  ): Promise<{ desiredConfig: Record<string, unknown> } | null>;
  /** Latest SUCCEEDED deployment job for the managed app, if any. */
  getLatestSucceededJobOperation(
    tenantId: string,
    key?: DbBackedManagedApplicationKey,
  ): Promise<string | null>;
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

export interface ManagedAppStatusReaderDeps {
  getManagedApplicationRow(
    tenantId: string,
    key?: DbBackedManagedApplicationKey,
  ): Promise<{ desiredConfig: Record<string, unknown> } | null>;
  getLatestSucceededJobOperation(
    tenantId: string,
    key?: DbBackedManagedApplicationKey,
  ): Promise<string | null>;
}

export function createDrizzleManagedAppStatusReaderDeps(
  db: typeof defaultDb = defaultDb,
): ManagedAppStatusReaderDeps {
  return {
    async getManagedApplicationRow(tenantId, key = "twenty") {
      const [row] = await db
        .select({ desired_config: managedApplicationsTable.desired_config })
        .from(managedApplicationsTable)
        .where(
          and(
            eq(managedApplicationsTable.tenant_id, tenantId),
            eq(managedApplicationsTable.key, key),
          ),
        )
        .limit(1);
      if (!row) return null;
      return {
        desiredConfig: (row.desired_config ?? {}) as Record<string, unknown>,
      };
    },
    async getLatestSucceededJobOperation(tenantId, key = "twenty") {
      const [job] = await db
        .select({ operation: managedApplicationDeploymentJobs.operation })
        .from(managedApplicationDeploymentJobs)
        .where(
          and(
            eq(managedApplicationDeploymentJobs.tenant_id, tenantId),
            eq(managedApplicationDeploymentJobs.app_key, key),
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

const DISABLED_N8N_STATUS: N8nStatus = {
  provisioned: false,
  runtimeEnabled: false,
  url: null,
  clusterArn: null,
  mainServiceName: null,
  workerServiceName: null,
  mainLogGroupName: null,
  workerLogGroupName: null,
  albArn: null,
  targetGroupArn: null,
  storageBucketName: null,
  databaseName: null,
  packageConfigDigest: null,
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
  const row = await deps.getManagedApplicationRow(tenantId, "twenty");
  if (!row) return DISABLED_TWENTY_STATUS;
  const operation = await deps.getLatestSucceededJobOperation(
    tenantId,
    "twenty",
  );
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

export async function readN8nStatus(
  tenantId: string | null,
  deps: ManagedAppStatusReaderDeps = createDrizzleManagedAppStatusReaderDeps(),
): Promise<N8nStatus> {
  if (!tenantId) return DISABLED_N8N_STATUS;
  const row = await deps.getManagedApplicationRow(tenantId, "n8n");
  if (!row) return DISABLED_N8N_STATUS;
  const operation = await deps.getLatestSucceededJobOperation(tenantId, "n8n");
  if (!operation || operation === "DESTROY") return DISABLED_N8N_STATUS;

  const provisioned = true;
  const runtimeEnabled = operation !== "PARK";
  const publicUrl = row.desiredConfig.publicUrl;
  const storageBucketName = row.desiredConfig.storageBucketName;
  const databaseName = row.desiredConfig.databaseName;
  const packageConfigDigest = row.desiredConfig.packageConfigDigest;
  const defaults = deriveN8nDefaults(provisioned);
  return {
    provisioned,
    runtimeEnabled,
    url: typeof publicUrl === "string" && publicUrl.trim() ? publicUrl : null,
    clusterArn: defaults.clusterArn,
    mainServiceName: defaults.mainServiceName,
    workerServiceName: defaults.workerServiceName,
    mainLogGroupName: defaults.mainLogGroupName,
    workerLogGroupName: defaults.workerLogGroupName,
    albArn: null,
    targetGroupArn: null,
    storageBucketName:
      typeof storageBucketName === "string" && storageBucketName.trim()
        ? storageBucketName
        : defaults.storageBucketName,
    databaseName:
      typeof databaseName === "string" && databaseName.trim()
        ? databaseName
        : defaults.databaseName,
    packageConfigDigest:
      typeof packageConfigDigest === "string" && packageConfigDigest.trim()
        ? packageConfigDigest
        : null,
  };
}

export async function readManagedApplications(
  tenantId: string | null,
  deps?: ManagedAppStatusReaderDeps,
): Promise<ManagedApplicationStatus[]> {
  return [
    cogneeManagedApplication(),
    await n8nManagedApplication(tenantId, deps),
    await twentyManagedApplication(tenantId, deps),
  ];
}

export async function readManagedApplication(
  key: ManagedApplicationKey,
  tenantId: string | null,
  deps?: ManagedAppStatusReaderDeps,
): Promise<ManagedApplicationStatus> {
  if (key === "cognee") return cogneeManagedApplication();
  if (key === "n8n") return n8nManagedApplication(tenantId, deps);
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
  const cluster = resolveCogneeClusterIdentity({
    enabled: cognee.enabled,
    stage,
    region,
    accountId,
  });
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
    clusterArn: cluster.clusterArn,
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
    ...nonWorkflowManagedApplicationProjection(),
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

  const application: ManagedApplicationStatus = {
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
    workflowReadinessState: "unknown",
    workflowReadinessReasons: [],
    workflowCapabilityFlags: {},
  };
  return {
    ...application,
    ...twentyWorkflowProjection(application),
  };
}

async function n8nManagedApplication(
  tenantId: string | null,
  deps?: ManagedAppStatusReaderDeps,
): Promise<ManagedApplicationStatus> {
  const n8n = await readN8nStatus(tenantId, deps);
  const status = n8n.runtimeEnabled
    ? "running"
    : n8n.provisioned
      ? "parked"
      : "disabled";
  const logGroupNames = [n8n.mainLogGroupName, n8n.workerLogGroupName].filter(
    (value): value is string => Boolean(value),
  );
  const serviceNames = [n8n.mainServiceName, n8n.workerServiceName].filter(
    (value): value is string => Boolean(value),
  );

  return {
    key: "n8n",
    displayName: "n8n",
    description:
      "Self-hosted workflow automation runtime managed by ThinkWork.",
    status,
    enabled: n8n.runtimeEnabled,
    provisioned: n8n.provisioned,
    runtimeEnabled: n8n.runtimeEnabled,
    url: n8n.url,
    endpoint: n8n.url,
    backendMode: "queue",
    logGroupName: n8n.mainLogGroupName,
    logGroupNames,
    clusterArn: n8n.clusterArn,
    serviceName: n8n.mainServiceName,
    serviceNames,
    albArn: n8n.albArn,
    targetGroupArn: n8n.targetGroupArn,
    storageBucketName: n8n.storageBucketName,
    databaseName: n8n.databaseName,
    message: n8nStatusMessage(status),
    managedMcpServerId: null,
    managedMcpStatus: "missing",
    managedMcpInstalled: false,
    managedMcpInstallAvailable:
      status === "running" && n8n.provisioned && Boolean(n8n.url),
    managedMcpMessage:
      status === "running" && n8n.url
        ? "n8n MCP service credential has not been registered yet."
        : null,
    ...nonWorkflowManagedApplicationProjection(),
  };
}

export function twentyWorkflowProjection(
  application: Pick<
    ManagedApplicationStatus,
    | "key"
    | "status"
    | "provisioned"
    | "runtimeEnabled"
    | "url"
    | "managedMcpInstalled"
    | "managedMcpStatus"
    | "managedMcpMessage"
  >,
): Pick<
  ManagedApplicationStatus,
  | "workflowReadinessState"
  | "workflowReadinessReasons"
  | "workflowCapabilityFlags"
> {
  if (application.key !== "twenty") {
    return nonWorkflowManagedApplicationProjection();
  }
  const ready =
    application.status === "running" &&
    application.provisioned &&
    application.runtimeEnabled &&
    Boolean(application.url) &&
    application.managedMcpInstalled &&
    ["installed", "plugin_managed"].includes(application.managedMcpStatus);
  const reasons: unknown[] = [];
  if (!application.provisioned || application.status === "disabled") {
    reasons.push({
      code: "managed_app_destroyed",
      component: "managed_app",
      severity: "blocker",
      message:
        "Twenty CRM managed application is destroyed or disabled; workflow history remains available.",
    });
  } else if (application.status === "parked" || !application.runtimeEnabled) {
    reasons.push({
      code: "managed_app_parked",
      component: "managed_app",
      severity: "blocker",
      message:
        "Twenty CRM runtime is parked; workflows remain visible but cannot run.",
    });
  } else if (!application.managedMcpInstalled) {
    reasons.push({
      code: "mcp_server_missing",
      component: "mcp",
      severity: "blocker",
      message: "Twenty CRM MCP server is not registered for agents.",
    });
  } else if (
    !["installed", "plugin_managed"].includes(application.managedMcpStatus)
  ) {
    reasons.push({
      code: `mcp_server_${application.managedMcpStatus}`,
      component: "mcp",
      severity: "blocker",
      message:
        application.managedMcpMessage ??
        "Twenty CRM MCP server is not ready for workflow actions.",
    });
  }
  return {
    workflowReadinessState: ready ? "ready" : "blocked_not_ready",
    workflowReadinessReasons: reasons,
    workflowCapabilityFlags: {
      sourceSystem: "twenty",
      bindingType: "twenty_crm",
      triggerFamilies: ["crm"],
      actions: ["create_customer_onboarding_thread", "mirror_checklist_tasks"],
      resources: ["opportunity", "customer", "thread", "checklist_item"],
      start: false,
      monitor: true,
      cancel: false,
      retry: false,
      replay: false,
      evidence: true,
    },
  };
}

function nonWorkflowManagedApplicationProjection(): Pick<
  ManagedApplicationStatus,
  | "workflowReadinessState"
  | "workflowReadinessReasons"
  | "workflowCapabilityFlags"
> {
  return {
    workflowReadinessState: "not_applicable",
    workflowReadinessReasons: [],
    workflowCapabilityFlags: {},
  };
}

function n8nStatusMessage(
  status: ManagedApplicationStatus["status"],
): string | null {
  if (status === "parked") {
    return "n8n runtime is parked; workflow data, credentials, and app secrets are retained.";
  }
  if (status === "disabled") {
    return "n8n has not been provisioned for this stage.";
  }
  if (status === "unknown") {
    return "n8n deployment status could not be parsed.";
  }
  return null;
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

function deriveN8nDefaults(
  provisioned: boolean,
): Pick<
  N8nStatus,
  | "clusterArn"
  | "mainServiceName"
  | "workerServiceName"
  | "mainLogGroupName"
  | "workerLogGroupName"
  | "storageBucketName"
  | "databaseName"
> {
  if (!provisioned) {
    return {
      clusterArn: null,
      mainServiceName: null,
      workerServiceName: null,
      mainLogGroupName: null,
      workerLogGroupName: null,
      storageBucketName: null,
      databaseName: null,
    };
  }

  const stage = process.env.STAGE || "unknown";
  const region = process.env.AWS_REGION || "us-east-1";
  const accountId = process.env.AWS_ACCOUNT_ID || null;

  return {
    clusterArn: accountId
      ? `arn:aws:ecs:${region}:${accountId}:cluster/thinkwork-${stage}-n8n-cluster`
      : null,
    mainServiceName: `thinkwork-${stage}-n8n-main`,
    workerServiceName: `thinkwork-${stage}-n8n-worker`,
    mainLogGroupName: `/thinkwork/${stage}/n8n/main`,
    workerLogGroupName: `/thinkwork/${stage}/n8n/worker`,
    storageBucketName: accountId ? `thinkwork-${stage}-${accountId}-n8n` : null,
    databaseName: "thinkwork_n8n",
  };
}
