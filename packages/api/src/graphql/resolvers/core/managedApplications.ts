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
  malformed: boolean;
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
  const raw = process.env.COGNEE || process.env.COGNEE_STATUS;

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

export function readTwentyStatus(): TwentyStatus {
  const raw = process.env.TWENTY || process.env.TWENTY_STATUS;
  const fallbackUrl = process.env.TWENTY_URL || null;

  if (!raw) {
    const provisioned = truthyFlag(process.env.TWENTY_PROVISIONED);
    const defaults = deriveTwentyDefaults(provisioned);
    return {
      provisioned,
      runtimeEnabled: truthyFlag(process.env.TWENTY_RUNTIME_ENABLED),
      url: fallbackUrl,
      clusterArn: process.env.TWENTY_CLUSTER_ARN || defaults.clusterArn,
      serverServiceName:
        process.env.TWENTY_SERVER_SERVICE_NAME || defaults.serverServiceName,
      workerServiceName:
        process.env.TWENTY_WORKER_SERVICE_NAME || defaults.workerServiceName,
      serverLogGroupName:
        process.env.TWENTY_SERVER_LOG_GROUP_NAME || defaults.serverLogGroupName,
      workerLogGroupName:
        process.env.TWENTY_WORKER_LOG_GROUP_NAME || defaults.workerLogGroupName,
      albArn: process.env.TWENTY_ALB_ARN || null,
      targetGroupArn: process.env.TWENTY_TARGET_GROUP_ARN || null,
      malformed: false,
    };
  }

  const parts = raw.split("|");
  const malformed = parts.length < 2;
  const provisioned = truthyFlag(parts[0]);
  const defaults = deriveTwentyDefaults(provisioned && !malformed);
  return {
    provisioned,
    runtimeEnabled: truthyFlag(parts[1]),
    url: nonEmpty(parts[2]) ?? fallbackUrl,
    clusterArn:
      nonEmpty(parts[3]) ??
      process.env.TWENTY_CLUSTER_ARN ??
      defaults.clusterArn,
    serverServiceName:
      nonEmpty(parts[4]) ??
      process.env.TWENTY_SERVER_SERVICE_NAME ??
      defaults.serverServiceName,
    workerServiceName:
      nonEmpty(parts[5]) ??
      process.env.TWENTY_WORKER_SERVICE_NAME ??
      defaults.workerServiceName,
    serverLogGroupName:
      nonEmpty(parts[6]) ??
      process.env.TWENTY_SERVER_LOG_GROUP_NAME ??
      defaults.serverLogGroupName,
    workerLogGroupName:
      nonEmpty(parts[7]) ??
      process.env.TWENTY_WORKER_LOG_GROUP_NAME ??
      defaults.workerLogGroupName,
    albArn: nonEmpty(parts[8]) ?? process.env.TWENTY_ALB_ARN ?? null,
    targetGroupArn:
      nonEmpty(parts[9]) ?? process.env.TWENTY_TARGET_GROUP_ARN ?? null,
    malformed,
  };
}

export function readManagedApplications(): ManagedApplicationStatus[] {
  return [cogneeManagedApplication(), twentyManagedApplication()];
}

export function readManagedApplication(
  key: ManagedApplicationKey,
): ManagedApplicationStatus {
  return key === "cognee"
    ? cogneeManagedApplication()
    : twentyManagedApplication();
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

function twentyManagedApplication(): ManagedApplicationStatus {
  const twenty = readTwentyStatus();
  const status = twenty.malformed
    ? "unknown"
    : twenty.runtimeEnabled
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
    enabled: twenty.runtimeEnabled && !twenty.malformed,
    provisioned: twenty.provisioned && !twenty.malformed,
    runtimeEnabled: twenty.runtimeEnabled && !twenty.malformed,
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

function truthyFlag(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
