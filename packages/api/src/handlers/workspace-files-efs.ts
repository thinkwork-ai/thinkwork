/**
 * workspace-files-efs — VPC-attached Lambda that reads any Computer's
 * workspace files directly off the shared EFS file system, bypassing the
 * computer_tasks queue for list/get operations.
 *
 * Invoked from `packages/api/workspace-files.ts` (Lambda → Lambda
 * RequestResponse) for Computer targets. The admin SPA's workspace tab
 * goes through workspace-files; this sidecar lets that path stay snappy
 * even when the Computer's runtime is hung, restarting, or buried under a
 * write backlog.
 *
 * Plan: docs/plans/2026-05-13-XXX-feat-admin-computer-efs-listing-plan.md
 *
 * --- Invocation contract ---
 * Payload (caller already validated tenant membership against the target):
 *   { action: "list",   tenantId: UUID, computerId: UUID, includeContent?: bool }
 *   { action: "get",    tenantId: UUID, computerId: UUID, path: string }
 *
 * Response shape mirrors the existing handleList / handleGet contract from
 * workspace-files.ts so the caller can return it without translation:
 *   list  → { ok: true, files: WorkspaceFileMeta[] }
 *   get   → { ok: true, content: string | null, source: "computer", sha256: "" }
 *   error → { ok: false, status: number, error: string }
 *
 * --- Layout ---
 * The Lambda mounts the workspace_admin EFS access point at
 * `${WORKSPACE_EFS_ROOT}` (default `/mnt/efs`). That access point is
 * chroot'd to `/tenants` on the shared EFS file system, so any Computer's
 * workspace resolves to:
 *   ${WORKSPACE_EFS_ROOT}/<tenantId>/computers/<computerId>/<relPath>
 * which matches the layout written by `computerWorkspacePath` in
 * packages/api/src/lib/computers/runtime-control.ts:40.
 *
 * --- Defensive posture ---
 * Tenant/computer ids are UUID-validated and the resolved file path is
 * verified to live under the per-Computer root, so a malformed `path`
 * (`..`, absolute, etc.) cannot escape the access-point chroot. Writes
 * intentionally stay on the queue path; this handler only reads.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { isBuiltinToolWorkspacePath } from "../lib/builtin-tool-slugs.js";

const EFS_ROOT = process.env.WORKSPACE_EFS_ROOT || "/mnt/efs";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface WorkspaceFileMeta {
  path: string;
  source: "computer";
  sha256: string;
  overridden: false;
  content?: string;
}

type Payload =
  | {
      action: "list";
      tenantId: string;
      computerId: string;
      includeContent?: boolean;
    }
  | {
      action: "get";
      tenantId: string;
      computerId: string;
      path: string;
    };

type Response =
  | { ok: true; files: WorkspaceFileMeta[] }
  | {
      ok: true;
      content: string | null;
      source: "computer";
      sha256: string;
    }
  | { ok: false; status: number; error: string };

export async function handler(event: Payload): Promise<Response> {
  if (!event || typeof event !== "object") {
    return { ok: false, status: 400, error: "Invalid payload" };
  }
  if (!UUID_RE.test(event.tenantId) || !UUID_RE.test(event.computerId)) {
    return { ok: false, status: 400, error: "tenantId/computerId must be UUIDs" };
  }
  const computerRoot = path.join(
    EFS_ROOT,
    event.tenantId,
    "computers",
    event.computerId,
  );

  try {
    if (event.action === "list") {
      return await handleList(computerRoot, event.includeContent === true);
    }
    if (event.action === "get") {
      if (typeof event.path !== "string" || event.path.length === 0) {
        return { ok: false, status: 400, error: "path is required for get" };
      }
      return await handleGet(computerRoot, event.path);
    }
    return {
      ok: false,
      status: 400,
      error: `Unknown action: ${(event as { action?: unknown }).action}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 500,
      error: `Workspace operation failed: ${message}`,
    };
  }
}

async function handleList(
  computerRoot: string,
  includeContent: boolean,
): Promise<Response> {
  const relPaths = await listRecursive(computerRoot, "");
  const visible = relPaths.filter(
    (p) =>
      p !== "manifest.json" &&
      p !== "_defaults_version" &&
      !isBuiltinToolWorkspacePath(p),
  );

  if (!includeContent) {
    return {
      ok: true,
      files: visible.map((p) => ({
        path: p,
        source: "computer",
        sha256: "",
        overridden: false,
      })),
    };
  }

  const files = await Promise.all(
    visible.map(async (p) => {
      const abs = safeJoin(computerRoot, p);
      if (!abs) {
        return {
          path: p,
          source: "computer" as const,
          sha256: "",
          overridden: false as const,
          content: "",
        };
      }
      const content = await readUtf8OrEmpty(abs);
      return {
        path: p,
        source: "computer" as const,
        sha256: "",
        overridden: false as const,
        content,
      };
    }),
  );
  return { ok: true, files };
}

async function handleGet(
  computerRoot: string,
  relPath: string,
): Promise<Response> {
  const abs = safeJoin(computerRoot, relPath);
  if (!abs) {
    return { ok: false, status: 400, error: "Invalid path" };
  }
  const content = await readUtf8OrNull(abs);
  return { ok: true, content, source: "computer", sha256: "" };
}

/**
 * Recursively list files under `root`, returning paths relative to `root`
 * with forward-slash separators. Missing root resolves to []. Symlinks and
 * non-regular files are skipped (the access point chroot keeps them inside
 * the tenant slice, but defense-in-depth: don't follow symlinks here).
 */
async function listRecursive(
  root: string,
  prefix: string,
): Promise<string[]> {
  const dir = prefix ? path.join(root, prefix) : root;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
  const out: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await listRecursive(root, rel)));
    } else if (entry.isFile()) {
      out.push(rel);
    }
    // skipped: symlinks, sockets, devices
  }
  return out;
}

function safeJoin(root: string, relPath: string): string | null {
  // Reject absolute paths and traversal up front; path.resolve still
  // collapses `..` so a final under-root check is the authoritative gate.
  if (relPath.startsWith("/") || relPath.startsWith("\\")) return null;
  const resolved = path.resolve(root, relPath);
  const rootNormalized = path.resolve(root);
  if (
    resolved !== rootNormalized &&
    !resolved.startsWith(rootNormalized + path.sep)
  ) {
    return null;
  }
  return resolved;
}

async function readUtf8OrEmpty(absPath: string): Promise<string> {
  try {
    return await fs.readFile(absPath, "utf8");
  } catch (err) {
    if (isNotFound(err)) return "";
    throw err;
  }
}

async function readUtf8OrNull(absPath: string): Promise<string | null> {
  try {
    return await fs.readFile(absPath, "utf8");
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}
