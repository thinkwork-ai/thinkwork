/**
 * Build MCP server configs for an agent invocation.
 *
 * Resolves the agent's attached server set from the rendered capabilities
 * manifest (flag-on agents) or workspace `mcp/<slug>/.assignment.json`
 * files (flag-off agents), joins the approved+enabled `tenant_mcp_servers`
 * credential registry, resolves auth (tenant_api_key → auth_config,
 * per_user_oauth → user_mcp_tokens + Secrets Manager, with
 * refresh-on-expiry; per_user_api_key → the same user_mcp_tokens +
 * Secrets Manager rows, minus any refresh — the stored key IS the
 * bearer), and returns the list of servers the runtime
 * container should connect to. Servers whose auth can't be resolved are
 * logged and skipped. The `agent_mcp_servers` dispatch read is RETIRED
 * (THINK-173 U11) — that table is a derived index only.
 *
 * Requester identity (plan 2026-06-12-001 U6): callers pass BOTH halves
 * of the dispatch identity explicitly —
 *
 *   - `requesterUserId`  — the thread-turn / job owner; resolves per-user
 *     OAuth MCP servers via user_mcp_tokens for that requester and server.
 *   - `humanPairId`      — the agent's paired human; fallback for DIRECT
 *     `per_user_oauth` servers when no requester exists (R16 scheduled/wakeup
 *     compatibility).
 *
 * The plugin owns plugin-managed MCP server registration/lifecycle; each user
 * still authenticates to the MCP server individually. Plugin-managed
 * user_headers servers continue to use user_plugin_activation_tokens.
 * service_credential and no-auth plugin rows are tenant-owned and resolve
 * server-side without requester activation.
 *
 * URL dedupe: when a plugin server and a direct server share an endpoint
 * URL, the dispatch includes the plugin entry for users whose activation
 * resolves, else the direct entry (if its own auth resolves) — never both.
 *
 * Called from the wakeup processor (scheduled/triggered invocations),
 * chat-agent-invoke via resolve-agent-runtime-config (direct chat turns),
 * and mcp-proxy (interactive tool calls).
 */

import { and, eq, or } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  tenantMcpServers,
  userMcpTokens,
  agents,
} from "@thinkwork/database-pg/schema";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  UpdateSecretCommand,
} from "@aws-sdk/client-secrets-manager";
import { mcpHashMatches } from "./mcp-server-hash.js";
import {
  ADMIN_OPS_ACTING_USER_HEADER,
  ADMIN_OPS_AGENT_ID_HEADER,
} from "@thinkwork/agent-loops-core";
import type { McpResultTransform } from "@thinkwork/plugin-catalog";

/** The tenant's admin-ops MCP surface (provisioned at `/mcp/admin`). */
function isAdminOpsUrl(url: string): boolean {
  try {
    return new URL(url).pathname.replace(/\/+$/, "").endsWith("/mcp/admin");
  } catch {
    return false;
  }
}
import {
  evaluateConnectionPolicyParity,
  parseConnectionPolicyBlock,
  resolveAnalystPolicySource,
} from "./capabilities/connection-policy.js";
import type { CapabilitiesManifest } from "./capabilities/manifest-compile.js";
import type { PluginDispatchAuthResolver } from "./plugins/activation.js";
import type { CapabilityDiagnosticsCollector } from "./capability-diagnostics.js";
// Type-only import: erased at compile time, so referencing McpAssignmentState
// here does NOT load the S3/graphql-utils-coupled assignment-state module.
// The runtime module is pulled in lazily (dynamic import) only when an agent
// actually has a resolvable workspace — see loadWorkspaceMcpHelpers().
import type { McpAssignmentState } from "./mcp/assignment-state.js";

export interface McpServerConfig {
  name: string;
  url: string;
  transport: "streamable-http" | "sse";
  /**
   * Server-side trust marker for plugin-owned tenant-internal MCP endpoints.
   * The Pi runtime uses this to allow private/plain HTTP URLs and no-auth
   * connects only for configs emitted by this trusted resolver.
   */
  trustedInternal?: boolean;
  auth?:
    | { type: "bearer"; token: string }
    | { type: "headers"; headers: Record<string, string> }
    | { type: "bearer"; token: string; headers: Record<string, string> };
  tools?: string[];
  availableTools?: string[];
  recordLinkHints?: McpRuntimeRecordLinkHints;
  resultTransforms?: McpResultTransform[];
  /**
   * THINK-623 — opt-in long-call profile for MCP servers that stream
   * progress notifications during a long tool call (the Brain connector's
   * deep retrieval, for one). Read from the server row's
   * `runtime_metadata.longRunning`; the Pi runtime turns it into a
   * progress-resetting `callTool` wall plus an absolute total ceiling.
   * Absent for every other server, which keeps the fixed 60s wall.
   */
  longRunning?: boolean;
  /**
   * Probe-mode only (capability-mapping plan U3, KTD-1): the stored token's
   * status for this server, read from user_mcp_tokens / auth_config metadata
   * WITHOUT touching Secrets Manager or the token endpoint. Never present on
   * runtime-path resolutions — runtime configs carry real `auth` instead.
   *   - "active"     stored token exists and is not near expiry
   *   - "expired"    stored token exists but is expired; a runtime turn would
   *                  attempt a refresh (outcome unknowable without side effects)
   *   - "configured" tenant/service credential reference is present
   */
  tokenStatus?: "active" | "expired" | "configured";
  /**
   * THINK-229 U4 (KTD6): signed sidecar budget block, attached ONLY for
   * the analyst broker and ONLY post-flip (ANALYST_POLICY_SOURCE=sidecar).
   * loadAgentProfileRuntimeConfigs overrides the analyst profile's
   * execution.maxQueriesPerRun from it so both enforcement points draw
   * from the single signed policy source.
   */
  sidecarBudgets?: {
    maxQueriesPerRun?: number;
    maxQueriesPerTenantDay?: number;
    /** THINK-232: per-run dollar budget, when the signed sidecar carries it. */
    costBudgetUsd?: number;
  };
}

export interface McpRuntimeRecordLinkHints {
  schemaVersion: 1;
  source: "plugin-manifest";
  browserBaseUrl: string;
  routes: McpRuntimeRecordLinkRouteHint[];
  workspace?: {
    hashField: string;
  };
}

export interface McpRuntimeRecordLinkRouteHint {
  objectType: string;
  routeTemplate: string;
  idFields?: string[];
  labelFields?: string[];
}

/** Dispatch identity for MCP auth resolution — see module doc. */
export interface McpRequesterIdentity {
  humanPairId: string | null | undefined;
  requesterUserId: string | null | undefined;
}

export interface BuildMcpConfigsDeps {
  /** Injectable for tests; defaults to the Drizzle/SecretsManager resolver. */
  pluginAuth?: PluginDispatchAuthResolver;
  /**
   * Token resolution mode (capability-mapping plan U3, KTD-1).
   *
   *   - "resolve" (default): the runtime path — reads Secrets Manager and
   *     refreshes expired OAuth tokens (token-endpoint POST + Secrets Manager
   *     + user_mcp_tokens writes).
   *   - "probe": the inspector path — classifies each server's stored token
   *     state from DB metadata only. Zero Secrets Manager reads, zero
   *     refreshes, zero writes; configs carry `tokenStatus` instead of `auth`.
   *     Inspection must never mutate the state it observes: with WorkOS
   *     refresh-token rotation, a refresh from the inspector could burn a
   *     live connection.
   */
  tokenMode?: "resolve" | "probe";
  /**
   * Optional runtime-specific custody for direct/plugin per-user OAuth.
   *
   * A resolver that supports a server is authoritative for that server: the
   * legacy user_mcp_tokens + Secrets Manager path is never consulted. This is
   * how the managed AgentCore runtime uses Identity Token Vault without
   * duplicating grant state locally, while Pi keeps its existing resolver.
   */
  userOAuth?: ExternalUserOAuthResolver;
  /**
   * Optional diagnostics collector (U1): when present, every server this
   * builder skips is recorded with its enumerated reason. Orthogonal to
   * tokenMode; runtime callers pass neither.
   */
  diagnostics?: CapabilityDiagnosticsCollector | null;
  /**
   * Workspace assignment-file store (Composer plan U9b). Injectable for
   * tests; defaults to a lazy dynamic import of
   * `./mcp/assignment-state.js`. The default is only loaded when an agent
   * has a resolvable slug (a workspace prefix), so the S3/graphql-utils
   * dependency graph stays out of the DB-only resolution path.
   */
  workspaceMcp?: WorkspaceMcpHelpers;
  /**
   * Folder-capability dispatch source (THINK-173 U5, R20). For an agent
   * whose `capability_folder_dispatch` flag is ON, the attached
   * connection set comes EXCLUSIVELY from the rendered capabilities
   * manifest — never per-file fallback:
   *
   *   - `{ manifest }` — enumerate mcp-type connection entries.
   *   - `{ manifest: null }` — the caller rendered but no manifest
   *     exists: loud error (R9 flag-on missing-manifest rule).
   *   - `{ defer: true }` — pre-render resolution (chat's
   *     resolveAgentRuntimeConfig call): return ZERO configs for the
   *     flag-on agent; the handler rebuilds post-render with the
   *     manifest. Fails safe (no tools) rather than split-brain.
   *   - `undefined` — caller not yet folder-aware: loud error for
   *     flag-on agents so a missed call site can never silently read
   *     the legacy tables.
   *
   * Flag-off agents ignore this entirely (byte-identical legacy path).
   */
  folderCapabilities?: {
    manifest?: CapabilitiesManifest | null;
    defer?: boolean;
  };
  /**
   * THINK-229 U4 (R8): collector for analyst-broker connections this
   * build WITHHELD (probe failure, credential missing, drift…). Dispatch
   * payload builders forward the notices to the container so a delegated
   * child can NAME the outage instead of estimating — the same detail
   * string the capability inspector shows.
   */
  withheldNotices?: Array<{ slug: string; detail: string }>;
}

