import {
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import type { Dirent } from "node:fs";
import { dirname, join } from "node:path";

const MAX_WORKSPACE_FILE_BYTES = 256 * 1024;
const MAX_PROMPT_FILE_CHARS = 24_000;

const PROMPT_WORKSPACE_FILES = [
  "PLATFORM.md",
  "CAPABILITIES.md",
  "GUARDRAILS.md",
  "MEMORY_GUIDE.md",
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "AGENTS.md",
  "CONTEXT.md",
  "TOOLS.md",
] as const;

export type WorkspacePromptFileReader = (
  filePath: string,
) => Promise<string | null>;

export async function ensureWorkspace(root: string): Promise<string> {
  await mkdir(root, { recursive: true });
  const markerPath = join(root, ".thinkwork-computer-health");
  await writeFile(markerPath, `ok ${new Date().toISOString()}\n`, {
    encoding: "utf8",
  });
  return markerPath;
}

export async function writeHealthCheck(root: string, taskId: string) {
  const path = join(root, `.thinkwork-health-${taskId}`);
  await writeFile(path, JSON.stringify({ taskId, ok: true }) + "\n", {
    encoding: "utf8",
  });
  return path;
}

export async function writeWorkspaceFile(
  root: string,
  input: unknown,
): Promise<{ path: string; relativePath: string; bytes: number }> {
  const payload = requireObject(input);
  const relativePath = validateWorkspaceRelativePath(
    requireString(payload.path, "path"),
  );
  const content = requireString(payload.content, "content");
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_WORKSPACE_FILE_BYTES) {
    throw new Error(
      `Task input content must be ${MAX_WORKSPACE_FILE_BYTES} bytes or less`,
    );
  }
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { encoding: "utf8" });
  return { path, relativePath, bytes };
}

export async function listWorkspaceFiles(root: string): Promise<{
  files: Array<{ path: string; bytes: number; updatedAt: string }>;
}> {
  const files: Array<{ path: string; bytes: number; updatedAt: string }> = [];
  await walkWorkspace(root, "", files);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files };
}

export async function readWorkspaceFile(root: string, input: unknown): Promise<{
  path: string;
  relativePath: string;
  content: string | null;
  exists: boolean;
}> {
  const payload = requireObject(input);
  const relativePath = validateWorkspaceRelativePath(
    requireString(payload.path, "path"),
  );
  const path = join(root, relativePath);
  try {
    const content = await readFile(path, "utf8");
    return { path, relativePath, content, exists: true };
  } catch (err) {
    if (isMissingFile(err)) {
      return { path, relativePath, content: null, exists: false };
    }
    throw err;
  }
}

export async function deleteWorkspaceFile(
  root: string,
  input: unknown,
): Promise<{ path: string; relativePath: string; deleted: boolean }> {
  const payload = requireObject(input);
  const relativePath = validateWorkspaceRelativePath(
    requireString(payload.path, "path"),
  );
  const path = join(root, relativePath);
  try {
    await unlink(path);
    return { path, relativePath, deleted: true };
  } catch (err) {
    if (isMissingFile(err)) {
      return { path, relativePath, deleted: false };
    }
    throw err;
  }
}

export async function readWorkspaceSystemPrompt(
  root: string,
  fileReader: WorkspacePromptFileReader = readPromptFile,
): Promise<string> {
  const parts: string[] = [
    "Workspace files loaded from the Computer's local workspace. Use them as durable identity, user context, operating instructions, and guardrails.",
  ];
  let filesLoaded = 0;

  for (const filename of PROMPT_WORKSPACE_FILES) {
    const content = await fileReader(join(root, filename));
    if (!content) continue;

    filesLoaded++;
    const truncated =
      content.length > MAX_PROMPT_FILE_CHARS
        ? `${content.slice(0, MAX_PROMPT_FILE_CHARS)}\n\n[truncated]`
        : content;
    parts.push(`# ${filename}\n${truncated}`);
  }

  return filesLoaded > 0 ? parts.join("\n\n---\n\n") : "";
}

export function validateWorkspaceRelativePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed.startsWith("/") || trimmed.startsWith("\\")) {
    throw new Error("Workspace path must be relative");
  }
  const parts = trimmed.split(/[\\/]+/).filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("Workspace path cannot contain . or .. segments");
  }
  return parts.join("/");
}

async function readPromptFile(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath, "utf8");
    const trimmed = content.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

async function walkWorkspace(
  root: string,
  relativeDir: string,
  files: Array<{ path: string; bytes: number; updatedAt: string }>,
) {
  const absoluteDir = join(root, relativeDir);
  let entries: Dirent<string>[];
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch (err) {
    if (isMissingFile(err)) return;
    throw err;
  }

  for (const entry of entries) {
    const relativePath = relativeDir
      ? `${relativeDir}/${entry.name}`
      : entry.name;
    if (isRuntimeWorkspacePath(relativePath)) continue;
    const absolutePath = join(root, relativePath);
    if (entry.isDirectory()) {
      await walkWorkspace(root, relativePath, files);
    } else if (entry.isFile()) {
      const info = await stat(absolutePath);
      files.push({
        path: relativePath,
        bytes: info.size,
        updatedAt: info.mtime.toISOString(),
      });
    }
  }
}

function isRuntimeWorkspacePath(relativePath: string): boolean {
  return (
    relativePath === ".thinkwork-computer-health" ||
    relativePath.startsWith(".thinkwork-health-") ||
    relativePath.startsWith(".thinkwork/")
  );
}

function isMissingFile(err: unknown): boolean {
  return (
    Boolean(err) &&
    typeof err === "object" &&
    (err as { code?: string }).code === "ENOENT"
  );
}

function requireObject(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  throw new Error("Task input must be an object");
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`Task input ${name} must be a string`);
  }
  return value;
}
