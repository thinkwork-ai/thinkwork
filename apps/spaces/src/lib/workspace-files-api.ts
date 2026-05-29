import type {
  WorkspaceFilesClient,
  WorkspaceFileMeta,
  WorkspaceFileSource,
  WorkspaceMoveResult,
} from "@thinkwork/workspace-editor";
import { apiFetch } from "@/lib/api-fetch";

export type WorkspaceFilesTarget =
  | { threadId: string }
  | { spaceId: string }
  | { agentId: string }
  | { userId: string }
  | { catalog: true };

export interface ThreadGoalFileFallback {
  file: string;
  key?: string | null;
  content?: string | null;
}

interface WorkspaceFilesResponse {
  ok?: boolean;
  files?: WorkspaceFileMeta[];
  content?: string | null;
  source?: WorkspaceFileSource;
  sha256?: string;
  destPath?: string;
}

async function request(
  body: Record<string, unknown>,
): Promise<WorkspaceFilesResponse> {
  return apiFetch<WorkspaceFilesResponse>("/api/workspaces/files", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export const spacesWorkspaceFilesClient: WorkspaceFilesClient<WorkspaceFilesTarget> =
  {
    async listFiles(target) {
      const data = await request({ action: "list", ...target });
      return { files: data.files ?? [] };
    },

    async getFile(target, path) {
      const data = await request({ action: "get", ...target, path });
      return {
        content: data.content ?? null,
        source: data.source ?? ("thread" as const),
        sha256: data.sha256 ?? "",
      };
    },

    async putFile(target, path, content) {
      await request({ action: "put", ...target, path, content });
    },

    async deleteFile(target, path) {
      await request({ action: "delete", ...target, path });
    },

    async movePath(target, fromPath, toFolder): Promise<WorkspaceMoveResult> {
      const data = await request({
        action: "move",
        ...target,
        fromPath,
        toFolder,
      });
      return { destPath: data.destPath ?? fromPath };
    },

    async renamePath(target, fromPath, toPath): Promise<WorkspaceMoveResult> {
      const data = await request({
        action: "rename",
        ...target,
        fromPath,
        toPath,
      });
      return { destPath: data.destPath ?? toPath };
    },
  };

export function createThreadGoalFilesClient(
  fallbackFiles: ThreadGoalFileFallback[] = [],
): WorkspaceFilesClient<{ threadId: string }> {
  const fallbackByPath = new Map(
    fallbackFiles.map((file) => {
      const path = fallbackPathForGoalFile(file);
      return [path, { ...file, path }];
    }),
  );

  return {
    async listFiles(target) {
      try {
        return await spacesWorkspaceFilesClient.listFiles(target);
      } catch (error) {
        if (!isThreadTargetUnsupportedError(error)) throw error;
        return {
          files: Array.from(fallbackByPath.values()).map((file) => ({
            path: file.path,
            source: "thread" as const,
            sha256: "",
            overridden: false,
          })),
        };
      }
    },

    async getFile(target, path) {
      try {
        return await spacesWorkspaceFilesClient.getFile(target, path);
      } catch (error) {
        if (!isThreadTargetUnsupportedError(error)) throw error;
        const fallback = fallbackByPath.get(path);
        return {
          content: fallback?.content ?? null,
          source: "thread" as const,
          sha256: "",
        };
      }
    },

    putFile: (target, path, content) =>
      spacesWorkspaceFilesClient.putFile(target, path, content),
    deleteFile: (target, path) =>
      spacesWorkspaceFilesClient.deleteFile(target, path),
    movePath: (target, fromPath, toFolder) =>
      spacesWorkspaceFilesClient.movePath?.(target, fromPath, toFolder) ??
      Promise.resolve({ destPath: fromPath }),
    renamePath: (target, fromPath, toPath) =>
      spacesWorkspaceFilesClient.renamePath?.(target, fromPath, toPath) ??
      Promise.resolve({ destPath: toPath }),
  };
}

function fallbackPathForGoalFile(file: ThreadGoalFileFallback) {
  const key = file.key?.trim();
  if (key) {
    const marker = "/threads/";
    const markerIndex = key.indexOf(marker);
    if (markerIndex >= 0) {
      const afterThread = key.slice(markerIndex + marker.length);
      const parts = afterThread.split("/");
      if (parts.length > 1) return parts.slice(1).join("/");
    }
    return key.split("/").pop() ?? key;
  }
  const name = file.file.trim();
  return /\.md$/i.test(name) ? name : `${name}.md`;
}

function isThreadTargetUnsupportedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Exactly one of agentId") && !message.includes("threadId")
  );
}