export interface ExternalUserOAuthServer {
  mcpServerId: string;
  name: string;
  slug: string;
  url: string;
  managementSource: string;
}

export interface ExternalUserOAuthResolver {
  supports(server: ExternalUserOAuthServer): boolean;
  probe(input: {
    userId: string;
    server: ExternalUserOAuthServer;
  }): Promise<"active" | "expired" | "missing">;
  resolve(input: {
    userId: string;
    server: ExternalUserOAuthServer;
  }): Promise<string | undefined>;
}

/**
 * The subset of the workspace assignment-state store `buildMcpConfigs` reads
 * from (Composer plan U9b). Kept as a narrow injectable so the runtime module
 * (and its graphql-utils/S3 graph) loads lazily and tests can stub it.
 */
export interface WorkspaceMcpHelpers {
  resolveAgentWorkspacePrefix(agentId: string): Promise<string | null>;
  listWorkspaceMcpSlugs(targetPrefix: string): Promise<string[] | null>;
  readMcpAssignmentState(
    targetPrefix: string,
    slug: string,
  ): Promise<McpAssignmentState | null>;
}

async function loadWorkspaceMcpHelpers(): Promise<WorkspaceMcpHelpers> {
  const mod = await import("./mcp/assignment-state.js");
  return {
    resolveAgentWorkspacePrefix: mod.resolveAgentWorkspacePrefix,
    listWorkspaceMcpSlugs: (prefix) => mod.listWorkspaceMcpSlugs(prefix),
    readMcpAssignmentState: (prefix, slug) =>
      mod.readMcpAssignmentState(prefix, slug),
  };
}

/**
 * The joined per-server row the resolution loop consumes — a tenant registry
 * row plus the agent-level assignment overlay (`enabled` + `config`). Both the
 * workspace-file path (U9b) and the DB fallback produce this identical shape.
 */
interface McpJoinedRow {
  mcp_server_id: string;
  name: string;
  slug: string;
  url: string;
  transport: string;
  auth_type: string;
  auth_config: unknown;
  server_enabled: boolean;
  server_status: string;
  server_url_hash: string | null;
  management_source: string;
  plugin_install_id: string | null;
  runtime_metadata: unknown;
  tools: unknown;
  assignment_enabled: boolean;
  assignment_config: unknown;
}

const db = getDb();

function normalizeServerUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function externalUserOAuthServer(mcp: McpJoinedRow): ExternalUserOAuthServer {
  return {
    mcpServerId: mcp.mcp_server_id,
    name: mcp.name,
    slug: mcp.slug,
    url: mcp.url,
    managementSource: mcp.management_source,
  };
}

async function probePerUserOAuth(
  userId: string,
  mcp: McpJoinedRow,
  resolver?: ExternalUserOAuthResolver,
): Promise<"active" | "expired" | "missing"> {
  const server = externalUserOAuthServer(mcp);
  if (resolver?.supports(server)) {
    return resolver.probe({ userId, server });
  }
  return probeUserMcpTokenStatus({
    userId,
    mcpServerId: mcp.mcp_server_id,
  });
}

async function resolvePerUserOAuth(
  userId: string,
  mcp: McpJoinedRow,
  logPrefix: string,
  resolver?: ExternalUserOAuthResolver,
  fallbackLabel?: string,
): Promise<string | undefined> {
  const server = externalUserOAuthServer(mcp);
  if (resolver?.supports(server)) {
    return resolver.resolve({ userId, server });
  }
  return resolveUserMcpBearerToken({
    userId,
    mcp,
    logPrefix,
    ...(fallbackLabel ? { fallbackLabel } : {}),
  });
}

