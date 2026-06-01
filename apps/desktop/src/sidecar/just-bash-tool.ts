import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { WorkspaceSnapshot } from "@thinkwork/pi-runtime-core";
import { Bash } from "just-bash";
import type { BashOptions } from "just-bash";
import { Type } from "typebox";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_TOOL_RESULT_CHARS = 64 * 1024;
const MAX_HYDRATED_FILE_BYTES = 512 * 1024;
const MAX_HYDRATED_WORKSPACE_BYTES = 10 * 1024 * 1024;
const SKIPPED_DIRS = new Set([
  ".git",
  ".thinkwork-pi",
  "debug",
  "node_modules",
]);

export const DESKTOP_JUST_BASH_TOOL_NAMES = ["bash"] as const;
export const DESKTOP_LOCAL_PI_BUILTIN_TOOL_NAMES = [
  "read",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
] as const;

export interface DesktopJustBashToolOptions {
  workspaceDir: string;
  network?: boolean;
  timeoutMs?: number;
}

export interface DesktopJustBashController {
  tool: ToolDefinition;
  snapshotWorkspace(): Promise<WorkspaceSnapshot | null>;
}

type RuntimeTuplePathMap = Map<string, string>;

function createBash(network: boolean): Bash {
  const options: BashOptions = {
    cwd: "/workspace",
    env: {
      HOME: "/workspace",
      PWD: "/workspace",
      PATH: "/bin:/usr/bin",
    },
    executionLimits: {
      maxCommandCount: 2_000,
      maxLoopIterations: 20_000,
      maxOutputSize: MAX_OUTPUT_SIZE_BYTES,
      maxStringLength: MAX_OUTPUT_SIZE_BYTES,
    },
    network: network
      ? {
          dangerouslyAllowFullInternetAccess: true,
          denyPrivateRanges: true,
          timeoutMs: 30_000,
          maxResponseSize: MAX_RESPONSE_SIZE_BYTES,
        }
      : undefined,
    python: false,
    javascript: false,
    defenseInDepth: true,
  };
  return new Bash(options);
}

function safeRelativePath(value: string): string {
  const normalized = value.split(path.sep).join("/");
  if (
    !normalized ||
    normalized.startsWith("../") ||
    normalized === ".." ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error(`Unsafe workspace path: ${value}`);
  }
  return normalized;
}

function parentDir(absolutePath: string): string {
  const index = absolutePath.lastIndexOf("/");
  return index <= 0 ? "/" : absolutePath.slice(0, index);
}

async function writeWorkspaceFile(
  bash: Bash,
  relativePath: string,
  content: string,
  pathMap?: RuntimeTuplePathMap,
): Promise<void> {
  const tuplePath = safeRelativePath(relativePath);
  const safePath = workspaceRuntimePath(relativePath);
  pathMap?.set(safePath, tuplePath);
  const absolutePath = `/workspace/${safePath}`;
  await bash.fs.mkdir(parentDir(absolutePath), { recursive: true });
  await bash.writeFile(absolutePath, content);
}

function workspaceRuntimePath(relativePath: string): string {
  const safePath = safeRelativePath(relativePath);
  if (safePath.startsWith("Agent/")) {
    return safeRelativePath(safePath.slice("Agent/".length));
  }
  if (safePath.startsWith("User/")) {
    return safeRelativePath(`User/${safePath.slice("User/".length)}`);
  }
  if (safePath.startsWith("Thread/")) {
    return safeRelativePath(`Thread/${safePath.slice("Thread/".length)}`);
  }
  if (safePath.startsWith("Spaces/")) {
    if (safePath === "Spaces/INDEX.md") return safePath;
    const [, spaceFolder, ...rest] = safePath.split("/");
    return safeRelativePath(["Spaces", spaceFolder, rest.join("/")].join("/"));
  }
  return safePath;
}

function workspaceTuplePath(
  relativePath: string,
  pathMap: RuntimeTuplePathMap,
): string {
  const safePath = safeRelativePath(relativePath);
  const mapped = pathMap.get(safePath);
  if (mapped) return mapped;
  if (
    safePath.startsWith("User/") ||
    safePath.startsWith("Spaces/") ||
    safePath.startsWith("Thread/")
  ) {
    return safePath;
  }
  return safePath;
}

function hasNulByte(bytes: Uint8Array): boolean {
  return bytes.includes(0);
}

