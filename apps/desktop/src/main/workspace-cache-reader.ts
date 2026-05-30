import { open, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type {
  ReadWorkspaceFileResponse,
  ReadWorkspaceTreeResponse,
  WorkspaceTreeNode,
} from "@thinkwork/desktop-ipc";
import {
  SKIP_FILES,
  WORKSPACE_CACHE_DIRNAME,
} from "../sidecar/workspace-cache.js";

/** Hard cap on a single file read; over this the viewer shows `too-large`. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Bounds on the eager tree walk so a pathological cache can't hang main. */
export const MAX_TREE_DEPTH = 12;
export const MAX_TREE_NODES = 5_000;
/** Bytes sniffed for a NUL to classify a file as binary. */
const BINARY_SNIFF_BYTES = 8_000;

/** Thrown when a requested relative path escapes the cache root. */
export class PathEscapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathEscapeError";
  }
}

interface AppPathLike {
  getPath(name: "userData"): string;
}

export function resolveCacheRoot(app: AppPathLike): string {
  return path.join(app.getPath("userData"), WORKSPACE_CACHE_DIRNAME);
}

function hasUnsafeSegments(relPath: string): boolean {
  if (!relPath || relPath.startsWith("/") || relPath.includes("\\")) return true;
  if (path.isAbsolute(relPath)) return true;
  return relPath
    .split("/")
    .some((segment) => segment === "." || segment === "..");
}

function isWithin(root: string, target: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}

/**
 * Resolve a renderer-supplied relative path to a real absolute path confined to
 * the cache root. Rejects traversal and symlink targets that escape the root by
 * `realpath`-ing both sides before the containment check — a string-prefix check
 * alone is bypassable via symlink. Lets `ENOENT` propagate so the caller can map
 * a missing file to `vanished` rather than conflating it with an escape.
 */
export async function resolveWithinCacheRoot(
  root: string,
  relPath: string,
): Promise<string> {
  if (hasUnsafeSegments(relPath)) {
    throw new PathEscapeError(`unsafe workspace path: ${relPath}`);
  }
  const realRoot = await realpath(root);
  const resolved = path.resolve(realRoot, relPath);
  const realTarget = await realpath(resolved); // throws ENOENT if gone
  if (!isWithin(realRoot, realTarget)) {
    throw new PathEscapeError(`workspace path escapes cache root: ${relPath}`);
  }
  return realTarget;
}

function errno(err: unknown): string {
  return typeof err === "object" && err && "code" in err
    ? String((err as { code: unknown }).code)
    : "EUNKNOWN";
}

interface WalkOptions {
  maxDepth?: number;
  maxNodes?: number;
}

interface WalkState {
  budget: number;
  truncated: boolean;
  maxDepth: number;
}

async function walkDir(
  absDir: string,
  relDir: string,
  depth: number,
  state: WalkState,
): Promise<WorkspaceTreeNode[]> {
  if (depth > state.maxDepth) {
    state.truncated = true;
    return [];
  }
  const entries = await readdir(absDir, { withFileTypes: true }).catch(
    () => null,
  );
  if (!entries) return [];
  // Directories first, then files; each group alphabetical for stable display.
  const sorted = entries
    .filter((e) => e.isDirectory() || e.isFile())
    .sort((a, b) => {
      const ad = a.isDirectory() ? 0 : 1;
      const bd = b.isDirectory() ? 0 : 1;
      return ad !== bd ? ad - bd : a.name.localeCompare(b.name);
    });

  const nodes: WorkspaceTreeNode[] = [];
  for (const entry of sorted) {
    if (state.budget <= 0) {
      state.truncated = true;
      break;
    }
    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isFile()) {
      if (SKIP_FILES.has(entry.name)) continue;
      state.budget -= 1;
      nodes.push({ name: entry.name, path: relPath, kind: "file" });
    } else {
      state.budget -= 1;
      const children = await walkDir(
        path.join(absDir, entry.name),
        relPath,
        depth + 1,
        state,
      );
      // Prune directories with no file descendants (empty or sentinel-only),
      // unless the walk was truncated inside them.
      const hasFiles = children.length > 0;
      if (hasFiles) {
        nodes.push({ name: entry.name, path: relPath, kind: "dir", children });
      } else if (depth + 1 > state.maxDepth || state.budget <= 0) {
        nodes.push({
          name: entry.name,
          path: relPath,
          kind: "dir",
          children: [],
          truncated: true,
        });
      }
    }
  }
  return nodes;
}

export async function walkCacheTree(
  root: string,
  options: WalkOptions = {},
): Promise<ReadWorkspaceTreeResponse> {
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch (err) {
    if (errno(err) === "ENOENT") return { status: "empty" };
    return { status: "error", code: errno(err) };
  }
  const state: WalkState = {
    budget: options.maxNodes ?? MAX_TREE_NODES,
    truncated: false,
    maxDepth: options.maxDepth ?? MAX_TREE_DEPTH,
  };
  let tree: WorkspaceTreeNode[];
  try {
    tree = await walkDir(realRoot, "", 0, state);
  } catch (err) {
    return { status: "error", code: errno(err) };
  }
  if (tree.length === 0) return { status: "empty" };
  return { status: "ok", tree, truncated: state.truncated };
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  txt: "text",
  json: "json",
  jsonc: "json",
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  html: "html",
  css: "css",
  scss: "scss",
  sql: "sql",
  xml: "xml",
};

function languageForPath(relPath: string): string {
  const base = relPath.split("/").pop() ?? relPath;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "text"; // no extension or dotfile → plaintext
  const ext = base.slice(dot + 1).toLowerCase();
  return LANGUAGE_BY_EXT[ext] ?? "text";
}

function isBinary(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < limit; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/**
 * Read one cache file. Opens a single descriptor and `fstat`s + reads through it
 * (not two path-based calls) to close the stat→read TOCTOU window against
 * concurrent sidecar writes or a symlink swap.
 */
export async function readCacheFile(
  root: string,
  relPath: string,
  options: { maxBytes?: number } = {},
): Promise<ReadWorkspaceFileResponse> {
  const maxBytes = options.maxBytes ?? MAX_FILE_BYTES;
  let absPath: string;
  try {
    absPath = await resolveWithinCacheRoot(root, relPath);
  } catch (err) {
    if (err instanceof PathEscapeError) return { status: "error", code: "EACCES" };
    if (errno(err) === "ENOENT") return { status: "vanished" };
    return { status: "error", code: errno(err) };
  }

  let fd: Awaited<ReturnType<typeof open>> | null = null;
  try {
    fd = await open(absPath, "r");
    const info = await fd.stat();
    if (info.isDirectory()) return { status: "error", code: "EISDIR" };
    if (info.size > maxBytes) return { status: "too-large", size: info.size };
    const buffer = await fd.readFile();
    if (isBinary(buffer)) return { status: "binary" };
    return {
      status: "ok",
      content: buffer.toString("utf8"),
      language: languageForPath(relPath),
    };
  } catch (err) {
    if (errno(err) === "ENOENT") return { status: "vanished" };
    return { status: "error", code: errno(err) };
  } finally {
    await fd?.close();
  }
}