export async function buildMcpConfigs(
  agentId: string,
  requester: McpRequesterIdentity | null,
  logPrefix = "[mcp-configs]",
  deps: BuildMcpConfigsDeps = {},
): Promise<McpServerConfig[]> {
  const humanPairId = requester?.humanPairId ?? null;
  const requesterUserId = requester?.requesterUserId ?? null;
  const probe = deps.tokenMode === "probe";
  const diagnostics = deps.diagnostics ?? null;
  const withheldNotices = deps.withheldNotices;
  const dropDiag = (
    mcp: { slug: string | null; name: string; url?: string },
    reason: Parameters<CapabilityDiagnosticsCollector["add"]>[0]["reason"],
    detail: string,
  ) => {
    diagnostics?.add({
      capabilityClass: "mcp_server",
      capabilityId: mcp.slug ?? mcp.name,
      displayName: mcp.name,
      reason,
      detail,
    });
  };
  const mcpConfigs: McpServerConfig[] = [];

  // U11 gate: only approved + enabled servers whose pinned `url_hash`
  // still matches (url, auth_config) reach the runtime. Pending /
  // rejected rows, and approved rows whose fields drifted, are dropped
  // here with a log line so operators see the reason a capability
  // vanished. This is the SI-5 defensive layer.
  const [agentRow] = await db
    .select({
      tenant_id: agents.tenant_id,
      slug: agents.slug,
      capability_folder_dispatch: agents.capability_folder_dispatch,
    })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (!agentRow?.tenant_id) {
    console.warn(
      `${logPrefix} No agent found for MCP config build: ${agentId}`,
    );
    return [];
  }

  // The approved+enabled tenant registry is the join source for BOTH the
  // workspace-file path and the DB fallback. The U11 approval/hash gate lives
  // in the resolution loop below and applies identically to both sources.
  const serverRows = await db
    .select({
      mcp_server_id: tenantMcpServers.id,
      name: tenantMcpServers.name,
      slug: tenantMcpServers.slug,
      url: tenantMcpServers.url,
      transport: tenantMcpServers.transport,
      auth_type: tenantMcpServers.auth_type,
      auth_config: tenantMcpServers.auth_config,
      tools: tenantMcpServers.tools,
      server_enabled: tenantMcpServers.enabled,
      server_status: tenantMcpServers.status,
      server_url_hash: tenantMcpServers.url_hash,
      management_source: tenantMcpServers.management_source,
      plugin_install_id: tenantMcpServers.plugin_install_id,
      runtime_metadata: tenantMcpServers.runtime_metadata,
    })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.tenant_id, agentRow.tenant_id),
        eq(tenantMcpServers.status, "approved"),
        eq(tenantMcpServers.enabled, true),
      ),
    );

  // ── Attachment resolution ───────────────────────────────────────────────
  // THINK-173 U5 (R20): a flag-on agent reads its attached connection set
  // from the rendered capabilities manifest, all-or-nothing. Flag-off
  // agents take the existing workspace-file/DB path byte-identically.
  let mcpRows: McpJoinedRow[];
  if (agentRow.capability_folder_dispatch === true) {
    const folder = deps.folderCapabilities;
    if (folder?.defer) {
      console.log(
        `${logPrefix} mcp attachment resolution source=folder-deferred agentId=${agentId} — caller rebuilds post-render`,
      );
      return [];
    }
    if (!folder || folder.manifest === undefined) {
      throw new Error(
        `${logPrefix} agent ${agentId} has capability_folder_dispatch=true but the caller is not folder-aware — refusing silent legacy fallback (R20)`,
      );
    }
    if (folder.manifest === null) {
      throw new Error(
        `${logPrefix} agent ${agentId} has capability_folder_dispatch=true but no capabilities manifest was rendered — failing the turn loudly (R9)`,
      );
    }
    mcpRows = resolveAttachedRowsFromFolderConnections({
      manifest: folder.manifest,
      serverRows,
      logPrefix,
    });
    console.log(
      `${logPrefix} mcp attachment resolution source=folder-manifest agentId=${agentId} fingerprint=${folder.manifest.fingerprint.slice(0, 12)} servers=${mcpRows.length}`,
    );
  } else {
    // The workspace `mcp/<slug>/.assignment.json` files (U9a dual-write)
    // are the source of the agent's ATTACHED server set. The
    // `agent_mcp_servers` dispatch read is RETIRED (THINK-173 U11 cutover
    // metric: zero capability-state reads from that table at dispatch) —
    // when files can't serve resolution, the fallback is the registry
    // default: every approved+enabled tenant server, no per-agent
    // overlay. That is byte-identical to the pre-retirement output for
    // any agent without assignment rows (the common file-absent case);
    // per-agent disable/allowlist state lives ONLY in files/folders now.
    // Per-user OAuth/token resolution at turn time (the loop below) is
    // unchanged.
    const fileResolution = await resolveAttachedRowsFromWorkspaceFiles({
      agentId,
      agentSlug: agentRow.slug,
      serverRows,
      logPrefix,
      helpers: deps.workspaceMcp,
    });

    if ("rows" in fileResolution) {
      mcpRows = fileResolution.rows;
      console.log(
        `${logPrefix} mcp attachment resolution source=workspace-file agentId=${agentId} files=${fileResolution.fileCount} servers=${mcpRows.length}`,
      );
    } else {
      mcpRows = resolveRegistryDefaultRows(serverRows);
      console.log(
        `${logPrefix} mcp attachment resolution source=registry-default agentId=${agentId} fallbackReason=${fileResolution.fallbackReason} servers=${mcpRows.length} (agent_mcp_servers dispatch read retired)`,
      );
    }
  }

  // Plugin rows resolve FIRST so the URL-dedupe pass below can give the
  // plugin entry precedence over a direct entry sharing the endpoint.
  const isPluginRow = (row: (typeof mcpRows)[number]): boolean =>
    row.management_source === "plugin" && Boolean(row.plugin_install_id);
  const orderedRows = [
    ...mcpRows.filter(isPluginRow),
    ...mcpRows.filter((row) => !isPluginRow(row)),
  ];
  /** Normalized URLs of plugin entries that made it into the dispatch. */
  const includedPluginUrls = new Set<string>();
  // Lazy (dynamic import): the activation module — and its store/engine
  // dependency graph — only loads when a plugin row actually needs
  // resolving in this invocation.
  let pluginAuth: PluginDispatchAuthResolver | null = deps.pluginAuth ?? null;
  const getPluginAuth = async (): Promise<PluginDispatchAuthResolver> => {
    if (!pluginAuth) {
      const activation = await import("./plugins/activation.js");
      pluginAuth = activation.createPluginDispatchAuthResolver();
    }
    return pluginAuth;
  };

  for (const mcp of orderedRows) {
    if (!mcp.server_enabled) continue;
    // Defensive invariant: the SQL WHERE already filters by
    // status='approved', but drift between `url_hash` and the
    // current (url, auth_config) indicates the approval no longer
    // applies. Treat as pending without blocking the rest of the
    // agent's MCP fleet.
    //
    // `url_hash IS NULL` means the row was pre-existing at the U3
    // migration (which grandfathered live servers in as approved
    // without computing a hash) — allow it. U11 approvals always
    // write url_hash, so future mutations are hash-guarded.
    if (
      mcp.server_url_hash &&
      !mcpHashMatches(
        mcp.server_url_hash,
        mcp.url,
        mcp.auth_config as Record<string, unknown> | null,
      )
    ) {
      console.warn(
        `${logPrefix} skipping ${mcp.slug}: url_hash mismatch with (url, auth_config); re-approval required`,
      );
      dropDiag(
        mcp,
        "mcp_server_not_resolved",
        "url_hash mismatch with (url, auth_config); re-approval required",
      );
      continue;
    }

    // ── Plugin-managed servers (management_source='plugin') ──────────
    // Plugin installation registers and owns the server row, but OAuth MCP
    // access is still per-user MCP auth. Resolve that from the REQUESTER's
    // user_mcp_tokens record, never from humanPairId. user_headers remains an
    // app-level activation shape. service_credential and no-auth rows are
    // tenant-owned.
    if (isPluginRow(mcp)) {
      if (mcp.auth_type === "service_credential") {
        if (probe) {
          const status = probeServiceCredentialConfig(
            (mcp.auth_config as Record<string, unknown>) || {},
          );
          if (status !== "configured") {
            dropDiag(mcp, "credential_missing", status);
            continue;
          }
          mcpConfigs.push(probeMcpServerConfig(mcp, "configured"));
          includedPluginUrls.add(normalizeServerUrl(mcp.url));
          continue;
        }
        const resolved = await resolveServiceCredentialAuth(
          (mcp.auth_config as Record<string, unknown>) || {},
          logPrefix,
          mcp.slug ?? mcp.name,
        );
        if (!resolved) {
          dropDiag(
            mcp,
            "credential_missing",
            "service credential did not resolve",
          );
          continue;
        }
        mcpConfigs.push(
          toMcpServerConfig(mcp, resolved.token, resolved.headers),
        );
        includedPluginUrls.add(normalizeServerUrl(mcp.url));
        continue;
      }
      if (mcp.auth_type === "none") {
        mcpConfigs.push(
          probe ? probeMcpServerConfig(mcp) : toMcpServerConfig(mcp, undefined),
        );
        includedPluginUrls.add(normalizeServerUrl(mcp.url));
        continue;
      }
      if (!requesterUserId) {
        console.warn(
          `${logPrefix} Skipping plugin MCP ${mcp.slug}: no resolvable requesting user (fail closed)`,
        );
        dropDiag(
          mcp,
          "plugin_gate_fail_closed",
          "no resolvable requesting user for a per-user plugin server (fail closed)",
        );
        continue;
      }
      const pluginInstallId = mcp.plugin_install_id as string;
      let pluginToken: string | undefined;
      let pluginHeaders: Record<string, string> | undefined;
      if (mcp.auth_type === "oauth" || mcp.auth_type === "per_user_oauth") {
        if (probe) {
          const status = await probePerUserOAuth(
            requesterUserId,
            mcp,
            deps.userOAuth,
          );
          if (status === "missing") {
            dropDiag(
              mcp,
              "oauth_missing",
              "requester has no active MCP OAuth token for this plugin server",
            );
            continue;
          }
          mcpConfigs.push(probeMcpServerConfig(mcp, status));
          includedPluginUrls.add(normalizeServerUrl(mcp.url));
          continue;
        }
        pluginToken = await resolvePerUserOAuth(
          requesterUserId,
          mcp,
          logPrefix,
          deps.userOAuth,
          "for plugin-registered MCP server",
        );
        if (!pluginToken) {
          dropDiag(
            mcp,
            "oauth_missing",
            "requester's MCP OAuth token did not resolve",
          );
          continue;
        }
      } else if (mcp.auth_type === "user_headers") {
        const headerNames = userHeaderNamesFromAuthConfig(
          mcp.auth_config as Record<string, unknown> | null,
        );
        const usesBearer = userHeaderAuthUsesBearer(
          mcp.auth_config as Record<string, unknown> | null,
        );
        if (headerNames.length === 0 && !usesBearer) {
          console.warn(
            `${logPrefix} Skipping plugin MCP ${mcp.slug}: user_headers auth_config has no header or bearer bindings`,
          );
          dropDiag(
            mcp,
            "mcp_server_not_resolved",
            "user_headers auth_config has no header or bearer bindings",
          );
          continue;
        }
        if (probe) {
          // Probe path: activation check only. Full header/token resolution
          // can MINT plugin activation tokens (WorkOS rotates refresh tokens
          // — mint at most one per activation), so the inspector never runs it.
          const active = await (
            await getPluginAuth()
          ).hasActiveActivation(requesterUserId, pluginInstallId);
          if (!active) {
            dropDiag(
              mcp,
              "plugin_activation_missing",
              "requester has no active activation for this plugin",
            );
            continue;
          }
          mcpConfigs.push(probeMcpServerConfig(mcp, "active"));
          includedPluginUrls.add(normalizeServerUrl(mcp.url));
          continue;
        }
        if (headerNames.length > 0) {
          const resolved = await (
            await getPluginAuth()
          ).resolveHeaders({
            requesterUserId,
            pluginInstallId,
            resource: mcp.url,
            slug: mcp.slug ?? mcp.name,
            headerNames,
            logPrefix,
          });
          if (!resolved) continue;
          pluginHeaders = resolved;
        }
        if (usesBearer) {
          const resolved = await (
            await getPluginAuth()
          ).resolveToken({
            requesterUserId,
            pluginInstallId,
            resource: mcp.url,
            slug: mcp.slug ?? mcp.name,
            logPrefix,
          });
          if (!resolved) continue;
          pluginToken = resolved;
        }
      } else {
        // Non-OAuth plugin servers with user-supplied credentials still gate
        // on the requester's active activation.
        const active = await (
          await getPluginAuth()
        ).hasActiveActivation(requesterUserId, pluginInstallId);
        if (!active) {
          console.warn(
            `${logPrefix} Skipping plugin MCP ${mcp.slug}: requester has no active activation`,
          );
          dropDiag(
            mcp,
            "plugin_activation_missing",
            "requester has no active activation for this plugin",
          );
          continue;
        }
      }
      mcpConfigs.push(
        probe
          ? probeMcpServerConfig(mcp, "active")
          : toMcpServerConfig(mcp, pluginToken, pluginHeaders),
      );
      includedPluginUrls.add(normalizeServerUrl(mcp.url));
      continue;
    }

    // ── Direct servers ────────────────────────────────────────────────
    // URL dedupe: a plugin entry with the same endpoint already resolved
    // for this requester wins — never dispatch both.
    if (includedPluginUrls.has(normalizeServerUrl(mcp.url))) {
      console.log(
        `${logPrefix} Skipping direct MCP ${mcp.slug}: deduped against an active plugin server with the same URL`,
      );
      continue;
    }

    // Direct service_credential servers (e.g. the first-party analyst
    // query broker, THINK-228) resolve tenant-owned credentials exactly
    // like their plugin-managed counterparts above. Without this branch
    // the row fell through to `toMcpServerConfig(mcp, undefined)` — no
    // bearer, no headers — and the Pi container's parseMcpConfigs
    // silently drops auth-less servers, so the tool never reached the
    // model despite "MCP configs built" listing the server.
    if (mcp.auth_type === "service_credential") {
      if (probe) {
        const status = probeServiceCredentialConfig(
          (mcp.auth_config as Record<string, unknown>) || {},
        );
        if (status !== "configured") {
          dropDiag(mcp, "credential_missing", status);
          continue;
        }
        mcpConfigs.push(probeMcpServerConfig(mcp, "configured"));
        continue;
      }
      const resolved = await resolveServiceCredentialAuth(
        (mcp.auth_config as Record<string, unknown>) || {},
        logPrefix,
        mcp.slug ?? mcp.name,
      );
      if (!resolved) {
        dropDiag(
          mcp,
          "credential_missing",
          "service credential did not resolve",
        );
        continue;
      }
      let contextHeaders = resolved.headers;
      let sidecarBudgets: McpServerConfig["sidecarBudgets"];
      const directConfig = toMcpServerConfig(
        mcp,
        resolved.token,
        contextHeaders,
      );
      if (sidecarBudgets) directConfig.sidecarBudgets = sidecarBudgets;
      mcpConfigs.push(directConfig);
      continue;
    }

    if (probe) {
      // Probe path (KTD-1): classify from stored metadata only — never a
      // Secrets Manager read, never a token refresh.
      if (mcp.auth_type === "tenant_api_key") {
        const authCfg = (mcp.auth_config as Record<string, unknown>) || {};
        const hasRef =
          (typeof authCfg.secretRef === "string" && authCfg.secretRef.trim()) ||
          (typeof authCfg.token === "string" && authCfg.token.length > 0);
        if (!hasRef) {
          dropDiag(mcp, "credential_missing", "tenant API key not configured");
          continue;
        }
        mcpConfigs.push(probeMcpServerConfig(mcp, "configured"));
        continue;
      }
      if (mcp.auth_type === "oauth" || mcp.auth_type === "per_user_oauth") {
        const directOAuthUserId = requesterUserId ?? humanPairId;
        if (!directOAuthUserId) {
          dropDiag(
            mcp,
            "oauth_missing",
            "no requesting user and no human pair to resolve OAuth for this server",
          );
          continue;
        }
        const status = await probePerUserOAuth(
          directOAuthUserId,
          mcp,
          deps.userOAuth,
        );
        if (status === "missing") {
          dropDiag(
            mcp,
            "oauth_missing",
            requesterUserId
              ? "requester has not completed OAuth for this server"
              : "human pair has not completed OAuth for this server",
          );
          continue;
        }
        mcpConfigs.push(probeMcpServerConfig(mcp, status));
        continue;
      }
      if (mcp.auth_type === "per_user_api_key") {
        const keyUserId = requesterUserId ?? humanPairId;
        if (!keyUserId) {
          dropDiag(
            mcp,
            "credential_missing",
            "no requesting user and no human pair to resolve a personal API key for this server",
          );
          continue;
        }
        const status = await probeUserMcpTokenStatus({
          userId: keyUserId,
          mcpServerId: mcp.mcp_server_id,
        });
        if (status === "missing") {
          dropDiag(
            mcp,
            "credential_missing",
            requesterUserId
              ? "requester has not saved a personal API key for this server"
              : "human pair has not saved a personal API key for this server",
          );
          continue;
        }
        mcpConfigs.push(probeMcpServerConfig(mcp, status));
        continue;
      }
      mcpConfigs.push(probeMcpServerConfig(mcp));
      continue;
    }

    let token: string | undefined;

    if (mcp.auth_type === "tenant_api_key") {
      const authCfg = (mcp.auth_config as Record<string, unknown>) || {};
      token = await resolveTenantApiKeyToken(authCfg, logPrefix, mcp.slug);
    } else if (
      mcp.auth_type === "oauth" ||
      mcp.auth_type === "per_user_oauth"
    ) {
      const directOAuthUserId = requesterUserId ?? humanPairId;
      if (directOAuthUserId) {
        token = await resolvePerUserOAuth(
          directOAuthUserId,
          mcp,
          logPrefix,
          deps.userOAuth,
        );
      }
    } else if (mcp.auth_type === "per_user_api_key") {
      // Same user_mcp_tokens + Secrets Manager custody as per-user OAuth,
      // but never the external OAuth resolver: the stored key IS the
      // bearer, and rows carry no expiry so the refresh path is inert.
      const keyUserId = requesterUserId ?? humanPairId;
      if (keyUserId) {
        token = await resolveUserMcpBearerToken({
          userId: keyUserId,
          mcp,
          logPrefix,
        });
      }
    }

    if (mcp.auth_type === "tenant_api_key" && !token) {
      console.warn(
        `${logPrefix} Skipping MCP ${mcp.slug}: tenant API key not configured`,
      );
      dropDiag(mcp, "credential_missing", "tenant API key not configured");
      continue;
    }
    if (
      (mcp.auth_type === "oauth" || mcp.auth_type === "per_user_oauth") &&
      !token
    ) {
      console.warn(
        `${logPrefix} Skipping MCP ${mcp.slug}: user has not completed OAuth`,
      );
      dropDiag(mcp, "oauth_missing", "user has not completed OAuth");
      continue;
    }
    if (mcp.auth_type === "per_user_api_key" && !token) {
      console.warn(
        `${logPrefix} Skipping MCP ${mcp.slug}: user has not saved a personal API key`,
      );
      dropDiag(
        mcp,
        "credential_missing",
        "user has not saved a personal API key for this server",
      );
      continue;
    }

    // THINK-227 U10 (KTD10): the admin-ops surface gets the TURN's identity
    // as connection headers, injected HERE — server-side, per invocation —
    // so the automation write tools' authorization pivot is never a
    // model-controllable tool argument. Same per-server injection pattern as
    // the analyst broker's caller context above.
    let identityHeaders: Record<string, string> | undefined;
    if (mcp.auth_type === "tenant_api_key" && isAdminOpsUrl(mcp.url)) {
      const actingUserId = requesterUserId ?? humanPairId ?? null;
      identityHeaders = {
        ...(actingUserId
          ? { [ADMIN_OPS_ACTING_USER_HEADER]: actingUserId }
          : {}),
        [ADMIN_OPS_AGENT_ID_HEADER]: agentId,
      };
    }

    mcpConfigs.push(toMcpServerConfig(mcp, token, identityHeaders));
  }

  if (mcpConfigs.length > 0) {
    console.log(
      `${logPrefix} MCP configs built: ${mcpConfigs.length} servers (${mcpConfigs.map((c) => c.name).join(", ")})`,
    );
  }

  return mcpConfigs;
}

