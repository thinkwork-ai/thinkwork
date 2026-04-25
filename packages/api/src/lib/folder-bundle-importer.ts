import { parseAgentsMd } from "./agents-md-parser.js";
import {
  type AgentLease,
  acquireExclusive,
  release,
} from "./agent-builder-lock.js";
import { fetchGitRefAsFileTree } from "./git-ref-fetcher.js";
import { inspectZipBuffer } from "./plugin-zip-safety.js";
import { isReservedFolderSegment } from "./reserved-folder-names.js";
import {
  type FileTree,
  collisionCheck,
  normalizeTree,
} from "./vendor-path-normalizer.js";
import { appendRoutingRowIfMissing } from "./workspace-map-generator.js";

export type ImportBundleRequest =
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

export type ImportBundleResult =
  | { ok: true; importedPaths: string[]; routingRowAdded: boolean }
  | ImportBundleError;

type ImportBundleError = {
  ok: false;
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
};

export interface ImportBundleStorage {
  getText(path: string): Promise<string | null>;
  putText(path: string, content: string): Promise<void>;
  deleteText(path: string): Promise<void>;
  listPaths(): Promise<string[]>;
}

export interface ImportFolderBundleOptions {
  agentId: string;
  storage: ImportBundleStorage;
  lease?: {
    acquireExclusive(agentId: string): Promise<AgentLease>;
    release(agentId: string, leaseId: string): Promise<void>;
  };
  fetchGitRef?: typeof fetchGitRefAsFileTree;
}

const ROOT_RESERVED_FILES = new Set([
  "USER.md",
  "IDENTITY.md",
  "SOUL.md",
  "GUARDRAILS.md",
]);

const MEMORY_PATH_RE =
  /^(?:[a-z0-9][a-z0-9-]*\/){0,5}memory\/(lessons|preferences|contacts)\.md$/;
const SKILL_PATH_RE =
  /^(?:[a-z0-9][a-z0-9-]*\/){0,5}skills\/[a-z0-9][a-z0-9-]*\/.+$/;

export async function importFolderBundle(
  request: ImportBundleRequest,
  options: ImportFolderBundleOptions,
): Promise<ImportBundleResult> {
  const loaded = await loadRequestTree(request, options);
  if (!loaded.ok) return loaded;

  const collisions = unsupportedCollisions(loaded.files);
  if (collisions.length > 0) {
    return invalid(
      "PathCollision",
      "Multiple bundle paths normalize to the same target",
      409,
      { collisions },
    );
  }

  const normalized = normalizeTree(loaded.files);
  const validation = await validateNormalizedTree(
    normalized,
    request.allowRootOverrides ?? [],
    options.storage,
  );
  if (!validation.ok) return validation;

  let lease: AgentLease | null = null;
  const writtenPaths: string[] = [];
  try {
    lease = await (options.lease?.acquireExclusive(agentId(options)) ??
      acquireExclusive(agentId(options), {
        ownerKind: "folder-bundle-import",
        timeoutMs: 30_000,
      }));

    for (const [path, content] of Object.entries(normalized)) {
      await options.storage.putText(path, content);
      writtenPaths.push(path);
    }

    const routingRowAdded = await ensureParentRoutingRow(
      options.storage,
      normalized,
    );

    return {
      ok: true,
      importedPaths: Object.keys(normalized).sort(),
      routingRowAdded,
    };
  } catch (err) {
    await rollbackWrittenPaths(options.storage, writtenPaths);
    throw err;
  } finally {
    if (lease) {
      await (options.lease?.release(lease.agentId, lease.leaseId) ??
        release(lease.agentId, lease.leaseId));
    }
  }
}

async function loadRequestTree(
  request: ImportBundleRequest,
  options: ImportFolderBundleOptions,
): Promise<
  | { ok: true; files: FileTree }
  | {
      ok: false;
      statusCode: number;
      code: string;
      message: string;
      details?: unknown;
    }
> {
  if (request.source === "zip") {
    let buffer: Buffer;
    try {
      buffer = Buffer.from(request.body, "base64");
    } catch {
      return invalid("InvalidBase64", "Zip body must be base64 encoded", 400);
    }
    const zip = await inspectZipBuffer(buffer);
    if (!zip.valid) {
      return invalid(
        "ZipSafetyFailed",
        "Bundle failed zip safety checks",
        400,
        {
          errors: zip.errors,
        },
      );
    }
    return {
      ok: true,
      files: Object.fromEntries(zip.entries.map((e) => [e.path, e.text])),
    };
  }

  const result = await (options.fetchGitRef ?? fetchGitRefAsFileTree)({
    url: request.url,
    ref: request.ref,
    pat: request.pat,
  });
  if (!result.ok) {
    return invalid("GitRefFetchFailed", result.error, result.statusCode);
  }
  return { ok: true, files: result.files };
}

