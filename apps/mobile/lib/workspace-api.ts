/**
 * Mobile client for /api/workspaces/files (Unit 5).
 *
 * Switched from EXPO_PUBLIC_MCP_AUTH_TOKEN bearer to Cognito ID token so
 * the handler can derive the caller's tenant server-side. Callers now pass
 * `agentId` (or `templateId` / `defaults: true`) instead of
 * `{tenantSlug, instanceId}`.
 */

import { getIdToken } from "./auth";

const API_BASE = (process.env.EXPO_PUBLIC_GRAPHQL_URL ?? "").replace(
  /\/graphql$/,
  "",
);

export type WorkspaceTarget =
  | { agentId: string }
  | { templateId: string }
  | { spaceId: string; spaceFolderName?: string | null }
  | { userId: string }
  | { defaults: true };

export type ComposeSource =
  | "agent"
  | "template"
  | "space"
  | "user"
  | "defaults"
  | "catalog"
  | "agent-override"
  | "agent-override-pinned"
  | "template-pinned";

export interface WorkspaceFileMeta {
  path: string;
  source: ComposeSource;
  sha256: string;
  overridden: boolean;
  content?: string;
}

async function request(body: Record<string, unknown>): Promise<unknown> {
  const token = await getIdToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/workspaces/files`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  };
  if (!res.ok || data.ok === false) {
    throw new Error(`Workspace API: ${res.status} ${data.error ?? ""}`);
  }
  return data;
}

export async function listWorkspaceFiles(
  target: WorkspaceTarget,
  options: { includeContent?: boolean } = {},
): Promise<{ files: WorkspaceFileMeta[] }> {
  return (await request({
    action: "list",
    ...workspaceTargetRequestBody(target),
    includeContent: options.includeContent === true,
  })) as {
    files: WorkspaceFileMeta[];
  };
}

export async function getWorkspaceFile(
  target: WorkspaceTarget,
  path: string,
): Promise<{ content: string | null; source: ComposeSource; sha256: string }> {
  return (await request({
    action: "get",
    ...workspaceTargetRequestBody(target),
    path,
  })) as {
    content: string | null;
    source: ComposeSource;
    sha256: string;
  };
}

export async function putWorkspaceFile(
  target: WorkspaceTarget,
  path: string,
  content: string,
): Promise<void> {
  await request({
    action: "put",
    ...workspaceTargetRequestBody(target),
    path,
    content,
  });
}

function workspaceTargetRequestBody(
  target: WorkspaceTarget,
): Record<string, unknown> {
  if ("agentId" in target) return { agentId: target.agentId };
  if ("templateId" in target) return { templateId: target.templateId };
  if ("spaceId" in target) return { spaceId: target.spaceId };
  if ("userId" in target) return { userId: target.userId };
  return { defaults: true };
}

/**
 * Back-compat shim so mobile route files can drop in with a single-import
 * migration. Prefer the typed helpers above for new code.
 */
export async function workspaceApi(
  body: Record<string, unknown>,
): Promise<unknown> {
  return request(body);
}
