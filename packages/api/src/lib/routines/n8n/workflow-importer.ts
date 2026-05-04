import type { N8nWorkflow } from "./workflow-types.js";

export interface N8nWorkflowFetchAuth {
  apiKey?: string | null;
  bearerToken?: string | null;
}

export interface N8nWorkflowLocation {
  baseUrl: string;
  workflowId: string;
}

export interface N8nWorkflowFetchResult {
  workflow: N8nWorkflow;
  endpoint: string;
}

export function parseN8nWorkflowLocation(
  rawUrlOrId: string,
): N8nWorkflowLocation {
  const value = rawUrlOrId.trim();
  if (!value) throw new Error("Enter an n8n workflow URL or workflow ID.");

  if (!looksLikeUrl(value)) {
    return { baseUrl: "", workflowId: value };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch (err) {
    throw new Error(`Invalid n8n workflow URL: ${(err as Error).message}`);
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const workflowIndex = parts.findIndex((part) => part === "workflow");
  const apiWorkflowIndex = parts.findIndex((part, index) => {
    return part === "workflows" && parts[index - 1] === "v1";
  });
  const restWorkflowIndex = parts.findIndex((part) => part === "workflows");
  const id =
    (workflowIndex >= 0 ? parts[workflowIndex + 1] : null) ??
    (apiWorkflowIndex >= 0 ? parts[apiWorkflowIndex + 1] : null) ??
    (restWorkflowIndex >= 0 ? parts[restWorkflowIndex + 1] : null);

  if (!id) {
    throw new Error("The n8n URL must include a workflow ID.");
  }

  return {
    baseUrl: url.origin,
    workflowId: decodeURIComponent(id),
  };
}

export async function fetchN8nWorkflow(input: {
  workflowUrl: string;
  auth?: N8nWorkflowFetchAuth;
}): Promise<N8nWorkflowFetchResult> {
  const location = parseN8nWorkflowLocation(input.workflowUrl);
  if (!location.baseUrl) {
    throw new Error("Import by workflow ID requires a full n8n workflow URL.");
  }

  const endpoints = [
    `${location.baseUrl}/api/v1/workflows/${encodeURIComponent(location.workflowId)}`,
    `${location.baseUrl}/rest/workflows/${encodeURIComponent(location.workflowId)}`,
  ];
  const headers: Record<string, string> = { accept: "application/json" };
  if (input.auth?.apiKey) headers["x-n8n-api-key"] = input.auth.apiKey;
  if (input.auth?.bearerToken) {
    headers.authorization = `Bearer ${input.auth.bearerToken}`;
  }

  let lastError = "";
  for (const endpoint of endpoints) {
    let response: Response;
    try {
      response = await fetch(endpoint, { headers });
    } catch (err) {
      lastError = `${endpoint}: ${(err as Error).message}`;
      continue;
    }

    if (response.ok) {
      const json = await response.json();
      const workflow = normalizeWorkflowResponse(json);
      if (!workflow) {
        throw new Error(
          `n8n returned an invalid workflow payload from ${endpoint}.`,
        );
      }
      return { workflow, endpoint };
    }

    const body = await response.text().catch(() => "");
    lastError = `${endpoint}: ${response.status} ${response.statusText}${
      body ? ` - ${body.slice(0, 240)}` : ""
    }`;
    if (response.status === 401 || response.status === 403) break;
  }

  throw new Error(
    `Unable to pull n8n workflow. ${lastError || "No n8n endpoint responded."}`,
  );
}

function normalizeWorkflowResponse(raw: unknown): N8nWorkflow | null {
  if (isWorkflow(raw)) return raw;
  if (raw && typeof raw === "object" && "data" in raw) {
    const data = (raw as { data?: unknown }).data;
    if (isWorkflow(data)) return data;
  }
  return null;
}

function isWorkflow(value: unknown): value is N8nWorkflow {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as { nodes?: unknown }).nodes) &&
      typeof (value as { connections?: unknown }).connections === "object",
  );
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}