async function rollbackWrittenPaths(
  storage: ImportBundleStorage,
  paths: string[],
): Promise<void> {
  for (const path of paths.reverse()) {
    try {
      await storage.deleteText(path);
    } catch (err) {
      console.warn("[folder-bundle-import] rollback delete failed", {
        path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function validateNormalizedTree(
  tree: FileTree,
  allowRootOverrides: string[],
  storage: ImportBundleStorage,
): Promise<ImportBundleResult> {
  const allowed = new Set(allowRootOverrides);
  for (const path of Object.keys(tree)) {
    const parts = path.split("/");
    if (
      parts.length === 1 &&
      ROOT_RESERVED_FILES.has(path) &&
      !allowed.has(path)
    ) {
      return invalid(
        "ReservedRootFile",
        `${path} is server-managed and cannot be imported without explicit override`,
        409,
        { path, allowRootOverride: path },
      );
    }
    if (parts.slice(0, -1).length > 5) {
      return invalid(
        "DepthExceeded",
        `${path} exceeds max folder depth 5`,
        409,
        {
          path,
        },
      );
    }
    const reserved = invalidReservedFolderPath(path);
    if (reserved) return reserved;
  }

  const collisions = unsupportedCollisions(tree);
  if (collisions.length > 0) {
    return invalid(
      "PathCollision",
      "Multiple bundle paths normalize to the same target",
      409,
      {
        collisions,
      },
    );
  }

  const existing = await storage.listPaths();
  const existingTopFolders = new Set(
    existing
      .map((path) => path.split("/")[0])
      .filter((segment): segment is string => !!segment),
  );
  for (const folder of importedTopFolders(tree)) {
    if (existingTopFolders.has(folder)) {
      return invalid(
        "ExistingSubAgentCollision",
        `A sub-agent folder already exists at ${folder}/`,
        409,
        { folder, choices: ["replace", "rename", "abort"] },
      );
    }
  }

  return { ok: true, importedPaths: [], routingRowAdded: false };
}

function unsupportedCollisions(tree: FileTree) {
  return collisionCheck(tree).filter((collision) => {
    const vendorCount = collision.sourcePaths.filter(
      (p) =>
        p.startsWith(".claude/") ||
        p.startsWith(".codex/") ||
        p.startsWith(".gemini/"),
    ).length;
    return vendorCount !== 1 || collision.sourcePaths.length !== 2;
  });
}

async function ensureParentRoutingRow(
  storage: ImportBundleStorage,
  tree: FileTree,
): Promise<boolean> {
  const folder = Array.from(importedTopFolders(tree)).sort()[0];
  if (!folder) return false;
  const existing = (await storage.getText("AGENTS.md")) ?? defaultAgentsMd();
  const subAgentsMd = tree[`${folder}/AGENTS.md`] ?? "";
  const parsed = subAgentsMd ? parseAgentsMd(subAgentsMd) : null;
  const skills = parsed
    ? Array.from(new Set(parsed.routing.flatMap((row) => row.skills))).sort()
    : [];
  const next = appendRoutingRowIfMissing(existing, {
    task: `Specialist for ${folder}`,
    goTo: `${folder}/`,
    read: `${folder}/CONTEXT.md`,
    skills,
  });
  if (next === existing) return false;
  await storage.putText("AGENTS.md", next);
  return true;
}

function invalidReservedFolderPath(path: string): ImportBundleResult | null {
  const parts = path.split("/");
  for (let i = 0; i < parts.length - 1; i++) {
    const segment = parts[i]!;
    if (!isReservedFolderSegment(segment)) continue;
    if (segment === "memory" && MEMORY_PATH_RE.test(path)) return null;
    if (segment === "skills" && SKILL_PATH_RE.test(path)) return null;
    return invalid(
      "ReservedFolderName",
      `${segment}/ is reserved and cannot be imported at ${path}`,
      409,
      { path, reservedFolder: segment },
    );
  }
  return null;
}

function importedTopFolders(tree: FileTree): Set<string> {
  const out = new Set<string>();
  for (const path of Object.keys(tree)) {
    const [first, ...rest] = path.split("/");
    if (!first || rest.length === 0) continue;
    if (isReservedFolderSegment(first)) continue;
    if (first.startsWith(".")) continue;
    out.add(first);
  }
  return out;
}

function defaultAgentsMd(): string {
  return `# AGENTS.md

## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
`;
}

function invalid(
  code: string,
  message: string,
  statusCode: number,
  details?: unknown,
): ImportBundleError {
  return { ok: false, code, message, statusCode, details };
}

function agentId(options: ImportFolderBundleOptions): string {
  return options.agentId;
}