/** The approved+enabled tenant registry row `serverRows` yields. */
type McpRegistryServerRow = Omit<
  McpJoinedRow,
  "assignment_enabled" | "assignment_config"
>;

/**
 * Registry-default fallback (THINK-173 U11): every approved + enabled
 * tenant server, attached-by-default with no per-agent overlay. This is
 * what the retired `agent_mcp_servers` read produced for an agent with
 * zero assignment rows — the only case that still reaches this fallback,
 * since any per-agent assignment change dual-writes an `mcp/<slug>/`
 * file (which makes the file path serve resolution instead). Per-agent
 * disable/allowlist state lives ONLY in files/folders.
 */
function resolveRegistryDefaultRows(
  serverRows: readonly McpRegistryServerRow[],
): McpJoinedRow[] {
  return serverRows.map((row) => ({
    ...row,
    assignment_enabled: true,
    assignment_config: null,
  }));
}

/**
 * Folder-manifest resolution (THINK-173 U5): the agent's attached
 * connection set is the rendered manifest's ACTIVE mcp-type connection
 * entries. Each joins to the approved+enabled tenant registry via the
 * sidecar's `registryServerId` credential ref (the backfill writes it;
 * R17 — same secrets, same rows) with a slug match fallback, so the
 * U11 approval/hash gate and the entire per-user OAuth auth loop below
 * apply unchanged (KTD-2: the auth half survives as a credential
 * resolver over folder-derived connections). `permittedOperations`
 * becomes the toolAllowlist overlay. The workspace TOOLS.md MCP policy
 * is NOT applied here — the manifest already carries that verdict
 * (KTD-6), so callers must not re-filter the folder path.
 */
