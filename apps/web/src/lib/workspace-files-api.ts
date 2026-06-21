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

export interface SkillSummary {
  slug: string;
  displayName: string | null;
  description: string | null;
  category: string | null;
  icon: string | null;
  tags: string[] | null;
  sha: string;
}

export interface ExportSkillArchiveResult {
  slug: string;
  filename: string;
  contentType: string;
  archiveBase64: string;
  bytes: Uint8Array;
  blob: Blob;
}

interface WorkspaceFilesResponse {
  ok?: boolean;
  files?: WorkspaceFileMeta[];
  skills?: SkillSummary[];
  content?: string | null;
  source?: WorkspaceFileSource;
  sha256?: string;
  destPath?: string;
  slug?: string;
  filename?: string;
  contentType?: string;
  archiveBase64?: string;
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

/**
 * A workspace client narrowed to one sub-folder of a single-target source:
 * paths are presented relative to the folder (prefix stripped on list) and
 * re-prefixed before hitting the backend, so the editor only ever sees and
 * writes that subtree. Same prefix-strip/re-prefix pattern as
 * `skillCatalogClient`, generalized over any `WorkspaceFilesTarget` — used by
 * the Agents settings surface to scope the agent source to `agents/`.
 */
export function createPrefixedWorkspaceClient(
  prefix: string,
): WorkspaceFilesClient<WorkspaceFilesTarget> {
  const pre = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const strip = (path: string) =>
    path.startsWith(pre) ? path.slice(pre.length) : path;
  return {
    async listFiles(target) {
      const { files } = await spacesWorkspaceFilesClient.listFiles(target);
      return {
        files: files
          .filter((f) => f.path.startsWith(pre))
          .map((f) => ({ ...f, path: f.path.slice(pre.length) })),
      };
    },
    getFile: (target, path) =>
      spacesWorkspaceFilesClient.getFile(target, `${pre}${path}`),
    putFile: (target, path, content) =>
      spacesWorkspaceFilesClient.putFile(target, `${pre}${path}`, content),
    deleteFile: (target, path) =>
      spacesWorkspaceFilesClient.deleteFile(target, `${pre}${path}`),
    async movePath(target, fromPath, toFolder): Promise<WorkspaceMoveResult> {
      const result = await spacesWorkspaceFilesClient.movePath?.(
        target,
        `${pre}${fromPath}`,
        `${pre}${toFolder}`,
      );
      return { destPath: strip(result?.destPath ?? `${pre}${fromPath}`) };
    },
    async renamePath(target, fromPath, toPath): Promise<WorkspaceMoveResult> {
      const result = await spacesWorkspaceFilesClient.renamePath?.(
        target,
        `${pre}${fromPath}`,
        `${pre}${toPath}`,
      );
      return { destPath: strip(result?.destPath ?? `${pre}${toPath}`) };
    },
  };
}

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
 * Index-backed per-skill summary for the Skills list — one cheap DB query
 * server-side instead of scanning S3 + reading every file (plan U4). Rows carry
 * the parsed display metadata; the list renders names instead of raw slugs.
 */
export async function listSkillSummaries(): Promise<SkillSummary[]> {
  const data = await request({ action: "list", catalog: true, summary: true });
  return (data.skills ?? [])
    .slice()
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function exportSkillArchive(
  slug: string,
): Promise<ExportSkillArchiveResult> {
  const data = await request({ action: "export-skill", catalog: true, slug });
  if (!data.archiveBase64 || !data.filename) {
    throw new Error("Skill export response was missing archive data.");
  }
  const contentType = data.contentType ?? "application/zip";
  const bytes = bytesFromBase64(data.archiveBase64);
  return {
    slug: data.slug ?? slug,
    filename: data.filename,
    contentType,
    archiveBase64: data.archiveBase64,
    bytes,
    blob: new Blob([arrayBufferFromBytes(bytes)], { type: contentType }),
  };
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
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
