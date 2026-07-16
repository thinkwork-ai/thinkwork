/**
 * connections/ → connectors/ per-tenant mover (subagent-folders U15 —
 * R18, R20).
 *
 * Moves every legacy `connections/<slug>/` capability folder in an agent
 * workspace SOURCE prefix to `connectors/<slug>/`, then deletes the old
 * objects and leaves a `connections/README.md` tombstone so retained
 * model-visible artifacts (memories, wiki pages, transcripts) that
 * reference old paths keep resolving to an explanation instead of a
 * dead end.
 *
 * "Sever before delete" (plan execution note): the reconciler-shaped
 * writers (`reconcile-connection-folders`, the analyst materializer, the
 * U11 backfill) derive folders from `tenant_mcp_servers` registry rows —
 * records keyed by slug/registry id, never by S3 path — so there is no
 * DB record to re-point. Severing here means the WRITER FLIP: the same
 * PR that ships this mover flips every writer and key builder to
 * `connectors/` (workspace-constants ROOT_CONNECTIONS_FOLDER), so after
 * the move nothing can re-create (`resurrect`) a deleted `connections/`
 * folder. This mover therefore MUST NOT run against a stack that
 * predates the flip deploy — the old writers would happily rebuild
 * `connections/` from the registry on the next reconcile.
 *
 * Idempotent: a second run sees only the tombstone (or nothing) and
 * reports noop. A partially-applied run (copied but not deleted) is
 * completed on re-run — existing identical targets are not re-copied,
 * and where source and target DIFFER the `connectors/` copy wins (it is
 * the post-flip writer's output; the legacy copy is stale by
 * definition), so the old object is deleted without overwriting.
 */

import type { WorkspaceObjectStore } from "./folder-canon-migrator.js";

export type ConnectorsMoveMode = "dry-run" | "apply" | "noop-check";

export const CONNECTORS_TOMBSTONE_FILENAME = "README.md";

export interface ConnectorsMoveOptions {
  tenantSlug?: string;
  agentSlug?: string;
  mode: ConnectorsMoveMode;
  store: WorkspaceObjectStore;
  /** Injectable for deterministic tombstone text in tests. */
  movedDate?: string;
}

export interface ConnectorsMoveOperation {
  type: "copy-object" | "delete-object" | "write-tombstone";
  key: string;
  sourceKey?: string;
}

export interface ConnectorsMoveAgentReport {
  tenantSlug: string;
  agentSlug: string;
  prefix: string;
  status: "dry-run" | "moved" | "noop" | "needs-move" | "failed";
  operations: ConnectorsMoveOperation[];
  movedSlugs: string[];
  message: string;
}

export interface ConnectorsMoveSummary {
  mode: ConnectorsMoveMode;
  agentReports: ConnectorsMoveAgentReport[];
  pendingOperations: number;
}

export function connectorsTombstoneMarkdown(movedDate: string): string {
  return [
    "# connections/ has moved to connectors/",
    "",
    `This folder was renamed to \`connectors/\` on ${movedDate}`,
    "(subagent-folders U15). Every connection capability folder now lives",
    "at `connectors/<slug>/`.",
    "",
    "If a memory, wiki page, or transcript references",
    "`connections/<slug>/...`, read the same path under",
    "`connectors/<slug>/...` instead. Do not create new files here.",
    "",
  ].join("\n");
}

export async function moveConnectionsToConnectors(
  options: ConnectorsMoveOptions,
): Promise<ConnectorsMoveSummary> {
  const prefixes = await discoverAgentWorkspacePrefixes(options);
  const agentReports: ConnectorsMoveAgentReport[] = [];
  for (const prefix of prefixes) {
    try {
      agentReports.push(await moveAgentPrefix(prefix, options));
    } catch (error) {
      agentReports.push(failedReport(prefix, error));
    }
  }
  return {
    mode: options.mode,
    agentReports,
    pendingOperations: agentReports.reduce(
      (count, report) => count + report.operations.length,
      0,
    ),
  };
}