function resolveAttachedRowsFromFolderConnections(input: {
  manifest: CapabilitiesManifest;
  serverRows: readonly McpRegistryServerRow[];
  logPrefix: string;
}): McpJoinedRow[] {
  const registryById = new Map(
    input.serverRows.map((row) => [row.mcp_server_id, row]),
  );
  const registryBySlug = new Map(
    input.serverRows
      .filter((row) => row.slug)
      .map((row) => [row.slug as string, row]),
  );
  const rows: McpJoinedRow[] = [];
  for (const entry of input.manifest.active) {
    // THINK-302 U4c: first-class `mcp` grants (mcp/<slug>/MCP.md). The
    // MCP.md `server` frontmatter is the tenant registry reference (id or
    // slug); `enabledTools` is the tool allowlist. Secrets never enter the
    // tree (R10) — they resolve from the joined tenant_mcp_servers row here,
    // through the SAME U11 approval/url_hash gate + per-user auth loop the
    // caller applies to every McpJoinedRow. Replaces the connectors→mcp
    // mirror; the legacy mcp-type CONNECTION path below stays for the
    // dual-read window until U9.
    if (entry.class === "mcp") {
      const ref = typeof entry.server === "string" ? entry.server : undefined;
      const registry = ref
        ? (registryById.get(ref) ?? registryBySlug.get(ref))
        : undefined;
      if (!registry) {
        console.warn(
          `${input.logPrefix} skipping mcp/${entry.slug}: no approved+enabled tenant registry row (server=${ref ?? "(missing)"})`,
        );
        continue;
      }
      const allow = Array.isArray(entry.enabledTools)
        ? entry.enabledTools.filter(
            (tool): tool is string => typeof tool === "string",
          )
        : [];
      rows.push({
        ...registry,
        assignment_enabled: true,
        assignment_config: allow.length > 0 ? { toolAllowlist: allow } : {},
      });
      continue;
    }
    if (entry.class !== "connection") continue;
    if (entry.type !== "mcp") continue;
    const refId = entry.credentialRefs?.registryServerId;
    const registry =
      (typeof refId === "string" ? registryById.get(refId) : undefined) ??
      registryBySlug.get(entry.slug);
    if (!registry) {
      console.warn(
        `${input.logPrefix} skipping connections/${entry.slug}: no approved+enabled tenant registry row (registryServerId=${
          typeof refId === "string" ? refId : "(missing)"
        })`,
      );
      continue;
    }
    const permitted = Array.isArray(entry.permittedOperations)
      ? entry.permittedOperations.filter(
          (operation): operation is string => typeof operation === "string",
        )
      : [];

    rows.push({
      ...registry,
      assignment_enabled: true,
      assignment_config: {
        ...(permitted.length > 0 ? { toolAllowlist: permitted } : {}),
      },
    });
  }
  return rows;
}

/**
 * File-preferred resolution (Composer plan U9b): the agent's ATTACHED server
 * set is the `mcp/<slug>/.assignment.json` files U9a dual-writes into the
 * agent workspace source. Each file references a `registryServerId`; we join
 * it to the approved+enabled tenant registry (`serverRows`) so the U11
 * approval/hash gate in the caller's loop still applies. `enabledTools`
 * becomes the `toolAllowlist` overlay — the exact inverse of what U9a wrote
 * from `agent_mcp_servers.config`, so output is parity-identical for shared
 * data.
 *
 * Returns `{ fallbackReason }` (never throws) whenever the file listing is
 * empty or unavailable, so the caller runs the DB path. Files whose
 * `registryServerId` isn't an approved+enabled server, or that are unreadable,
 * are tolerated (skipped + logged, not fatal). A file marked `enabled:false`
 * excludes the server, mirroring a DB-disabled assignment.
 */
async function resolveAttachedRowsFromWorkspaceFiles(input: {
  agentId: string;
  agentSlug: string | null | undefined;
  serverRows: readonly McpRegistryServerRow[];
  logPrefix: string;
  helpers?: WorkspaceMcpHelpers;
}): Promise<
  { rows: McpJoinedRow[]; fileCount: number } | { fallbackReason: string }
> {
  const { agentId, agentSlug, serverRows, logPrefix } = input;
  // Cheap local gate: without the agent's own slug the workspace prefix is
  // unresolvable. Short-circuiting here keeps the S3/graphql-utils dependency
  // graph out of the DB-only path (and out of DB-mocked unit tests).
  if (!agentSlug) return { fallbackReason: "no-agent-slug" };

  let helpers: WorkspaceMcpHelpers;
  try {
    helpers = input.helpers ?? (await loadWorkspaceMcpHelpers());
  } catch (err) {
    console.warn(
      `${logPrefix} workspace MCP store unavailable, falling back to DB:`,
      err instanceof Error ? err.message : err,
    );
    return { fallbackReason: "store-load-error" };
  }

  const targetPrefix = await helpers
    .resolveAgentWorkspacePrefix(agentId)
    .catch(() => null);
  if (!targetPrefix) return { fallbackReason: "no-workspace-prefix" };

  const slugs = await helpers.listWorkspaceMcpSlugs(targetPrefix);
  // null = no bucket / list error (helper logs the cause); [] = folder absent.
  // Both fall back so cutover is conservative until DB retirement.
  if (slugs === null) return { fallbackReason: "workspace-unavailable" };
  if (slugs.length === 0) return { fallbackReason: "no-attachment-files" };

  const states = await Promise.all(
    slugs.map(async (slug) => ({
      slug,
      state: await helpers.readMcpAssignmentState(targetPrefix, slug),
    })),
  );

  const registryById = new Map(
    serverRows.map((row) => [row.mcp_server_id, row]),
  );
  const rows: McpJoinedRow[] = [];
  for (const { slug, state } of states) {
    if (!state) {
      console.warn(
        `${logPrefix} skipping mcp/${slug}: assignment file unreadable`,
      );
      continue;
    }
    if (state.enabled === false) continue;
    const registry = state.registryServerId
      ? registryById.get(state.registryServerId)
      : undefined;
    if (!registry) {
      console.warn(
        `${logPrefix} skipping mcp/${slug}: registryServerId ${
          state.registryServerId ?? "(missing)"
        } is not an approved+enabled tenant server`,
      );
      continue;
    }
    const enabledTools = Array.isArray(state.enabledTools)
      ? state.enabledTools.filter(
          (tool): tool is string => typeof tool === "string",
        )
      : [];
    rows.push({
      ...registry,
      assignment_enabled: true,
      assignment_config:
        enabledTools.length > 0 ? { toolAllowlist: enabledTools } : null,
    });
  }
  return { rows, fileCount: slugs.length };
}

/**
 * Probe a user's stored MCP OAuth token status from user_mcp_tokens metadata
 * only (capability-mapping plan U3, KTD-1). No Secrets Manager read, no
 * refresh, no writes — the inspector's zero-side-effect counterpart to
 * resolveUserMcpBearerToken.
 */
async function probeUserMcpTokenStatus(args: {
  userId: string;
  mcpServerId: string;
}): Promise<"active" | "expired" | "missing"> {
  const [userToken] = await db
    .select({
      secret_ref: userMcpTokens.secret_ref,
      expires_at: userMcpTokens.expires_at,
    })
    .from(userMcpTokens)
    .where(
      and(
        eq(userMcpTokens.user_id, args.userId),
        eq(userMcpTokens.mcp_server_id, args.mcpServerId),
        eq(userMcpTokens.status, "active"),
      ),
    )
    .limit(1);
  if (!userToken?.secret_ref) return "missing";
  const EXPIRY_BUFFER_MS = 5 * 60 * 1000;
  const isExpired =
    userToken.expires_at &&
    new Date(userToken.expires_at).getTime() - Date.now() < EXPIRY_BUFFER_MS;
  return isExpired ? "expired" : "active";
}

/** Probe-mode service-credential config check — presence only, no secret read. */
function probeServiceCredentialConfig(
  authCfg: Record<string, unknown>,
): "configured" | string {
  if (typeof authCfg.revokedAt === "string" || authCfg.revoked === true) {
    return "service credential is revoked";
  }
  const secretRef =
    typeof authCfg.secretRef === "string" && authCfg.secretRef.trim();
  if (!secretRef) return "service credential secret ref is missing";
  if (serviceCredentialHeaderBindings(authCfg).length === 0) {
    return "service credential auth_config has no header bindings";
  }
  return "configured";
}

/** Probe-mode config: same shape as the runtime config but never carries auth material. */
function probeMcpServerConfig(
  mcp: Parameters<typeof toMcpServerConfig>[0],
  tokenStatus?: "active" | "expired" | "configured",
): McpServerConfig {
  const config = toMcpServerConfig(mcp, undefined);
  delete config.auth;
  if (tokenStatus) config.tokenStatus = tokenStatus;
  return config;
}

/**
 * Resolve a caller's bearer token for a tenant MCP server from
 * `user_mcp_tokens`, refreshing it when expired.
 *
 * Exported because it is the only per-user MCP credential path that exists.
 * Twenty's REST client used to reach its token through plugin activation
 * instead; migration 0279 nulled every `plugin_install_id`, which left that
 * route resolving nothing. Both surfaces read the same token here now.
 */
