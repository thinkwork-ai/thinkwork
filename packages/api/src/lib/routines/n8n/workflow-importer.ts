import { isIP } from "node:net";
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

export interface N8nWorkflowFetchConstraints {
  allowedBaseUrl?: string | null;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

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
  constraints?: N8nWorkflowFetchConstraints;
}): Promise<N8nWorkflowFetchResult> {
  const location = parseN8nWorkflowLocation(input.workflowUrl);
  if (!location.baseUrl) {
    throw new Error("Import by workflow ID requires a full n8n workflow URL.");
  }
  assertSafeN8nWorkflowLocation(location, input.constraints);

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
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      input.constraints?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    try {
      response = await fetch(endpoint, {
        headers,
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (err) {
      lastError = `${endpoint}: ${(err as Error).message}`;
      continue;
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      lastError = `${endpoint}: redirects are not allowed for n8n workflow imports`;
      continue;
    }

    if (response.ok) {
      const json = await readWorkflowJson(response, {
        endpoint,
        maxResponseBytes:
          input.constraints?.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      });
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

export function assertSafeN8nWorkflowLocation(
  location: N8nWorkflowLocation,
  constraints?: N8nWorkflowFetchConstraints,
): void {
  let base: URL;
  try {
    base = new URL(location.baseUrl);
  } catch (err) {
    throw new Error(`Invalid n8n base URL: ${(err as Error).message}`);
  }

  if (base.protocol !== "https:") {
    throw new Error("n8n workflow imports require an HTTPS base URL.");
  }
  if (isUnsafeHost(base.hostname)) {
    throw new Error(
      "n8n workflow imports cannot target private or local hosts.",
    );
  }

  const configured = constraints?.allowedBaseUrl?.trim();
  if (configured) {
    let allowed: URL;
    try {
      allowed = new URL(configured);
    } catch (err) {
      throw new Error(
        `Invalid configured n8n base URL: ${(err as Error).message}`,
      );
    }
    if (allowed.protocol !== "https:") {
      throw new Error("Configured n8n base URL must use HTTPS.");
    }
    if (isUnsafeHost(allowed.hostname)) {
      throw new Error(
        "Configured n8n base URL cannot be a private or local host.",
      );
    }
    if (base.origin !== allowed.origin) {
      throw new Error(
        "n8n workflow URL must use the configured credential base URL.",
      );
    }
  }
}

async function readWorkflowJson(
  response: Response,
  input: { endpoint: string; maxResponseBytes: number },
): Promise<unknown> {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > input.maxResponseBytes) {
    throw new Error(
      `n8n workflow payload from ${input.endpoint} exceeded ${input.maxResponseBytes} bytes.`,
    );
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(
      `n8n returned invalid JSON from ${input.endpoint}: ${(err as Error).message}`,
    );
  }
}

function isUnsafeHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal"
  ) {
    return true;
  }
  const ipVersion = isIP(host);
  if (ipVersion === 4) return isUnsafeIpv4(host);
  if (ipVersion === 6) return isUnsafeIpv6(host);
  if (!host.includes(".")) return true;
  return false;
}

function isUnsafeIpv4(host: string): boolean {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isUnsafeIpv6(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80")
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
