import {
  deleteWorkspaceFile,
  createSubAgentWorkspaceFiles,
  getWorkspaceFile,
  listWorkspaceFiles,
  putWorkspaceFile,
  type ComposeSource,
  type Target,
  type WorkspaceFileMeta,
} from "@/lib/workspace-files-api";
import { getIdToken } from "@/lib/auth";

export type { ComposeSource, Target, WorkspaceFileMeta };

export async function createSubAgent(
  agentId: string,
  slug: string,
  contextContent: string,
): Promise<void> {
  await createSubAgentWorkspaceFiles(agentId, slug, contextContent);
}

const API_URL = import.meta.env.VITE_API_URL || "";

export type ImportBundleInput =
  | {
      source: "zip";
      file: File;
      allowRootOverrides?: string[];
    }
  | {
      source: "git";
      url: string;
      ref?: string;
      pat?: string;
      allowRootOverrides?: string[];
    };

export type ImportBundleRequestBody =
  | {
      source: "zip";
      body: string;
      allowRootOverrides?: string[];
    }
  | {
      source: "git";
      url: string;
      ref?: string;
      pat?: string;
      allowRootOverrides?: string[];
    };

export interface ImportBundleResult {
  importedPaths: string[];
  routingRowAdded: boolean;
}

export class ImportBundleApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly retryAfter?: string;

  constructor(input: {
    status: number;
    code?: string;
    message: string;
    details?: unknown;
    retryAfter?: string;
  }) {
    super(input.message);
    this.name = "ImportBundleApiError";
    this.status = input.status;
    this.code = input.code ?? "ImportBundleFailed";
    this.details = input.details;
    this.retryAfter = input.retryAfter;
  }
}

export function acceptsZipFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".zip") ||
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed"
  );
}

export function buildGitImportRequest(input: {
  url: string;
  ref?: string;
  pat?: string;
  allowRootOverrides?: string[];
}): ImportBundleRequestBody {
  return {
    source: "git",
    url: input.url.trim(),
    ...(input.ref?.trim() ? { ref: input.ref.trim() } : {}),
    ...(input.pat ? { pat: input.pat } : {}),
    ...(input.allowRootOverrides?.length
      ? { allowRootOverrides: input.allowRootOverrides }
      : {}),
  };
}

export function describeImportError(error: {
  code?: string;
  message?: string;
  details?: unknown;
  retryAfter?: string;
}): { title: string; description: string } {
  switch (error.code) {
    case "ZipSafetyFailed":
      return {
        title: "Archive contains unsafe paths",
        description: zipSafetyDescription(error.details),
      };
    case "InvalidBase64":
      return {
        title: "Archive could not be read",
        description: "Choose a valid .zip file and try again.",
      };
    case "GitRefFetchFailed":
      return {
        title: "Git reference could not be fetched",
        description:
          error.message ??
          "Check the repository URL, optional ref, and access token.",
      };
    case "ReservedRootFile":
      return {
        title: "Import wants to replace a protected root file",
        description:
          "Review the protected file and explicitly allow the override to continue.",
      };
    case "ReservedFolderName":
      return {
        title: "Bundle uses a reserved folder",
        description:
          error.message ??
          "Sub-agent folders cannot be named memory or skills.",
      };
    case "PathCollision":
      return {
        title: "Bundle paths collide after normalization",
        description:
          "Two or more source paths map to the same ThinkWork folder path.",
      };
    case "ExistingSubAgentCollision":
      return {
        title: "Sub-agent folder already exists",
        description:
          error.message ??
          "Rename the source folder or remove the existing sub-agent before importing.",
      };
    case "DepthExceeded":
      return {
        title: "Folder depth is too deep",
        description:
          error.message ??
          "Imported sub-agent paths can be at most 5 folders deep.",
      };
    case "ImportRateLimited":
      return {
        title: "Import rate limit reached",
        description: error.retryAfter
          ? `Try again after ${error.retryAfter}.`
          : "Try again later.",
      };
    default:
      return {
        title: "Import failed",
        description: error.message ?? "The bundle could not be imported.",
      };
  }
}

export async function importBundle(
  agentId: string,
  input: ImportBundleInput,
): Promise<ImportBundleResult> {
  const body =
    input.source === "zip"
      ? {
          source: "zip" as const,
          body: await fileToBase64(input.file),
          ...(input.allowRootOverrides?.length
            ? { allowRootOverrides: input.allowRootOverrides }
            : {}),
        }
      : buildGitImportRequest(input);

  return requestImportBundle(agentId, body);
}

async function requestImportBundle(
  agentId: string,
  body: ImportBundleRequestBody,
): Promise<ImportBundleResult> {
  const token = await getIdToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(`${API_URL}/api/agents/${agentId}/import-bundle`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    code?: string;
    error?: string;
    details?: unknown;
    retryAfter?: string;
    importedPaths?: string[];
    routingRowAdded?: boolean;
  };

  if (!res.ok || data.ok === false) {
    throw new ImportBundleApiError({
      status: res.status,
      code: data.code,
      message: data.error ?? res.statusText,
      details: data.details,
      retryAfter: data.retryAfter,
    });
  }

  return {
    importedPaths: data.importedPaths ?? [],
    routingRowAdded: Boolean(data.routingRowAdded),
  };
}

async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

function zipSafetyDescription(details: unknown): string {
  const errors = (
    details as { errors?: Array<{ kind?: string; path?: string }> } | undefined
  )?.errors;
  const first = errors?.[0];
  switch (first?.kind) {
    case "ZipPathEscape":
      return "Archive contains a path that escapes the import root.";
    case "ZipDecompressedTooLarge":
      return "Archive expands beyond the allowed size.";
    case "ZipTooManyEntries":
      return "Archive contains too many files.";
    case "ZipSymlinkNotAllowed":
      return "Archive contains a symlink, which is not allowed.";
    case "ZipPathTooLong":
      return "Archive contains a path that is too long.";
    case "ZipMalformed":
      return "Archive is corrupt or not a valid .zip file.";
    default:
      return "Archive failed safety validation.";
  }
}

export const agentBuilderApi = {
  listFiles: listWorkspaceFiles,
  getFile: getWorkspaceFile,
  putFile: putWorkspaceFile,
  deleteFile: deleteWorkspaceFile,
  createSubAgent,
  importBundle,
};
