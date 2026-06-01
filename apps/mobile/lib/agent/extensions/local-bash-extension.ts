// local-bash — the mobile harness's built-in Pi-style shell tool.
//
// This is intentionally a local extension, not an MCP/cloud shim: just-bash runs an
// in-memory bash-like sandbox inside the mobile JS runtime. That keeps command execution
// in the same place the mobile agent lives, while still letting the agent call public
// internet endpoints through curl/wget when a task needs it.

import { Bash } from "just-bash";
import type { BashOptions } from "just-bash";
import { defineExtension } from "./define-extension";
import type { ExtensionFactory } from "./types";
import type { ToolResult } from "../types";
import type { WorkspaceSnapshot } from "../workspace-diff";
import {
  assertSafeRelativePath,
  type WorkspaceCache,
  type WorkspaceCachePartition,
} from "../workspace-cache";
import type { WorkspaceTarget } from "@/lib/workspace-api";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_TOOL_RESULT_CHARS = 64 * 1024;
const SNAPSHOT_KEY_PREFIX = "thinkwork:mobile-pi:bash-snapshot:";
type RuntimeTuplePathMap = Map<string, string>;

export interface BashSnapshotStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?(key: string): Promise<void>;
}

export class MemoryBashSnapshotStorage implements BashSnapshotStorage {
  private readonly values = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }
}

export interface LocalBashExtensionOptions {
  /**
   * Stable key for the in-memory shell. Use the thread id so files/env survive across
   * turns while the app process is alive, without crossing thread boundaries.
   */
  sessionId?: string;
  /** Public internet access for curl/wget. Enabled by default per the mobile Pi contract. */
  network?: boolean;
  timeoutMs?: number;
  /**
   * Optional rendered ThinkWork workspace cache. When provided, cached files are mounted
   * into /workspace before each command and command-created files are snapshotted after.
   */
  workspace?: {
    cache: WorkspaceCache;
    partition: WorkspaceCachePartition;
    targets: readonly WorkspaceTarget[];
  };
  /** Test seam for durable per-thread shell file snapshots. Defaults to AsyncStorage. */
  snapshotStorage?: BashSnapshotStorage;
  /** Optional turn-level sink for computing the finalize changed_files payload. */
  onWorkspaceSnapshot?: (
    phase: "baseline" | "current",
    files: WorkspaceSnapshot,
  ) => void;
}

const sandboxes = new Map<string, Bash>();

function sandboxKey(sessionId?: string): string {
  return sessionId?.trim() || "mobile-default";
}

function snapshotKey(key: string): string {
  return `${SNAPSHOT_KEY_PREFIX}${key}`;
}

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

function getBash(sessionId: string | undefined, network: boolean): Bash {
  const key = sandboxKey(sessionId);
  const existing = sandboxes.get(key);
  if (existing) return existing;

  const bash = createBash(network);
  sandboxes.set(key, bash);
  return bash;
}

function createAsyncStorageAdapter(): BashSnapshotStorage {
  let fallback: MemoryBashSnapshotStorage | null = null;
  async function loadAsyncStorage() {
    try {
      const storage = await import("@react-native-async-storage/async-storage");
      return storage.default;
    } catch {
      fallback ??= new MemoryBashSnapshotStorage();
      return fallback;
    }
  }
  return {
    async getItem(key) {
      const storage = await loadAsyncStorage();
      try {
        return await storage.getItem(key);
      } catch {
        fallback ??= new MemoryBashSnapshotStorage();
        return fallback.getItem(key);
      }
    },
    async setItem(key, value) {
      const storage = await loadAsyncStorage();
      try {
        await storage.setItem(key, value);
      } catch {
        fallback ??= new MemoryBashSnapshotStorage();
        await fallback.setItem(key, value);
      }
    },
    async removeItem(key) {
      const storage = await loadAsyncStorage();
      try {
        await storage.removeItem?.(key);
      } catch {
        fallback ??= new MemoryBashSnapshotStorage();
        await fallback.removeItem(key);
      }
    },
  };
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
  const tuplePath = assertSafeRelativePath(relativePath);
  const safePath = workspaceRuntimePath(relativePath);
  pathMap?.set(safePath, tuplePath);
  const absolutePath = `/workspace/${safePath}`;
  await bash.fs.mkdir(parentDir(absolutePath), { recursive: true });
  await bash.writeFile(absolutePath, content);
}

function workspaceRuntimePath(relativePath: string): string {
  const safePath = assertSafeRelativePath(relativePath);
  if (safePath.startsWith("Agent/")) {
    return assertSafeRelativePath(safePath.slice("Agent/".length));
  }
  if (safePath.startsWith("User/")) {
    return assertSafeRelativePath(`User/${safePath.slice("User/".length)}`);
  }
  if (safePath.startsWith("Thread/")) {
    return assertSafeRelativePath(`Thread/${safePath.slice("Thread/".length)}`);
  }
  if (safePath.startsWith("Spaces/")) {
    if (safePath === "Spaces/INDEX.md") return safePath;
    const [, spaceFolder, ...rest] = safePath.split("/");
    return assertSafeRelativePath(
      ["Spaces", spaceFolder, rest.join("/")].join("/"),
    );
  }
  return safePath;
}

