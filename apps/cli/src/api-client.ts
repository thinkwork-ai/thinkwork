/**
 * Shared HTTP client for the Thinkwork REST API.
 *
 * The CLI authenticates to the deployed API with the static `api_auth_secret`
 * bearer token stored in `terraform.tfvars`. The base URL is discovered at
 * call time via `aws apigatewayv2 get-apis`. Commands that hit the API (mcp,
 * tools, user invite) import from here instead of duplicating these helpers.
 */

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolveTerraformDir } from "./environments.js";
import { resolveTierDir } from "./terraform.js";
import { printError } from "./ui.js";

/** Read a quoted string variable from a `terraform.tfvars` file. */
export function readTfVar(tfvarsPath: string, key: string): string | null {
  if (!existsSync(tfvarsPath)) return null;
  const content = readFileSync(tfvarsPath, "utf-8");
  const match = content.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"));
  return match ? match[1] : null;
}

/** Locate terraform.tfvars for a stage, preferring the registered env dir. */
export function resolveTfvarsPath(stage: string): string {
  const tfDir = resolveTerraformDir(stage);
  if (tfDir) {
    const direct = `${tfDir}/terraform.tfvars`;
    if (existsSync(direct)) return direct;
  }
  const terraformDir = process.env.THINKWORK_TERRAFORM_DIR || process.cwd();
  const cwd = resolveTierDir(terraformDir, stage, "app");
  return `${cwd}/terraform.tfvars`;
}

/** Look up the HTTP API Gateway endpoint for a stage via the AWS CLI. */
export function getApiEndpoint(stage: string, region: string): string | null {
  try {
    const raw = execSync(
      `aws apigatewayv2 get-apis --region ${region} --query "Items[?Name=='thinkwork-${stage}-api'].ApiEndpoint|[0]" --output text`,
      { encoding: "utf-8", timeout: 15_000, stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    return raw && raw !== "None" ? raw : null;
  } catch {
    return null;
  }
}

export interface ApiFetchResult<T = any> {
  ok: boolean;
  status: number;
  body: T;
}

/** Throwing fetch helper — matches what mcp/tools commands expect today. */
export async function apiFetch(
  apiUrl: string,
  authSecret: string,
  path: string,
  options: RequestInit = {},
  extraHeaders: Record<string, string> = {},
): Promise<any> {
  const res = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authSecret}`,
      ...extraHeaders,
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Non-throwing fetch helper. Callers inspect `status` to distinguish
 * success codes (e.g. 200 "already a member" vs 201 "created").
 */
export async function apiFetchRaw<T = any>(
  apiUrl: string,
  authSecret: string,
  path: string,
  options: RequestInit = {},
  extraHeaders: Record<string, string> = {},
): Promise<ApiFetchResult<T>> {
  const res = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authSecret}`,
      ...extraHeaders,
      ...options.headers,
    },
  });
  const body = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, body };
}

/** Resolve API URL + bearer token for a stage, or print an error and return null. */
export function resolveApiConfig(
  stage: string,
): { apiUrl: string; authSecret: string } | null {
  const tfvarsPath = resolveTfvarsPath(stage);
  const authSecret = readTfVar(tfvarsPath, "api_auth_secret");
  if (!authSecret) {
    printError(`Cannot read api_auth_secret from ${tfvarsPath}`);
    return null;
  }

  const region = readTfVar(tfvarsPath, "region") || "us-east-1";
  const apiUrl = getApiEndpoint(stage, region);
  if (!apiUrl) {
    printError(
      `Cannot discover API endpoint for stage "${stage}". Is the stack deployed?`,
    );
    return null;
  }

  return { apiUrl, authSecret };
}
