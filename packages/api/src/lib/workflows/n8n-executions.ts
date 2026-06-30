import { readTenantCredentialSecret } from "../tenant-credentials/secret-store.js";
import {
  loadN8nApiCredential,
  loadN8nInstall,
  loadN8nManagedApplication,
  n8nApiRootUrl,
  n8nDiscoveryReadiness,
  normalizeDate,
  parseJsonRecord,
  recordValue,
  stringValue,
} from "./n8n-discovery.js";

type WorkflowDb = any;

export type N8nDiscoveredExecution = {
  externalExecutionId: string;
  externalWorkflowId: string;
  workflowName: string | null;
  status: string;
  mode: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  failureMessage: string | null;
  nativeExecutionUrl: string;
  nativeWorkflowUrl: string;
  warnings: string[];
};

export type N8nExecutionDiscoveryResult = {
  installId: string;
  readinessState: "ready" | "blocked_not_ready" | "disabled";
  readinessReasons: unknown[];
  nativeBaseUrl: string | null;
  executions: N8nDiscoveredExecution[];
};

type DiscoverN8nExecutionsDeps = {
  fetch?: typeof fetch;
  readTenantCredentialSecret?: typeof readTenantCredentialSecret;
};

export async function discoverN8nExecutions(
  database: WorkflowDb,
  input: { tenantId: string; installId: string; limit?: number | null },
  deps: DiscoverN8nExecutionsDeps = {},
): Promise<N8nExecutionDiscoveryResult> {
  const install = await loadN8nInstall(database, input);
  const app = await loadN8nManagedApplication(database, input.tenantId);
  const apiCredential = await loadN8nApiCredential(database, input.tenantId);
  const baseReadiness = n8nDiscoveryReadiness(install, app, {
    apiCredential,
    requireApiCredential: true,
  });
  const baseUrl = configuredN8nBaseUrl(app, apiCredential);
  const nativeBaseUrl = baseUrl ? n8nNativeRootUrl(baseUrl).toString() : null;

  if (baseReadiness.state !== "ready" || !apiCredential) {
    return {
      installId: input.installId,
      readinessState: baseReadiness.state,
      readinessReasons: baseReadiness.reasons,
      nativeBaseUrl,
      executions: [],
    };
  }
  if (!baseUrl) {
    return {
      installId: input.installId,
      readinessState: "blocked_not_ready",
      readinessReasons: [
        {
          code: "n8n_api_base_url_missing",
          message:
            "n8n API key is configured, but no n8n public URL is available.",
        },
      ],
      nativeBaseUrl,
      executions: [],
    };
  }

  try {
    const secret = await (
      deps.readTenantCredentialSecret ?? readTenantCredentialSecret
    )(apiCredential.secret_ref);
    const apiKey = stringValue(secret.apiKey);
    if (!apiKey) {
      return {
        installId: input.installId,
        readinessState: "blocked_not_ready",
        readinessReasons: [
          {
            code: "n8n_api_key_missing",
            message: "n8n API credential is missing the apiKey secret field.",
          },
        ],
        nativeBaseUrl,
        executions: [],
      };
    }
    return {
      installId: input.installId,
      readinessState: baseReadiness.state,
      readinessReasons: baseReadiness.reasons,
      nativeBaseUrl,
      executions: await fetchN8nPublicApiExecutions({
        baseUrl,
        apiKey,
        fetchImpl: deps.fetch ?? fetch,
        limit: normalizeLimit(input.limit),
      }),
    };
  } catch (error) {
    return {
      installId: input.installId,
      readinessState: "blocked_not_ready",
      readinessReasons: [
        {
          code: "n8n_api_executions_failed",
          message: `Could not discover n8n executions: ${(error as Error).message}`,
        },
      ],
      nativeBaseUrl,
      executions: [],
    };
  }
}

