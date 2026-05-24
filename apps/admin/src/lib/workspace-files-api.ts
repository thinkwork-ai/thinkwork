/**
 * Admin client for the /api/workspaces/files Lambda (Unit 5).
 *
 * Supersedes the per-route `workspaceApi` fetch wrappers that used the
 * VITE_API_AUTH_SECRET bearer token. The new handler validates Cognito
 * JWTs and derives the caller's tenant server-side — callers must send
 * agentId / templateId / spaceId / defaults:true, never tenantSlug.
 */

import { getIdToken } from "@/lib/auth";

const API_URL = import.meta.env.VITE_API_URL || "";

export type Target =
  | { agentId: string }
  | { templateId: string }
  | { spaceId: string }
  | { computerId: string }
  | { userId: string }
  | { catalog: true }
  | { defaults: true };

export type ComposeSource =
  | "agent-override"
  | "agent-override-pinned"
  | "template"
  | "template-pinned"
  | "space"
  | "computer"
  | "user"
  | "catalog"
  | "defaults";

export interface WorkspaceFileMeta {
  path: string;
  source: ComposeSource;
  sha256: string;
  overridden: boolean;
}

async function request(body: Record<string, unknown>): Promise<unknown> {
  const token = await getIdToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_URL}/api/workspaces/files`, {
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
    throw new Error(
      `Workspace API: ${res.status} ${data.error ?? res.statusText}`,
    );
  }
  return data;
}

export async function listWorkspaceFiles(
  target: Target,
): Promise<{ files: WorkspaceFileMeta[] }> {
  return (await request({ action: "list", ...target })) as {
    files: WorkspaceFileMeta[];
  };
}

export async function getWorkspaceFile(
  target: Target,
  path: string,
): Promise<{ content: string | null; source: ComposeSource; sha256: string }> {
  return (await request({ action: "get", ...target, path })) as {
    content: string | null;
    source: ComposeSource;
    sha256: string;
  };
}

export async function putWorkspaceFile(
  target: Target,
  path: string,
  content: string,
  opts: { acceptTemplateUpdate?: boolean } = {},
): Promise<void> {
  await request({
    action: "put",
    ...target,
    path,
    content,
    ...(opts.acceptTemplateUpdate ? { acceptTemplateUpdate: true } : {}),
  });
}

export async function deleteWorkspaceFile(
  target: Target,
  path: string,
): Promise<void> {
  await request({ action: "delete", ...target, path });
}

export async function createSubAgentWorkspaceFiles(
  agentId: string,
  slug: string,
  contextContent: string,
): Promise<void> {
  await request({
    action: "create-sub-agent",
    agentId,
    slug,
    contextContent,
  });
}

export async function regenerateWorkspaceMap(agentId: string): Promise<void> {
  await request({ action: "regenerate-map", agentId });
}

export async function generateFolderStructure(
  target: Target,
  path: string,
): Promise<void> {
  await request({ action: "generate-folder-structure", ...target, path });
}

export async function normalizeWorkspaceMap(agentId: string): Promise<void> {
  await request({ action: "normalize-map", agentId });
}

export interface MoveResult {
  /** Final destination path after collision-aware auto-rename. */
  destPath: string;
  /** Number of objects moved (1 for files, N for folders). */
  movedCount: number;
  /** Pinned files that lost template inheritance as part of the move. */
  detachedPinnedCount: number;
  /**
   * Set to true when the source was partially deleted after a successful
   * copy phase. The client should refetch the file list — both the
   * source and destination may have content.
   */
  partiallyDeleted?: boolean;
}

/**
 * Move a file or folder to a different folder within the same workspace.
 * The server performs an atomic copy + delete in a single Lambda
 * invocation. Folder moves walk the entire source prefix. On
 * destination collision, the basename is auto-renamed (`notes.md` →
 * `notes (2).md`); the final path is returned in `destPath`.
 *
 * `toFolder` is a folder path relative to the workspace root. Pass `""`
 * to move to the root.
 */
export async function moveWorkspaceFile(
  target: Target,
  fromPath: string,
  toFolder: string,
): Promise<MoveResult> {
  return (await request({
    action: "move",
    ...target,
    fromPath,
    toFolder,
  })) as MoveResult;
}

/**
 * Rename a file or folder to an exact destination path within the same
 * workspace. Unlike move, rename does not collision-auto-suffix: the user
 * typed the desired name, so the server returns an error when it already
 * exists.
 */
export async function renameWorkspacePath(
  target: Target,
  fromPath: string,
  toPath: string,
): Promise<MoveResult> {
  return (await request({
    action: "rename",
    ...target,
    fromPath,
    toPath,
  })) as MoveResult;
}