export async function resolveUserMcpBearerToken(args: {
  userId: string;
  mcp: {
    mcp_server_id: string;
    slug: string | null;
    name: string;
    url: string;
    auth_config: unknown;
  };
  logPrefix: string;
  fallbackLabel?: string;
}): Promise<string | undefined> {
  const { userId, mcp, logPrefix } = args;
  const slug = mcp.slug ?? mcp.name;
  try {
    const [userToken] = await db
      .select({
        id: userMcpTokens.id,
        secret_ref: userMcpTokens.secret_ref,
        status: userMcpTokens.status,
        expires_at: userMcpTokens.expires_at,
      })
      .from(userMcpTokens)
      .where(
        and(
          eq(userMcpTokens.user_id, userId),
          eq(userMcpTokens.mcp_server_id, mcp.mcp_server_id),
          eq(userMcpTokens.status, "active"),
        ),
      )
      .limit(1);
    if (!userToken?.secret_ref) {
      console.warn(
        `${logPrefix} No active MCP token for user ${userId} (MCP: ${slug})`,
      );
      return undefined;
    }

    const sm = new SecretsManagerClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
    const secret = await sm.send(
      new GetSecretValueCommand({ SecretId: userToken.secret_ref }),
    );
    if (!secret.SecretString) return undefined;
    const parsed = JSON.parse(secret.SecretString);
    const accessToken =
      typeof parsed.access_token === "string" ? parsed.access_token : "";
    const refreshToken =
      typeof parsed.refresh_token === "string" ? parsed.refresh_token : "";
    const EXPIRY_BUFFER_MS = 5 * 60 * 1000;
    const isExpired =
      userToken.expires_at &&
      new Date(userToken.expires_at).getTime() - Date.now() < EXPIRY_BUFFER_MS;

    if (!isExpired) return accessToken || undefined;
    if (!refreshToken) return accessToken || undefined;

    // WorkOS public-client refresh REQUIRES client_id in the body.
    // It's stored in tenant_mcp_servers.auth_config at DCR time.
    const authCfg = (mcp.auth_config as Record<string, unknown>) || {};
    const clientId =
      typeof authCfg.client_id === "string" ? authCfg.client_id : "";
    if (!clientId) {
      console.warn(
        `${logPrefix} MCP token for ${slug} needs refresh but auth_config.client_id is missing; user must reconnect from mobile to re-run DCR`,
      );
      return accessToken || undefined;
    }

    console.log(
      `${logPrefix} MCP token expired for ${slug}, refreshing${args.fallbackLabel ? ` ${args.fallbackLabel}` : ""}...`,
    );
    try {
      const mcpBaseUrl = mcp.url.replace(/\/+$/, "");
      const serverPath = new URL(mcpBaseUrl).pathname.replace(/^\//, "");
      const wellKnownUrl = `${new URL(mcpBaseUrl).origin}/.well-known/oauth-protected-resource/${serverPath}`;
      const resMeta = await fetch(wellKnownUrl, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resMeta.ok) return undefined;
      const meta = (await resMeta.json()) as {
        authorization_servers?: string[];
      };
      const authServer = meta.authorization_servers?.[0];
      if (!authServer) return undefined;
      const authMetaRes = await fetch(
        `${authServer}/.well-known/oauth-authorization-server`,
        { signal: AbortSignal.timeout(5000) },
      ).catch(() => null);
      const oidcRes = authMetaRes?.ok
        ? authMetaRes
        : await fetch(`${authServer}/.well-known/openid-configuration`, {
            signal: AbortSignal.timeout(5000),
          });
      if (!oidcRes.ok) return undefined;
      const authMeta = (await oidcRes.json()) as {
        token_endpoint: string;
      };
      const refreshRes = await fetch(authMeta.token_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: clientId,
        }).toString(),
        signal: AbortSignal.timeout(10000),
      });
      if (!refreshRes.ok) {
        const errBody = await refreshRes.text().catch(() => "");
        console.warn(
          `${logPrefix} MCP token refresh failed for ${slug}: ${refreshRes.status} ${errBody}`,
        );
        await db
          .update(userMcpTokens)
          .set({
            status: "expired",
            updated_at: new Date(),
          })
          .where(eq(userMcpTokens.id, userToken.id));
        return undefined;
      }
      const refreshData = (await refreshRes.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      const refreshedToken = refreshData.access_token;
      const updatedSecret = {
        access_token: refreshedToken,
        refresh_token: refreshData.refresh_token || refreshToken,
        token_type: parsed.token_type || "Bearer",
        obtained_at: new Date().toISOString(),
      };
      await sm.send(
        new UpdateSecretCommand({
          SecretId: userToken.secret_ref,
          SecretString: JSON.stringify(updatedSecret),
        }),
      );
      const newExpiry = refreshData.expires_in
        ? new Date(Date.now() + refreshData.expires_in * 1000)
        : null;
      await db
        .update(userMcpTokens)
        .set({
          expires_at: newExpiry,
          updated_at: new Date(),
        })
        .where(eq(userMcpTokens.id, userToken.id));
      console.log(`${logPrefix} MCP token refreshed for ${slug}`);
      return refreshedToken;
    } catch (refreshErr) {
      console.warn(
        `${logPrefix} MCP token refresh error for ${slug}:`,
        refreshErr,
      );
      return undefined;
    }
  } catch (err) {
    console.warn(`${logPrefix} MCP token lookup failed for ${slug}:`, err);
    return undefined;
  }
}

function toMcpServerConfig(
  mcp: {
    slug: string | null;
    name: string;
    url: string;
    transport: string | null;
    tools: unknown;
    assignment_config: unknown;
    runtime_metadata?: unknown;
    management_source?: unknown;
    plugin_install_id?: unknown;
    auth_type?: unknown;
  },
  token: string | undefined,
  headers?: Record<string, string>,
): McpServerConfig {
  const assignCfg = (mcp.assignment_config as Record<string, unknown>) || {};
  const toolAllowlist = Array.isArray(assignCfg.toolAllowlist)
    ? (assignCfg.toolAllowlist as string[]).filter(
        (tool): tool is string => typeof tool === "string",
      )
    : undefined;
  const availableTools = extractMcpToolNames(mcp.tools);
  const recordLinkHints =
    mcp.management_source === "plugin" && mcp.plugin_install_id
      ? extractMcpRuntimeRecordLinkHints(mcp.runtime_metadata)
      : undefined;
  const resultTransforms =
    mcp.management_source === "plugin" && mcp.plugin_install_id
      ? extractMcpRuntimeResultTransforms(mcp.runtime_metadata)
      : undefined;
  const config: McpServerConfig = {
    name: mcp.slug ?? mcp.name,
    url: mcp.url,
    transport:
      (mcp.transport as "streamable-http" | "sse") || "streamable-http",
  };
  if (token) {
    config.auth = headers
      ? { type: "bearer", token, headers }
      : { type: "bearer", token };
  } else if (headers) {
    config.auth = { type: "headers", headers };
  }
  if (toolAllowlist) config.tools = toolAllowlist;
  if (availableTools.length > 0) config.availableTools = availableTools;
  if (isTrustedInternalNoAuthPluginMcp(mcp)) {
    config.trustedInternal = true;
  }
  if (recordLinkHints) config.recordLinkHints = recordLinkHints;
  if (resultTransforms) config.resultTransforms = resultTransforms;
  // THINK-623 — ungated (unlike the plugin-only hints above): the Brain
  // connector is an operator-configured server row, not a plugin install.
  if (recordOrNull(mcp.runtime_metadata)?.longRunning === true) {
    config.longRunning = true;
  }
  return config;
}

function extractMcpRuntimeResultTransforms(
  runtimeMetadata: unknown,
): McpResultTransform[] | undefined {
  const metadata = recordOrNull(runtimeMetadata);
  const transforms = metadata?.resultTransforms;
  if (
    !Array.isArray(transforms) ||
    transforms.length === 0 ||
    transforms.length > 8
  ) {
    return undefined;
  }
  const normalized: McpResultTransform[] = [];
  for (const value of transforms) {
    const transform = recordOrNull(value);
    if (
      !transform ||
      transform.type !== "scaled-integer-to-decimal" ||
      typeof transform.sourceField !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(transform.sourceField) ||
      typeof transform.targetField !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(transform.targetField) ||
      transform.sourceField === transform.targetField ||
      !Number.isInteger(transform.scale) ||
      (transform.scale as number) < 0 ||
      (transform.scale as number) > 12 ||
      (transform.removeSource !== undefined &&
        typeof transform.removeSource !== "boolean")
    ) {
      return undefined;
    }
    normalized.push({
      type: "scaled-integer-to-decimal",
      sourceField: transform.sourceField,
      targetField: transform.targetField,
      scale: transform.scale as number,
      ...(transform.removeSource !== undefined
        ? { removeSource: transform.removeSource }
        : {}),
    });
  }
  return normalized;
}

function isTrustedInternalNoAuthPluginMcp(mcp: {
  url: string;
  management_source?: unknown;
  plugin_install_id?: unknown;
  auth_type?: unknown;
}): boolean {
  if (
    mcp.management_source !== "plugin" ||
    !mcp.plugin_install_id ||
    mcp.auth_type !== "none"
  ) {
    return false;
  }
  try {
    // Only server-built plugin configs for internal HTTP endpoints get the Pi
    // private-network bypass. Public HTTPS no-auth plugins stay untrusted.
    return new URL(mcp.url).protocol === "http:";
  } catch {
    return false;
  }
}

const RECORD_LINK_FIELD_RE =
  /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*){0,4}$/;
const RECORD_LINK_OBJECT_TYPE_RE = /^[a-z][a-z0-9-]{1,63}$/;
const RECORD_LINK_TEMPLATE_SEGMENT_RE = /^[A-Za-z0-9._~-]+$|^\{id\}$/;
const RECORD_LINK_FORBIDDEN_FIELD_PARTS = [
  "auth_config",
  "authorization",
  "cookie",
  "token",
  "secret",
  "password",
  "credential",
  "header",
];

