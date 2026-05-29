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

// ─── Skill catalog ───────────────────────────────────────────────────────

/**
 * Lists the skill slugs in the tenant catalog — the top-level folders under
 * the catalog root (e.g. `web-research/SKILL.md` → skill "web-research").
 */
export async function listSkillSlugs(): Promise<string[]> {
  const { files } = await spacesWorkspaceFilesClient.listFiles({
    catalog: true,
  });
  const slugs = new Set<string>();
  for (const f of files) {
    const top = f.path.split("/")[0];
    if (top && f.path.includes("/")) slugs.add(top);
  }
  return [...slugs].sort();
}

/**
 * A workspace client scoped to a single skill folder in the catalog: paths are
 * presented relative to the skill root (prefix stripped) and re-prefixed before
 * hitting the catalog backend. Lets WorkspaceFileEditor show one skill's files
 * instead of the whole catalog.
 */
export const skillCatalogClient: WorkspaceFilesClient<{ skill: string }> = {
  async listFiles(target) {
    const prefix = `${target.skill}/`;
    const { files } = await spacesWorkspaceFilesClient.listFiles({
      catalog: true,
    });
    return {
      files: files
        .filter((f) => f.path.startsWith(prefix))
        .map((f) => ({ ...f, path: f.path.slice(prefix.length) })),
    };
  },
  getFile(target, path) {
    return spacesWorkspaceFilesClient.getFile(
      { catalog: true },
      `${target.skill}/${path}`,
    );
  },
  putFile(target, path, content) {
    return spacesWorkspaceFilesClient.putFile(
      { catalog: true },
      `${target.skill}/${path}`,
      content,
    );
  },
  deleteFile(target, path) {
    return spacesWorkspaceFilesClient.deleteFile(
      { catalog: true },
      `${target.skill}/${path}`,
    );
  },
  async movePath(target, fromPath, toFolder) {
    const r = await spacesWorkspaceFilesClient.movePath?.(
      { catalog: true },
      `${target.skill}/${fromPath}`,
      `${target.skill}/${toFolder}`,
    );
    const dest = r?.destPath ?? `${target.skill}/${fromPath}`;
    return { destPath: dest.replace(`${target.skill}/`, "") };
  },
  async renamePath(target, fromPath, toPath) {
    const r = await spacesWorkspaceFilesClient.renamePath?.(
      { catalog: true },
      `${target.skill}/${fromPath}`,
      `${target.skill}/${toPath}`,
    );
    const dest = r?.destPath ?? `${target.skill}/${toPath}`;
    return { destPath: dest.replace(`${target.skill}/`, "") };
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