async function fetchN8nPublicApiExecutions(input: {
  baseUrl: string;
  apiKey: string;
  fetchImpl: typeof fetch;
  limit: number;
}): Promise<N8nDiscoveredExecution[]> {
  const executions: N8nDiscoveredExecution[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 5 && executions.length < input.limit; page += 1) {
    const endpoint = n8nExecutionListUrl(input.baseUrl, cursor, input.limit);
    const response = await input.fetchImpl(endpoint, {
      method: "GET",
      headers: {
        accept: "application/json",
        "X-N8N-API-KEY": input.apiKey,
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `n8n API ${response.status}: ${response.statusText || "request failed"}`,
      );
    }
    const payload = parseJsonRecord(text, endpoint);
    const data = Array.isArray(payload.data) ? payload.data : [];
    executions.push(
      ...data.flatMap((entry) =>
        n8nExecutionFromApiRecord(entry, input.baseUrl),
      ),
    );
    cursor = stringValue(payload.nextCursor);
    if (!cursor) break;
  }
  return executions.slice(0, input.limit);
}

function n8nExecutionListUrl(
  baseUrl: string,
  cursor: string | null,
  limit: number,
): string {
  const endpoint = new URL("executions", n8nApiRootUrl(baseUrl));
  endpoint.searchParams.set("limit", String(Math.min(limit, 100)));
  endpoint.searchParams.set("includeData", "false");
  if (cursor) endpoint.searchParams.set("cursor", cursor);
  return endpoint.toString();
}

function n8nExecutionFromApiRecord(
  entry: unknown,
  baseUrl: string,
): N8nDiscoveredExecution[] {
  const record = recordValue(entry);
  const executionId = stringValue(record.id);
  const workflowRecord = recordValue(record.workflowData);
  const workflowId =
    stringValue(record.workflowId) ?? stringValue(workflowRecord.id);
  if (!executionId || !workflowId) return [];
  const startedAt = normalizeDate(record.startedAt ?? record.createdAt);
  const finishedAt = normalizeDate(
    record.stoppedAt ?? record.finishedAt ?? record.completedAt,
  );
  return [
    {
      externalExecutionId: executionId,
      externalWorkflowId: workflowId,
      workflowName:
        stringValue(record.workflowName) ?? stringValue(workflowRecord.name),
      status: normalizeExecutionStatus(record),
      mode: stringValue(record.mode),
      startedAt,
      finishedAt,
      durationMs:
        startedAt && finishedAt
          ? Math.max(0, finishedAt.getTime() - startedAt.getTime())
          : null,
      failureMessage: executionFailureMessage(record),
      nativeExecutionUrl: n8nNativeExecutionUrl(
        baseUrl,
        workflowId,
        executionId,
      ),
      nativeWorkflowUrl: n8nNativeWorkflowUrl(baseUrl, workflowId),
      warnings: [],
    },
  ];
}

function configuredN8nBaseUrl(
  app: Awaited<ReturnType<typeof loadN8nManagedApplication>>,
  apiCredential: Awaited<ReturnType<typeof loadN8nApiCredential>>,
): string | null {
  const desiredConfig = recordValue(app?.desired_config);
  const metadata = recordValue(apiCredential?.metadata_json);
  return (
    stringValue(metadata.n8nBaseUrl) ??
    stringValue(metadata.baseUrl) ??
    stringValue(metadata.publicUrl) ??
    stringValue(desiredConfig.publicUrl)
  );
}

export function n8nNativeWorkflowUrl(
  baseUrl: string,
  workflowId: string,
): string {
  return new URL(
    `workflow/${encodeURIComponent(workflowId)}`,
    n8nNativeRootUrl(baseUrl),
  ).toString();
}

export function n8nNativeExecutionUrl(
  baseUrl: string,
  workflowId: string,
  executionId: string,
): string {
  return new URL(
    `workflow/${encodeURIComponent(workflowId)}/executions/${encodeURIComponent(
      executionId,
    )}`,
    n8nNativeRootUrl(baseUrl),
  ).toString();
}

function n8nNativeRootUrl(value: string): URL {
  const url = new URL(value);
  let path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/api/v1")) {
    path = path.slice(0, -"/api/v1".length);
  }
  url.pathname = `${path}/`.replace(/\/+/g, "/");
  url.search = "";
  url.hash = "";
  return url;
}

function normalizeExecutionStatus(record: Record<string, unknown>): string {
  const status = stringValue(record.status);
  if (status) return status.toLowerCase();
  if (record.waitTill) return "waiting";
  if (record.finished === true) {
    return executionFailureMessage(record) ? "error" : "success";
  }
  return "running";
}

function executionFailureMessage(
  record: Record<string, unknown>,
): string | null {
  const error = record.error;
  if (typeof error === "string") return bounded(error);
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const errorRecord = error as Record<string, unknown>;
    for (const key of ["message", "error", "reason", "code"]) {
      const value = stringValue(errorRecord[key]);
      if (value) return bounded(value);
    }
  }
  return null;
}

function bounded(value: string | null): string | null {
  if (!value) return null;
  return value.length > 300 ? `${value.slice(0, 300)}...` : value;
}

function normalizeLimit(value: number | null | undefined): number {
  if (value == null) return 50;
  if (!Number.isInteger(value) || value < 1) return 50;
  return Math.min(value, 100);
}