function extractMcpRuntimeRecordLinkHints(
  runtimeMetadata: unknown,
): McpRuntimeRecordLinkHints | undefined {
  const metadata = recordOrNull(runtimeMetadata);
  const hints = recordOrNull(metadata?.recordLinkHints);
  if (!hints) return undefined;
  if (hints.schemaVersion !== 1 || hints.source !== "plugin-manifest") {
    return undefined;
  }
  const browserBaseUrl =
    typeof hints.browserBaseUrl === "string" ? hints.browserBaseUrl : "";
  if (!isSafeBrowserBaseUrl(browserBaseUrl)) return undefined;
  if (!Array.isArray(hints.routes) || hints.routes.length === 0) {
    return undefined;
  }

  const routes: McpRuntimeRecordLinkRouteHint[] = [];
  const seenObjectTypes = new Set<string>();
  for (const route of hints.routes) {
    const normalizedRoute = normalizeRecordLinkRoute(route);
    if (!normalizedRoute) return undefined;
    if (seenObjectTypes.has(normalizedRoute.objectType)) return undefined;
    seenObjectTypes.add(normalizedRoute.objectType);
    routes.push(normalizedRoute);
  }

  const workspace = recordOrNull(hints.workspace);
  const normalizedWorkspace =
    workspace === undefined
      ? undefined
      : normalizeRecordLinkWorkspace(workspace);
  if (workspace !== undefined && !normalizedWorkspace) return undefined;

  return {
    schemaVersion: 1,
    source: "plugin-manifest",
    browserBaseUrl,
    routes,
    ...(normalizedWorkspace ? { workspace: normalizedWorkspace } : {}),
  };
}

function normalizeRecordLinkRoute(
  value: unknown,
): McpRuntimeRecordLinkRouteHint | undefined {
  const route = recordOrNull(value);
  if (!route) return undefined;
  const objectType =
    typeof route.objectType === "string" ? route.objectType : "";
  const routeTemplate =
    typeof route.routeTemplate === "string" ? route.routeTemplate : "";
  if (!RECORD_LINK_OBJECT_TYPE_RE.test(objectType)) return undefined;
  if (!isSafeRecordLinkRouteTemplate(routeTemplate)) return undefined;
  const idFields = normalizeRecordLinkFieldList(route.idFields);
  const labelFields = normalizeRecordLinkFieldList(route.labelFields);
  if (route.idFields !== undefined && !idFields) return undefined;
  if (route.labelFields !== undefined && !labelFields) return undefined;
  return {
    objectType,
    routeTemplate,
    ...(idFields ? { idFields } : {}),
    ...(labelFields ? { labelFields } : {}),
  };
}

function normalizeRecordLinkWorkspace(
  value: Record<string, unknown>,
): { hashField: string } | undefined {
  const hashField = typeof value.hashField === "string" ? value.hashField : "";
  if (!isSafeRecordLinkField(hashField)) return undefined;
  return { hashField };
}

function normalizeRecordLinkFieldList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const fields: string[] = [];
  const seen = new Set<string>();
  for (const field of value) {
    if (!isSafeRecordLinkField(field)) return undefined;
    if (seen.has(field)) return undefined;
    seen.add(field);
    fields.push(field);
  }
  return fields;
}

function isSafeRecordLinkField(value: unknown): value is string {
  if (typeof value !== "string" || !RECORD_LINK_FIELD_RE.test(value)) {
    return false;
  }
  const normalized = value.toLowerCase();
  const parts = normalized.split(/[_.-]+/);
  return (
    !parts.includes("auth") &&
    !RECORD_LINK_FORBIDDEN_FIELD_PARTS.some((part) => normalized.includes(part))
  );
}

function isSafeRecordLinkRouteTemplate(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (/[?#\\%\s<>\[\]()"']/.test(value)) return false;
  if (/[\u0000-\u001F\u007F]/.test(value)) return false;
  const placeholders = value.match(/\{[^}]*\}/g) ?? [];
  if (placeholders.length !== 1 || placeholders[0] !== "{id}") return false;
  const segments = value.slice(1).split("/");
  if (segments.some((segment) => segment.length === 0)) return false;
  let idSegmentCount = 0;
  for (const segment of segments) {
    if (segment === "." || segment === "..") return false;
    if (!RECORD_LINK_TEMPLATE_SEGMENT_RE.test(segment)) return false;
    if (segment === "{id}") idSegmentCount += 1;
  }
  return idSegmentCount === 1;
}

function isSafeBrowserBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.href === url.origin + "/" &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && isLocalBrowserOrigin(url)))
    );
  } catch {
    return false;
  }
}

function isLocalBrowserOrigin(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("127.") ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function recordOrNull(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function userHeaderAuthUsesBearer(
  authConfig: Record<string, unknown> | null,
): boolean {
  return typeof authConfig?.bearerCredentialKey === "string";
}

function userHeaderNamesFromAuthConfig(
  authConfig: Record<string, unknown> | null,
): string[] {
  const headers = authConfig?.headers;
  if (!Array.isArray(headers)) return [];
  const names = headers
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return "";
      }
      const name = (entry as Record<string, unknown>).name;
      return typeof name === "string" ? name : "";
    })
    .filter((name) => name.length > 0);
  return [...new Set(names)];
}

async function resolveTenantApiKeyToken(
  authCfg: Record<string, unknown>,
  logPrefix: string,
  slug: string,
): Promise<string | undefined> {
  const secretRef =
    typeof authCfg.secretRef === "string" && authCfg.secretRef.trim()
      ? authCfg.secretRef.trim()
      : null;

  if (secretRef) {
    try {
      const sm = new SecretsManagerClient({
        region: process.env.AWS_REGION || "us-east-1",
      });
      const secret = await sm.send(
        new GetSecretValueCommand({ SecretId: secretRef }),
      );
      const token = extractTokenFromSecretString(secret.SecretString);
      if (token) return token;
      console.warn(
        `${logPrefix} tenant API key secret for ${slug} did not contain a token`,
      );
      return undefined;
    } catch (err) {
      console.warn(
        `${logPrefix} tenant API key secret lookup failed for ${slug}:`,
        err,
      );
      return undefined;
    }
  }

  const token = authCfg.token;
  return typeof token === "string" && token.length > 0 ? token : undefined;
}

interface ResolvedServiceCredentialAuth {
  token?: string;
  headers?: Record<string, string>;
}

interface ServiceCredentialHeaderBinding {
  name: string;
  secretJsonKey: string;
  valuePrefix?: string;
}

async function resolveServiceCredentialAuth(
  authCfg: Record<string, unknown>,
  logPrefix: string,
  slug: string,
): Promise<ResolvedServiceCredentialAuth | undefined> {
  if (typeof authCfg.revokedAt === "string" || authCfg.revoked === true) {
    console.warn(
      `${logPrefix} Skipping MCP ${slug}: service credential is revoked`,
    );
    return undefined;
  }
  const secretRef =
    typeof authCfg.secretRef === "string" && authCfg.secretRef.trim()
      ? authCfg.secretRef.trim()
      : null;
  if (!secretRef) {
    console.warn(
      `${logPrefix} Skipping MCP ${slug}: service credential secret ref is missing`,
    );
    return undefined;
  }
  const bindings = serviceCredentialHeaderBindings(authCfg);
  if (bindings.length === 0) {
    console.warn(
      `${logPrefix} Skipping MCP ${slug}: service credential auth_config has no header bindings`,
    );
    return undefined;
  }

  let secretValue: ServiceCredentialSecretValue | null = null;
  try {
    const sm = new SecretsManagerClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
    const secret = await sm.send(
      new GetSecretValueCommand({ SecretId: secretRef }),
    );
    secretValue = parseServiceCredentialSecret(secret.SecretString);
  } catch (err) {
    console.warn(
      `${logPrefix} service credential secret lookup failed for ${slug}:`,
      err,
    );
    return undefined;
  }
  if (!secretValue) {
    console.warn(`${logPrefix} service credential secret for ${slug} is empty`);
    return undefined;
  }

  let token: string | undefined;
  const headers: Record<string, string> = {};
  for (const binding of bindings) {
    const raw = serviceCredentialSecretField(
      secretValue,
      binding.secretJsonKey,
    );
    if (!raw) {
      console.warn(
        `${logPrefix} service credential secret for ${slug} is missing key ${binding.secretJsonKey}`,
      );
      return undefined;
    }
    const headerValue = `${binding.valuePrefix ?? ""}${raw}`;
    if (binding.name.toLowerCase() === "authorization") {
      const bearer = headerValue.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
      if (!bearer) {
        console.warn(
          `${logPrefix} service credential Authorization header for ${slug} must use Bearer auth`,
        );
        return undefined;
      }
      token = bearer;
    } else {
      headers[binding.name] = headerValue;
    }
  }

  const extraHeaders = Object.keys(headers).length > 0 ? headers : undefined;
  if (!token && !extraHeaders) {
    console.warn(
      `${logPrefix} service credential auth_config for ${slug} resolved no usable auth material`,
    );
    return undefined;
  }
  return { token, headers: extraHeaders };
}