async function discoverAgentWorkspacePrefixes(
  options: ConnectorsMoveOptions,
): Promise<string[]> {
  if (options.agentSlug) {
    if (!options.tenantSlug) {
      throw new Error("--tenant is required when --agent is provided");
    }
    return [
      `tenants/${options.tenantSlug}/agents/${options.agentSlug}/workspace/`,
    ];
  }
  const scanPrefix = options.tenantSlug
    ? `tenants/${options.tenantSlug}/agents/`
    : "tenants/";
  const keys = await options.store.list(scanPrefix);
  const prefixes = new Set<string>();
  for (const key of keys) {
    const relative = key.slice(scanPrefix.length);
    const match = options.tenantSlug
      ? relative.match(/^([^/]+)\/workspace\//)
      : relative.match(/^([^/]+)\/agents\/([^/]+)\/workspace\//);
    const agentSlug = options.tenantSlug ? match?.[1] : match?.[2];
    if (!agentSlug || agentSlug === "_catalog") continue;
    prefixes.add(
      options.tenantSlug
        ? `tenants/${options.tenantSlug}/agents/${agentSlug}/workspace/`
        : `tenants/${match?.[1]}/agents/${agentSlug}/workspace/`,
    );
  }
  return [...prefixes].sort((left, right) => left.localeCompare(right));
}

async function moveAgentPrefix(
  prefix: string,
  options: ConnectorsMoveOptions,
): Promise<ConnectorsMoveAgentReport> {
  const { tenantSlug, agentSlug } = parseWorkspacePrefix(prefix);
  const legacyPrefix = `${prefix}connections/`;
  const tombstoneKey = `${legacyPrefix}${CONNECTORS_TOMBSTONE_FILENAME}`;
  const legacyKeys = (await options.store.list(legacyPrefix)).filter((key) =>
    key.startsWith(legacyPrefix),
  );
  const moveKeys = legacyKeys.filter((key) => key !== tombstoneKey);

  const operations: ConnectorsMoveOperation[] = [];
  const movedSlugs = new Set<string>();
  for (const sourceKey of moveKeys) {
    const relative = sourceKey.slice(legacyPrefix.length);
    if (!relative) continue;
    const slug = relative.split("/")[0];
    if (slug) movedSlugs.add(slug);
    const targetKey = `${prefix}connectors/${relative}`;
    // Idempotence/partial-run handling: an existing target is kept as-is —
    // identical content means the copy already happened; differing content
    // means the post-flip writer re-materialized the folder under
    // connectors/, which supersedes the stale legacy bytes.
    if ((await options.store.read(targetKey)) === null) {
      operations.push({ type: "copy-object", sourceKey, key: targetKey });
    }
    operations.push({ type: "delete-object", key: sourceKey });
  }
  if (moveKeys.length > 0 && !legacyKeys.includes(tombstoneKey)) {
    operations.push({ type: "write-tombstone", key: tombstoneKey });
  }

  if (options.mode === "noop-check") {
    return report(tenantSlug, agentSlug, prefix, {
      status: operations.length > 0 ? "needs-move" : "noop",
      operations,
      movedSlugs,
      message:
        operations.length > 0
          ? `${operations.length} operation(s) pending`
          : "No move needed",
    });
  }
  if (options.mode === "dry-run") {
    return report(tenantSlug, agentSlug, prefix, {
      status: operations.length > 0 ? "dry-run" : "noop",
      operations,
      movedSlugs,
      message:
        operations.length > 0
          ? `Would apply ${operations.length} operation(s)`
          : "No move needed",
    });
  }

  // Apply: copy everything first, verify, then delete, then tombstone —
  // the legacy objects are only removed once their replacements are
  // confirmed present (sever-before-delete ordering within S3).
  const copiedTargets: string[] = [];
  for (const operation of operations) {
    if (operation.type === "copy-object" && operation.sourceKey) {
      await options.store.copy(operation.sourceKey, operation.key);
      copiedTargets.push(operation.key);
    }
  }
  for (const key of copiedTargets) {
    if ((await options.store.read(key)) === null) {
      throw new Error(`Verification failed: copied object missing at ${key}`);
    }
  }
  const deletes = operations
    .filter((operation) => operation.type === "delete-object")
    .map((operation) => operation.key);
  if (deletes.length > 0) {
    await options.store.delete(deletes);
  }
  if (operations.some((operation) => operation.type === "write-tombstone")) {
    await options.store.write(
      tombstoneKey,
      connectorsTombstoneMarkdown(
        options.movedDate ?? new Date().toISOString().slice(0, 10),
      ),
    );
  }

  return report(tenantSlug, agentSlug, prefix, {
    status: operations.length > 0 ? "moved" : "noop",
    operations,
    movedSlugs,
    message:
      operations.length > 0
        ? `Applied ${operations.length} operation(s)`
        : "No move needed",
  });
}

function report(
  tenantSlug: string,
  agentSlug: string,
  prefix: string,
  input: {
    status: ConnectorsMoveAgentReport["status"];
    operations: ConnectorsMoveOperation[];
    movedSlugs: Set<string>;
    message: string;
  },
): ConnectorsMoveAgentReport {
  return {
    tenantSlug,
    agentSlug,
    prefix,
    status: input.status,
    operations: input.operations,
    movedSlugs: [...input.movedSlugs].sort((left, right) =>
      left.localeCompare(right),
    ),
    message: input.message,
  };
}

function failedReport(
  prefix: string,
  error: unknown,
): ConnectorsMoveAgentReport {
  const { tenantSlug, agentSlug } = parseWorkspacePrefix(prefix);
  return {
    tenantSlug,
    agentSlug,
    prefix,
    status: "failed",
    operations: [],
    movedSlugs: [],
    message: error instanceof Error ? error.message : String(error),
  };
}

function parseWorkspacePrefix(prefix: string): {
  tenantSlug: string;
  agentSlug: string;
} {
  const match = prefix.match(/^tenants\/([^/]+)\/agents\/([^/]+)\/workspace\//);
  if (!match?.[1] || !match[2]) {
    return { tenantSlug: "(unknown)", agentSlug: "(unknown)" };
  }
  return { tenantSlug: match[1], agentSlug: match[2] };
}
