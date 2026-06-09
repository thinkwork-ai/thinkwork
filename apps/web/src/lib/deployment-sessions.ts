export interface DeploymentSessionEvent {
  id: string;
  eventType: string;
  stepKey: string | null;
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface DeploymentSession {
  id: string;
  status: string;
  currentStepKey: string;
  requestedAction: string;
  source: string;
  customerName: string;
  environmentName: string;
  awsAccountId: string;
  awsRegion: string;
  availabilityZones: string[];
  adminName: string;
  adminEmail: string;
  credentialsStatus: string;
  runnerMode: string;
  terraformBackend: Record<string, unknown>;
  sessionConfig: Record<string, unknown>;
  errorMessage: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  events: DeploymentSessionEvent[];
}

export interface CreateDeploymentSessionInput {
  customerName: string;
  environmentName: string;
  awsAccountId: string;
  awsRegion: string;
  availabilityZones: string[];
  adminName: string;
  adminEmail: string;
  source: "browser" | "local_dev";
}

export interface DeploymentSessionResume {
  sessionId: string;
  clientToken: string;
}

export interface CreateDeploymentSessionResult {
  session: DeploymentSession;
  clientToken: string;
}

export async function createDeploymentSession(
  input: CreateDeploymentSessionInput,
): Promise<CreateDeploymentSessionResult> {
  return requestJson<CreateDeploymentSessionResult>(
    "/api/deployment-sessions",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export async function readDeploymentSession(
  resume: DeploymentSessionResume,
): Promise<DeploymentSession> {
  const result = await requestJson<{ session: DeploymentSession }>(
    `/api/deployment-sessions/${encodeURIComponent(resume.sessionId)}`,
    {
      headers: deploymentSessionHeaders(resume.clientToken),
    },
  );
  return result.session;
}

export async function startDeploymentSession(
  resume: DeploymentSessionResume,
): Promise<DeploymentSession> {
  const result = await requestJson<{ session: DeploymentSession }>(
    `/api/deployment-sessions/${encodeURIComponent(resume.sessionId)}/start`,
    {
      method: "POST",
      headers: deploymentSessionHeaders(resume.clientToken),
    },
  );
  return result.session;
}

export async function requestDeploymentSessionTeardown(
  resume: DeploymentSessionResume,
): Promise<DeploymentSession> {
  const result = await requestJson<{ session: DeploymentSession }>(
    `/api/deployment-sessions/${encodeURIComponent(resume.sessionId)}/teardown`,
    {
      method: "POST",
      headers: deploymentSessionHeaders(resume.clientToken),
    },
  );
  return result.session;
}

function deploymentSessionHeaders(clientToken: string): HeadersInit {
  return { "x-thinkwork-deployment-token": clientToken };
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(body.error || `Request failed with ${response.status}`);
  }
  return body as T;
}

export function apiBaseUrl(): string {
  const explicit = readRuntimeEnv("VITE_API_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  const graphql = readRuntimeEnv("VITE_GRAPHQL_HTTP_URL");
  if (graphql) return graphql.replace(/\/graphql\/?$/, "").replace(/\/+$/, "");
  return "";
}
import { readRuntimeEnv } from "@/lib/runtime-config";