async function hydrateWorkspace(
  bash: Bash,
  workspaceDir: string,
): Promise<RuntimeTuplePathMap> {
  await bash.fs.mkdir("/workspace", { recursive: true });
  let hydratedBytes = 0;
  const pathMap: RuntimeTuplePathMap = new Map();

  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && SKIPPED_DIRS.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      const relative = safeRelativePath(path.relative(workspaceDir, absolute));
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await lstat(absolute);
      if (stat.size > MAX_HYDRATED_FILE_BYTES) continue;
      if (hydratedBytes + stat.size > MAX_HYDRATED_WORKSPACE_BYTES) return;
      const bytes = await readFile(absolute);
      if (hasNulByte(bytes)) continue;
      await writeWorkspaceFile(
        bash,
        relative,
        new TextDecoder().decode(bytes),
        pathMap,
      );
      hydratedBytes += bytes.byteLength;
    }
  }

  await visit(workspaceDir);
  return pathMap;
}

export async function snapshotBashWorkspace(
  bash: Bash,
  pathMap: RuntimeTuplePathMap = new Map(),
): Promise<WorkspaceSnapshot> {
  const files: WorkspaceSnapshot = {};
  for (const filePath of bash.fs.getAllPaths()) {
    if (!filePath.startsWith("/workspace/")) continue;
    const relativePath = filePath.slice("/workspace/".length);
    try {
      const stat = await bash.fs.stat(filePath);
      if (!stat.isFile) continue;
      files[workspaceTuplePath(relativePath, pathMap)] =
        await bash.readFile(filePath);
    } catch {
      // Best effort: a concurrently removed or non-text file should not fail the turn.
    }
  }
  return files;
}

function truncate(value: string): string {
  if (value.length <= MAX_TOOL_RESULT_CHARS) return value;
  return `${value.slice(0, MAX_TOOL_RESULT_CHARS)}\n[truncated after ${MAX_TOOL_RESULT_CHARS} characters]`;
}

function formatContent(result: {
  stdout: string;
  stderr: string;
  exitCode: number;
}): string {
  const parts = [];
  if (result.stdout) parts.push(truncate(result.stdout));
  if (result.stderr) parts.push(`stderr:\n${truncate(result.stderr)}`);
  if (result.exitCode !== 0) parts.push(`exitCode: ${result.exitCode}`);
  return parts.length > 0 ? parts.join("\n") : "(no output)";
}

function abortErrorMessage(timeoutMs: number): string {
  return `bash timed out after ${timeoutMs}ms`;
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function createDesktopJustBashTool(
  options: DesktopJustBashToolOptions,
): ToolDefinition {
  return createDesktopJustBashController(options).tool;
}

export function createDesktopJustBashController(
  options: DesktopJustBashToolOptions,
): DesktopJustBashController {
  const network = options.network ?? true;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const bash = createBash(network);
  let hydrated = false;
  let pathMap: RuntimeTuplePathMap = new Map();

  const tool: ToolDefinition = {
    name: "bash",
    label: "Bash",
    description:
      "Run bash commands in the ThinkWork desktop app's local just-bash /workspace sandbox. The sandbox is preloaded with rendered ThinkWork workspace files. Public internet access is enabled for curl/wget; private and loopback addresses are blocked. This is not the native macOS shell and cannot read arbitrary host files.",
    parameters: Type.Object({
      command: Type.String({
        description: "The bash command or script to run.",
      }),
    }),
    executionMode: "sequential",
    execute: async (_toolCallId, params, signal) => {
      const record = recordOf(params);
      const command =
        typeof record.command === "string" ? record.command.trim() : "";
      if (!command) {
        return {
          content: [
            {
              type: "text",
              text: 'Missing required string argument "command".',
            },
          ],
          details: null,
          isError: true,
        };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort(new Error(abortErrorMessage(timeoutMs)));
      }, timeoutMs);
      const abortFromParent = () => {
        controller.abort(signal?.reason);
      };
      signal?.addEventListener("abort", abortFromParent, { once: true });

      try {
        if (!hydrated) {
          pathMap = await hydrateWorkspace(bash, options.workspaceDir);
          hydrated = true;
        }
        const result = await bash.exec(command, { signal: controller.signal });
        return {
          content: [{ type: "text", text: formatContent(result) }],
          details: result,
          isError: result.exitCode !== 0,
        };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err || "failed");
        return {
          content: [
            {
              type: "text",
              text:
                controller.signal.aborted && !message
                  ? abortErrorMessage(timeoutMs)
                  : `bash failed: ${message}`,
            },
          ],
          details: { error: message },
          isError: true,
        };
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abortFromParent);
      }
    },
  };

  return {
    tool,
    async snapshotWorkspace() {
      return hydrated ? snapshotBashWorkspace(bash, pathMap) : null;
    },
  };
}