function serviceCredentialHeaderBindings(
  authCfg: Record<string, unknown>,
): ServiceCredentialHeaderBinding[] {
  const headers = authCfg.headers;
  if (!Array.isArray(headers)) return [];
  const bindings: ServiceCredentialHeaderBinding[] = [];
  for (const header of headers) {
    if (!header || typeof header !== "object" || Array.isArray(header)) {
      continue;
    }
    const entry = header as Record<string, unknown>;
    if (
      typeof entry.name !== "string" ||
      !entry.name.trim() ||
      typeof entry.secretJsonKey !== "string" ||
      !entry.secretJsonKey.trim()
    ) {
      continue;
    }
    bindings.push({
      name: entry.name.trim(),
      secretJsonKey: entry.secretJsonKey.trim(),
      ...(typeof entry.valuePrefix === "string"
        ? { valuePrefix: entry.valuePrefix }
        : {}),
    });
  }
  return bindings;
}

type ServiceCredentialSecretValue = Record<string, unknown> | string;

function parseServiceCredentialSecret(
  secretString?: string,
): ServiceCredentialSecretValue | null {
  if (!secretString) return null;
  try {
    const parsed = JSON.parse(secretString) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return secretString.trim() ? secretString : null;
  }
}

function serviceCredentialSecretField(
  secretValue: ServiceCredentialSecretValue,
  key: string,
): string | undefined {
  if (typeof secretValue === "string") {
    return key === "token" && secretValue.trim()
      ? secretValue.trim()
      : undefined;
  }
  const value = secretValue[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function extractTokenFromSecretString(
  secretString?: string,
): string | undefined {
  if (!secretString) return undefined;
  try {
    const parsed = JSON.parse(secretString) as Record<string, unknown>;
    const token = parsed.token ?? parsed.apiKey ?? parsed.access_token;
    return typeof token === "string" && token.length > 0 ? token : undefined;
  } catch {
    return secretString.length > 0 ? secretString : undefined;
  }
}

/**
 * Ready-to-call target for a single tenant MCP server. `McpServerTarget` is the
 * transport-only shape `mcp-client-call.ts` consumes (url + optional bearer /
 * headers), so a resolved target can be handed straight to `mcpCallTool`.
 */
import type { McpServerTarget } from "./mcp-client-call.js";

export type ResolveTenantMcpServerTargetResult =
  | { kind: "ok"; target: McpServerTarget; authType: string }
  | { kind: "missing"; reason: string }
  | { kind: "needs_user"; reason: string };

/**
 * Resolve ONE tenant-scoped MCP server by name (or slug) to a ready-to-call
 * target for HEADLESS, no-user execution — the Living Artifacts canvas-refresh
 * path (THINK-145 U6, KTD7). Only tenant-owned auth models resolve unattended:
 *   - none               → no bearer
 *   - tenant_api_key      → resolveTenantApiKeyToken (Secrets Manager / inline)
 *   - service_credential  → resolveServiceCredentialAuth (Secrets Manager)
 *
 * Per-user auth (`oauth` / `per_user_oauth` / `user_headers`) returns
 * `needs_user`: a headless refresh has no user handle to resolve those (R9).
 * The refresh caller already excludes per-user bindings before calling — this
 * is defense in depth. A missing / disabled / unapproved server, or a
 * tenant-credential that fails to resolve, returns `missing`, which the caller
 * maps to a terminal BAD binding (R8). Secrets access is scoped to the
 * `tenantId` named here: only THIS tenant's server rows are read, and the
 * Secrets Manager fetch uses the row's own `auth_config.secretRef`.
 */
export async function resolveTenantMcpServerTarget(input: {
  tenantId: string;
  serverName: string;
  logPrefix?: string;
}): Promise<ResolveTenantMcpServerTargetResult> {
  const logPrefix = input.logPrefix ?? "[canvas-refresh]";
  const db = getDb();
  const [row] = await db
    .select({
      slug: tenantMcpServers.slug,
      name: tenantMcpServers.name,
      url: tenantMcpServers.url,
      transport: tenantMcpServers.transport,
      auth_type: tenantMcpServers.auth_type,
      auth_config: tenantMcpServers.auth_config,
      enabled: tenantMcpServers.enabled,
      status: tenantMcpServers.status,
    })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.tenant_id, input.tenantId),
        or(
          eq(tenantMcpServers.name, input.serverName),
          eq(tenantMcpServers.slug, input.serverName),
        ),
      ),
    )
    .limit(1);

  if (!row) {
    return { kind: "missing", reason: "MCP server no longer exists" };
  }
  if (row.status !== "approved" || row.enabled !== true) {
    return {
      kind: "missing",
      reason: `MCP server is not active (status=${row.status}, enabled=${row.enabled})`,
    };
  }

  const label = row.slug ?? row.name;
  const authType = row.auth_type ?? "none";
  const authCfg = (row.auth_config as Record<string, unknown>) || {};
  const target: McpServerTarget = { url: row.url, name: label };

  if (authType === "none") {
    return { kind: "ok", target, authType };
  }
  if (authType === "tenant_api_key") {
    const token = await resolveTenantApiKeyToken(authCfg, logPrefix, label);
    if (!token) {
      return { kind: "missing", reason: "tenant API key not configured" };
    }
    target.token = token;
    return { kind: "ok", target, authType };
  }
  if (authType === "service_credential") {
    const resolved = await resolveServiceCredentialAuth(
      authCfg,
      logPrefix,
      label,
    );
    if (!resolved) {
      return { kind: "missing", reason: "service credential did not resolve" };
    }
    if (resolved.token) target.token = resolved.token;
    if (resolved.headers) target.headers = resolved.headers;
    return { kind: "ok", target, authType };
  }
  // oauth / per_user_oauth / per_user_api_key / user_headers → requires a
  // per-user handle that a headless refresh does not have.
  return {
    kind: "needs_user",
    reason: `auth_type ${authType} requires a signed-in user`,
  };
}

/**
 * Resolve ONE tenant MCP server to a ready-to-call target ON BEHALF OF a named
 * user (THINK-172, U2b): the deliberate R9 widening that lets the canvas-refresh
 * Lambda exercise the REQUESTING OWNER's stored OAuth token. Callers must have
 * verified that `userId` is the authenticated principal who initiated the
 * refresh AND the owner of the binding being refreshed — this function only
 * resolves credentials, it does not authorize.
 *
 * Non-per-user auth types delegate to {@link resolveTenantMcpServerTarget}
 * (tenant credentials are never user-scoped). Per-user types resolve through
 * the same `user_mcp_tokens` + Secrets Manager + WorkOS-refresh plumbing the
 * workspace config builder uses (`resolveUserMcpBearerToken`). A missing or
 * expired-and-unrefreshable token returns `needs_user` — the caller degrades
 * to the agent-mediated path exactly as before.
 */
export async function resolveTenantMcpServerTargetForUser(input: {
  tenantId: string;
  serverName: string;
  userId: string;
  logPrefix?: string;
}): Promise<ResolveTenantMcpServerTargetResult> {
  const logPrefix = input.logPrefix ?? "[canvas-refresh]";
  const db = getDb();
  const [row] = await db
    .select({
      id: tenantMcpServers.id,
      slug: tenantMcpServers.slug,
      name: tenantMcpServers.name,
      url: tenantMcpServers.url,
      auth_type: tenantMcpServers.auth_type,
      auth_config: tenantMcpServers.auth_config,
      enabled: tenantMcpServers.enabled,
      status: tenantMcpServers.status,
    })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.tenant_id, input.tenantId),
        or(
          eq(tenantMcpServers.name, input.serverName),
          eq(tenantMcpServers.slug, input.serverName),
        ),
      ),
    )
    .limit(1);

  if (!row) {
    return { kind: "missing", reason: "MCP server no longer exists" };
  }
  if (row.status !== "approved" || row.enabled !== true) {
    return {
      kind: "missing",
      reason: `MCP server is not active (status=${row.status}, enabled=${row.enabled})`,
    };
  }

  const authType = row.auth_type ?? "none";
  if (
    authType !== "oauth" &&
    authType !== "per_user_oauth" &&
    authType !== "per_user_api_key" &&
    authType !== "user_headers"
  ) {
    return resolveTenantMcpServerTarget(input);
  }
  if (authType === "user_headers") {
    // No stored server-side credential exists for user_headers — the user
    // supplies headers per-session from the client.
    return {
      kind: "needs_user",
      reason: "user_headers auth cannot be resolved server-side",
    };
  }

  const label = row.slug ?? row.name;
  const token = await resolveUserMcpBearerToken({
    userId: input.userId,
    mcp: {
      mcp_server_id: row.id,
      slug: row.slug,
      name: row.name,
      url: row.url,
      auth_config: row.auth_config,
    },
    logPrefix,
    fallbackLabel: "for owner-initiated canvas refresh",
  });
  if (!token) {
    return {
      kind: "needs_user",
      reason:
        "no active connector token for the requesting owner — reconnect from mobile",
    };
  }
  return {
    kind: "ok",
    target: { url: row.url, name: label, token },
    authType,
  };
}

function extractMcpToolNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names = value
    .map((tool) => {
      if (typeof tool === "string") return tool;
      if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
        return "";
      }
      const name = (tool as Record<string, unknown>).name;
      return typeof name === "string" ? name : "";
    })
    .filter((name) => name.length > 0);
  return [...new Set(names)];
}
