/**
 * Cognito-authenticated client for the plugin upload REST surface
 * (plan §U10). All four routes require `requireTenantAdmin` on the
 * server and fail with 401/403 without a Cognito JWT, so this client
 * drives every call through `getIdToken()` — the API_AUTH_SECRET path
 * that other admin clients use would not pass the auth gate.
 *
 * Shape of the happy path:
 *   1. `presignPluginUpload({ fileName })` → `{ uploadUrl, s3Key }`.
 *   2. Browser `PUT uploadUrl` with the zip buffer (direct to S3).
 *   3. `installPluginUpload({ s3Key })` → returns installed skills +
 *      staged MCP servers, or a structured validation error.
 *   4. `listPluginUploads()` + `getPluginUpload(id)` power the admin's
 *      history view.
 */

import { getIdToken } from "@/lib/auth";

const API_URL = import.meta.env.VITE_API_URL || "";

async function cognitoFetch(path: string, options: RequestInit = {}) {
  const token = await getIdToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PluginUploadStatus = "staging" | "installed" | "failed";

export interface PluginUploadRow {
  id: string;
  uploaded_by: string | null;
  uploaded_at: string;
  bundle_sha256: string;
  plugin_name: string;
  plugin_version: string | null;
  status: PluginUploadStatus;
  error_message?: string | null;
}

export interface PluginUploadDetail extends PluginUploadRow {
  s3_staging_prefix: string | null;
}

export interface PresignResponse {
  uploadUrl: string;
  s3Key: string;
  expiresIn: number;
}

export interface InstallSuccessResponse {
  uploadId: string;
  status: "installed";
  plugin: {
    name: string;
    skills: Array<{ slug: string; version?: string | null }>;
    mcpServers: Array<{ name: string; url: string }>;
  };
  warnings: string[];
}

export interface InstallFailureResponse {
  uploadId: string;
  status: "failed";
  phase: string;
  errorMessage: string;
}

export interface InstallValidationError {
  valid: false;
  errors: string[];
  warnings: string[];
}

export type InstallResponse =
  | InstallSuccessResponse
  | InstallFailureResponse
  | InstallValidationError;

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export function presignPluginUpload(input: {
  fileName?: string;
}): Promise<PresignResponse> {
  return cognitoFetch("/api/plugins/presign", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function uploadPluginZipToS3(
  uploadUrl: string,
  zip: Blob | ArrayBuffer,
): Promise<void> {
  // The presigned URL carries its own signature; don't add auth headers.
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/zip" },
    body: zip,
  });
  if (!res.ok) {
    throw new Error(`S3 upload failed: HTTP ${res.status}`);
  }
}

export function installPluginUpload(input: {
  s3Key: string;
}): Promise<InstallResponse> {
  return cognitoFetch("/api/plugins/upload", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listPluginUploads(): Promise<{ uploads: PluginUploadRow[] }> {
  return cognitoFetch("/api/plugins", { method: "GET" });
}

export function getPluginUpload(
  uploadId: string,
): Promise<{ upload: PluginUploadDetail }> {
  return cognitoFetch(`/api/plugins/${uploadId}`, { method: "GET" });
}