function workspaceTuplePath(
  relativePath: string,
  pathMap: RuntimeTuplePathMap,
): string {
  const safePath = assertSafeRelativePath(relativePath);
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

async function hydrateWorkspace(
  bash: Bash,
  key: string,
  options: LocalBashExtensionOptions,
): Promise<RuntimeTuplePathMap> {
  await bash.fs.mkdir("/workspace", { recursive: true });
  const pathMap: RuntimeTuplePathMap = new Map();

  const storage = options.snapshotStorage ?? createAsyncStorageAdapter();
  const raw = await storage.getItem(snapshotKey(key));
  if (raw) {
    try {
      const files = JSON.parse(raw) as Record<string, string>;
      for (const [path, content] of Object.entries(files)) {
        if (typeof content === "string") {
          await writeWorkspaceFile(bash, path, content, pathMap);
        }
      }
      return pathMap;
    } catch {
      await storage.removeItem?.(snapshotKey(key));
    }
  }

  if (options.workspace) {
    await options.workspace.cache.sync({
      partition: options.workspace.partition,
      targets: options.workspace.targets,
    });
    const files = await options.workspace.cache.listFiles(
      options.workspace.partition,
    );
    for (const file of files) {
      await writeWorkspaceFile(bash, file.path, file.content, pathMap);
    }
  }
  return pathMap;
}

async function snapshotWorkspace(
  bash: Bash,
  key: string,
  storage: BashSnapshotStorage,
  pathMap: RuntimeTuplePathMap,
): Promise<WorkspaceSnapshot> {
  const files: WorkspaceSnapshot = {};
  for (const path of bash.fs.getAllPaths()) {
    if (!path.startsWith("/workspace/")) continue;
    const relativePath = path.slice("/workspace/".length);
    try {
      const stat = await bash.fs.stat(path);
      if (!stat.isFile) continue;
      files[workspaceTuplePath(relativePath, pathMap)] =
        await bash.readFile(path);
    } catch {
      // Snapshot best effort: a concurrently removed or non-text file should not fail the turn.
    }
  }
  await storage.setItem(snapshotKey(key), JSON.stringify(files));
  return files;
}

function truncate(value: string): string {
  if (value.length <= MAX_TOOL_RESULT_CHARS) return value;
  return `${value.slice(0, MAX_TOOL_RESULT_CHARS)}\n[truncated after ${MAX_TOOL_RESULT_CHARS} characters]`;
}

function formatResult(result: {
  stdout: string;
  stderr: string;
  exitCode: number;
}): ToolResult {
  const parts = [];
  if (result.stdout) parts.push(truncate(result.stdout));
  if (result.stderr) parts.push(`stderr:\n${truncate(result.stderr)}`);
  if (result.exitCode !== 0) parts.push(`exitCode: ${result.exitCode}`);

  return {
    content: parts.length > 0 ? parts.join("\n") : "(no output)",
    isError: result.exitCode !== 0,
  };
}

function abortErrorMessage(timeoutMs: number): string {
  return `bash timed out after ${timeoutMs}ms`;
}

export function localBashExtension(
  options: LocalBashExtensionOptions = {},
): ExtensionFactory {
  const network = options.network ?? true;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const snapshotStorage =
    options.snapshotStorage ?? createAsyncStorageAdapter();

  return defineExtension({
    name: "local-bash",
    description: "Adds a local in-memory bash sandbox to the mobile agent.",
    register(pi) {
      pi.registerTool({
        name: "bash",
        description:
          "Run bash commands in the mobile app's local in-memory sandbox. Public internet access is enabled for curl/wget; private and loopback addresses are blocked. This is not the native iOS shell and cannot read arbitrary device files.",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The bash command or script to run.",
            },
          },
          required: ["command"],
        },
        execute: async (args, ctx) => {
          const command =
            typeof args.command === "string" ? args.command.trim() : "";
          if (!command) {
            return {
              content: 'Missing required string argument "command".',
              isError: true,
            };
          }

          const controller = new AbortController();
          const timeout = setTimeout(() => {
            controller.abort(new Error(abortErrorMessage(timeoutMs)));
          }, timeoutMs);
          const abortFromParent = () => {
            controller.abort(ctx.signal?.reason);
          };
          ctx.signal?.addEventListener("abort", abortFromParent, {
            once: true,
          });

          try {
            const key = sandboxKey(ctx.sessionId ?? options.sessionId);
            const bash = getBash(key, network);
            const pathMap = await hydrateWorkspace(bash, key, {
              ...options,
              snapshotStorage,
            });
            const baselineFiles = await snapshotWorkspace(
              bash,
              key,
              snapshotStorage,
              pathMap,
            );
            options.onWorkspaceSnapshot?.("baseline", baselineFiles);
            const result = await bash.exec(command, {
              signal: controller.signal,
            });
            const currentFiles = await snapshotWorkspace(
              bash,
              key,
              snapshotStorage,
              pathMap,
            );
            options.onWorkspaceSnapshot?.("current", currentFiles);
            return formatResult(result);
          } catch (err) {
            const message =
              err instanceof Error ? err.message : String(err || "failed");
            return {
              content:
                controller.signal.aborted && !message
                  ? abortErrorMessage(timeoutMs)
                  : `bash failed: ${message}`,
              isError: true,
            };
          } finally {
            clearTimeout(timeout);
            ctx.signal?.removeEventListener("abort", abortFromParent);
          }
        },
      });

      pi.on("before_agent_start", (e) => ({
        systemPrompt: `${e.systemPrompt}\n\nYou have a local \`bash\` tool. It runs inside a durable per-thread /workspace sandbox in the mobile app, preloaded with the cached ThinkWork workspace files when they are available. Public internet access is enabled for commands like curl and wget; private/loopback network ranges are blocked, and it cannot access arbitrary native device files. Use it for command output, lightweight file work in /workspace, builds/tests only when appropriate, and internet checks when the user asks. Do not claim command output unless it came from the bash tool.`,
      }));
    },
  });
}

export function resetLocalBashSandboxesForTests(): void {
  sandboxes.clear();
}
